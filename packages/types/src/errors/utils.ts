/**
 * Error Utility Functions
 *
 * Helper functions for error handling, type guards, and error information extraction.
 */

import { BaseError } from "./base.js"
import { StreamingError, isStreamingError as isStreamingErrorImpl } from "./streaming.js"
import { ApiProviderError, RateLimitError, ServerError, ConnectionError, RequestTimeoutError } from "./api-provider.js"
import { HttpError, getHttpStatusCode as getHttpStatusCodeImpl, getRequestId as getRequestIdImpl } from "./http.js"
import { QdrantConnectionError } from "./qdrant.js"

/**
 * Check if an error is a streaming error
 */
export function isStreamingError(error: unknown): error is StreamingError {
	return isStreamingErrorImpl(error)
}

/**
 * Check if an error is an API provider error
 */
export function isApiProviderError(error: unknown): error is ApiProviderError {
	return error instanceof ApiProviderError
}

/**
 * Check if an error is an HTTP error
 */
export function isHttpError(error: unknown): error is HttpError {
	return error instanceof HttpError
}

/**
 * Check if an error is retryable based on its type
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof ApiProviderError) {
		// Retry on rate limit, server errors, connection errors, and timeouts
		return (
			error instanceof RateLimitError ||
			error instanceof ServerError ||
			error instanceof ConnectionError ||
			error instanceof RequestTimeoutError
		)
	}
	// Qdrant connection errors are retryable
	if (error instanceof QdrantConnectionError) {
		return true
	}
	// For streaming errors, check the code
	if (error instanceof StreamingError) {
		return error.code === "STREAM_TIMEOUT" || error.code === "TOKEN_ERROR"
	}
	return false
}

/**
 * Get error code from any error object
 */
export function getErrorCode(error: unknown): string | undefined {
	if (error instanceof BaseError) {
		return error.code
	}
	return undefined
}

/**
 * Get error context from any error object
 */
export function getErrorContext(error: unknown): Record<string, unknown> | undefined {
	if (error instanceof BaseError) {
		return error.context
	}
	return undefined
}

/**
 * Get HTTP status code from an error if available
 */
export function getHttpStatusCode(error: unknown): number | undefined {
	return getHttpStatusCodeImpl(error)
}

/**
 * Get request ID from an error if available
 */
export function getRequestId(error: unknown): string | undefined {
	return getRequestIdImpl(error)
}

/**
 * Result of error handling operation
 */
export interface ErrorHandlingResult {
	shouldRetry: boolean
	retryDelay?: number
	abortReason?: string
	errorMessage?: string
}
