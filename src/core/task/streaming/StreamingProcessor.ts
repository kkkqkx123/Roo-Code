/**
 * Streaming Processor
 * 
 * Core controller for streaming processing.
 * Coordinates all handlers, manages the processing loop, and handles errors.
 */

import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { StreamingStateManager } from "./StreamingStateManager"
import { StreamingTokenManager } from "./StreamingTokenManager"
import { StreamingErrorHandler } from "./StreamingErrorHandler"
import { ReasoningHandler } from "./handlers/ReasoningHandler"
import { TextHandler } from "./handlers/TextHandler"
import { ToolCallHandler } from "./handlers/ToolCallHandler"
import { UsageHandler } from "./handlers/UsageHandler"
import { GroundingHandler } from "./handlers/GroundingHandler"
import type {
	StreamingProcessorConfig,
	StreamingResult,
	StreamChunk,
	ChunkHandler,
} from "./types"
import { StreamingRetryError } from "./types"

export class StreamingProcessor {
	private config: StreamingProcessorConfig
	private stateManager: StreamingStateManager
	private tokenManager: StreamingTokenManager
	private errorHandler: StreamingErrorHandler
	private handlers: Map<string, ChunkHandler>

	constructor(config: StreamingProcessorConfig) {
		this.config = config
		this.stateManager = new StreamingStateManager()
		this.tokenManager = new StreamingTokenManager(config.api)
		this.errorHandler = new StreamingErrorHandler(config)
		this.errorHandler.setStateManager(this.stateManager)
		this.handlers = this.initializeHandlers()
	}

	/**
	 * Initialize all chunk handlers
	 */
	private initializeHandlers(): Map<string, ChunkHandler> {
		const handlers = new Map<string, ChunkHandler>()

		const context = {
			stateManager: this.stateManager,
			tokenManager: this.tokenManager,
			config: this.config,
		}

		handlers.set("reasoning", new ReasoningHandler(context))
		handlers.set("text", new TextHandler(context))
		handlers.set("tool_call_partial", new ToolCallHandler(context))
		handlers.set("tool_call", new ToolCallHandler(context))
		handlers.set("usage", new UsageHandler(context))
		handlers.set("grounding", new GroundingHandler(context))

		return handlers
	}

	/**
	 * Start streaming processing
	 * @param stream API returned stream data
	 * @param abortController Abort controller for cancellation
	 * @param apiConversationHistory API conversation history for tiktoken fallback
	 * @returns Processing result
	 */
	async processStream(
		stream: AsyncIterable<StreamChunk>,
		abortController?: AbortController,
		apiConversationHistory?: any[]
	): Promise<StreamingResult> {
		// Reset state
		this.stateManager.reset()
		this.tokenManager.reset()

		// Set API conversation history for tiktoken fallback
		if (apiConversationHistory) {
			this.tokenManager.setApiConversationHistory(apiConversationHistory)
		}

		// Set abort controller
		this.stateManager.setAbortController(abortController)

		// Cache model info
		this.stateManager.setCachedModel(this.config.api.getModel())

		// Set streaming flag
		this.stateManager.setStreaming(true)

		try {
			// Main processing loop
			await this.processLoop(stream)

			// Finalize processing
			await this.finalize()

			// Return result
			return this.buildResult()
		} catch (error) {
			// Handle errors
			return await this.handleError(error)
		} finally {
			// Cleanup
			this.cleanup()
		}
	}

	/**
	 * Main processing loop
	 */
	private async processLoop(stream: AsyncIterable<StreamChunk>): Promise<void> {
		const iterator = stream[Symbol.asyncIterator]()
		const nextChunkWithAbort = this.createNextChunkFunction(iterator)

		let item = await nextChunkWithAbort()

		while (!item.done) {
			const chunk = item.value
			item = await nextChunkWithAbort()

			if (!chunk) {
				continue
			}

			// Process chunk
			await this.handleChunk(chunk)

			// Check abort conditions
			if (this.stateManager.shouldAbort()) {
				await this.abortStream()
				break
			}

			if (this.stateManager.didRejectTool) {
				break
			}

			if (this.stateManager.didAlreadyUseTool) {
				break
			}
		}
	}

	/**
	 * Handle a single stream chunk
	 */
	private async handleChunk(chunk: StreamChunk): Promise<void> {
		const handler = this.handlers.get(chunk.type)

		if (!handler) {
			console.warn(`[StreamingProcessor] No handler for chunk type: ${chunk.type}`)
			return
		}

		await handler.handle(chunk)
	}

	/**
	 * Create next chunk function with abort support
	 */
	private createNextChunkFunction(iterator: AsyncIterator<StreamChunk>) {
		return async () => {
			const nextPromise = iterator.next()
			const abortController = this.stateManager.getAbortController()

			if (abortController) {
				const abortPromise = new Promise<never>((_, reject) => {
					const signal = abortController!.signal

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
	}

	/**
	 * Finalize processing after stream ends
	 */
	private async finalize(): Promise<void> {
		// Finalize incomplete tool calls
		await this.finalizeIncompleteToolCalls()

		// Complete partial blocks
		this.stateManager.completePartialBlocks()

		// Complete reasoning message
		// Note: This requires clineMessages access from Task
		// For now, we'll skip this part as it requires Task integration

		// Background token collection
		await this.tokenManager.collectBackgroundUsage()

		// Check tiktoken fallback
		await this.tokenManager.checkTiktokenFallback()
	}

	/**
	 * Finalize incomplete tool calls
	 */
	private async finalizeIncompleteToolCalls(): Promise<void> {
		const finalizeEvents = NativeToolCallParser.finalizeRawChunks()

		for (const event of finalizeEvents) {
			if (event.type === "tool_call_end") {
				const handler = this.handlers.get("tool_call_partial") as ToolCallHandler
				await handler?.finalizeToolCall(event.id)
			}
		}
	}

	/**
	 * Abort the stream
	 */
	private async abortStream(): Promise<void> {
		await this.errorHandler.abortStream(
			this.stateManager.getAbortReason() || "streaming_failed"
		)
	}

	/**
	 * Handle errors
	 */
	private async handleError(error: unknown): Promise<StreamingResult> {
		const result = await this.errorHandler.handleError(error)

		if (result.shouldRetry) {
			throw new StreamingRetryError(result.retryDelay || 1000)
		}

		return this.buildResult()
	}

	/**
	 * Build the final result
	 */
	private buildResult(): StreamingResult {
		return {
			assistantMessage: this.stateManager.getAssistantMessage(),
			reasoningMessage: this.stateManager.getReasoningMessage(),
			assistantMessageContent: this.stateManager.getAssistantMessageContent(),
			userMessageContent: this.stateManager.getUserMessageContent(),
			groundingSources: this.stateManager.getGroundingSources(),
			tokens: this.tokenManager.getTokens(),
			didUseTool: this.stateManager.didUseTool(),
			didRejectTool: this.stateManager.didRejectTool,
			aborted: this.stateManager.isAborted(),
			abortReason: this.stateManager.getAbortReason(),
		}
	}

	/**
	 * Cleanup resources
	 */
	private cleanup(): void {
		this.stateManager.cleanup()
	}

	/**
	 * Get the state manager (for testing and advanced usage)
	 */
	getStateManager(): StreamingStateManager {
		return this.stateManager
	}

	/**
	 * Get the token manager (for testing and advanced usage)
	 */
	getTokenManager(): StreamingTokenManager {
		return this.tokenManager
	}

	/**
	 * Get the error handler (for testing and advanced usage)
	 */
	getErrorHandler(): StreamingErrorHandler {
		return this.errorHandler
	}
}
