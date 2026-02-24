import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import * as vscode from "vscode"
import { ApiHandler } from "../../../api"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { ApiMessage } from "../../task-persistence"
import { ProviderSettings } from "@coder/types"
import { Task } from "../Task"
import { TaskStateManager } from "../managers/TaskStateManager"
import { TaskMessageService } from "./TaskMessageService"
import { TaskToolService } from "./TaskToolService"
import { TaskInteractionService } from "./TaskInteractionService"
import { TaskMetricsService } from "./TaskMetricsService"
import { buildApiHandler } from "../../../api"
import { checkContextWindowExceededError } from "../../context/management/error-handling"
import { MAX_CONTEXT_WINDOW_RETRIES, MAX_EXPONENTIAL_BACKOFF_SECONDS, FORCED_CONTEXT_REDUCTION_PERCENT } from "../Task"
import { getEffectiveApiHistory, getMessagesSinceLastSummary } from "../../condense"
import { mergeConsecutiveApiMessages } from "../mergeConsecutiveApiMessages"
import { buildNativeToolsArrayWithRestrictions } from "../build-tools"
import { getModelId, getApiProtocol } from "@coder/types"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../../shared/cost"
import { serializeError } from "serialize-error"
import { SYSTEM_PROMPT } from "../../prompts/system"
import { McpServerManager } from "../../../services/mcp/McpServerManager"
import { McpHub } from "../../../services/mcp/McpHub"
import { manageContext, willManageContext } from "../../context/management"
import { getEnvironmentDetails } from "../../environment/getEnvironmentDetails"
import delay from "delay"
import pWaitFor from "p-wait-for"
import { CoderEventName } from "@coder/types"
import { Package } from "../../../shared/package"
import { getModeBySlug, defaultModeSlug } from "../../../shared/modes"
import { processUserContentMentions } from "../../mentions"
import { IgnoreMode } from "../../ignore/RooIgnoreController"
import { getModelMaxOutputTokens } from "../../../shared/api"
import { maybeRemoveImageBlocks } from "../../../api/transform/image-cleaning"

/**
 * API通信管理服务
 * 负责处理所有与API提供商的通信，包括请求、重试、速率限制等
 */
export class TaskApiService {
	apiConfiguration: ProviderSettings
	api: ApiHandler
	currentRequestAbortController: AbortController | undefined

	constructor(
		private task: Task,
		private stateManager: TaskStateManager,
		private messageService: TaskMessageService,
		private toolService: TaskToolService,
		private interactionService: TaskInteractionService,
		private metricsService: TaskMetricsService,
		apiConfiguration: ProviderSettings,
		api: ApiHandler,
	) {
		// 初始化API配置和处理器
		this.apiConfiguration = apiConfiguration
		this.api = api
	}

	/**
	 * 更新API配置并重建API处理器
	 */
	updateApiConfiguration(newConfig: ProviderSettings): void {
		this.apiConfiguration = newConfig
		this.api = buildApiHandler(newConfig)
	}

	/**
	 * 取消当前HTTP请求
	 */
	cancelCurrentRequest(): void {
		if (this.currentRequestAbortController) {
			console.log(`[Task#${this.task.taskId}.${this.task.instanceId}] Aborting current HTTP request`)
			this.currentRequestAbortController.abort()
			this.currentRequestAbortController = undefined
		}
	}

	/**
	 * 获取系统提示词
	 */
	async getSystemPrompt(): Promise<string> {
		const { mcpEnabled } = (await this.task.providerRef.deref()?.getState()) ?? {}
		let mcpHub: McpHub | undefined
		if (mcpEnabled ?? true) {
			const provider = this.task.providerRef.deref()

			if (!provider) {
				throw new Error("Provider reference lost during view transition")
			}

			// Wait for MCP hub initialization through McpServerManager
			mcpHub = await McpServerManager.getInstance(provider.context, provider)

			if (!mcpHub) {
				throw new Error("Failed to get MCP hub from server manager")
			}

			// Wait for MCP servers to be connected before generating system prompt
			await pWaitFor(() => !mcpHub!.isConnecting, { timeout: 10_000 }).catch(() => {
				console.error("MCP servers failed to connect in time")
			})
		}

		const rooIgnoreInstructions = this.task.rooIgnoreController?.getInstructions()

		const state = await this.task.providerRef.deref()?.getState()

		const {
			mode,
			customModes,
			customModePrompts,
			customInstructions,
			experiments,
			language,
			apiConfiguration,
			enableSubfolderRules,
			skillsEnabled,
			disabledSkills,
		} = state ?? {}

		return await (async () => {
			const provider = this.task.providerRef.deref()

			if (!provider) {
				throw new Error("Provider not available")
			}

			const modelInfo = this.api.getModel().info

			return SYSTEM_PROMPT(
				provider.context,
				this.task.cwd,
				false,
				mcpHub,
				this.task.diffStrategy,
				mode ?? defaultModeSlug,
				customModePrompts,
				customModes,
				customInstructions,
				experiments,
				language,
				rooIgnoreInstructions,
				{
					todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
					useAgentRules:
						vscode.workspace.getConfiguration(Package.name).get<boolean>("useAgentRules") ?? true,
					enableSubfolderRules: enableSubfolderRules ?? false,
					newTaskRequireTodos: vscode.workspace
						.getConfiguration(Package.name)
						.get<boolean>("newTaskRequireTodos", false),
					isStealthModel: modelInfo?.isStealthModel,
					skillsEnabled: skillsEnabled ?? true,
					disabledSkills: disabledSkills ?? [],
				},
				undefined, // todoList
				this.api.getModel().id,
				provider.getSkillsManager(),
			)
		})()
	}

	/**
	 * 执行API请求（带重试和错误处理）
	 */
	public async *attemptApiRequest(
		retryAttempt: number = 0,
		options: { skipProviderRateLimit?: boolean } = {},
	): AsyncGenerator<ApiStreamChunk, void, unknown> {
		const state = await this.task.providerRef.deref()?.getState()

		const {
			apiConfiguration,
			autoApprovalEnabled,
			requestDelaySeconds,
			mode,
			autoCondenseContext = true,
			autoCondenseContextPercent = 100,
			profileThresholds = {},
		} = state ?? {}

		// Get condensing configuration for automatic triggers.
		const customCondensingPrompt = state?.customSupportPrompts?.CONDENSE

		if (!options.skipProviderRateLimit) {
			await this.maybeWaitForProviderRateLimit(retryAttempt)
		}

		// Update last request time right before making the request
		;(this.task.constructor as any).lastGlobalApiRequestTime = performance.now()

		const systemPrompt = await this.getSystemPrompt()
		const { contextTokens } = this.metricsService.getTokenUsage()

		if (contextTokens) {
			const modelInfo = this.api.getModel().info

			const maxTokens = getModelMaxOutputTokens({
				modelId: this.api.getModel().id,
				model: modelInfo,
				settings: this.apiConfiguration,
			})

			const contextWindow = modelInfo.contextWindow

			// Get the current profile ID using the helper method
			const currentProfileId = this.getCurrentProfileId(state)
			
			// Check if context management will likely run (threshold check)
			const lastMessage = this.messageService.apiConversationHistory[this.messageService.apiConversationHistory.length - 1]
			const lastMessageContent = lastMessage?.content
			let lastMessageTokens = 0
			if (lastMessageContent) {
				lastMessageTokens = Array.isArray(lastMessageContent)
					? await this.api.countTokens(lastMessageContent)
					: await this.api.countTokens([{ type: "text", text: lastMessageContent as string }])
			}

			const contextManagementWillRun = willManageContext({
				totalTokens: contextTokens,
				contextWindow,
				maxTokens,
				autoCondenseContext,
				autoCondenseContextPercent,
				profileThresholds,
				currentProfileId,
				lastMessageTokens,
			})

			// Send condenseTaskContextStarted BEFORE manageContext to show in-progress indicator
			if (contextManagementWillRun && autoCondenseContext) {
				await this.task.providerRef
					.deref()
					?.postMessageToWebview({ type: "condenseTaskContextStarted", text: this.task.taskId })
			}

			// Build tools for condensing metadata
			let contextMgmtTools: OpenAI.Chat.ChatCompletionTool[] = []
			{
				const provider = this.task.providerRef.deref()
				if (provider) {
					const toolsResult = await buildNativeToolsArrayWithRestrictions({
						provider,
						cwd: this.task.cwd,
						mode,
						customModes: state?.customModes,
						experiments: state?.experiments,
						apiConfiguration,
						disabledTools: state?.disabledTools,
						modelInfo,
						skillsEnabled: state?.skillsEnabled,
						includeAllToolsWithRestrictions: false,
					})
					contextMgmtTools = toolsResult.tools
				}
			}

			// Build metadata with tools and taskId for the condensing API call
			const contextMgmtMetadata: any = {
				mode,
				taskId: this.task.taskId,
				...(contextMgmtTools.length > 0
					? {
						tools: contextMgmtTools,
						tool_choice: "auto",
						parallelToolCalls: true,
					}
					: {}),
			}

			// Only generate environment details when context management will actually run
			const contextMgmtEnvironmentDetails = contextManagementWillRun
				? await getEnvironmentDetails(this.task, true)
				: undefined

			// Get files read by Roo for code folding - only when context management will run
			const contextMgmtFilesReadByRoo =
				contextManagementWillRun && autoCondenseContext
					? await (this.task as any).getFilesReadByRooSafely("attemptApiRequest")
					: undefined

			try {
				const truncateResult = await manageContext({
					messages: this.messageService.apiConversationHistory,
					totalTokens: contextTokens,
					maxTokens,
					contextWindow,
					apiHandler: this.api,
					autoCondenseContext,
					autoCondenseContextPercent,
					systemPrompt,
					taskId: this.task.taskId,
					customCondensingPrompt,
					profileThresholds,
					currentProfileId,
					metadata: contextMgmtMetadata,
					environmentDetails: contextMgmtEnvironmentDetails,
					filesReadByRoo: contextMgmtFilesReadByRoo,
					cwd: this.task.cwd,
					rooIgnoreController: this.task.rooIgnoreController,
				})
				if (truncateResult.messages !== this.messageService.apiConversationHistory) {
					await this.messageService.overwriteApiConversationHistory(truncateResult.messages)
				}
				if (truncateResult.error) {
					await this.interactionService.say("condense_context_error", truncateResult.error)
				}
				if (truncateResult.summary) {
					const { summary, cost, prevContextTokens, newContextTokens = 0, condenseId } = truncateResult
					const contextCondense: any = {
						summary,
						cost,
						newContextTokens,
						prevContextTokens,
						condenseId,
					}
					await this.interactionService.say(
						"condense_context",
						undefined /* text */,
						undefined /* images */,
						false /* partial */,
						undefined /* checkpoint */,
						undefined /* progressStatus */,
						{ isNonInteractive: true } /* options */,
						contextCondense,
					)
				} else if (truncateResult.truncationId) {
					// Sliding window truncation occurred
					const contextTruncation: any = {
						truncationId: truncateResult.truncationId,
						messagesRemoved: truncateResult.messagesRemoved ?? 0,
						prevContextTokens: truncateResult.prevContextTokens,
						newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
					}
					await this.interactionService.say(
						"sliding_window_truncation",
						undefined /* text */,
						undefined /* images */,
						false /* partial */,
						undefined /* checkpoint */,
						undefined /* progressStatus */,
						{ isNonInteractive: true } /* options */,
						undefined /* contextCondense */,
						contextTruncation,
					)
				}
			} finally {
				// Notify webview that context management is complete
				if (contextManagementWillRun && autoCondenseContext) {
					await this.task.providerRef
						.deref()
						?.postMessageToWebview({ type: "condenseTaskContextResponse", text: this.task.taskId })
				}
			}
		}

		// Get the effective API history by filtering out condensed messages
		const effectiveHistory = getEffectiveApiHistory(this.messageService.apiConversationHistory)
		const messagesSinceLastSummary = getMessagesSinceLastSummary(effectiveHistory)
		const mergedForApi = mergeConsecutiveApiMessages(messagesSinceLastSummary, { roles: ["user"] })
		const messagesWithoutImages = maybeRemoveImageBlocks(mergedForApi, this.api)
		const cleanConversationHistory = this.buildCleanConversationHistory(messagesWithoutImages as ApiMessage[])

		// Check auto-approval limits
		const approvalResult = await (this.task as any).autoApprovalHandler.checkAutoApprovalLimits(
			state,
			this.task.combineMessages(this.messageService.clineMessages.slice(1)),
			async (type: any, data: any) => this.interactionService.ask(type, data),
		)

		if (!approvalResult.shouldProceed) {
			throw new Error("Auto-approval limit reached and user did not approve continuation")
		}

		// Build complete tools array: native tools + dynamic MCP tools
		const modelInfo = this.api.getModel().info
		let allTools: OpenAI.Chat.ChatCompletionTool[] = []
		let allowedFunctionNames: string[] | undefined

		const supportsAllowedFunctionNames = apiConfiguration?.apiProvider === "gemini"

		{
			const provider = this.task.providerRef.deref()
			if (!provider) {
				throw new Error("Provider reference lost during tool building")
			}

			const toolsResult = await buildNativeToolsArrayWithRestrictions({
				provider,
				cwd: this.task.cwd,
				mode,
				customModes: state?.customModes,
				experiments: state?.experiments,
				apiConfiguration,
				disabledTools: state?.disabledTools,
				modelInfo,
				skillsEnabled: state?.skillsEnabled,
				includeAllToolsWithRestrictions: supportsAllowedFunctionNames,
			})
			allTools = toolsResult.tools
			allowedFunctionNames = toolsResult.allowedFunctionNames
		}

		const shouldIncludeTools = allTools.length > 0

		const metadata: any = {
			mode: mode,
			taskId: this.task.taskId,
			suppressPreviousResponseId: this.task.skipPrevResponseIdOnce,
			...(shouldIncludeTools
				? {
					tools: allTools,
					tool_choice: "auto",
					parallelToolCalls: true,
					...(allowedFunctionNames ? { allowedFunctionNames } : {}),
				}
				: {}),
		}

		// Create an AbortController to allow cancelling the request mid-stream
		this.currentRequestAbortController = new AbortController()
		const abortSignal = this.currentRequestAbortController.signal
		this.task.skipPrevResponseIdOnce = false

		const stream = this.api.createMessage(
			systemPrompt,
			cleanConversationHistory as unknown as Anthropic.Messages.MessageParam[],
			metadata,
		)
		const iterator = stream[Symbol.asyncIterator]()

		// Set up abort handling
		abortSignal.addEventListener("abort", () => {
			console.log(`[Task#${this.task.taskId}.${this.task.instanceId}] AbortSignal triggered for current request`)
			this.currentRequestAbortController = undefined
		})

		try {
			// Awaiting first chunk to see if it will throw an error
			this.stateManager.isWaitingForFirstChunk = true

			const firstChunkPromise = iterator.next()
			const abortPromise = new Promise<never>((_, reject) => {
				if (abortSignal.aborted) {
					reject(new Error("Request cancelled by user"))
				} else {
					abortSignal.addEventListener("abort", () => {
						reject(new Error("Request cancelled by user"))
					})
				}
			})

			const firstChunk = await Promise.race([firstChunkPromise, abortPromise])
			yield firstChunk.value
			this.stateManager.isWaitingForFirstChunk = false
		} catch (error) {
			this.stateManager.isWaitingForFirstChunk = false
			this.currentRequestAbortController = undefined
			const isContextWindowExceededError = checkContextWindowExceededError(error)

			// If it's a context window error and we haven't exceeded max retries
			if (isContextWindowExceededError && retryAttempt < MAX_CONTEXT_WINDOW_RETRIES) {
				console.warn(
					`[Task#${this.task.taskId}] Context window exceeded for model ${this.api.getModel().id}. ` +
					`Retry attempt ${retryAttempt + 1}/${MAX_CONTEXT_WINDOW_RETRIES}. ` +
					`Attempting automatic truncation...`,
				)
				await this.handleContextWindowExceededError()
				yield* this.attemptApiRequest(retryAttempt + 1)
				return
			}

			if (autoApprovalEnabled) {
				await this.backoffAndAnnounce(retryAttempt, error)

				// Check if task was aborted during the backoff countdown
				if (this.stateManager.abort) {
					throw new Error(
						`[Task#attemptApiRequest] task ${this.task.taskId}.${this.task.instanceId} aborted during retry`,
						{ cause: error }
					)
				}

				yield* this.attemptApiRequest(retryAttempt + 1)
				return
			} else {
				const { response } = await this.interactionService.ask(
					"api_req_failed",
					(error instanceof Error ? error.message : undefined) ?? JSON.stringify(serializeError(error), null, 2),
				)

				if (response !== "yesButtonClicked") {
					throw new Error("API request failed", { cause: error })
				}

				await this.interactionService.say("api_req_retried")
				yield* this.attemptApiRequest()
				return
			}
		}

		// No error, so we can continue to yield all remaining chunks
		yield* iterator
	}

	/**
	 * 处理上下文窗口超出错误
	 */
	private async handleContextWindowExceededError(): Promise<void> {
		const state = await this.task.providerRef.deref()?.getState()
		const { profileThresholds = {}, mode, apiConfiguration } = state ?? {}

		const { contextTokens } = this.metricsService.getTokenUsage()
		const modelInfo = this.api.getModel().info

		const maxTokens = getModelMaxOutputTokens({
			modelId: this.api.getModel().id,
			model: modelInfo,
			settings: this.apiConfiguration,
		})

		const contextWindow = modelInfo.contextWindow
		const currentProfileId = this.getCurrentProfileId(state)

		console.warn(
			`[Task#${this.task.taskId}] Context window exceeded for model ${this.api.getModel().id}. ` +
			`Current tokens: ${contextTokens}, Context window: ${contextWindow}. ` +
			`Forcing truncation to ${FORCED_CONTEXT_REDUCTION_PERCENT}% of current context.`,
		)

		await this.task.providerRef.deref()?.postMessageToWebview({ type: "condenseTaskContextStarted", text: this.task.taskId })

		// Build tools for condensing metadata
		const provider = this.task.providerRef.deref()
		let allTools: OpenAI.Chat.ChatCompletionTool[] = []
		if (provider) {
			const toolsResult = await buildNativeToolsArrayWithRestrictions({
				provider,
				cwd: this.task.cwd,
				mode,
				customModes: state?.customModes,
				experiments: state?.experiments,
				apiConfiguration,
				disabledTools: state?.disabledTools,
				modelInfo,
				skillsEnabled: state?.skillsEnabled,
				includeAllToolsWithRestrictions: false,
			})
			allTools = toolsResult.tools
		}

		const metadata: any = {
			mode,
			taskId: this.task.taskId,
			...(allTools.length > 0
				? {
					tools: allTools,
					tool_choice: "auto",
					parallelToolCalls: true,
				}
				: {}),
		}

		try {
			const environmentDetails = await getEnvironmentDetails(this.task, true)

			const truncateResult = await manageContext({
				messages: this.messageService.apiConversationHistory,
				totalTokens: contextTokens || 0,
				maxTokens,
				contextWindow,
				apiHandler: this.api,
				autoCondenseContext: true,
				autoCondenseContextPercent: FORCED_CONTEXT_REDUCTION_PERCENT,
				systemPrompt: await this.getSystemPrompt(),
				taskId: this.task.taskId,
				profileThresholds,
				currentProfileId,
				metadata,
				environmentDetails,
			})

			if (truncateResult.messages !== this.messageService.apiConversationHistory) {
				await this.messageService.overwriteApiConversationHistory(truncateResult.messages)
			}

			if (truncateResult.summary) {
				const { summary, cost, prevContextTokens, newContextTokens = 0 } = truncateResult
				const contextCondense: any = { summary, cost, newContextTokens, prevContextTokens }
				await this.interactionService.say(
					"condense_context",
					undefined,
					undefined,
					false,
					undefined,
					undefined,
					{ isNonInteractive: true },
					contextCondense,
				)
			} else if (truncateResult.truncationId) {
				const contextTruncation: any = {
					truncationId: truncateResult.truncationId,
					messagesRemoved: truncateResult.messagesRemoved ?? 0,
					prevContextTokens: truncateResult.prevContextTokens,
					newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
				}
				await this.interactionService.say(
					"sliding_window_truncation",
					undefined,
					undefined,
					false,
					undefined,
					undefined,
					{ isNonInteractive: true },
					undefined,
					contextTruncation,
				)
			}
		} finally {
			await this.task.providerRef
				.deref()
				?.postMessageToWebview({ type: "condenseTaskContextResponse", text: this.task.taskId })
		}
	}

	/**
	 * 等待提供商速率限制
	 */
	private async maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void> {
		const state = await this.task.providerRef.deref()?.getState()
		const rateLimitSeconds =
			state?.apiConfiguration?.rateLimitSeconds ?? this.apiConfiguration?.rateLimitSeconds ?? 0

		if (rateLimitSeconds <= 0 || !(this.task.constructor as any).lastGlobalApiRequestTime) {
			return
		}

		const now = performance.now()
		const timeSinceLastRequest = now - (this.task.constructor as any).lastGlobalApiRequestTime
		const rateLimitDelay = Math.ceil(
			Math.min(rateLimitSeconds, Math.max(0, rateLimitSeconds * 1000 - timeSinceLastRequest) / 1000),
		)

		if (rateLimitDelay > 0 && retryAttempt === 0) {
			for (let i = rateLimitDelay; i > 0; i--) {
				const delayMessage = JSON.stringify({ seconds: i })
				await this.interactionService.say("api_req_rate_limit_wait", delayMessage, undefined, true)
				await delay(1000)
			}
			await this.interactionService.say("api_req_rate_limit_wait", undefined, undefined, false)
		}
	}

	/**
	 * 指数退避重试
	 */
	public async backoffAndAnnounce(retryAttempt: number, error: any): Promise<void> {
		try {
			const state = await this.task.providerRef.deref()?.getState()
			const baseDelay = state?.requestDelaySeconds || 5

			let exponentialDelay = Math.min(
				Math.ceil(baseDelay * Math.pow(2, retryAttempt)),
				MAX_EXPONENTIAL_BACKOFF_SECONDS,
			)

			// Respect provider rate limit window
			let rateLimitDelay = 0
			const rateLimit = (state?.apiConfiguration ?? this.apiConfiguration)?.rateLimitSeconds || 0
			if ((this.task.constructor as any).lastGlobalApiRequestTime && rateLimit > 0) {
				const elapsed = performance.now() - (this.task.constructor as any).lastGlobalApiRequestTime
				rateLimitDelay = Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000))
			}

			// Prefer RetryInfo on 429 if present
			if (error?.status === 429) {
				const retryInfo = error?.errorDetails?.find(
					(d: any) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
				)
				const match = retryInfo?.retryDelay?.match?.(/^(\d+)s$/)
				if (match) {
					exponentialDelay = Number(match[1]) + 1
				}
			}

			const finalDelay = Math.max(exponentialDelay, rateLimitDelay)
			if (finalDelay <= 0) {
				return
			}

			// Build header text
			let headerText
			if (error.status) {
				const errorMessage = error?.message || "Unknown error"
				headerText = `${error.status}\n${errorMessage}`
			} else if (error?.message) {
				headerText = error.message
			} else {
				headerText = "Unknown error"
			}

			headerText = headerText ? `${headerText}\n` : ""

			// Show countdown timer with exponential backoff
			for (let i = finalDelay; i > 0; i--) {
				if (this.stateManager.abort) {
					throw new Error(`[Task#${this.task.taskId}] Aborted during retry countdown`)
				}

				await this.interactionService.say("api_req_retry_delayed", `${headerText}<retry_timer>${i}</retry_timer>`, undefined, true)
				await delay(1000)
			}

			await this.interactionService.say("api_req_retry_delayed", headerText, undefined, false)
		} catch (err) {
			console.error("Exponential backoff failed:", err)
		}
	}

	/**
	 * 构建干净的对话历史
	 */
	private buildCleanConversationHistory(
		messages: ApiMessage[],
	): Array<
		Anthropic.Messages.MessageParam | { type: "reasoning"; encrypted_content: string; id?: string; summary?: any[] }
	> {
		type ReasoningItemForRequest = {
			type: "reasoning"
			encrypted_content: string
			id?: string
			summary?: any[]
		}

		const cleanConversationHistory: (Anthropic.Messages.MessageParam | ReasoningItemForRequest)[] = []

		for (const msg of messages) {
			// Skip system prompt messages
			if (msg.isSystemPrompt) {
				continue
			}
			// Standalone reasoning: send encrypted, skip plain text
			if (msg.type === "reasoning") {
				if (msg.encrypted_content) {
					cleanConversationHistory.push({
						type: "reasoning",
						summary: msg.summary,
						encrypted_content: msg.encrypted_content!,
						...(msg.id ? { id: msg.id } : {}),
					})
				}
				continue
			}

			// Assistant message with embedded reasoning
			if (msg.role === "assistant") {
				const rawContent = msg.content

				const contentArray: Anthropic.Messages.ContentBlockParam[] = Array.isArray(rawContent)
					? (rawContent as Anthropic.Messages.ContentBlockParam[])
					: rawContent !== undefined
						? ([{ type: "text", text: rawContent }] as Anthropic.Messages.ContentBlockParam[])
						: []

				const [first, ...rest] = contentArray

				// Check if this message has reasoning_details (OpenRouter format for Gemini 3, etc.)
				const msgWithDetails = msg
				if (msgWithDetails.reasoning_details && Array.isArray(msgWithDetails.reasoning_details)) {
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (contentArray.length === 0) {
						assistantContent = ""
					} else if (contentArray.length === 1 && contentArray[0] && contentArray[0].type === "text") {
						assistantContent = (contentArray[0] as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = contentArray
					}

					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
						reasoning_details: msgWithDetails.reasoning_details,
					} as any)

					continue
				}

				// Embedded reasoning: encrypted (send) or plain text (skip)
				const hasEncryptedReasoning =
					first && (first as any).type === "reasoning" && typeof (first as any).encrypted_content === "string"
				const hasPlainTextReasoning =
					first && (first as any).type === "reasoning" && typeof (first as any).text === "string"

				if (hasEncryptedReasoning) {
					const reasoningBlock = first as any

					// Send as separate reasoning item (OpenAI Native)
					cleanConversationHistory.push({
						type: "reasoning",
						summary: reasoningBlock.summary ?? [],
						encrypted_content: reasoningBlock.encrypted_content,
						...(reasoningBlock.id ? { id: reasoningBlock.id } : {}),
					})

					// Send assistant message without reasoning
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (rest.length === 0) {
						assistantContent = ""
					} else if (rest.length === 1 && rest[0] && rest[0].type === "text") {
						assistantContent = (rest[0] as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = rest
					}

					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
					})

					continue
				}

				if (hasPlainTextReasoning) {
					// Skip plain text reasoning
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (rest.length === 0) {
						assistantContent = ""
					} else if (rest.length === 1 && rest[0] && rest[0].type === "text") {
						assistantContent = (rest[0] as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = rest
					}

					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
					})

					continue
				}

				// No reasoning, just send as-is
				cleanConversationHistory.push({
					role: "assistant",
					content: contentArray,
				})

				continue
			}

			// User messages: send as-is
			cleanConversationHistory.push(msg as Anthropic.Messages.MessageParam)
		}

		return cleanConversationHistory
	}

	/**
	 * 获取当前配置文件ID
	 */
	public getCurrentProfileId(state: any): string {
		return (
			state?.listApiConfigMeta?.find((profile: any) => profile.name === state?.currentApiConfigName)?.id ??
			"default"
		)
	}
}