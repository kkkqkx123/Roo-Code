/**
 * Streaming Error Handler
 * 
 * Handles errors during streaming processing.
 * Manages stream abortion, retry logic, and backoff strategies.
 */

import { serializeError } from "serialize-error"
import type { StreamingProcessorConfig, ErrorHandlingResult, ClineMessage } from "./types"

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
		if (this.stateManager && this.stateManager.isAborted()) {
			return {
				shouldRetry: false,
				abortReason: this.stateManager.getAbortReason(),
			}
		}

		const cancelReason = this.stateManager?.isAborted() ? "user_cancelled" : "streaming_failed"

		const rawErrorMessage = this.extractErrorMessage(error)
		const streamingFailedMessage = this.stateManager?.isAborted()
			? undefined
			: `Stream terminated by provider: ${rawErrorMessage}`

		await this.abortStream(cancelReason, streamingFailedMessage)

		if (this.stateManager?.isAborted()) {
			return {
				shouldRetry: false,
				abortReason: cancelReason,
			}
		}

		// Stream failed, should retry
		return {
			shouldRetry: true,
			retryDelay: await this.calculateBackoffDelay(),
		}
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
