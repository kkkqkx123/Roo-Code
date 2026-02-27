# Error Refactoring Plan

## Executive Summary

This document outlines the plan to refactor error handling in the Roo-Code codebase to:
1. Split `packages/types/src/errors.ts` into a modular directory structure
2. Create dedicated tool error types for better LLM guidance and telemetry

**Date**: 2026-02-27  
**Status**: Approved for Implementation

---

## Part 1: Split `packages/types/src/errors.ts`

### Current State Analysis

The current `errors.ts` file (180 lines) contains:
- 2 base error classes (`BaseError`, `StreamingError`)
- 13 streaming-related error classes
- 3 utility functions
- 2 type definitions

**Problems**:
1. Mixed responsibilities (base classes + streaming errors + utilities)
2. Poor scalability for future error categories
3. Suboptimal tree-shaking for bundlers
4. Difficult to discover specific error types

### Proposed Directory Structure

```
packages/types/src/errors/
├── index.ts              # Main entry point, re-exports all
├── base.ts               # BaseError, StreamingError
├── streaming.ts          # All streaming error types
├── tool.ts               # ToolCallError, ToolInterruptError (moved from streaming)
└── utils.ts              # Helper functions
```

### File Contents

#### `packages/types/src/errors/base.ts`
```typescript
/**
 * Base error classes for the application.
 */

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
```

#### `packages/types/src/errors/streaming.ts`
```typescript
/**
 * Streaming error types.
 */

import { StreamingError } from "./base.js"

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

/**
 * Union type for all streaming errors
 */
export type StreamingErrorType =
  | InvalidStreamError
  | ChunkHandlerError
  | StreamAbortedError
  | TokenError
  | UserInterruptError
  | StreamProviderError
  | StreamTimeoutError
  | StateError
```

#### `packages/types/src/errors/tool.ts`
```typescript
/**
 * Tool-related error types.
 */

import { StreamingError } from "./base.js"

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
 * Error thrown when a tool use result interrupts the stream
 */
export class ToolInterruptError extends StreamingError {
  constructor(
    message: string = "Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message."
  ) {
    super(message, "TOOL_INTERRUPT")
  }
}
```

#### `packages/types/src/errors/utils.ts`
```typescript
/**
 * Error utility functions.
 */

import { BaseError, StreamingError } from "./base.js"
import type { StreamingErrorType } from "./streaming.js"

/**
 * Check if an error is a streaming error
 */
export function isStreamingError(error: unknown): error is StreamingError {
  return error instanceof StreamingError
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
 * Result of error handling operation
 */
export interface ErrorHandlingResult {
  shouldRetry: boolean
  retryDelay?: number
  abortReason?: string
  errorMessage?: string
}
```

#### `packages/types/src/errors/index.ts`
```typescript
/**
 * Unified Error Definitions
 *
 * This module contains all error classes and types used across the project.
 * These errors provide a consistent error handling mechanism with proper
 * error codes and context information.
 */

export * from "./base.js"
export * from "./streaming.js"
export * from "./tool.js"
export * from "./utils.js"
```

### Migration Steps

1. Create new directory structure
2. Create individual files with split content
3. Update `packages/types/src/index.ts` export path
4. Run build to verify no breaking changes
5. Run tests to ensure compatibility

---

## Part 2: Create Tool Error Types

### Current State Analysis

Tools in `src/core/tools` currently use:
- Generic `Error` objects with string messages
- `formatResponse.toolError()` for LLM feedback (JSON format)
- `task.recordToolError()` for telemetry
- Local error classes (e.g., `ShellIntegrationError`)

**Problems**:
1. No structured error context for LLM guidance
2. Inconsistent error formats across tools
3. Limited telemetry capabilities (no error codes)
4. LLM receives vague error messages without actionable suggestions

### Proposed Tool Error Architecture

#### Directory Structure
```
src/core/tools/errors/
├── index.ts          # Re-exports all tool errors
├── types.ts          # ToolErrorCode enum, ToolError base class
├── file-errors.ts    # File operation errors
├── parameter-errors.ts # Parameter validation errors
├── execution-errors.ts # Command execution errors
└── state-errors.ts   # State and repetition errors
```

#### Error Code Enum
```typescript
export enum ToolErrorCode {
  // Parameter errors
  MISSING_PARAMETER = "MISSING_PARAMETER",
  INVALID_PARAMETER = "INVALID_PARAMETER",
  
  // File operation errors
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_ALREADY_EXISTS = "FILE_ALREADY_EXISTS",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  ROOIGNORE_VIOLATION = "ROOIGNORE_VIOLATION",
  DIRECTORY_NOT_FOUND = "DIRECTORY_NOT_FOUND",
  
  // Content errors
  CONTENT_NOT_FOUND = "CONTENT_NOT_FOUND",
  CONTENT_MISMATCH = "CONTENT_MISMATCH",
  DUPLICATE_MATCH = "DUPLICATE_MATCH",
  NO_MATCH_FOUND = "NO_MATCH_FOUND",
  
  // Execution errors
  COMMAND_TIMEOUT = "COMMAND_TIMEOUT",
  COMMAND_FAILED = "COMMAND_FAILED",
  DIFF_APPLY_FAILED = "DIFF_APPLY_FAILED",
  SHELL_INTEGRATION_ERROR = "SHELL_INTEGRATION_ERROR",
  
  // State errors
  INVALID_STATE = "INVALID_STATE",
  TOOL_REPETITION = "TOOL_REPETITION",
  CONSECUTIVE_MISTAKES = "CONSECUTIVE_MISTAKES",
}
```

#### Base ToolError Class
```typescript
import { BaseError } from "@coder/types"
import type { ToolName } from "@coder/types"

export class ToolError extends BaseError {
  constructor(
    public readonly toolErrorCode: ToolErrorCode,
    message: string,
    public readonly toolName: ToolName,
    public readonly suggestion?: string,
    context?: Record<string, any>
  ) {
    super(message, toolErrorCode, context)
    this.name = "ToolError"
  }

  toObject(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.toolErrorCode,
      toolName: this.toolName,
      message: this.message,
      suggestion: this.suggestion,
      context: this.context,
    }
  }
}
```

#### Specific Error Classes with LLM Guidance

```typescript
// file-errors.ts
export class FileNotFoundToolError extends ToolError {
  constructor(toolName: ToolName, filePath: string) {
    super(
      ToolErrorCode.FILE_NOT_FOUND,
      `File not found: ${filePath}`,
      toolName,
      "Verify the file path exists using list_files or search_files before attempting operations. " +
      "Check if the path is relative to the workspace directory."
    )
  }
}

export class PermissionDeniedToolError extends ToolError {
  constructor(toolName: ToolName, filePath: string, reason: string) {
    const suggestion = reason.includes(".rooignore")
      ? "This file is restricted by .rooignore. Options: 1) Ask the user to update .rooignore, " +
        "2) Work with alternative files, 3) Request user approval for this specific operation."
      : "File is write-protected. Request user approval or choose a different file."

    super(
      ToolErrorCode.PERMISSION_DENIED,
      `Access denied: ${filePath} - ${reason}`,
      toolName,
      suggestion
    )
  }
}

export class DirectoryNotFoundToolError extends ToolError {
  constructor(toolName: ToolName, dirPath: string) {
    super(
      ToolErrorCode.DIRECTORY_NOT_FOUND,
      `Directory not found: ${dirPath}`,
      toolName,
      "Verify the directory path exists using list_files. Check if the path is relative " +
      "to the workspace directory. Consider creating the directory if needed."
    )
  }
}

// parameter-errors.ts
export class MissingParameterToolError extends ToolError {
  constructor(toolName: ToolName, paramName: string, example?: string) {
    super(
      ToolErrorCode.MISSING_PARAMETER,
      `Missing required parameter: ${paramName}`,
      toolName,
      `Please provide the '${paramName}' parameter. ${example ? `Example: ${example}` : ""}`
    )
  }
}

export class InvalidParameterToolError extends ToolError {
  constructor(
    toolName: ToolName,
    paramName: string,
    value: unknown,
    reason: string
  ) {
    super(
      ToolErrorCode.INVALID_PARAMETER,
      `Invalid parameter '${paramName}': ${reason}`,
      toolName,
      `The value '${JSON.stringify(value)}' is invalid. ${reason}. Please check the tool documentation.`,
      { paramName, value }
    )
  }
}

// execution-errors.ts
export class CommandTimeoutToolError extends ToolError {
  constructor(toolName: ToolName, command: string, timeoutMs: number) {
    super(
      ToolErrorCode.COMMAND_TIMEOUT,
      `Command timed out after ${timeoutMs}ms: ${command}`,
      toolName,
      "The command took too long to execute. Consider: 1) Breaking into smaller commands, " +
      "2) Using background execution, 3) Increasing timeout setting, 4) Checking for infinite loops."
    )
  }
}

export class DiffApplyFailedToolError extends ToolError {
  constructor(
    toolName: ToolName,
    filePath: string,
    reason: string,
    suggestion?: string
  ) {
    const defaultSuggestion = "Read the current file content with read_file, then use the correct " +
      "old_string that matches exactly (including whitespace and indentation). " +
      "Consider using smaller, more precise diff blocks."

    super(
      ToolErrorCode.DIFF_APPLY_FAILED,
      `Failed to apply diff to ${filePath}: ${reason}`,
      toolName,
      suggestion || defaultSuggestion,
      { filePath, reason }
    )
  }
}

// state-errors.ts
export class ToolRepetitionError extends ToolError {
  constructor(toolName: ToolName, count: number, windowSize?: number) {
    super(
      ToolErrorCode.TOOL_REPETITION,
      `Tool '${toolName}' called ${count} times consecutively`,
      toolName,
      "You are repeating the same tool call without making progress. Consider: " +
      "1) Reading the file to understand current state, 2) Trying a different approach, " +
      "3) Asking for clarification if stuck." +
      (windowSize ? ` (Detected in last ${windowSize} messages)` : "")
    )
  }
}
```

### Integration Guide

#### 1. Update Tool Implementations

Before:
```typescript
if (!relPath) {
  task.consecutiveMistakeCount++
  task.recordToolError("edit")
  pushToolResult(await task.sayAndCreateMissingParamError("edit", "file_path"))
  return
}
```

After:
```typescript
import { MissingParameterToolError } from "./errors/index.js"

if (!relPath) {
  task.consecutiveMistakeCount++
  const error = new MissingParameterToolError("edit", "file_path", "{ file_path: 'src/index.ts' }")
  task.recordToolError("edit", error.toObject())
  pushToolResult(formatResponse.toolError(error.message, error.suggestion))
  return
}
```

#### 2. Update formatResponse.toolError

```typescript
toolError: (error?: string, suggestion?: string) =>
  JSON.stringify({
    status: "error",
    message: "The tool execution failed",
    error,
    suggestion,  // New field for LLM guidance
  }),
```

#### 3. Update handleError Callback

```typescript
async function handleError(action: string, error: Error) {
  if (error instanceof ToolError) {
    // Structured error with suggestion
    pushToolResult(formatResponse.toolError(error.message, error.suggestion))
    task.recordToolError(currentToolName, error.toObject())
  } else {
    // Generic error
    pushToolResult(formatResponse.toolError(error.message))
    task.recordToolError(currentToolName)
  }
}
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **LLM Guidance** | Each error includes actionable suggestions for recovery |
| **Consistent Format** | Unified error structure across all 26+ tools |
| **Better Telemetry** | Error codes enable precise tracking and analytics |
| **Debugging** | Structured context helps identify root causes |
| **User Experience** | Clear error messages with next-step recommendations |

---

## Implementation Phases

### Phase 1: Split errors.ts (Priority: Medium)
- [ ] Create `packages/types/src/errors/` directory
- [ ] Create split files (base.ts, streaming.ts, tool.ts, utils.ts, index.ts)
- [ ] Update `packages/types/src/index.ts` export
- [ ] Run build and tests
- [ ] Update any import paths if needed

### Phase 2: Create Tool Error Types (Priority: High)
- [ ] Create `src/core/tools/errors/` directory
- [ ] Create types.ts with ToolErrorCode and ToolError base class
- [ ] Create specific error classes (file-errors.ts, parameter-errors.ts, etc.)
- [ ] Update `formatResponse.toolError` to support suggestions
- [ ] Update handleError callback to handle ToolError instances

### Phase 3: Migrate Tools (Priority: High)
- [ ] Update ExecuteCommandTool.ts to use tool errors
- [ ] Update EditFileTool.ts to use tool errors
- [ ] Update WriteToFileTool.ts to use tool errors
- [ ] Update ApplyDiffTool.ts to use tool errors
- [ ] Update ReadFileTool.ts to use tool errors
- [ ] Update remaining tools...

### Phase 4: Testing and Validation (Priority: High)
- [ ] Add unit tests for new error classes
- [ ] Update existing tool tests to verify error handling
- [ ] Run full test suite
- [ ] Verify LLM receives proper error suggestions

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes to imports | Low | Maintain backward compatibility in index.ts |
| Tool behavior changes | Medium | Comprehensive testing before merge |
| LLM response format changes | Low | Gradual rollout, monitor LLM behavior |

---

## Success Metrics

1. ✅ Build passes without errors
2. ✅ All existing tests pass
3. ✅ New error classes have unit tests
4. ✅ LLM receives structured error messages with suggestions
5. ✅ Telemetry captures error codes for analytics

---

## Related Files

- `packages/types/src/errors.ts` - Current monolithic error file
- `src/core/tools/apply-patch/errors.ts` - Example of well-structured error handling
- `src/shared/modes.ts` - Contains FileRestrictionError
- `src/core/prompts/responses.ts` - formatResponse.toolError implementation
