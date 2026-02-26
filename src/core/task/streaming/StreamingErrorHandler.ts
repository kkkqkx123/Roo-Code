/**
 * Streaming Error Handler
 * 
 * Handles errors during streaming processing.
 * Manages stream abortion, retry logic, and backoff strategies.
 */

import { serializeError } from "serialize-error"
import type {
	StreamingProcessorConfig,
	ErrorHandlingResult,
	ClineMessage,
	StreamingErrorType,
} from "./types"
import {
	StreamAbortedError,
	StreamProviderError,
	TokenError,
} from "./types"

export class StreamingErrorHandler {
	private config: StreamingProcessorConfig
	private stateManager: any // Will be set properly when integrated

	constructor(config: StreamingProcessorConfig) {
		this.config = config
	}

	/**
	 * Set the state manager (needed for integration)
	 */
	setStateManager(stateManager: any): void {
		this.stateManager = stateManager
	}

	/**
	 * Abort the stream and clean up resources
	 */
	async abortStream(
		cancelReason: string,
		streamingFailedMessage?: string,
		cost?: number
	): Promise<void> {
		// Revert diff view changes
		if (this.config.diffViewProvider.isEditing) {
			await this.config.diffViewProvider.revertChanges()
		}

		// Complete partial messages
		// Note: This would need access to clineMessages from Task
		// For now, we'll skip this part as it requires Task integration

		// Update api_req_started message with cancel reason and cost
		// Note: This would need access to updateApiReqMsg from Task
		// For now, we'll skip this part as it requires Task integration

		// Save messages
		await this.config.onSaveMessages()

		// Mark as aborted
		if (this.stateManager) {
			this.stateManager.setAborted(true, cancelReason)
		}
	}

	/**
	 * Handle streaming errors
	 */
	async handleError(error: unknown): Promise<ErrorHandlingResult> {
		// Check if already aborted
		if (this.stateManager && this.stateManager.isAborted()) {
			return {
				shouldRetry: false,
				abortReason: this.stateManager.getAbortReason(),
				errorMessage: this.extractErrorMessage(error),
			}
		}

		// Determine error type and handle accordingly
		const streamingError = this.normalizeError(error)
		let cancelReason: string
		let shouldRetry: boolean

		switch (streamingError.code) {
			case "STREAM_ABORTED":
				cancelReason = streamingError.reason || "user_cancelled"
				shouldRetry = false
				break

			case "INVALID_STREAM":
				cancelReason = "invalid_stream"
				shouldRetry = false
				break

			case "STATE_ERROR":
				cancelReason = "state_error"
				shouldRetry = false
				break

			case "STREAM_TIMEOUT":
				cancelReason = "timeout"
				shouldRetry = true
				break

			case "TOKEN_ERROR":
				cancelReason = "token_error"
				shouldRetry = true
				break

			case "CHUNK_HANDLER_ERROR":
			case "TOOL_CALL_ERROR":
			case "STREAM_PROVIDER_ERROR":
			default:
				cancelReason = "streaming_failed"
				shouldRetry = true
				break
		}

		const rawErrorMessage = this.extractErrorMessage(error)
		const streamingFailedMessage = this.stateManager?.isAborted()
			? undefined
			: `Stream terminated: ${rawErrorMessage}`

		await this.abortStream(cancelReason, streamingFailedMessage)

		if (this.stateManager?.isAborted()) {
			return {
				shouldRetry: false,
				abortReason: cancelReason,
				errorMessage: streamingFailedMessage,
			}
		}

		// Stream failed, should retry
		return {
			shouldRetry,
			retryDelay: await this.calculateBackoffDelay(),
			abortReason: cancelReason,
			errorMessage: streamingFailedMessage,
		}
	}

	/**
	 * Normalize error to StreamingErrorType
	 */
	private normalizeError(error: unknown): StreamingErrorType {
		// If already a StreamingErrorType, return as-is
		if (this.isStreamingError(error)) {
			return error
		}

		// Convert generic Error to appropriate StreamingErrorType
		if (error instanceof Error) {
			// Check for common error patterns
			const message = error.message.toLowerCase()

			if (message.includes("timeout") || message.includes("timed out")) {
				return new StreamProviderError(error.message, undefined, error)
			}

			if (message.includes("aborted") || message.includes("cancelled")) {
				return new StreamAbortedError("Stream aborted", { originalError: error })
			}

			if (message.includes("token") || message.includes("limit")) {
				return new TokenError(error.message, { originalError: error })
			}

			// Default to StreamProviderError for unknown errors
			return new StreamProviderError(error.message, undefined, error)
		}

		// Unknown error type
		return new StreamProviderError(
			typeof error === "string" ? error : "Unknown error",
			undefined,
			error instanceof Error ? error : new Error(String(error))
		)
	}

	/**
	 * Check if error is a StreamingErrorType
	 */
	private isStreamingError(error: unknown): error is StreamingErrorType {
		return (
			error !== null &&
			typeof error === "object" &&
			"code" in error &&
			"name" in error &&
			"message" in error
		)
	}

	/**
	 * Extract error message from error object
	 */
	private extractErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			return error.message
		}
		return JSON.stringify(serializeError(error), null, 2)
	}

	/**
	 * Calculate backoff delay for retry
	 * This is a simplified version - the full implementation would use
	 * exponential backoff with jitter
	 */
	private async calculateBackoffDelay(): Promise<number> {
		// Simplified backoff: 1 second
		// The full implementation would use exponential backoff:
		// delay = Math.min(baseDelay * Math.pow(2, retryAttempt), maxDelay)
		return 1000
	}

	/**
	 * Apply backoff strategy and wait
	 */
	async applyBackoff(retryAttempt: number, error: unknown): Promise<void> {
		const delay = await this.calculateBackoffDelay()

		console.log(`[StreamingErrorHandler] Applying backoff: ${delay}ms (attempt ${retryAttempt})`)

		await new Promise((resolve) => setTimeout(resolve, delay))
	}
}
