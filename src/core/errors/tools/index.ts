/**
 * Tool error types.
 * Errors that occur during tool validation, execution, and state management.
 */

export * from "./validation-errors.js"
export * from "./file-errors.js"
export * from "./content-errors.js"
export * from "./execution-errors.js"
export * from "./state-errors.js"

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
