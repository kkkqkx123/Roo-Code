/**
 * Tool error types.
 * Errors that occur during tool validation, execution, and state management.
 */

export * from "./validation-errors.js"
export * from "./file-errors.js"
export * from "./content-errors.js"
export * from "./execution-errors.js"
export * from "./state-errors.js"
export * from "./result.js"

// Re-export all error classes for convenience
export {
	// Validation errors
	ValidationError,
	MissingParameterError,
	InvalidParameterError,
	InvalidToolError,
	// Types
	type LLMErrorPayload,
	type LogEntry,
} from "./validation-errors.js"

export {
	// File operation errors
	FileOperationError,
	FileNotFoundToolError,
	FileAlreadyExistsError,
	DirectoryNotFoundToolError,
	PermissionDeniedToolError,
	RooIgnoreViolationError,
	DirectoryCreationError,
	BinaryFileError,
	FileTooLargeError,
} from "./file-errors.js"

export {
	// Content errors
	ContentError,
	ContentNotFoundError,
	ContentMismatchError,
	DuplicateMatchError,
	NoMatchFoundError,
} from "./content-errors.js"

export {
	// Execution errors
	ExecutionError,
	CommandTimeoutError,
	CommandFailedError,
	DiffApplyFailedError,
	ShellIntegrationError,
	PatchParseError,
} from "./execution-errors.js"

export {
	// State errors
	StateError as ToolStateError,
	ToolRepetitionError,
	ConsecutiveMistakeError,
	InvalidToolStateError,
} from "./state-errors.js"

// ============================================================================
// Tool Error Union Type
// ============================================================================

import type { ValidationError } from "./validation-errors.js"
import type { FileOperationError } from "./file-errors.js"
import type { ContentError } from "./content-errors.js"
import type { ExecutionError } from "./execution-errors.js"
import type { StateError } from "./state-errors.js"

/**
 * Union type for all tool errors.
 * Use this for type-safe error handling and result collection.
 */
export type ToolError = ValidationError | FileOperationError | ContentError | ExecutionError | StateError
