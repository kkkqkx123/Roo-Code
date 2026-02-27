/**
 * Streaming parse errors.
 * Errors that occur during stream parsing and message interpretation.
 */

/**
 * Base class for stream parsing errors.
 */
export abstract class ParseError extends Error {
	constructor(
		message: string,
		public readonly chunk?: string
	) {
		super(message)
		this.name = this.constructor.name
	}
}

/**
 * Error thrown when the stream format is invalid or malformed.
 */
export class InvalidStreamError extends ParseError {
	constructor(reason: string) {
		super(`Invalid stream: ${reason}`)
		this.name = "InvalidStreamError"
	}
}

/**
 * Error thrown when a chunk cannot be parsed.
 */
export class ChunkParseError extends ParseError {
	constructor(
		message: string,
		chunk: string,
		public readonly position?: number
	) {
		super(message, chunk)
		this.name = "ChunkParseError"
	}
}

/**
 * Error thrown when tool call parsing fails.
 */
export class ToolCallParseError extends ParseError {
	constructor(
		public readonly toolName: string,
		message: string,
		chunk?: string
	) {
		super(`Failed to parse tool call '${toolName}': ${message}`, chunk)
		this.name = "ToolCallParseError"
	}
}
