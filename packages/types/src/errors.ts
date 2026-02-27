/**
 * Unified Error Definitions
 *
 * This file contains all error classes and types used across the project.
 * These errors provide a consistent error handling mechanism with proper
 * error codes and context information.
 */

// ============================================================================
// Base Error Classes
// ============================================================================

/**
 * Base error class for all application errors
 */
export abstract class BaseError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly context?: Record<string, any>
	) {
		super(message)
		this.name = this.constructor.name
	}
}

/**
 * Base error class for streaming-related errors
 */
export abstract class StreamingError extends BaseError {
	constructor(
		message: string,
		code: string,
		context?: Record<string, any>
	) {
		super(message, code, context)
	}
}

// ============================================================================
// Streaming Error Classes
// ============================================================================

/**
 * Error thrown when the stream is invalid or malformed
 */
export class InvalidStreamError extends StreamingError {
	constructor(message: string, context?: Record<string, any>) {
		super(message, "INVALID_STREAM", context)
	}
}

/**
 * Error thrown when a chunk handler fails
 */
export class ChunkHandlerError extends StreamingError {
	constructor(
		readonly chunkType: string,
		message: string,
		readonly originalError?: Error
	) {
		super(message, "CHUNK_HANDLER_ERROR", { chunkType, originalError })
	}
}

/**
 * Error thrown when the stream is aborted
 */
export class StreamAbortedError extends StreamingError {
	constructor(readonly reason: string, context?: Record<string, any>) {
		super(`Stream aborted: ${reason}`, "STREAM_ABORTED", { reason, ...context })
	}
}

/**
 * Error thrown when tool call processing fails
 */
export class ToolCallError extends StreamingError {
	constructor(
		readonly toolCallId: string,
		readonly toolName: string,
		message: string,
		readonly originalError?: Error
	) {
		super(message, "TOOL_CALL_ERROR", { toolCallId, toolName, originalError })
	}
}

/**
 * Error thrown when token counting or usage tracking fails
 */
export class TokenError extends StreamingError {
	constructor(message: string, context?: Record<string, any>) {
		super(message, "TOKEN_ERROR", context)
	}
}

/**
 * Error thrown when the stream is interrupted by user feedback
 */
export class UserInterruptError extends StreamingError {
	constructor(message: string = "Response interrupted by user feedback") {
		super(message, "USER_INTERRUPT")
	}
}

/**
 * Error thrown when a tool use result interrupts the stream
 */
export class ToolInterruptError extends StreamingError {
	constructor(
		message: string = "Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message."
	) {
		super(message, "TOOL_INTERRUPT")
	}
}

/**
 * Error thrown when the stream provider fails
 */
export class StreamProviderError extends StreamingError {
	constructor(
		message: string,
		readonly providerName?: string,
		readonly originalError?: Error
	) {
		super(message, "STREAM_PROVIDER_ERROR", { providerName, originalError })
	}
}

/**
 * Error thrown when there's a timeout during stream processing
 */
export class StreamTimeoutError extends StreamingError {
	constructor(
		readonly operation: string,
		readonly timeoutMs: number,
		context?: Record<string, any>
	) {
		super(`Timeout during ${operation} after ${timeoutMs}ms`, "STREAM_TIMEOUT", {
			operation,
			timeoutMs,
			...context,
		})
	}
}

/**
 * Error thrown when there's a state inconsistency
 */
export class StateError extends StreamingError {
	constructor(message: string, context?: Record<string, any>) {
		super(message, "STATE_ERROR", context)
	}
}

/**
 * Streaming retry error type
 */
export class StreamingRetryError extends Error {
	constructor(public retryDelay: number, public rawError?: unknown) {
		super("Stream processing failed, will retry")
		this.name = "StreamingRetryError"
	}
}

// ============================================================================
// API Provider Error Classes
// ============================================================================

/**
 * Base class for API provider errors.
 * These errors are thrown by API providers (Anthropic, OpenAI, Gemini, etc.)
 * and provide structured error information for consistent handling.
 */
export class ApiProviderError extends StreamingError {
	constructor(
		message: string,
		public readonly providerName: string,
		public readonly statusCode?: number,
		public readonly requestId?: string,
		originalError?: Error,
		code?: string
	) {
		super(message, code || "API_PROVIDER_ERROR", {
			providerName,
			statusCode,
			requestId,
			originalError,
		})
	}
}

/**
 * Error thrown when authentication fails (HTTP 401).
 * Usually indicates an invalid or expired API key.
 */
export class AuthenticationError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 401, requestId, originalError, "AUTHENTICATION_ERROR")
	}
}

/**
 * Error thrown when rate limit is exceeded (HTTP 429).
 * Contains retry-after information for backoff calculation.
 */
export class RateLimitError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		public readonly retryAfter?: number,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 429, requestId, originalError, "RATE_LIMIT_ERROR")
	}
}

/**
 * Error thrown when the server returns an error (HTTP 5xx).
 * These are usually transient and can be retried.
 */
export class ServerError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		statusCode: number,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, statusCode, requestId, originalError, "SERVER_ERROR")
	}
}

/**
 * Error thrown when there's a network connection issue.
 * No HTTP response was received from the server.
 */
export class ConnectionError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		originalError?: Error
	) {
		super(message, providerName, undefined, undefined, originalError, "CONNECTION_ERROR")
	}
}

/**
 * Error thrown when a request times out.
 * The request was sent but no response was received within the timeout period.
 */
export class RequestTimeoutError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 408, requestId, originalError, "REQUEST_TIMEOUT_ERROR")
	}
}

/**
 * Error thrown when the request is invalid (HTTP 400).
 * Usually indicates a problem with the request parameters.
 */
export class BadRequestError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 400, requestId, originalError, "BAD_REQUEST_ERROR")
	}
}

/**
 * Error thrown when access is denied (HTTP 403).
 * The API key may not have permission to access the requested resource.
 */
export class PermissionDeniedError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 403, requestId, originalError, "PERMISSION_DENIED_ERROR")
	}
}

/**
 * Error thrown when the requested resource is not found (HTTP 404).
 * Usually indicates an invalid model ID or endpoint.
 */
export class NotFoundError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 404, requestId, originalError, "NOT_FOUND_ERROR")
	}
}

/**
 * Error thrown when the request cannot be processed (HTTP 422).
 * Usually indicates a validation error in the request body.
 */
export class UnprocessableEntityError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 422, requestId, originalError, "UNPROCESSABLE_ENTITY_ERROR")
	}
}

// ============================================================================
// Error Type Unions and Interfaces
// ============================================================================

/**
 * Union type for all streaming errors
 */
export type StreamingErrorType =
	| InvalidStreamError
	| ChunkHandlerError
	| StreamAbortedError
	| ToolCallError
	| TokenError
	| UserInterruptError
	| ToolInterruptError
	| StreamProviderError
	| StreamTimeoutError
	| StateError
	| ApiProviderError

/**
 * Union type for all API provider errors
 */
export type ApiProviderErrorType =
	| ApiProviderError
	| AuthenticationError
	| RateLimitError
	| ServerError
	| ConnectionError
	| RequestTimeoutError
	| BadRequestError
	| PermissionDeniedError
	| NotFoundError
	| UnprocessableEntityError

/**
 * Result of error handling operation
 */
export interface ErrorHandlingResult {
	shouldRetry: boolean
	retryDelay?: number
	abortReason?: string
	errorMessage?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error is a streaming error
 */
export function isStreamingError(error: unknown): error is StreamingError {
	return error instanceof StreamingError
}

/**
 * Check if an error is an API provider error
 */
export function isApiProviderError(error: unknown): error is ApiProviderError {
	return error instanceof ApiProviderError
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
	// For other streaming errors, check the code
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
export function getErrorContext(error: unknown): Record<string, any> | undefined {
	if (error instanceof BaseError) {
		return error.context
	}
	return undefined
}

/**
 * Get HTTP status code from an error if available
 */
export function getErrorStatusCode(error: unknown): number | undefined {
	if (error instanceof ApiProviderError) {
		return error.statusCode
	}
	if (error instanceof Error) {
		return (error as any).status
	}
	return undefined
}

/**
 * Get request ID from an error if available
 */
export function getErrorRequestId(error: unknown): string | undefined {
	if (error instanceof ApiProviderError) {
		return error.requestId
	}
	if (error instanceof Error) {
		return (error as any).requestId
	}
	return undefined
}
