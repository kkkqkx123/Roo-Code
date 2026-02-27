/**
 * Streaming error types.
 * Errors that occur during stream processing, parsing, and handling.
 */

export * from "./parse-errors.js"
export * from "./handler-errors.js"
export * from "./abort-errors.js"
export * from "./provider-errors.js"

/**
 * Union type for all streaming errors
 */
export type StreamingErrorType =
	| InvalidStreamError
	| ChunkParseError
	| ToolCallParseError
	| ChunkHandlerError
	| TokenError
	| StreamAbortedError
	| UserInterruptError
	| ToolInterruptError
	| StreamProviderError
	| StreamTimeoutError
	| StateError

// Re-export specific types for convenience
import type {
	InvalidStreamError,
	ChunkParseError,
	ToolCallParseError,
} from "./parse-errors.js"

import type {
	ChunkHandlerError,
	TokenError,
} from "./handler-errors.js"

import type {
	StreamAbortedError,
	UserInterruptError,
	ToolInterruptError,
} from "./abort-errors.js"

import type {
	StreamProviderError,
	StreamTimeoutError,
	StateError,
} from "./provider-errors.js"
