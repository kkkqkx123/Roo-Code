/**
 * Streaming abort errors.
 * Errors that occur when a stream is cancelled or interrupted.
 */

/**
 * Base class for stream abort errors.
 */
export abstract class AbortError extends Error {
	constructor(
		message: string,
		public readonly reason?: string
	) {
		super(message)
		this.name = this.constructor.name
	}
}

/**
 * Error thrown when the stream is aborted.
 */
export class StreamAbortedError extends AbortError {
	constructor(reason: string) {
		super(`Stream aborted: ${reason}`, reason)
		this.name = "StreamAbortedError"
	}
}

/**
 * Error thrown when the stream is interrupted by user feedback.
 */
export class UserInterruptError extends AbortError {
	constructor(message: string = "Response interrupted by user feedback") {
		super(message, "user_feedback")
		this.name = "UserInterruptError"
	}
}

/**
 * Error thrown when a tool use result interrupts the stream.
 * This happens when multiple tools are used simultaneously.
 */
export class ToolInterruptError extends AbortError {
	constructor(
		message: string = "Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message."
	) {
		super(message, "tool_interrupt")
		this.name = "ToolInterruptError"
	}
}
