/**
 * Streaming Error Classes
 *
 * Error classes for streaming-related operations including chunk processing,
 * tool calls, token tracking, and stream lifecycle events.
 */

import { BaseError } from "./base.js"

/**
 * Base error class for streaming-related errors
 */
export abstract class StreamingError extends BaseError {
	constructor(
		message: string,
		code: string,
		context?: Record<string, unknown>
	) {
		super(message, code, context)
	}
}

/**
 * Error thrown when the stream is invalid or malformed
 */
export class InvalidStreamError extends StreamingError {
	constructor(message: string, context?: Record<string, unknown>) {
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
	constructor(readonly reason: string, context?: Record<string, unknown>) {
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
	constructor(message: string, context?: Record<string, unknown>) {
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
		context?: Record<string, unknown>
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
	constructor(message: string, context?: Record<string, unknown>) {
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

/**
 * Type guard to check if an error is a streaming error
 */
export function isStreamingError(error: unknown): error is StreamingError {
	return error instanceof StreamingError
}

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
	| StreamingRetryError
