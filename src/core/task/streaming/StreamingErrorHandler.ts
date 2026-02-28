/**
 * Streaming Error Handler
 *
 * Handles errors during streaming processing.
 * Manages stream abortion, retry logic, and backoff strategies.
 *
 * Supports both legacy StreamingError types and new ApiProviderError types
 * for consistent error handling across all providers.
 */

import { serializeError } from "serialize-error"
import type {
	StreamingProcessorConfig,
	ErrorHandlingResult,
	ClineMessage,
	StreamingErrorType,
} from "./types"
import type { TaskEventBus } from "../TaskEventBus"
import {
	StreamAbortedError,
	StreamProviderError,
	TokenError,
	ApiProviderError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	ConnectionError,
	RequestTimeoutError,
	BadRequestError,
	PermissionDeniedError,
	NotFoundError,
	UnprocessableEntityError,
	isApiProviderError,
	isRetryableError,
	extractErrorInfo,
	formatErrorForDisplay,
	ErrorCategory,
} from "@coder/types"

export class StreamingErrorHandler {
	private config: StreamingProcessorConfig
	private stateManager: any // Will be set properly when integrated
	private eventBus?: TaskEventBus

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
	 * Set the event bus for publishing error events
	 */
	setEventBus(eventBus?: TaskEventBus): void {
		this.eventBus = eventBus
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

		// Extract error information using the new extractor
		const errorInfo = extractErrorInfo(error)

		// Determine error type and handle accordingly
		const streamingError = this.normalizeError(error)
		let cancelReason: string
		let shouldRetry: boolean
		let retryDelay: number | undefined

		// Handle ApiProviderError types (new standardized errors)
		if (isApiProviderError(streamingError)) {
			const result = this.handleApiProviderError(streamingError)
			cancelReason = result.cancelReason
			shouldRetry = result.shouldRetry
			retryDelay = result.retryDelay
		} else {
			// Handle legacy StreamingError types
			const result = this.handleStreamingError(streamingError)
			cancelReason = result.cancelReason
			shouldRetry = result.shouldRetry
		}

		// Use extracted error info for better message formatting
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

		// Use retryAfter from extracted error info if available
		const finalRetryDelay = retryDelay ?? errorInfo.retryAfter ? (errorInfo.retryAfter! * 1000) : await this.calculateBackoffDelay()

		// Publish stream error event
		await this.publishErrorEvent(streamingError, shouldRetry, finalRetryDelay)

		// Stream failed, should retry
		return {
			shouldRetry,
			retryDelay: finalRetryDelay,
			abortReason: cancelReason,
			errorMessage: streamingFailedMessage,
		}
	}

	/**
	 * Publish stream error event to the event bus
	 */
	private async publishErrorEvent(
		error: StreamingErrorType,
		shouldRetry: boolean,
		retryDelay: number
	): Promise<void> {
		await this.eventBus?.publishAsync('stream:error', {
			error,
			retryAttempt: 0,
			isRetryable: shouldRetry,
			retryDelay,
		})
	}

	/**
	 * Handle ApiProviderError types (new standardized errors)
	 */
	private handleApiProviderError(error: ApiProviderError): {
		cancelReason: string
		shouldRetry: boolean
		retryDelay?: number
	} {
		// Authentication errors - should not retry
		if (error instanceof AuthenticationError) {
			return {
				cancelReason: "authentication_failed",
				shouldRetry: false,
			}
		}

		// Permission denied - should not retry
		if (error instanceof PermissionDeniedError) {
			return {
				cancelReason: "permission_denied",
				shouldRetry: false,
			}
		}

		// Bad request - should not retry (client error)
		if (error instanceof BadRequestError) {
			return {
				cancelReason: "bad_request",
				shouldRetry: false,
			}
		}

		// Not found - should not retry
		if (error instanceof NotFoundError) {
			return {
				cancelReason: "not_found",
				shouldRetry: false,
			}
		}

		// Unprocessable entity - should not retry
		if (error instanceof UnprocessableEntityError) {
			return {
				cancelReason: "unprocessable_entity",
				shouldRetry: false,
			}
		}

		// Rate limit - should retry with delay
		if (error instanceof RateLimitError) {
			return {
				cancelReason: "rate_limited",
				shouldRetry: true,
				retryDelay: error.retryAfter ? error.retryAfter * 1000 : undefined,
			}
		}

		// Server errors - should retry
		if (error instanceof ServerError) {
			return {
				cancelReason: "server_error",
				shouldRetry: true,
			}
		}

		// Connection errors - should retry
		if (error instanceof ConnectionError) {
			return {
				cancelReason: "connection_error",
				shouldRetry: true,
			}
		}

		// Request timeout - should retry
		if (error instanceof RequestTimeoutError) {
			return {
				cancelReason: "timeout",
				shouldRetry: true,
			}
		}

		// Generic API provider error - use isRetryableError helper
		return {
			cancelReason: "api_error",
			shouldRetry: isRetryableError(error),
		}
	}

	/**
	 * Handle legacy StreamingError types
	 */
	private handleStreamingError(error: StreamingErrorType): {
		cancelReason: string
		shouldRetry: boolean
	} {
		// StreamingRetryError doesn't have a code property
		if (!("code" in error) || typeof error.code !== "string") {
			return {
				cancelReason: "unknown_error",
				shouldRetry: false,
			}
		}

		switch (error.code) {
			case "STREAM_ABORTED":
				// StreamAbortedError has a 'reason' property
				return {
					cancelReason: (error as any).reason || "user_cancelled",
					shouldRetry: false,
				}

			case "INVALID_STREAM":
				return {
					cancelReason: "invalid_stream",
					shouldRetry: false,
				}

			case "STATE_ERROR":
				return {
					cancelReason: "state_error",
					shouldRetry: false,
				}

			case "STREAM_TIMEOUT":
				return {
					cancelReason: "timeout",
					shouldRetry: true,
				}

			case "TOKEN_ERROR":
				return {
					cancelReason: "token_error",
					shouldRetry: true,
				}

			case "CHUNK_HANDLER_ERROR":
			case "TOOL_CALL_ERROR":
			case "STREAM_PROVIDER_ERROR":
			case "API_PROVIDER_ERROR":
			default:
				return {
					cancelReason: "streaming_failed",
					shouldRetry: true,
				}
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
		// Use the new formatErrorForDisplay for consistent formatting
		if (error instanceof Error) {
			return formatErrorForDisplay(error)
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
