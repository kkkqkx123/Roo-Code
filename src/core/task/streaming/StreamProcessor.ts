/**
 * StreamProcessor - 流式响应处理器
 *
 * 负责处理 API 流式响应，包括：
 * - 处理各种类型的流式 chunk（reasoning, text, tool_call, usage 等）
 * - 管理 token 计数和成本计算
 * - 检测死循环
 * - 处理流中止
 * - 后台收集使用数据
 * - 发射流处理事件
 *
 * 通过回调接口与外部（Task）交互，实现解耦
 * 通过事件系统与StreamPostProcessor通信
 */

import { getApiProtocol, getModelId } from "@coder/types"
import { ApiStream, ApiStreamChunk, GroundingSource } from "../../../api/transform/stream"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../../shared/cost"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { StreamingTokenCounter } from "../../../utils/tiktoken"
import { DeadLoopDetector } from "../../../utils/deadLoopDetector"
import type {
	StreamProcessorCallbacks,
	StreamProcessorConfig,
	StreamProcessorOptions,
	StreamProcessorState,
} from "./StreamProcessorCallbacks"
import type {
	StreamProcessorEvent,
	StreamProcessorEventType,
	StreamEventListener,
	StreamProcessingResult,
} from "./StreamProcessorEvents"

const DEFAULT_USAGE_COLLECTION_TIMEOUT_MS = 5000

/**
 * StreamProcessor - 流式响应处理器
 */
export class StreamProcessor {
	private callbacks: StreamProcessorCallbacks
	private config: StreamProcessorConfig
	private options: StreamProcessorOptions
	private state: StreamProcessorState
	private tokenCounter: StreamingTokenCounter
	private deadLoopDetector: DeadLoopDetector
	private assistantMessage: string = ""
	private reasoningMessage: string = ""
	private pendingGroundingSources: GroundingSource[] = []
	
	// Event system
	private eventListeners: Map<StreamProcessorEventType, Set<StreamEventListener>> = new Map()

	constructor(
		callbacks: StreamProcessorCallbacks,
		config: StreamProcessorConfig,
		options: StreamProcessorOptions = {},
	) {
		this.callbacks = callbacks
		this.config = config
		this.options = {
			enableDeadLoopDetection: true,
			enableBackgroundUsageCollection: true,
			enableTokenCounterFallback: true,
			...options,
		}

		// 初始化状态
		this.state = {
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: undefined,
			hasApiUsageData: false,
		}

		// 初始化工具
		this.tokenCounter = new StreamingTokenCounter()
		this.deadLoopDetector = new DeadLoopDetector()
	}

	// ===== Event System =====

	/**
	 * Register an event listener
	 */
	on(eventType: StreamProcessorEventType, listener: StreamEventListener): void {
		if (!this.eventListeners.has(eventType)) {
			this.eventListeners.set(eventType, new Set())
		}
		this.eventListeners.get(eventType)!.add(listener)
	}

	/**
	 * Unregister an event listener
	 */
	off(eventType: StreamProcessorEventType, listener: StreamEventListener): void {
		const listeners = this.eventListeners.get(eventType)
		if (listeners) {
			listeners.delete(listener)
		}
	}

	/**
	 * Emit an event to all registered listeners
	 */
	private async emit(event: StreamProcessorEvent): Promise<void> {
		const listeners = this.eventListeners.get(event.type)
		if (listeners) {
			for (const listener of listeners) {
				await listener(event)
			}
		}
	}

	/**
	 * Remove all event listeners
	 */
	removeAllListeners(eventType?: StreamProcessorEventType): void {
		if (eventType) {
			this.eventListeners.delete(eventType)
		} else {
			this.eventListeners.clear()
		}
	}

	/**
	 * 处理流式响应
	 * @param stream API 流
	 */
	async processStream(stream: ApiStream): Promise<void> {
		const { apiReqIndex, modelInfo } = this.config

		try {
			// Emit stream start event
			await this.emit({
				type: "streamStart",
				timestamp: Date.now(),
			})

			const iterator = stream[Symbol.asyncIterator]()

			// 辅助函数：带中止控制的 nextChunk
			const nextChunkWithAbort = async () => {
				const nextPromise = iterator.next()
				const abortController = this.callbacks.getAbortController()

				if (abortController) {
					const abortPromise = new Promise<never>((_, reject) => {
						const signal = abortController.signal
						if (signal.aborted) {
							reject(new Error("Request cancelled by user"))
						} else {
							signal.addEventListener("abort", () => {
								reject(new Error("Request cancelled by user"))
							})
						}
					})
					return await Promise.race([nextPromise, abortPromise])
				}

				return await nextPromise
			}

			let item = await nextChunkWithAbort()
			while (!item.done) {
				const chunk = item.value
				item = await nextChunkWithAbort()

				if (!chunk) {
					// 有时 chunk 是 undefined，继续处理
					continue
				}

				// Emit chunk received event
				await this.emit({
					type: "chunkReceived",
					timestamp: Date.now(),
					chunk,
				})

				// 处理不同类型的 chunk
				try {
					await this.handleChunk(chunk)
					
					// Emit chunk processed event
					await this.emit({
						type: "chunkProcessed",
						timestamp: Date.now(),
						chunkType: chunk.type,
						success: true,
					})
				} catch (error) {
					// Emit chunk processed event with error
					await this.emit({
						type: "chunkProcessed",
						timestamp: Date.now(),
						chunkType: chunk.type,
						success: false,
					})
					throw error
				}

				// 检查中止状态
				if (this.callbacks.isAborted()) {
					console.log(`[StreamProcessor] Aborting stream, abandoned = ${this.callbacks.isAbandoned()}`)

					if (!this.callbacks.isAbandoned()) {
						await this.abortStream("user_cancelled")
					}
					break
				}

				// 检查工具拒绝
				if (this.callbacks.didRejectTool()) {
					this.assistantMessage += "\n\n[Response interrupted by user feedback]"
					break
				}

				// 检查是否已使用工具
				if (this.callbacks.didAlreadyUseTool()) {
					this.assistantMessage +=
						"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
					break
				}
			}

			// 启动后台使用数据收集
			if (this.options.enableBackgroundUsageCollection) {
				this.drainStreamInBackgroundToFindAllUsage(iterator, apiReqIndex).catch((error) => {
					console.error("[StreamProcessor] Background usage collection failed:", error)
				})
			}

			// Emit stream complete event
			await this.emitStreamCompleteEvent()
		} catch (error) {
			// Emit stream error event
			await this.emit({
				type: "streamError",
				timestamp: Date.now(),
				error: error instanceof Error ? error : new Error(String(error)),
				cancelReason: this.callbacks.isAborted() ? "user_cancelled" : "streaming_failed",
			})

			if (!this.callbacks.isAbandoned()) {
				const cancelReason: "streaming_failed" | "user_cancelled" = this.callbacks.isAborted()
					? "user_cancelled"
					: "streaming_failed"

				const rawErrorMessage =
					error instanceof Error ? error.message : JSON.stringify(error, null, 2)
				const streamingFailedMessage = this.callbacks.isAborted()
					? undefined
					: `Stream terminated by provider: ${rawErrorMessage}`

				await this.abortStream(cancelReason, streamingFailedMessage)

				if (this.callbacks.isAborted()) {
					this.callbacks.setAbortReason(cancelReason)
					await this.callbacks.abortTask()
				}
			}
		}
	}

	/**
	 * Emit stream complete event with processing result
	 */
	private async emitStreamCompleteEvent(): Promise<void> {
		const result: StreamProcessingResult = {
			hasApiUsageData: this.state.hasApiUsageData,
			inputTokens: this.state.inputTokens,
			outputTokens: this.state.outputTokens,
			cacheWriteTokens: this.state.cacheWriteTokens,
			cacheReadTokens: this.state.cacheReadTokens,
			totalCost: this.state.totalCost ?? 0,
			hasTextContent: this.assistantMessage.length > 0,
			hasToolUses: this.callbacks.hasToolUses(),
			assistantMessage: [this.assistantMessage],
			assistantMessageContent: this.callbacks.getAssistantMessageContent(),
			pendingGroundingSources: this.pendingGroundingSources,
			reasoningMessage: this.reasoningMessage || undefined,
			didCompleteReadingStream: true,
			wasAborted: this.callbacks.isAborted(),
			wasAbandoned: this.callbacks.isAbandoned(),
			tokenCounterData: {
				totalTokens: this.tokenCounter.getTotalTokens(),
				breakdown: this.tokenCounter.getTokenBreakdown(),
			},
			apiReqIndex: this.config.apiReqIndex,
			apiReqInfo: this.callbacks.getApiReqInfo(),
		}

		await this.emit({
			type: "streamComplete",
			timestamp: Date.now(),
			result,
		})
	}

	/**
	 * 处理单个 chunk
	 */
	private async handleChunk(chunk: ApiStreamChunk): Promise<void> {
		switch (chunk.type) {
			case "reasoning":
				await this.handleReasoningChunk(chunk)
				break
			case "usage":
				this.handleUsageChunk(chunk)
				break
			case "grounding":
				this.handleGroundingChunk(chunk)
				break
			case "tool_call_partial":
				await this.handleToolCallPartialChunk(chunk)
				break
			case "tool_call":
				await this.handleToolCallChunk(chunk)
				break
			case "text":
				await this.handleTextChunk(chunk)
				break
			case "error":
				await this.handleErrorChunk(chunk)
				break
		}
	}

	/**
	 * 处理 reasoning chunk
	 */
	private async handleReasoningChunk(chunk: any): Promise<void> {
		this.reasoningMessage += chunk.text

		// 增量计数 reasoning tokens
		this.tokenCounter.addReasoning(chunk.text)

		// 格式化 reasoning 消息
		let formattedReasoning = this.reasoningMessage
		if (this.reasoningMessage.includes("**")) {
			// 在句子结尾后的 **Title** 模式前添加换行
			formattedReasoning = this.reasoningMessage.replace(/([.!?])\*\*([^*\n]+)\*\*/g, "$1\n\n**$2**")
		}

		// 死循环检测
		if (this.options.enableDeadLoopDetection) {
			const detectionResult = this.deadLoopDetector.detect(this.reasoningMessage)
			if (detectionResult.detected) {
				const taskId = this.callbacks.getTaskId()
				console.error(`[StreamProcessor] Dead loop detected in reasoning: ${detectionResult.details}`)

				const deadLoopErrorMessage = `检测到死循环：${detectionResult.details}。任务已终止，请尝试重新描述任务或调整提示词。`

				await this.callbacks.say("error", deadLoopErrorMessage)
				await this.abortStream("streaming_failed", deadLoopErrorMessage)

				this.callbacks.setAbort(true)
				this.callbacks.setAbortReason("streaming_failed")
				await this.callbacks.abortTask()
				return
			}
		}

		await this.callbacks.say("reasoning", formattedReasoning, undefined, true)
	}

	/**
	 * 处理 usage chunk
	 */
	private handleUsageChunk(chunk: any): void {
		this.state.inputTokens += chunk.inputTokens
		this.state.outputTokens += chunk.outputTokens
		this.state.cacheWriteTokens += chunk.cacheWriteTokens ?? 0
		this.state.cacheReadTokens += chunk.cacheReadTokens ?? 0
		this.state.totalCost = chunk.totalCost

		// 只有当输出 tokens > 0 时才认为有有效的 API 使用数据
		this.state.hasApiUsageData = chunk.outputTokens > 0
	}

	/**
	 * 处理 grounding chunk
	 */
	private handleGroundingChunk(chunk: any): void {
		if (chunk.sources && chunk.sources.length > 0) {
			this.pendingGroundingSources.push(...chunk.sources)
		}
	}

	/**
	 * 处理 tool_call_partial chunk
	 */
	private async handleToolCallPartialChunk(chunk: any): Promise<void> {
		// 通过 NativeToolCallParser 处理原始工具调用 chunk
		const events = NativeToolCallParser.processRawChunk({
			index: chunk.index,
			id: chunk.id,
			name: chunk.name,
			arguments: chunk.arguments,
		})

		for (const event of events) {
			if (event.type === "tool_call_start") {
				await this.handleToolCallStartEvent(event)
			} else if (event.type === "tool_call_delta") {
				await this.handleToolCallDeltaEvent(event)
			} else if (event.type === "tool_call_end") {
				await this.handleToolCallEndEvent(event)
			}
		}
	}

	/**
	 * 处理 tool_call_start 事件
	 */
	private async handleToolCallStartEvent(event: any): Promise<void> {
		const streamingToolCallIndices = this.callbacks.getStreamingToolCallIndices()

		// 防止重复的工具调用
		if (streamingToolCallIndices.has(event.id)) {
			console.warn(
				`[StreamProcessor] Ignoring duplicate tool_call_start for ID: ${event.id} (tool: ${event.name})`,
			)
			return
		}

		// 初始化流式工具调用
		NativeToolCallParser.startStreamingToolCall(event.id, event.name)

		// 追踪工具调用 tokens
		this.tokenCounter.addToolCall(event.id, event.name, "")

		// 完成前一个文本块
		const assistantMessageContent = this.callbacks.getAssistantMessageContent()
		const lastBlock = assistantMessageContent[assistantMessageContent.length - 1]
		if (lastBlock?.type === "text" && lastBlock.partial) {
			lastBlock.partial = false
		}

		// 追踪工具调用索引
		const toolUseIndex = assistantMessageContent.length
		streamingToolCallIndices.set(event.id, toolUseIndex)
		this.callbacks.setStreamingToolCallIndices(streamingToolCallIndices)

		// 创建部分工具使用
		const partialToolUse: any = {
			type: "tool_use",
			name: event.name,
			params: {},
			partial: true,
			id: event.id,
		}

		assistantMessageContent.push(partialToolUse)
		this.callbacks.setAssistantMessageContent(assistantMessageContent)
		this.callbacks.setUserMessageContentReady(false)

		// 通知 Task 呈现助手消息
		this.callbacks.notifyPresentAssistantMessage()
	}

	/**
	 * 处理 tool_call_delta 事件
	 */
	private async handleToolCallDeltaEvent(event: any): Promise<void> {
		const partialToolUse = NativeToolCallParser.processStreamingChunk(event.id, event.delta)

		if (partialToolUse) {
			const streamingToolCallIndices = this.callbacks.getStreamingToolCallIndices()
			const toolUseIndex = streamingToolCallIndices.get(event.id)

			if (toolUseIndex !== undefined) {
				const assistantMessageContent = this.callbacks.getAssistantMessageContent()
				partialToolUse.id = event.id
				assistantMessageContent[toolUseIndex] = partialToolUse
				this.callbacks.setAssistantMessageContent(assistantMessageContent)

				// 通知 Task 呈现助手消息
				this.callbacks.notifyPresentAssistantMessage()

				// 更新工具调用 tokens
				if (partialToolUse.name) {
					this.tokenCounter.addToolCall(
						event.id,
						partialToolUse.name,
						JSON.stringify(partialToolUse.params || {}),
					)
				}
			}
		}
	}

	/**
	 * 处理 tool_call_end 事件
	 */
	private async handleToolCallEndEvent(event: any): Promise<void> {
		const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
		const streamingToolCallIndices = this.callbacks.getStreamingToolCallIndices()
		const toolUseIndex = streamingToolCallIndices.get(event.id)

		if (finalToolUse) {
			finalToolUse.id = event.id
			const assistantMessageContent = this.callbacks.getAssistantMessageContent()
			if (toolUseIndex !== undefined) {
				assistantMessageContent[toolUseIndex] = finalToolUse
			}
			this.callbacks.setAssistantMessageContent(assistantMessageContent)

			// 通知 Task 呈现助手消息
			this.callbacks.notifyPresentAssistantMessage()
		} else if (toolUseIndex !== undefined) {
			// 处理格式错误的工具调用
			const assistantMessageContent = this.callbacks.getAssistantMessageContent()
			const existingToolUse = assistantMessageContent[toolUseIndex]
			if (existingToolUse && existingToolUse.type === "tool_use") {
				existingToolUse.partial = false
				existingToolUse.id = event.id
			}
			this.callbacks.setAssistantMessageContent(assistantMessageContent)

			// 通知 Task 呈现助手消息
			this.callbacks.notifyPresentAssistantMessage()
		}

		// 清理追踪
		streamingToolCallIndices.delete(event.id)
		this.callbacks.setStreamingToolCallIndices(streamingToolCallIndices)
		this.callbacks.setUserMessageContentReady(false)
	}

	/**
	 * 处理 tool_call chunk（完整工具调用）
	 */
	private async handleToolCallChunk(chunk: any): Promise<void> {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: chunk.id,
			name: chunk.name,
			arguments: chunk.arguments,
		})

		if (!toolUse) {
			console.error(`[StreamProcessor] Failed to parse tool call:`, chunk)
			return
		}

		toolUse.id = chunk.id

		const assistantMessageContent = this.callbacks.getAssistantMessageContent()
		assistantMessageContent.push(toolUse)
		this.callbacks.setAssistantMessageContent(assistantMessageContent)
		this.callbacks.setUserMessageContentReady(false)

		// 通知 Task 呈现助手消息
		this.callbacks.notifyPresentAssistantMessage()
	}

	/**
	 * 处理 text chunk
	 */
	private async handleTextChunk(chunk: any): Promise<void> {
		this.assistantMessage += chunk.text

		// 增量计数文本 tokens
		this.tokenCounter.addText(chunk.text)

		// 创建或更新文本内容块
		const assistantMessageContent = this.callbacks.getAssistantMessageContent()
		const lastBlock = assistantMessageContent[assistantMessageContent.length - 1]

		if (lastBlock?.type === "text" && lastBlock.partial) {
			lastBlock.content = this.assistantMessage
		} else {
			assistantMessageContent.push({
				type: "text",
				content: this.assistantMessage,
				partial: true,
			})
			this.callbacks.setUserMessageContentReady(false)
		}

		this.callbacks.setAssistantMessageContent(assistantMessageContent)

		// 通知 Task 呈现助手消息
		this.callbacks.notifyPresentAssistantMessage()
	}

	/**
		* 处理 error chunk
	 */
	private async handleErrorChunk(chunk: any): Promise<void> {
		console.error(`[StreamProcessor] Stream error:`, chunk.error)
		await this.abortStream("streaming_failed", chunk.message)
	}

	/**
	 * 中止流
	 */
	private async abortStream(
		cancelReason: "streaming_failed" | "user_cancelled",
		streamingFailedMessage?: string,
	): Promise<void> {
		// 回滚 diff 视图更改
		if (this.callbacks.isDiffViewEditing()) {
			await this.callbacks.revertDiffViewChanges()
		}

		// 完成最后一个部分消息
		const lastMessage = this.callbacks.getLastClineMessage()
		if (lastMessage && lastMessage.partial) {
			lastMessage.partial = false
		}

		// 更新 API 请求消息
		await this.updateApiReqMessage(cancelReason, streamingFailedMessage)
		await this.callbacks.saveClineMessages()

		// 设置完成中止标志
		this.callbacks.setDidFinishAbortingStream(true)
	}

	/**
	 * 更新 API 请求消息
	 */
	private async updateApiReqMessage(
		cancelReason?: "streaming_failed" | "user_cancelled",
		streamingFailedMessage?: string,
	): Promise<void> {
		const { apiReqIndex, modelInfo } = this.config
		const apiConfiguration = this.callbacks.getApiConfiguration()

		const existingData = JSON.parse(this.callbacks.getClineMessage(apiReqIndex)?.text || "{}")

		// 计算总 tokens 和成本
		const modelId = getModelId(apiConfiguration)
		const apiProvider = apiConfiguration.apiProvider
		const apiProtocol = getApiProtocol(apiProvider, modelId)

		const costResult =
			apiProtocol === "anthropic"
				? calculateApiCostAnthropic(
					modelInfo,
					this.state.inputTokens,
					this.state.outputTokens,
					this.state.cacheWriteTokens,
					this.state.cacheReadTokens,
				)
				: calculateApiCostOpenAI(
					modelInfo,
					this.state.inputTokens,
					this.state.outputTokens,
					this.state.cacheWriteTokens,
					this.state.cacheReadTokens,
				)

		const info = {
			...existingData,
			tokensIn: costResult.totalInputTokens,
			tokensOut: costResult.totalOutputTokens,
			cacheWrites: this.state.cacheWriteTokens,
			cacheReads: this.state.cacheReadTokens,
			cost: this.state.totalCost ?? costResult.totalCost,
			cancelReason,
			streamingFailedMessage,
		}

		await this.callbacks.updateApiReqMessage(apiReqIndex, info)
	}

	/**
	 * 在后台收集使用数据
	 */
	private async drainStreamInBackgroundToFindAllUsage(
		iterator: AsyncIterator<any>,
		apiReqIndex: number,
	): Promise<void> {
		const timeoutMs = this.config.usageCollectionTimeoutMs ?? DEFAULT_USAGE_COLLECTION_TIMEOUT_MS
		const startTime = performance.now()
		const apiConfiguration = this.callbacks.getApiConfiguration()
		const modelId = getModelId(apiConfiguration)

		// 本地变量累积使用数据
		let bgInputTokens = this.state.inputTokens
		let bgOutputTokens = this.state.outputTokens
		let bgCacheWriteTokens = this.state.cacheWriteTokens
		let bgCacheReadTokens = this.state.cacheReadTokens
		let bgTotalCost = this.state.totalCost

		try {
			let usageFound = false
			let chunkCount = 0

			// 继续处理流
			let item = await iterator.next()
			while (!item.done) {
				// 检查超时
				if (performance.now() - startTime > timeoutMs) {
					console.warn(
						`[StreamProcessor] Background usage collection timed out after ${timeoutMs}ms for model: ${modelId}, processed ${chunkCount} chunks`,
					)
					if (iterator.return) {
						await iterator.return(undefined)
					}
					break
				}

				const chunk = item.value
				item = await iterator.next()
				chunkCount++

				if (chunk && chunk.type === "usage") {
					usageFound = true
					bgInputTokens += chunk.inputTokens
					bgOutputTokens += chunk.outputTokens
					bgCacheWriteTokens += chunk.cacheWriteTokens ?? 0
					bgCacheReadTokens += chunk.cacheReadTokens ?? 0
					bgTotalCost = chunk.totalCost
				}
			}

			if (
				usageFound ||
				bgInputTokens > 0 ||
				bgOutputTokens > 0 ||
				bgCacheWriteTokens > 0 ||
				bgCacheReadTokens > 0
			) {
				// 更新状态
				this.state.inputTokens = bgInputTokens
				this.state.outputTokens = bgOutputTokens
				this.state.cacheWriteTokens = bgCacheWriteTokens
				this.state.cacheReadTokens = bgCacheReadTokens
				this.state.totalCost = bgTotalCost

				// 更新 API 请求消息
				await this.updateApiReqMessage()
				await this.callbacks.saveClineMessages()

				// 更新 webview 中的消息
				const apiReqMessage = this.callbacks.getClineMessage(apiReqIndex)
				if (apiReqMessage) {
					await this.callbacks.updateClineMessage(apiReqMessage)
				}
			} else {
				console.warn(
					`[StreamProcessor] Suspicious: request ${apiReqIndex} is complete, but no usage info was found. Model: ${modelId}`,
				)
			}
		} catch (error) {
			console.error("[StreamProcessor] Error draining stream for usage data:", error)

			// 尝试捕获已收集的使用数据
			if (
				bgInputTokens > 0 ||
				bgOutputTokens > 0 ||
				bgCacheWriteTokens > 0 ||
				bgCacheReadTokens > 0
			) {
				this.state.inputTokens = bgInputTokens
				this.state.outputTokens = bgOutputTokens
				this.state.cacheWriteTokens = bgCacheWriteTokens
				this.state.cacheReadTokens = bgCacheReadTokens
				this.state.totalCost = bgTotalCost

				await this.updateApiReqMessage()
				await this.callbacks.saveClineMessages()
			}
		}
	}

	/**
	 * 获取当前状态
	 */
	getState(): StreamProcessorState {
		return { ...this.state }
	}

	/**
	 * 重置处理器状态
	 */
	reset(): void {
		this.state = {
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: undefined,
			hasApiUsageData: false,
		}
		this.assistantMessage = ""
		this.reasoningMessage = ""
		this.pendingGroundingSources = []
		this.tokenCounter.reset()
		this.deadLoopDetector.reset()
	}
}