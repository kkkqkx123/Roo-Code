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
	StreamingErrorType,
} from "./types"
import {
	ChunkHandlerError,
	InvalidStreamError,
	StreamAbortedError,
	StreamingRetryError,
	extractErrorInfo,
} from "@coder/types"

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
		// Validate input
		if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
			throw new InvalidStreamError("Stream must be an AsyncIterable")
		}

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

			// Return result with no error
			return this.buildResult(null)
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
		const { nextChunkWithAbort, cleanupAbortListeners } = this.createNextChunkFunction(iterator)
		let interrupted = false

		try {
			while (true) {
				const item = await nextChunkWithAbort()
				if (item.done) {
					break
				}

				const chunk = item.value
				if (!chunk) {
					continue
				}

				// Process chunk
				await this.handleChunk(chunk)

				// Check abort conditions
				if (this.stateManager.shouldAbort()) {
					await this.abortStream()
					interrupted = true
					break
				}

				if (this.stateManager.didRejectTool) {
					interrupted = true
					break
				}

				if (this.stateManager.didAlreadyUseTool) {
					interrupted = true
					break
				}
			}
		} finally {
			// Cleanup abort event listeners
			cleanupAbortListeners()

			// Close iterator if interrupted
			if (interrupted && iterator.return) {
				try {
					await iterator.return(undefined)
				} catch (error) {
					console.error("[StreamingProcessor] Failed to close interrupted stream iterator", error)
				}
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

		try {
			await handler.handle(chunk)
		} catch (error) {
			console.error(`[StreamingProcessor] Handler error for chunk type ${chunk.type}:`, error)
			// Create appropriate error type
			const handlerError = new ChunkHandlerError(
				chunk.type,
				`Handler failed for chunk type ${chunk.type}`,
				error instanceof Error ? error : new Error(String(error))
			)
			// Mark error in state manager
			this.stateManager.setError(handlerError)
			// Re-throw the error to stop stream processing
			throw error
		}
	}

	/**
	 * Create next chunk function with abort support
	 * Returns both the function and a cleanup function for event listeners
	 */
	private createNextChunkFunction(iterator: AsyncIterator<StreamChunk>) {
		const cleanupFunctions: Array<() => void> = []

		const nextChunkWithAbort = async () => {
			const nextPromise = iterator.next()
			const abortController = this.stateManager.getAbortController()

			if (abortController) {
				const abortPromise = new Promise<never>((_, reject) => {
					const signal = abortController!.signal

					if (signal.aborted) {
						this.stateManager.setAborted(true, "user_cancelled")
						reject(new Error("Request cancelled by user"))
					} else {
						const abortHandler = () => {
							this.stateManager.setAborted(true, "user_cancelled")
							reject(new Error("Request cancelled by user"))
						}

						signal.addEventListener("abort", abortHandler)

						// Store cleanup function
						cleanupFunctions.push(() => {
							signal.removeEventListener("abort", abortHandler)
						})
					}
				})

				return await Promise.race([nextPromise, abortPromise])
			}

			return await nextPromise
		}

		const cleanupAbortListeners = () => {
			for (const cleanup of cleanupFunctions) {
				cleanup()
			}
			cleanupFunctions.length = 0
		}

		return { nextChunkWithAbort, cleanupAbortListeners }
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
		// Convert error to appropriate StreamingErrorType
		let streamingError: StreamingErrorType

		if (error instanceof StreamAbortedError || error instanceof ChunkHandlerError || error instanceof InvalidStreamError) {
			streamingError = error
		} else if (this.stateManager.getAbortReason()) {
			streamingError = new StreamAbortedError(
				this.stateManager.getAbortReason() || "unknown",
				error instanceof Error ? { originalError: error } : { error }
			)
		} else {
			// Generic error wrapper
			streamingError = new ChunkHandlerError(
				"unknown",
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : new Error(String(error))
			)
		}

		// Mark error in state manager
		this.stateManager.setError(streamingError)

		const result = await this.errorHandler.handleError(error)

		if (result.shouldRetry) {
			throw new StreamingRetryError(result.retryDelay || 1000, error)
		}

		// Return result even after error - caller can check aborted/error status
		return this.buildResult(streamingError)
	}

	/**
	 * Build the final result
	 */
	private buildResult(error: StreamingErrorType | null = null): StreamingResult {
		// Add interruption messages if needed
		let assistantMessage = this.stateManager.getAssistantMessage()

		if (this.stateManager.didRejectTool) {
			assistantMessage += "\n\n[Response interrupted by user feedback]"
		} else if (this.stateManager.didAlreadyUseTool) {
			assistantMessage +=
				"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
		}

		// Update the assistant message in state
		this.stateManager.setAssistantMessage(assistantMessage)

		// Determine the final error
		const finalError = error || this.stateManager.getError() || null

		// Extract error information if there's an error
		const extractedErrorInfo = finalError ? extractErrorInfo(finalError) : undefined

		return {
			assistantMessage: assistantMessage,
			reasoningMessage: this.stateManager.getReasoningMessage(),
			assistantMessageContent: this.stateManager.getAssistantMessageContent(),
			userMessageContent: this.stateManager.getUserMessageContent(),
			groundingSources: this.stateManager.getGroundingSources(),
			tokens: this.tokenManager.getTokens(),
			didUseTool: this.stateManager.didUseTool(),
			didRejectTool: this.stateManager.didRejectTool,
			aborted: this.stateManager.isAborted(),
			abortReason: this.stateManager.getAbortReason(),
			error: finalError,
			extractedErrorInfo,
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
