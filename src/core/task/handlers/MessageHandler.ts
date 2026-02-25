/**
 * MessageHandler - 消息处理器
 *
 * 负责处理 Task 类中所有与消息相关的逻辑，包括：
 * - ask/say 方法
 * - 消息历史管理（API 和 Cline）
 * - 用户消息提交
 * - 自动批准处理
 */

import type {
	ITaskMessageHandler,
	AskResult,
} from "../interfaces/ITaskMessageHandler"
import type {
	ClineAsk,
	ClineMessage,
	ClineSay,
	TaskStatus,
	TodoItem,
} from "@coder/types"
import { getApiProtocol, CoderEventName } from "@coder/types"
import type { SayOptions } from "../streaming/SayOptions"
import type { ApiMessage } from "../../task-persistence"
import type { Task } from "../Task"
import type { ClineProvider } from "../../webview/ClineProvider"
import { AskIgnoredError } from "../AskIgnoredError"
import { findLastIndex } from "../../../shared/array"
import { t } from "../../../i18n"
import { ClineAskResponse } from "../../../shared/WebviewMessage"
import { defaultModeSlug } from "../../../shared/modes"
import { formatResponse } from "../../prompts/responses"
import { checkAutoApproval } from "../../auto-approval"
import { restoreTodoListForTask } from "../../tools/UpdateTodoListTool"
import { validateAndFixToolResultIds } from "../validateToolResultIds"
import { getEffectiveApiHistory } from "../../condense"
import { taskMetadata } from "../../task-persistence"
import { getApiMetrics, hasTokenUsageChanged, hasToolUsageChanged } from "../../../shared/getApiMetrics"
import { combineApiRequests } from "../../../shared/combineApiRequests"
import pWaitFor from "p-wait-for"
import type { Anthropic } from "@anthropic-ai/sdk"

export class MessageHandler implements ITaskMessageHandler {
	constructor(
		private task: Task,
		private provider: WeakRef<ClineProvider>
	) {}

	// ===== Ask 方法 =====

	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: any,
		isProtected?: boolean
	): Promise<AskResult> {
		// 如果此 Cline 实例已被 provider 中止，那么唯一让我们存活的是
		// 后台仍在运行的 promise，在这种情况下，我们不想将其结果发送到 webview，
		// 因为它现在已附加到新的 Cline 实例。所以我们可以安全地忽略
		// 任何活动 promise 的结果，这个类将被释放。
		if (this.task.abort) {
			throw new Error(`[Coder#ask] task ${this.task.taskId}.${this.task.instanceId} aborted`)
		}

		let askTs: number

		if (partial !== undefined) {
			const lastMessage = this.task.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// 现有的部分消息，所以更新它
					lastMessage.text = text
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					lastMessage.isProtected = isProtected
					this.updateClineMessage(lastMessage)
					throw new AskIgnoredError("updating existing partial")
				} else {
					// 这是一个新的部分消息，所以添加部分状态
					askTs = Date.now()
					this.task.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, partial, isProtected })
					throw new AskIgnoredError("new partial")
				}
			} else {
				if (isUpdatingPreviousPartial) {
					// 这是之前部分消息的完整版本，所以用完整版本替换部分版本
					this.task.clearAskResponse()

					// Bug 记录：
					// 在 webview 中，我们使用 ts 作为 virtuoso 列表的 chatrow 键。
					// 由于我们会在流结束时更新这个 ts，这会导致视图闪烁。
					// 键属性必须是稳定的，否则 React 在渲染之间协调项目时会有困难，
					// 导致组件卸载和重新挂载（闪烁）。
					// 这里的教训是，如果你看到列表渲染时闪烁，很可能是因为键属性不稳定。
					// 所以在这种情况下，我们必须确保消息 ts 在首次设置后永远不会被更改。
					askTs = lastMessage.ts
					this.task.lastMessageTs = askTs
					lastMessage.text = text
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus
					lastMessage.isProtected = isProtected
					await this.saveClineMessages()
					this.updateClineMessage(lastMessage)
				} else {
					// 这是一个新的完整消息，所以正常添加
					this.task.clearAskResponse()
					askTs = Date.now()
					this.task.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, isProtected })
				}
			}
		} else {
			// 这是一个新的非部分消息，所以正常添加
			this.task.clearAskResponse()
			askTs = Date.now()
			this.task.lastMessageTs = askTs
			await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, isProtected })
		}

		let timeouts: NodeJS.Timeout[] = []

		// 根据用户设置自动批准 ask
		const provider = this.provider.deref()
		const state = provider ? await provider.getState() : undefined
		const approval = await checkAutoApproval({ state, ask: type, text, isProtected })

		if (approval.decision === "approve") {
			this.approveAsk()
		} else if (approval.decision === "deny") {
			this.denyAsk()
		} else if (approval.decision === "timeout") {
			// 存储自动批准超时，以便在用户交互时取消
			const timeout = this.task.setAutoApprovalTimeout(() => {
				const { askResponse, text, images } = approval.fn()
				this.handleWebviewAskResponse(askResponse, text, images)
			}, approval.timeout)
			timeouts.push(timeout)
		}

		// 如果消息完成且任务将阻塞（通过 `pWaitFor`），则状态是可变的
		const askResponseState = this.task.getAskResponse()
		const isBlocking = !(askResponseState.response !== undefined || this.task.lastMessageTs !== askTs)
		const isMessageQueued = !this.task.messageQueueService.isEmpty()
		const isStatusMutable = !partial && isBlocking && !isMessageQueued && approval.decision === "ask"

		if (isStatusMutable) {
			const statusMutationTimeout = 2_000

			if (this.isInteractiveAsk(type)) {
				timeouts.push(
					setTimeout(() => {
						const message = this.findMessageByTimestamp(askTs)

						if (message) {
							this.task.interactiveAsk = message
							this.task.emit(CoderEventName.TaskInteractive, this.task.taskId)
							provider?.postMessageToWebview({ type: "interactionRequired" })
						}
					}, statusMutationTimeout),
				)
			} else if (this.isResumableAsk(type)) {
				timeouts.push(
					setTimeout(() => {
						const message = this.findMessageByTimestamp(askTs)

						if (message) {
							this.task.resumableAsk = message
							this.task.emit(CoderEventName.TaskResumable, this.task.taskId)
						}
					}, statusMutationTimeout),
				)
			} else if (this.isIdleAsk(type)) {
				timeouts.push(
					setTimeout(() => {
						const message = this.findMessageByTimestamp(askTs)

						if (message) {
							this.task.idleAsk = message
							this.task.emit(CoderEventName.TaskIdle, this.task.taskId)
						}
					}, statusMutationTimeout),
				)
			}
		} else if (isMessageQueued) {
			const message = this.task.messageQueueService.dequeueMessage()

			if (message) {
				// 检查这是否是需要处理的工具批准 ask
				if (type === "tool" || type === "command" || type === "use_mcp_server") {
					// 对于工具批准，我们需要先批准，然后如果有文本/图片则发送消息
					this.handleWebviewAskResponse("yesButtonClicked", message.text, message.images)
				} else {
					// 对于其他 ask 类型（如 followup 或 command_output），直接完成 ask
					this.handleWebviewAskResponse("messageResponse", message.text, message.images)
				}
			}
		}

		// 等待 askResponse 被设置
		await pWaitFor(
			() => {
				const askResponseState = this.task.getAskResponse()
				if (askResponseState.response !== undefined || this.task.lastMessageTs !== askTs) {
					return true
				}

				// 如果在 ask 阻塞时到达了排队消息（例如，由于 UI 状态错误排队了 follow-up 建议点击），
				// 立即消费它，以免任务挂起
				if (!this.task.messageQueueService.isEmpty()) {
					const message = this.task.messageQueueService.dequeueMessage()
					if (message) {
						// 如果这是工具批准 ask，我们需要先批准（yesButtonClicked）
						// 并包含任何排队的文本/图片
						if (type === "tool" || type === "command" || type === "use_mcp_server") {
							this.handleWebviewAskResponse("yesButtonClicked", message.text, message.images)
						} else {
							this.handleWebviewAskResponse("messageResponse", message.text, message.images)
						}
					}
				}

				return false
			},
			{ interval: 100 },
		)

		if (this.task.lastMessageTs !== askTs) {
			// 如果我们连续发送多个 ask，可能会发生这种情况（例如使用 command_output）。
			// 重要的是，当我们知道 ask 可能失败时，要优雅地处理它。
			throw new AskIgnoredError("superseded")
		}

		const result = this.task.getAskResponse()
		this.task.clearAskResponse()

		// 如果超时仍在运行，则取消它们
		timeouts.forEach((timeout) => clearTimeout(timeout))

		// 切换回活动状态
		if (this.task.idleAsk || this.task.resumableAsk || this.task.interactiveAsk) {
			this.task.idleAsk = undefined
			this.task.resumableAsk = undefined
			this.task.interactiveAsk = undefined
			this.task.emit(CoderEventName.TaskActive, this.task.taskId)
		}

		this.task.emit(CoderEventName.TaskAskResponded)
		
		// Ensure response is not undefined
		if (!result.response) {
			throw new Error("Ask response is undefined after waiting")
		}
		
		return result as AskResult
	}

	handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]): void {
		// 用户响应时清除任何待处理的自动批准超时
		this.cancelAutoApprovalTimeout()

		this.task.setAskResponse(askResponse, text, images)

		// 每当用户发送消息时创建 checkpoint
		// 使用 allowEmpty=true 确保即使没有文件更改也记录 checkpoint
		// 抑制此特定 checkpoint 的 checkpoint_saved 聊天行，以保持时间线清洁
		if (askResponse === "messageResponse") {
			void this.task.checkpointSave(false, true)
		}

		// 标记最后一个 follow-up 问题为已回答
		if (askResponse === "messageResponse" || askResponse === "yesButtonClicked") {
			// 使用 findLastIndex 查找最后一个未回答的 follow-up 消息
			const lastFollowUpIndex = findLastIndex(
				this.task.clineMessages,
				(msg) => msg.type === "ask" && msg.ask === "followup" && !msg.isAnswered,
			)

			if (lastFollowUpIndex !== -1) {
				// 标记此 follow-up 为已回答
				const followUpMsg = this.task.clineMessages[lastFollowUpIndex]
				if (followUpMsg) {
					followUpMsg.isAnswered = true
					// 保存更新的消息
					this.saveClineMessages().catch((error) => {
						console.error("Failed to save answered follow-up state:", error)
					})
				}
			}
		}

		// 当用户批准（或自动批准）时，标记最后一个工具批准 ask 为已回答
		if (askResponse === "yesButtonClicked") {
			const lastToolAskIndex = findLastIndex(
				this.task.clineMessages,
				(msg) => msg.type === "ask" && msg.ask === "tool" && !msg.isAnswered,
			)
			if (lastToolAskIndex !== -1) {
				const toolAskMsg = this.task.clineMessages[lastToolAskIndex]
				if (toolAskMsg) {
					toolAskMsg.isAnswered = true
					void this.updateClineMessage(toolAskMsg)
					this.saveClineMessages().catch((error) => {
						console.error("Failed to save answered tool-ask state:", error)
					})
				}
			}
		}
	}

	approveAsk({ text, images }: { text?: string; images?: string[] } = {}): void {
		this.handleWebviewAskResponse("yesButtonClicked", text, images)
	}

	denyAsk({ text, images }: { text?: string; images?: string[] } = {}): void {
		this.handleWebviewAskResponse("noButtonClicked", text, images)
	}

	supersedePendingAsk(): void {
		this.task.lastMessageTs = Date.now()
	}

	cancelAutoApprovalTimeout(): void {
		this.task.cancelAutoApprovalTimeout()
	}

	// ===== Say 方法 =====

	async say(type: ClineSay, options?: SayOptions): Promise<void> {
		const {
			text,
			images,
			partial,
			isNonInteractive = false,
			checkpoint,
			progressStatus,
			contextCondense,
			contextTruncation,
		} = options || {}
		if (this.task.abort) {
			throw new Error(`[Coder#say] task ${this.task.taskId}.${this.task.instanceId} aborted`)
		}

		if (partial !== undefined) {
			const lastMessage = this.task.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// 现有的部分消息，所以更新它
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					this.updateClineMessage(lastMessage)
				} else {
					// 这是一个新的部分消息，所以添加部分状态
					const sayTs = Date.now()

					if (!isNonInteractive) {
						this.task.lastMessageTs = sayTs
					}

					await this.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						partial,
						contextCondense,
						contextTruncation,
					})
				}
			} else {
				// 现在我们有了之前部分消息的完整版本
				// 这是之前部分消息的完整版本，所以用完整版本替换部分版本
				if (isUpdatingPreviousPartial) {
					if (!isNonInteractive) {
						this.task.lastMessageTs = lastMessage.ts
					}

					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus

					// 不像流式传输 partialMessage 事件，我们执行保存
					// 并像正常一样发布以持久化到磁盘
					await this.saveClineMessages()

					// 比整个 `postStateToWebview` 更高效
					this.updateClineMessage(lastMessage)
				} else {
					// 这是一个新的完整消息，所以正常添加
					const sayTs = Date.now()

					if (!isNonInteractive) {
						this.task.lastMessageTs = sayTs
					}

					await this.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						contextCondense,
						contextTruncation,
					})
				}
			}
		} else {
			// 这是一个新的非部分消息，所以正常添加
			const sayTs = Date.now()

			// "非交互式"消息是用户不需要响应的消息。我们不希望这些消息类型
			// 触发 `lastMessageTs` 的更新，因为它们可以异步创建，
			// 并且可能中断待处理的 ask
			if (!isNonInteractive) {
				this.task.lastMessageTs = sayTs
			}

			await this.addToClineMessages({
				ts: sayTs,
				type: "say",
				say: type,
				text,
				images,
				checkpoint,
				contextCondense,
				contextTruncation,
			})
		}
	}

	async sayAndCreateMissingParamError(toolName: any, paramName: string, relPath?: any): Promise<any> {
		await this.say("error", {
			text: `Roo tried to use ${toolName}${relPath ? ` for '${relPath.toPosix()}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`,
		})
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
	}

	// ===== API 消息历史管理 =====

	async addToApiConversationHistory(message: Anthropic.MessageParam, reasoning?: string): Promise<void> {
		// 从 provider 捕获 encrypted_content / thought 签名（如果存在）
		// 例如 OpenAI Responses API、Google GenAI
		// 我们只持久化当前响应体报告的数据
		const handler = this.task.api as any & {
			getResponseId?: () => string | undefined
			getEncryptedContent?: () => { encrypted_content: string; id?: string } | undefined
			getThoughtSignature?: () => string | undefined
			getSummary?: () => any[] | undefined
			getReasoningDetails?: () => any[] | undefined
		}

		if (message.role === "assistant") {
			const responseId = handler.getResponseId?.()
			const reasoningData = handler.getEncryptedContent?.()
			const thoughtSignature = handler.getThoughtSignature?.()
			const reasoningSummary = handler.getSummary?.()
			const reasoningDetails = handler.getReasoningDetails?.()

			// 只有 Anthropic 的 API 期望/验证特殊的 `thinking` 内容块签名
			// 其他提供者（特别是 Gemini 3）使用不同的签名语义（例如 `thoughtSignature`）
			// 并且需要以自己的格式往返签名
			const modelId = this.task.api.getModel().id
			const apiProvider = this.task.apiConfiguration.apiProvider
			const apiProtocol = getApiProtocol(apiProvider, modelId)
			const isAnthropicProtocol = apiProtocol === "anthropic"

			// 从原始助手消息开始
			const messageWithTs: any = {
				...message,
				...(responseId ? { id: responseId } : {}),
				ts: Date.now(),
			}

			// 如果存在，存储 reasoning_details 数组（对于 Gemini 3 等模型）
			if (reasoningDetails) {
				messageWithTs.reasoning_details = reasoningDetails
			}

			// 存储 reasoning：Anthropic thinking（带签名）、纯文本（大多数提供者）或加密（OpenAI Native）
			// 如果 reasoning_details 已包含 reasoning，则跳过（以避免重复）
			if (isAnthropicProtocol && reasoning && thoughtSignature && !reasoningDetails) {
				// Anthropic 提供者带扩展思考：存储为适当的 `thinking` 块
				// 此格式通过 anthropic-filter.ts 并正确往返
				// 用于带工具使用的交错思考（Anthropic API 要求）
				const thinkingBlock = {
					type: "thinking",
					thinking: reasoning,
					signature: thoughtSignature,
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						thinkingBlock,
						{ type: "text", text: messageWithTs.content } satisfies Anthropic.Messages.TextBlockParam,
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [thinkingBlock, ...messageWithTs.content]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [thinkingBlock]
				}
			} else if (reasoning && !reasoningDetails) {
				// 其他提供者（非 Anthropic）：存储为通用 reasoning 块
				const reasoningBlock = {
					type: "reasoning",
					text: reasoning,
					summary: reasoningSummary ?? ([] as any[]),
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						reasoningBlock,
						{ type: "text", text: messageWithTs.content } satisfies Anthropic.Messages.TextBlockParam,
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [reasoningBlock, ...messageWithTs.content]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [reasoningBlock]
				}
			} else if (reasoningData?.encrypted_content) {
				// OpenAI Native 加密推理
				const reasoningBlock = {
					type: "reasoning",
					summary: [] as any[],
					encrypted_content: reasoningData.encrypted_content,
					...(reasoningData.id ? { id: reasoningData.id } : {}),
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						reasoningBlock,
						{ type: "text", text: messageWithTs.content } satisfies Anthropic.Messages.TextBlockParam,
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [reasoningBlock, ...messageWithTs.content]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [reasoningBlock]
				}
			}

			// 对于非 Anthropic 提供者（例如 Gemini 3），将 thought 签名持久化为其自己的
			// 内容块，以便转换器可以将其附加回正确的提供者特定字段
			// 注意：对于 Anthropic 扩展思考，签名已包含在上面的 thinking 块中
			if (thoughtSignature && !isAnthropicProtocol) {
				const thoughtSignatureBlock = {
					type: "thoughtSignature",
					thoughtSignature,
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						{ type: "text", text: messageWithTs.content } satisfies Anthropic.Messages.TextBlockParam,
						thoughtSignatureBlock,
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [...messageWithTs.content, thoughtSignatureBlock]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [thoughtSignatureBlock]
				}
			}

			this.task.apiConversationHistory.push(messageWithTs)
		} else {
			// 对于用户消息，仅当紧接的前一个*有效*消息是助手消息时，
			// 验证 tool_result ID
			//
			// 如果前一个有效消息也是用户消息（例如，摘要 + 新用户消息），
			// 根据任何较早的助手消息进行验证可能会错误地注入占位符 tool_results
			const effectiveHistoryForValidation = getEffectiveApiHistory(this.task.apiConversationHistory)
			const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
			const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []

			// 如果前一个有效消息不是助手，将 tool_result 块转换为文本块
			// 这可以防止孤立的 tool_results 被 getEffectiveApiHistory 过滤掉
			// 当助手发送 tool_uses 但在用户响应之前发生压缩时，可能会发生这种情况
			// - tool_use 块被压缩掉，留下孤立的 tool_results
			let messageToAdd = message
			if (lastEffective?.role !== "assistant" && Array.isArray(message.content)) {
				messageToAdd = {
					...message,
					content: message.content.map((block) =>
						block.type === "tool_result"
							? {
								type: "text" as const,
								text: `Tool result:\n${typeof block.content === "string" ? block.content : JSON.stringify(block.content)}`,
							}
							: block,
					),
				}
			}

			const validatedMessage = validateAndFixToolResultIds(messageToAdd, historyForValidation)
			const messageWithTs = { ...validatedMessage, ts: Date.now() }
			this.task.apiConversationHistory.push(messageWithTs)
		}

		await this.saveApiConversationHistory()
	}

	async overwriteApiConversationHistory(newHistory: ApiMessage[]): Promise<void> {
		this.task.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	async saveApiConversationHistory(): Promise<boolean> {
		try {
			// 获取当前系统提示词用于调试
			const systemPrompt = await this.task.getSystemPromptForHandler()

			// 创建系统提示词消息用于调试
			const systemPromptMessage: ApiMessage = {
				role: "system",
				content: systemPrompt,
				ts: Date.now(),
				isSystemPrompt: true,
			}

			// 在历史前添加系统提示词用于调试
			const messagesWithSystemPrompt = [systemPromptMessage, ...structuredClone(this.task.apiConversationHistory)]

			await this.task.saveApiMessagesForHandler(messagesWithSystemPrompt)
			return true
		} catch (error) {
			console.error("Failed to save API conversation history:", error)
			return false
		}
	}

	async retrySaveApiConversationHistory(): Promise<boolean> {
		const delays = [100, 500, 1500]

		for (let attempt = 0; attempt < delays.length; attempt++) {
			await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]))
			console.warn(
				`[Task#${this.task.taskId}] retrySaveApiConversationHistory: retry attempt ${attempt + 1}/${delays.length}`,
			)

			const success = await this.saveApiConversationHistory()

			if (success) {
				return true
			}
		}

		return false
	}

	async flushPendingToolResultsToHistory(): Promise<boolean> {
		// 仅当有实际待保存的内容时才刷新
		if (this.task.userMessageContent.length === 0) {
			return true
		}

		// 关键：等待助手消息先保存到 API 历史
		// 没有这个，tool_result 块会在对话历史中出现在 tool_use 块之前，
		// 导致 API 错误，如：
		// "unexpected `tool_use_id` found in `tool_result` blocks"
		//
		// 当并行调用工具时（例如 update_todo_list + new_task），可能会发生这种情况
		// 工具在流式传输期间通过 presentAssistantMessage 执行，在助手消息保存之前
		// 当 new_task 触发委托时，它调用此方法来刷新待处理结果
		// - 但助手消息尚未保存
		//
		// assistantMessageSavedToHistory 标志是：
		// - 在每次 API 请求开始时重置为 false
		// - 在 recursivelyMakeClineRequests 中保存助手消息后设置为 true
		if (!this.task.assistantMessageSavedToHistory) {
			await pWaitFor(() => this.task.assistantMessageSavedToHistory || this.task.abort, {
				interval: 50,
				timeout: 30_000, // 30 秒超时作为安全网
			}).catch(() => {
				// 如果超时或中止，记录并继续以避免挂起
				console.warn(
					`[Task#${this.task.taskId}] flushPendingToolResultsToHistory: timed out waiting for assistant message to be saved`,
				)
			})
		}

		// 如果任务在等待时中止，不要刷新
		if (this.task.abort) {
			return false
		}

		// 保存带有 tool_result 块的用户消息
		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: this.task.userMessageContent,
		}

		// 当前一个*有效*消息是助手消息时，验证并修复 tool_result ID
		const effectiveHistoryForValidation = getEffectiveApiHistory(this.task.apiConversationHistory)
		const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
		const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []
		// 在验证前过滤掉系统提示词消息（仅用于调试）
		const historyForValidationFiltered = historyForValidation.filter((msg) => !msg.isSystemPrompt)
		const validatedMessage = validateAndFixToolResultIds(userMessage, historyForValidationFiltered as Anthropic.MessageParam[])
		const userMessageWithTs = { ...validatedMessage, ts: Date.now() }
		this.task.apiConversationHistory.push(userMessageWithTs as ApiMessage)

		const saved = await this.saveApiConversationHistory()

		if (saved) {
			// 清除待处理内容，因为现在已保存
			this.task.userMessageContent = []
		} else {
			console.warn(
				`[Task#${this.task.taskId}] flushPendingToolResultsToHistory: save failed, retaining pending tool results in memory`,
			)
		}

		return saved
	}

	// ===== Cline 消息管理 =====

	async addToClineMessages(message: ClineMessage): Promise<void> {
		this.task.clineMessages.push(message)
		const provider = this.provider.deref()
		// 避免在每次聊天消息更新时重新发送大的、大部分静态的字段（特别是 taskHistory）
		// taskHistory 在 webview 中内存维护，并通过 taskHistoryItemUpdated 更新
		await provider?.postStateToWebviewWithoutTaskHistory()
		// Emit message event
		// Emit message event
		this.task.emit(CoderEventName.Message, { action: "created", message })
		await this.saveClineMessages()
	}

	async overwriteClineMessages(newMessages: ClineMessage[]): Promise<void> {
		this.task.clineMessages = newMessages
		restoreTodoListForTask(this.task)
		await this.saveClineMessages()
	}

	async updateClineMessage(message: ClineMessage): Promise<void> {
		const provider = this.provider.deref()
		await provider?.postMessageToWebview({ type: "messageUpdated", clineMessage: message })
		// Emit message event
		// Emit message event
		this.task.emit(CoderEventName.Message, { action: "updated", message })
	}

	async saveClineMessages(): Promise<boolean> {
		try {
			await this.task.saveTaskMessagesForHandler(structuredClone(this.task.clineMessages))

			await this.task.waitForTaskApiConfig()

			const { historyItem, tokenUsage } = await taskMetadata({
				taskId: this.task.taskId,
				rootTaskId: this.task.rootTaskId,
				parentTaskId: this.task.parentTaskId,
				taskNumber: this.task.taskNumber,
				messages: this.task.clineMessages,
				globalStoragePath: this.task.getGlobalStoragePath(),
				workspace: this.task.cwd,
				mode: (await this.task.getTaskMode()) || defaultModeSlug, // 使用任务自己的模式，而不是当前提供者模式
				apiConfigName: await this.task.getTaskApiConfigName(), // 使用任务自己的提供者配置，而不是当前提供者配置
				initialStatus: this.task.getInitialStatus(),
			})

			// 使用防抖函数发出 token/工具使用更新
			// 防抖配合 maxWait 确保：
			// - 立即首次发出（leading: true）
			// - 快速更新期间最多每次间隔发出一次（maxWait）
			// - 更新停止时发出最终状态（trailing: true）
			this.task.emitTokenUsageForHandler(tokenUsage, this.task.toolUsage)

			await this.provider.deref()?.updateTaskHistory(historyItem)
			return true
		} catch (error) {
			console.error("Failed to save Roo messages:", error)
			return false
		}
	}

	findMessageByTimestamp(ts: number): ClineMessage | undefined {
		for (let i = this.task.clineMessages.length - 1; i >= 0; i--) {
			const msg = this.task.clineMessages[i]
			if (msg && msg.ts === ts) {
				return msg
			}
		}

		return undefined
	}

	// ===== 用户消息提交 =====

	async submitUserMessage(
		text: string,
		images?: string[],
		mode?: string,
		providerProfile?: string
	): Promise<void> {
		try {
			text = (text ?? "").trim()
			images = images ?? []

			if (text.length === 0 && images.length === 0) {
				return
			}

			const provider = this.provider.deref()

			if (provider) {
				if (mode) {
					await provider.setMode(mode)
				}

				if (providerProfile) {
					await provider.setProviderProfile(providerProfile)

					// 更新此任务的 API 配置以匹配新配置
					// 这确保解析器状态与所选模型同步
					const newState = await provider.getState()
					if (newState?.apiConfiguration) {
						this.task.updateApiConfiguration(newState.apiConfiguration)
					}
				}

				this.task.emit(CoderEventName.TaskUserMessage, this.task.taskId)

				// 直接处理消息，而不是通过 webview 路由
				// 这避免了竞态条件，即 webview 的消息状态尚未水合，
				// 导致它将消息解释为新任务请求
				this.handleWebviewAskResponse("messageResponse", text, images)
			} else {
				console.error("[Task#submitUserMessage] Provider reference lost")
			}
		} catch (error) {
			console.error("[Task#submitUserMessage] Failed to submit user message:", error)
		}
	}

	// ===== 私有辅助方法 =====

	private isInteractiveAsk(type: ClineAsk): boolean {
		return type === "command" || type === "use_mcp_server"
	}

	private isResumableAsk(type: ClineAsk): boolean {
		return type === "completion_result"
	}

	private isIdleAsk(type: ClineAsk): boolean {
		return type === "followup" || type === "tool"
	}
}