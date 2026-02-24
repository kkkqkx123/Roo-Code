import { Anthropic } from "@anthropic-ai/sdk"
import pWaitFor from "p-wait-for"

import {
	type ClineMessage,
	CoderEventName,
	DEFAULT_MODES,
} from "@coder/types"

import {
	type ApiMessage,
	readApiMessages,
	saveApiMessages,
	readTaskMessages,
	saveTaskMessages,
	taskMetadata,
} from "../../task-persistence"
import { getEffectiveApiHistory } from "../../condense"
import { validateAndFixToolResultIds } from "../validateToolResultIds"
import { restoreTodoListForTask } from "../../tools/UpdateTodoListTool"

/**
 * TaskMessageService
 * 管理任务的消息历史，包括 API 对话历史和 UI 消息历史
 */
export class TaskMessageService {
	// 消息历史
	apiConversationHistory: ApiMessage[] = []
	clineMessages: ClineMessage[] = []

	constructor(
		private task: any,
		private stateManager: any,
		private globalStoragePath: string,
		private taskId: string,
		private rootTaskId: string | undefined,
		private parentTaskId: string | undefined,
		private taskNumber: number,
		private cwd: string,
		private initialStatus?: "active" | "delegated" | "completed",
	) { }

	/**
	 * 获取保存的 API 对话历史
	 */
	async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
		return readApiMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
	}

	/**
	 * 添加消息到 API 对话历史
	 */
	async addToApiConversationHistory(message: Anthropic.MessageParam, reasoning?: string): Promise<void> {
		const api = this.task.api as any
		const apiConfiguration = this.task.apiConfiguration

		// Capture the encrypted_content / thought signatures from the provider
		const handler = api as {
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

			// Determine if this is Anthropic protocol
			const modelId = this.task.getModelId?.(apiConfiguration) || ""
			const apiProvider = apiConfiguration.apiProvider
			const apiProtocol = this.task.getApiProtocol?.(apiProvider, modelId) || ""
			const isAnthropicProtocol = apiProtocol === "anthropic"

			const messageWithTs: any = {
				...message,
				...(responseId ? { id: responseId } : {}),
				ts: Date.now(),
			}

			// Store reasoning_details array if present
			if (reasoningDetails) {
				messageWithTs.reasoning_details = reasoningDetails
			}

			// Store reasoning based on provider type
			if (isAnthropicProtocol && reasoning && thoughtSignature && !reasoningDetails) {
				// Anthropic provider with extended thinking
				const thinkingBlock = {
					type: "thinking",
					thinking: reasoning,
					signature: thoughtSignature,
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						thinkingBlock,
						{ type: "text", text: messageWithTs.content },
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [thinkingBlock, ...messageWithTs.content]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [thinkingBlock]
				}
			} else if (reasoning && !reasoningDetails) {
				// Other providers
				const reasoningBlock = {
					type: "reasoning",
					text: reasoning,
					summary: reasoningSummary ?? ([] as any[]),
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						reasoningBlock,
						{ type: "text", text: messageWithTs.content },
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [reasoningBlock, ...messageWithTs.content]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [reasoningBlock]
				}
			} else if (reasoningData?.encrypted_content) {
				// OpenAI Native encrypted reasoning
				const reasoningBlock = {
					type: "reasoning",
					summary: [] as any[],
					encrypted_content: reasoningData.encrypted_content,
					...(reasoningData.id ? { id: reasoningData.id } : {}),
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						reasoningBlock,
						{ type: "text", text: messageWithTs.content },
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [reasoningBlock, ...messageWithTs.content]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [reasoningBlock]
				}
			}

			// Store thought signature for non-Anthropic providers
			if (thoughtSignature && !isAnthropicProtocol) {
				const thoughtSignatureBlock = {
					type: "thoughtSignature",
					thoughtSignature,
				}

				if (typeof messageWithTs.content === "string") {
					messageWithTs.content = [
						{ type: "text", text: messageWithTs.content },
						thoughtSignatureBlock,
					]
				} else if (Array.isArray(messageWithTs.content)) {
					messageWithTs.content = [...messageWithTs.content, thoughtSignatureBlock]
				} else if (!messageWithTs.content) {
					messageWithTs.content = [thoughtSignatureBlock]
				}
			}

			this.apiConversationHistory.push(messageWithTs)
		} else {
			// For user messages, validate tool_result IDs
			const effectiveHistoryForValidation = getEffectiveApiHistory(this.apiConversationHistory)
			const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
			const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []

			let messageToAdd = message
			if (lastEffective?.role !== "assistant" && Array.isArray(message.content)) {
				messageToAdd = {
					...message,
					content: message.content.map((block) => {
						if (block.type === "tool_result") {
							return { type: "text", text: JSON.stringify(block) }
						}
						return block
					}),
				}
			}

			const validatedMessage = validateAndFixToolResultIds(
				messageToAdd,
				historyForValidation as Anthropic.MessageParam[],
			)
			const messageWithTs = { ...validatedMessage, ts: Date.now() }
			this.apiConversationHistory.push(messageWithTs)
		}
	}

	/**
	 * 覆盖 API 对话历史
	 */
	async overwriteApiConversationHistory(newHistory: ApiMessage[]): Promise<void> {
		this.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	/**
	 * 刷新待处理的工具结果到历史记录
	 */
	async flushPendingToolResultsToHistory(): Promise<boolean> {
		if (this.task.userMessageContent.length === 0) {
			return true
		}

		// Wait for assistant message to be saved
		if (!this.stateManager.assistantMessageSavedToHistory) {
			await pWaitFor(() => this.stateManager.assistantMessageSavedToHistory || this.stateManager.abort, {
				interval: 50,
				timeout: 30_000,
			}).catch(() => {
				console.warn(
					`[Task#${this.taskId}] flushPendingToolResultsToHistory: timed out waiting for assistant message to be saved`,
				)
			})
		}

		if (this.stateManager.abort) {
			return false
		}

		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: this.task.userMessageContent,
		}

		const effectiveHistoryForValidation = getEffectiveApiHistory(this.apiConversationHistory)
		const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
		const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []
		const historyForValidationFiltered = historyForValidation.filter((msg) => !msg.isSystemPrompt)
		const validatedMessage = validateAndFixToolResultIds(
			userMessage,
			historyForValidationFiltered as Anthropic.MessageParam[],
		)
		const userMessageWithTs = { ...validatedMessage, ts: Date.now() }
		this.apiConversationHistory.push(userMessageWithTs as ApiMessage)

		const saved = await this.saveApiConversationHistory()

		if (saved) {
			this.task.userMessageContent = []
		} else {
			console.warn(
				`[Task#${this.taskId}] flushPendingToolResultsToHistory: save failed, retaining pending tool results in memory`,
			)
		}

		return saved
	}

	/**
	 * 保存 API 对话历史
	 */
	async saveApiConversationHistory(): Promise<boolean> {
		try {
			const systemPrompt = await this.task.getSystemPrompt?.()

			const systemPromptMessage: ApiMessage = {
				role: "system",
				content: systemPrompt || "",
				ts: Date.now(),
				isSystemPrompt: true,
			}

			const messagesWithSystemPrompt = [
				systemPromptMessage,
				...structuredClone(this.apiConversationHistory),
			]

			await saveApiMessages({
				messages: messagesWithSystemPrompt,
				taskId: this.taskId,
				globalStoragePath: this.globalStoragePath,
			})
			return true
		} catch (error) {
			console.error("Failed to save API conversation history:", error)
			return false
		}
	}

	/**
	 * 重试保存 API 对话历史
	 */
	async retrySaveApiConversationHistory(): Promise<boolean> {
		const delays = [100, 500, 1500]

		for (let attempt = 0; attempt < delays.length; attempt++) {
			await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]))
			console.warn(
				`[Task#${this.taskId}] retrySaveApiConversationHistory: retry attempt ${attempt + 1}/${delays.length}`,
			)

			const success = await this.saveApiConversationHistory()

			if (success) {
				return true
			}
		}

		return false
	}

	/**
	 * 获取保存的 Cline 消息
	 */
	async getSavedClineMessages(): Promise<ClineMessage[]> {
		return readTaskMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
	}

	/**
	 * 添加消息到 Cline 消息历史
	 */
	async addToClineMessages(message: ClineMessage): Promise<void> {
		this.clineMessages.push(message)
		const provider = this.task.providerRef?.deref?.()
		await provider?.postStateToWebviewWithoutTaskHistory?.()
		this.task.emit(CoderEventName.Message, { action: "created", message })
		await this.saveClineMessages()
	}

	/**
	 * 覆盖 Cline 消息历史
	 */
	async overwriteClineMessages(newMessages: ClineMessage[]): Promise<void> {
		this.clineMessages = newMessages
		restoreTodoListForTask(this.task)
		await this.saveClineMessages()
	}

	/**
	 * 更新 Cline 消息
	 */
	async updateClineMessage(message: ClineMessage): Promise<void> {
		const provider = this.task.providerRef?.deref?.()
		await provider?.postMessageToWebview?.({ type: "messageUpdated", clineMessage: message })
		this.task.emit(CoderEventName.Message, { action: "updated", message })
	}

	/**
	 * 保存 Cline 消息
	 */
	async saveClineMessages(): Promise<boolean> {
		try {
			await saveTaskMessages({
				messages: structuredClone(this.clineMessages),
				taskId: this.taskId,
				globalStoragePath: this.globalStoragePath,
			})

			if (this.stateManager._taskApiConfigName === undefined) {
				await this.stateManager.waitForApiConfigInitialization()
			}

			const { historyItem, tokenUsage } = await taskMetadata({
				taskId: this.taskId,
				rootTaskId: this.rootTaskId,
				parentTaskId: this.parentTaskId,
				taskNumber: this.taskNumber,
				messages: this.clineMessages,
				globalStoragePath: this.globalStoragePath,
				workspace: this.cwd,
				mode: this.stateManager._taskMode || DEFAULT_MODES,
				apiConfigName: this.stateManager._taskApiConfigName,
				initialStatus: this.initialStatus,
			})

			// Emit token/tool usage updates
			this.task.debouncedEmitTokenUsage?.(tokenUsage, this.task.toolUsage)

			await this.task.providerRef?.deref?.()?.updateTaskHistory?.(historyItem)
			return true
		} catch (error) {
			console.error("Failed to save Roo messages:", error)
			return false
		}
	}

	/**
	 * 根据时间戳查找消息
	 */
	findMessageByTimestamp(ts: number): ClineMessage | undefined {
		for (let i = this.clineMessages.length - 1; i >= 0; i--) {
			const msg = this.clineMessages[i]
			if (msg && msg.ts === ts) {
				return msg
			}
		}
		return undefined
	}
}