# Error Handling Architecture Design

**Status**: Draft  
**Date**: 2026-02-27  
**Author**: Roo Code Team

---

## Executive Summary

This document describes a redesigned error handling architecture for Roo-Code that:

1. **Separates concerns** between streaming errors and tool execution errors
2. **Eliminates unnecessary abstraction** (BaseError with code field)
3. **Uses instanceof checks** instead of string error codes
4. **Distinguishes error audiences**: telemetry/logging vs. LLM guidance
5. **Provides actionable guidance** to LLM for error recovery

---

## Problem Analysis

### Current Issues

#### 1. Incorrect Inheritance Hierarchy

```typescript
// ❌ PROBLEM: Tool errors inherit from StreamingError
export class ToolCallError extends StreamingError { ... }
export class ToolInterruptError extends StreamingError { ... }
```

**Why it's wrong**:
- Tool execution errors (validation, file not found, permission denied) are **NOT** streaming errors
- Streaming errors occur during **message parsing and chunk processing**
- Tool errors occur during **tool validation and execution**
- These are orthogonal concerns with different handling strategies

#### 2. Misleading Error Messages

```typescript
// ❌ PROBLEM: Message doesn't match implementation
export class ToolInterruptError extends StreamingError {
  constructor(
    message: string = "Response interrupted by a tool use result. Only one tool may be used at a time..."
  ) {
    super(message, "TOOL_INTERRUPT")
  }
}
```

**Reality**: This error is never thrown for tool interruption. The name and message are lies.

#### 3. Useless BaseError Abstraction

```typescript
// ❌ PROBLEM: What does this code provide?
export abstract class BaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,  // String codes are meaningless
    public readonly context?: Record<string, any>
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

// Usage:
throw new FileNotFoundToolError(...)  // What's the code? "FILE_NOT_FOUND"? Why not instanceof?
```

**Problems**:
- `code` field duplicates what `instanceof` provides
- No enforcement of valid codes (any string allowed)
- No type safety - codes can change without breaking compilation
- Context is untyped `Record<string, any>`

#### 4. No Separation of Error Audiences

Current flow:
```
Tool Error → formatResponse.toolError() → LLM
           → task.recordToolError() → Metrics
```

Both use the **same error object**, but they have different needs:

| Audience | Needs |
|----------|-------|
| **LLM** | Actionable guidance, what went wrong, how to fix |
| **Telemetry** | Error category, tool name, parameters (sanitized), stack trace |
| **User (UI)** | Human-readable message, progress impact |

---

## Design Principles

### 1. Separation of Concerns

```
┌─────────────────────────────────────────────────────────────┐
│                    Error Domains                            │
├─────────────────────────────────────────────────────────────┤
│  Streaming Domain    │  Tool Execution Domain               │
│  - Message parsing   │  - Parameter validation              │
│  - Chunk handling    │  - File operations                   │
│  - Token counting    │  - Command execution                 │
│  - Stream abortion   │  - Permission checks                 │
└─────────────────────────────────────────────────────────────┘
```

### 2. Type-Safe Error Classification

Use **class hierarchy + instanceof** instead of string codes:

```typescript
// ✅ GOOD: Type-safe, IDE-friendly, refactoring-safe
if (error instanceof FileNotFoundToolError) {
  // Handle file not found
}

// ❌ BAD: String comparison
if (error.code === "FILE_NOT_FOUND") { ... }
```

### 3. Error Audience Separation

```typescript
interface ToolError {
  // For LLM consumption
  toLLMMessage(): LLMErrorPayload
  
  // For telemetry/logging
  toLogEntry(): LogEntry
  
  // For UI display (optional)
  toUserMessage?: () => UserMessage
}
```

### 4. Minimal Abstraction

Don't create abstraction unless it provides value:
- ❌ `BaseError` with `code` field → No value add
- ✅ `ValidationError` base class → Groups validation errors
- ✅ `ExecutionError` base class → Groups runtime errors

---

## Proposed Architecture

### Error Domain Hierarchy

```
Error (built-in)
│
├── StreamingError                    // Stream processing errors
│   ├── ParseError
│   │   ├── InvalidStreamError
│   │   └── ChunkParseError
│   ├── HandlerError
│   │   └── ChunkHandlerError
│   ├── AbortError
│   │   ├── StreamAbortedError
│   │   └── UserInterruptError
│   ├── ProviderError
│   │   └── StreamProviderError
│   └── TokenError
│
├── ToolError                         // Tool execution errors (NEW)
│   ├── ValidationError (pre-execution)
│   │   ├── MissingParameterError
│   │   ├── InvalidParameterError
│   │   └── InvalidToolError
│   ├── FileOperationError
│   │   ├── FileNotFoundError
│   │   ├── FileExistsError
│   │   ├── PermissionDeniedError
│   │   └── RooIgnoreViolationError
│   ├── ContentError
│   │   ├── ContentNotFoundError
│   │   ├── ContentMismatchError
│   │   └── DuplicateMatchError
│   ├── ExecutionError
│   │   ├── CommandTimeoutError
│   │   ├── CommandFailedError
│   │   └── DiffApplyFailedError
│   └── StateError
│       ├── ToolRepetitionError
│       └── ConsecutiveMistakeError
│
└── NetworkError                      // API/HTTP errors (future)
    ├── RateLimitError
    ├── AuthenticationError
    └── TimeoutError
```

### File Structure

```
src/
├── core/
│   ├── errors/
│   │   ├── index.ts
│   │   ├── streaming/
│   │   │   ├── index.ts
│   │   │   ├── parse-errors.ts
│   │   │   ├── handler-errors.ts
│   │   │   ├── abort-errors.ts
│   │   │   └── provider-errors.ts
│   │   └── tools/
│   │       ├── index.ts
│   │       ├── validation-errors.ts
│   │       ├── file-errors.ts
│   │       ├── content-errors.ts
│   │       ├── execution-errors.ts
│   │       └── state-errors.ts
│   ├── tools/
│   │   └── ... (tool implementations use errors from core/errors/tools/)
│   └── task/
│       └── ... (uses both streaming and tool errors)
└── shared/
    └── errors/
        └── ... (errors shared across layers, e.g., FileRestrictionError)

packages/types/src/
└── errors/                          // ONLY exported error types for external use
    ├── index.ts
    ├── base.ts                      // Minimal base classes if needed
    ├── streaming.ts                 // Re-export from src/core/errors/streaming
    └── tool.ts                      // Re-export from src/core/errors/tools
```

---

## Implementation Details

### Streaming Errors (Refined)

Keep streaming errors but fix the hierarchy:

```typescript
// src/core/errors/streaming/parse-errors.ts

export class ParseError extends Error {
  constructor(message: string, public readonly chunk?: string) {
    super(message)
    this.name = "ParseError"
  }
}

export class InvalidStreamError extends ParseError {
  constructor(reason: string) {
    super(`Invalid stream: ${reason}`)
    this.name = "InvalidStreamError"
  }
}

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
```

### Tool Errors (New)

```typescript
// src/core/errors/tools/validation-errors.ts

/**
 * Base class for tool validation errors (pre-execution).
 * These errors occur before the tool actually runs.
 */
export abstract class ValidationError extends Error {
  constructor(
    message: string,
    public readonly toolName: ToolName,
    public readonly suggestion?: string
  ) {
    super(message)
    this.name = "ValidationError"
  }

  /**
   * Format error for LLM consumption.
   * Includes actionable guidance.
   */
  toLLMMessage(): LLMErrorPayload {
    return {
      status: "error",
      type: "validation_error",
      error_class: this.constructor.name,
      message: this.message,
      suggestion: this.suggestion,
    }
  }

  /**
   * Format error for telemetry/logging.
   * Includes tool name and parameters (sanitized).
   */
  toLogEntry(params?: Record<string, unknown>): LogEntry {
    return {
      level: "warn",
      category: "tool_validation",
      tool: this.toolName,
      error_type: this.constructor.name,
      message: this.message,
      params: sanitizeForLogging(params),
      timestamp: Date.now(),
    }
  }
}

/**
 * Missing required parameter.
 */
export class MissingParameterError extends ValidationError {
  constructor(
    toolName: ToolName,
    paramName: string,
    example?: string
  ) {
    super(
      `Missing required parameter: ${paramName}`,
      toolName,
      `Please provide the '${paramName}' parameter.${example ? ` Example: ${example}` : ""}`
    )
    this.name = "MissingParameterError"
  }
}

/**
 * Invalid parameter value.
 */
export class InvalidParameterError extends ValidationError {
  constructor(
    toolName: ToolName,
    paramName: string,
    value: unknown,
    reason: string
  ) {
    super(
      `Invalid parameter '${paramName}': ${reason}`,
      toolName,
      `The value '${JSON.stringify(value)}' is invalid. ${reason}`
    )
    this.name = "InvalidParameterError"
  }
}
```

```typescript
// src/core/errors/tools/file-errors.ts

/**
 * Base class for file operation errors.
 */
export abstract class FileOperationError extends Error {
  constructor(
    message: string,
    public readonly toolName: ToolName,
    public readonly filePath: string,
    public readonly suggestion?: string
  ) {
    super(message)
    this.name = "FileOperationError"
  }

  toLLMMessage(): LLMErrorPayload {
    return {
      status: "error",
      type: "file_operation_error",
      error_class: this.constructor.name,
      message: this.message,
      path: this.filePath,
      suggestion: this.suggestion,
    }
  }

  toLogEntry(): LogEntry {
    return {
      level: "error",
      category: "file_operation",
      tool: this.toolName,
      error_type: this.constructor.name,
      path: this.filePath,
      message: this.message,
      timestamp: Date.now(),
    }
  }
}

/**
 * File not found.
 */
export class FileNotFoundToolError extends FileOperationError {
  constructor(toolName: ToolName, filePath: string) {
    super(
      `File not found: ${filePath}`,
      toolName,
      filePath,
      "Verify the file path exists using list_files or search_files before attempting operations. " +
      "Check if the path is relative to the workspace directory."
    )
    this.name = "FileNotFoundToolError"
  }
}

/**
 * Permission denied (including .rooignore violations).
 */
export class PermissionDeniedToolError extends FileOperationError {
  constructor(
    toolName: ToolName,
    filePath: string,
    reason: "rooignore" | "write_protected" | "system_permission"
  ) {
    const suggestions = {
      rooignore:
        "This file is restricted by .rooignore. Options: " +
        "1) Ask the user to update .rooignore, " +
        "2) Work with alternative files, " +
        "3) Request user approval for this specific operation.",
      write_protected:
        "File is write-protected. Request user approval or choose a different file.",
      system_permission:
        "System permission denied. Check file permissions or choose a different file.",
    }

    super(
      `Access denied: ${filePath} (${reason})`,
      toolName,
      filePath,
      suggestions[reason]
    )
    this.name = "PermissionDeniedToolError"
  }
}
```

### Error Handler Integration

```typescript
// src/core/task/error-handling.ts

import {
  ValidationError,
  FileOperationError,
  ExecutionError,
  MissingParameterError,
} from "../errors/tools/index.js"

import { formatResponse } from "../prompts/responses.js"

/**
 * Handle tool execution errors.
 * Separates LLM feedback from telemetry logging.
 */
export async function handleToolError(
  error: unknown,
  toolName: ToolName,
  callbacks: {
    pushToolResult: PushToolResult
    log: (entry: LogEntry) => void
  },
  params?: Record<string, unknown>
): Promise<void> {
  if (error instanceof ValidationError) {
    // Validation error - send guidance to LLM
    callbacks.pushToolResult(formatResponse.toolErrorWithGuidance(
      error.message,
      error.suggestion
    ))
    callbacks.log(error.toLogEntry(params))
    return
  }

  if (error instanceof FileOperationError) {
    // File operation error - send guidance to LLM
    callbacks.pushToolResult(formatResponse.toolErrorWithGuidance(
      error.message,
      error.suggestion
    ))
    callbacks.log(error.toLogEntry())
    return
  }

  if (error instanceof ExecutionError) {
    // Execution error - may include output
    callbacks.pushToolResult(formatResponse.toolErrorWithGuidance(
      error.message,
      error.suggestion
    ))
    callbacks.log(error.toLogEntry())
    return
  }

  // Generic error - fallback
  const message = error instanceof Error ? error.message : String(error)
  callbacks.pushToolResult(formatResponse.toolError(message))
  callbacks.log({
    level: "error",
    category: "tool_execution",
    tool: toolName,
    error_type: "UnknownError",
    message,
    timestamp: Date.now(),
  })
}
```

### Updated formatResponse

```typescript
// src/core/prompts/responses.ts

export const formatResponse = {
  // Existing method (keep for backward compat)
  toolError: (error?: string) =>
    JSON.stringify({
      status: "error",
      message: "The tool execution failed",
      error,
    }),

  // NEW: Error with LLM guidance
  toolErrorWithGuidance: (error: string, suggestion?: string) =>
    JSON.stringify({
      status: "error",
      message: "The tool execution failed",
      error,
      suggestion,  // Actionable guidance for LLM
    }),

  // NEW: Structured error from ToolError instance
  toolErrorFromInstance: (error: ToolError) =>
    JSON.stringify(error.toLLMMessage()),

  // ... rest of existing methods
}
```

---

## Migration Plan

### Phase 1: Create New Error Structure (Week 1)
- [ ] Create `src/core/errors/` directory structure
- [ ] Move streaming errors from `packages/types/src/errors/` to `src/core/errors/streaming/`
- [ ] Create tool error classes in `src/core/errors/tools/`
- [ ] Export from `packages/types` for backward compatibility

### Phase 2: Update Error Handlers (Week 2)
- [ ] Update `handleToolError` to use instanceof checks
- [ ] Update `formatResponse` to support guidance
- [ ] Update `Task.recordToolError` to accept structured errors

### Phase 3: Migrate Tools (Week 3-4)
- [ ] Migrate file operation tools (WriteToFileTool, ReadFileTool, etc.)
- [ ] Migrate command execution tools
- [ ] Migrate diff/patch tools
- [ ] Update tests

### Phase 4: Cleanup (Week 5)
- [ ] Remove old error classes
- [ ] Remove `BaseError.code` field
- [ ] Update documentation

---

## Benefits

| Benefit | Description |
|---------|-------------|
| **Type Safety** | `instanceof` checks are compile-time safe |
| **Clear Guidance** | LLM receives actionable suggestions |
| **Separation of Concerns** | Streaming and tool errors are independent |
| **Better Telemetry** | Structured logging with error categories |
| **Easier Testing** | Mock specific error types |
| **Refactoring Safe** | Rename classes, IDE finds all references |

---

## Anti-Patterns to Avoid

### ❌ Don't: String Error Codes

```typescript
// BAD
export class MyError extends BaseError {
  constructor() {
    super("message", "MY_ERROR_CODE")  // What if typo? No type safety.
  }
}

// Usage
if (error.code === "MY_ERROR_CODE") { ... }  // Stringly-typed
```

### ✅ Do: Class Hierarchy + instanceof

```typescript
// GOOD
export class MyError extends BaseError {
  constructor() {
    super("message")
    this.name = "MyError"
  }
}

// Usage
if (error instanceof MyError) { ... }  // Type-safe
```

### ❌ Don't: Mix Error Domains

```typescript
// BAD: Tool error inherits from streaming error
export class FileNotFoundToolError extends StreamingError { ... }
```

### ✅ Do: Keep Domains Separate

```typescript
// GOOD: Tool error in tool hierarchy
export class FileNotFoundToolError extends FileOperationError { ... }
```

### ❌ Don't: Lie in Error Messages

```typescript
// BAD: Message doesn't match usage
export class ToolInterruptError {
  constructor(message = "Response interrupted by tool use...")
  // But never actually thrown for tool interruption
}
```

### ✅ Do: Accurate Error Names and Messages

```typescript
// GOOD: Name and message match actual usage
export class ToolCallParseError extends ParseError {
  constructor(toolName: string) {
    super(`Failed to parse tool call for: ${toolName}`)
  }
}
```

---

## Appendix: Error Type Reference

### Streaming Error Types

| Error | When Thrown | Recovery |
|-------|-------------|----------|
| `InvalidStreamError` | Stream format is invalid | Abort, report to user |
| `ChunkHandlerError` | Chunk processing fails | Retry or abort |
| `StreamAbortedError` | Stream cancelled by user | Cleanup, no retry |
| `UserInterruptError` | User feedback received | Process feedback |
| `StreamProviderError` | API provider fails | Retry with backoff |
| `TokenError` | Token counting fails | Estimate or abort |

### Tool Error Types

| Error | When Thrown | Recovery |
|-------|-------------|----------|
| `MissingParameterError` | Required param missing | Retry with param |
| `InvalidParameterError` | Param value invalid | Retry with corrected value |
| `FileNotFoundToolError` | File doesn't exist | Verify path, create if needed |
| `PermissionDeniedToolError` | Access denied | Request approval or skip |
| `ContentNotFoundError` | Search string not found | Read file, adjust search |
| `DiffApplyFailedError` | Diff doesn't apply | Read file, regenerate diff |
| `CommandTimeoutError` | Command times out | Use shorter command or increase timeout |
| `ToolRepetitionError` | Same tool called repeatedly | Change strategy |

---

## Related Documents

- [ERROR_REFACTORING_PLAN.md](../../ERROR_REFACTORING_PLAN.md) - Original refactoring plan (superseded)
- [ERROR_HANDLING_ANALYSIS.md](../../ERROR_HANDLING_ANALYSIS.md) - Initial analysis
