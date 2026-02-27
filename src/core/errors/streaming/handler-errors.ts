/**
 * Streaming handler errors.
 * Errors that occur during chunk processing and handling.
 */

/**
 * Base class for stream handler errors.
 */
export abstract class HandlerError extends Error {
	constructor(
		message: string,
		public readonly chunkType: string,
		public readonly originalError?: Error
	) {
		super(message)
		this.name = this.constructor.name
	}
}

/**
 * Error thrown when a chunk handler fails.
 */
export class ChunkHandlerError extends HandlerError {
	constructor(
		chunkType: string,
		message: string,
		originalError?: Error
	) {
		super(message, chunkType, originalError)
		this.name = "ChunkHandlerError"
	}
}

/**
 * Error thrown when token counting or usage tracking fails.
 */
export class TokenError extends Error {
	constructor(
		message: string,
		public readonly context?: Record<string, any>
	) {
		super(message)
		this.name = "TokenError"
	}
}
