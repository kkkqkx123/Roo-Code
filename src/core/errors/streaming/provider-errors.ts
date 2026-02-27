/**
 * Streaming provider errors.
 * Errors that occur due to API provider failures.
 */

/**
 * Base class for stream provider errors.
 */
export abstract class ProviderError extends Error {
	constructor(
		message: string,
		public readonly providerName?: string,
		public readonly originalError?: Error
	) {
		super(message)
		this.name = this.constructor.name
	}
}

/**
 * Error thrown when the stream provider fails.
 */
export class StreamProviderError extends ProviderError {
	constructor(
		message: string,
		providerName?: string,
		originalError?: Error
	) {
		super(message, providerName, originalError)
		this.name = "StreamProviderError"
	}
}

/**
 * Error thrown when there's a timeout during stream processing.
 */
export class StreamTimeoutError extends Error {
	constructor(
		public readonly operation: string,
		public readonly timeoutMs: number,
		message?: string
	) {
		super(message ?? `Timeout during ${operation} after ${timeoutMs}ms`)
		this.name = "StreamTimeoutError"
	}
}

/**
 * Error thrown when there's a state inconsistency during streaming.
 */
export class StateError extends Error {
	constructor(
		message: string,
		public readonly context?: Record<string, any>
	) {
		super(message)
		this.name = "StateError"
	}
}

/**
 * Streaming retry error type - used internally for retry logic.
 */
export class StreamingRetryError extends Error {
	constructor(
		public retryDelay: number,
		public rawError?: unknown
	) {
		super("Stream processing failed, will retry")
		this.name = "StreamingRetryError"
	}
}
