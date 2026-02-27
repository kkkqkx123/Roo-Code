# Error System Migration Plan

**Status**: In Progress  
**Date**: 2026-02-27  
**Related Design**: [error-architecture.md](../design/error/error-architecture.md)

---

## Overview

This document describes the migration plan for adopting the new error handling architecture across the Roo-Code codebase.

---

## Completed Work

### Phase 1: Core Error Types ✅

**Location**: `src/core/errors/`

- ✅ `src/core/errors/streaming/` - Streaming error types
  - `parse-errors.ts` - `ParseError`, `InvalidStreamError`, `ChunkParseError`, `ToolCallParseError`
  - `handler-errors.ts` - `HandlerError`, `ChunkHandlerError`, `TokenError`
  - `abort-errors.ts` - `AbortError`, `StreamAbortedError`, `UserInterruptError`, `ToolInterruptError`
  - `provider-errors.ts` - `ProviderError`, `StreamProviderError`, `StreamTimeoutError`, `StateError`, `StreamingRetryError`

- ✅ `src/core/errors/tools/` - Tool error types
  - `validation-errors.ts` - `ValidationError`, `MissingParameterError`, `InvalidParameterError`, `InvalidToolError`
  - `file-errors.ts` - `FileOperationError`, `FileNotFoundToolError`, `PermissionDeniedToolError`, etc.
  - `content-errors.ts` - `ContentError`, `ContentNotFoundError`, `DuplicateMatchError`, etc.
  - `execution-errors.ts` - `ExecutionError`, `CommandTimeoutError`, `DiffApplyFailedError`, etc.
  - `state-errors.ts` - `ToolRepetitionError`, `ConsecutiveMistakeError`, `InvalidToolStateError`

- ✅ `src/core/prompts/responses.ts` - Updated with new methods
  - `toolErrorWithGuidance(error, suggestion)` - Error with LLM guidance
  - `toolErrorFromInstance(llmPayload)` - Error from ToolError instance

---

## Pending Migration Tasks

### Phase 2: Update Error Handlers

**Location**: `src/core/task/`

#### 2.1 Task.ts - Error Handling Integration

**File**: `src/core/task/Task.ts`

**Changes needed**:

1. **Import new error types**:
   ```typescript
   import {
     ValidationError,
     MissingParameterError,
     FileOperationError,
     // ... other error types
   } from "../errors/tools/index.js"
   ```

2. **Update `sayAndCreateMissingParamError` method** (around line 1830):
   ```typescript
   async sayAndCreateMissingParamError(toolName: ToolName, paramName: string, relPath?: string) {
     const error = new MissingParameterError(toolName, paramName)
     await this.say("error", error.message)
     this.recordToolError(toolName, error.toLogEntry())
     return formatResponse.toolErrorFromInstance(error.toLLMMessage())
   }
   ```

3. **Update `recordToolError` method** (around line 4220):
   ```typescript
   public recordToolError(toolName: ToolName, error?: string | LogEntry): void {
     if (typeof error === "string") {
       this.metricsService.recordToolError(toolName, error)
     } else if (error && typeof error === "object") {
       this.metricsService.recordToolError(toolName, error)
     } else {
       this.metricsService.recordToolError(toolName)
     }
   }
   ```

#### 2.2 BaseTool.ts - Error Handler Callback

**File**: `src/core/tools/BaseTool.ts`

**Changes needed**:

1. **Update `handleError` callback type** to support structured errors:
   ```typescript
   export interface ToolCallbacks {
     askApproval: AskApproval
     handleError: HandleError
     pushToolResult: PushToolResult
     toolCallId?: string
   }

   // HandleError should accept ToolError instances
   export type HandleError = (action: string, error: Error) => Promise<void>
   ```

2. **Update error handling in `handle` method** (around line 150):
   ```typescript
   catch (error) {
     console.error(`Error parsing parameters:`, error)
     if (error instanceof ValidationError) {
       // Use structured error
       callbacks.pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
       task.recordToolError(this.name, error.toLogEntry())
     } else {
       // Fallback for generic errors
       const errorMessage = `Failed to parse ${this.name} parameters: ${error instanceof Error ? error.message : String(error)}`
       await callbacks.handleError(`parsing ${this.name} args`, new Error(errorMessage))
     }
     return
   }
   ```

---

### Phase 3: Migrate File Operation Tools

**Priority**: High - Most frequently used tools

#### 3.1 WriteToFileTool.ts

**File**: `src/core/tools/WriteToFileTool.ts`

**Current error patterns** (lines 36-77):
```typescript
if (!path) {
  task.recordToolError("write_to_file")
  pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "path"))
  return
}
```

**Migration**:
```typescript
import { FileNotFoundToolError, PermissionDeniedToolError } from "../errors/tools/index.js"

// In execute method:
if (!relPath) {
  const error = new MissingParameterError("write_to_file", "path")
  task.recordToolError("write_to_file", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}

// For file not found (if checking parent directory):
if (!await fileExistsAtPath(parentDir)) {
  const error = new DirectoryNotFoundToolError("write_to_file", parentDir)
  task.recordToolError("write_to_file", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}

// For rooignore violation:
if (!accessAllowed) {
  const error = new RooIgnoreViolationError("write_to_file", relPath)
  await task.say("rooignore_error", relPath)
  task.recordToolError("write_to_file", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}
```

#### 3.2 ReadFileTool.ts

**File**: `src/core/tools/ReadFileTool.ts`

**Current error patterns** (lines 94-95, 687-688):
```typescript
task.recordToolError("read_file")
const errorMsg = await task.sayAndCreateMissingParamError("read_file", "path")
```

**Migration**: Similar to WriteToFileTool, use `FileNotFoundToolError`, `MissingParameterError`, `RooIgnoreViolationError`

#### 3.3 EditFileTool.ts

**File**: `src/core/tools/EditFileTool.ts`

**Current error patterns** (multiple locations around lines 186-362):
- Missing parameter errors
- RooIgnore errors
- Content not found errors

**Migration**:
- Use `ContentNotFoundError` when old_string not found
- Use `DuplicateMatchError` when multiple matches found
- Use `PermissionDeniedToolError` for access denied

#### 3.4 EditTool.ts

**File**: `src/core/tools/EditTool.ts`

**Current error patterns** (lines 44-108):
- Missing parameter checks
- File not found checks
- Content match checks

**Migration**:
```typescript
// When old_string === new_string
if (oldString === newString) {
  const error = new InvalidParameterError(
    "edit",
    "old_string",
    oldString,
    "'old_string' and 'new_string' are identical. No changes needed."
  )
  task.recordToolError("edit", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}

// When no match found
if (matchCount === 0) {
  const error = new ContentNotFoundError("edit", relPath, oldString)
  task.recordToolError("edit", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}

// When duplicate matches found
if (!replaceAll && matchCount > 1) {
  const error = new DuplicateMatchError("edit", relPath, oldString, matchCount)
  task.recordToolError("edit", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}
```

---

### Phase 4: Migrate Command Execution Tools

#### 4.1 ExecuteCommandTool.ts

**File**: `src/core/tools/ExecuteCommandTool.ts`

**Current error patterns**:
- ShellIntegrationError (local class, line 24)
- Timeout handling (around line 300)

**Migration**:
```typescript
import { CommandTimeoutError, CommandFailedError, ShellIntegrationError as ShellIntegrationErrorType } from "../errors/tools/index.js"

// Replace local ShellIntegrationError class with imported one

// For timeout (around line 300):
if (isTimedOut) {
  const error = new CommandTimeoutError("execute_command", commandToExecute, commandExecutionTimeout)
  task.recordToolError("execute_command", error.toLogEntry())
  task.terminalProcess = undefined
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}
```

#### 4.2 ReadCommandOutputTool.ts

**File**: `src/core/tools/ReadCommandOutputTool.ts`

**Migration**: Use `MissingParameterError` for missing artifact_id

---

### Phase 5: Migrate Diff/Patch Tools

#### 5.1 ApplyDiffTool.ts

**File**: `src/core/tools/ApplyDiffTool.ts`

**Current error patterns** (lines 37-110):
- Missing parameter errors
- File not found errors
- Diff apply failures

**Migration**:
```typescript
import { DiffApplyFailedError, FileNotFoundToolError } from "../errors/tools/index.js"

// When file doesn't exist (line 62):
if (!fileExists) {
  const error = new FileNotFoundToolError("apply_diff", relPath)
  task.recordToolError("apply_diff", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}

// When diff apply fails (line 110):
if (!diffResult.success) {
  const error = new DiffApplyFailedError("apply_diff", relPath, diffResult.error)
  task.recordToolError("apply_diff", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}
```

#### 5.2 ApplyPatchTool.ts

**File**: `src/core/tools/ApplyPatchTool.ts`

**Migration**: Use `PatchParseError` for parse failures, `DiffApplyFailedError` for apply failures

#### 5.3 SearchReplaceTool.ts

**File**: `src/core/tools/SearchReplaceTool.ts`

**Migration**: Similar to EditTool, use content errors

---

### Phase 6: Migrate Other Tools

#### 6.1 ListFilesTool.ts

**File**: `src/core/tools/ListFilesTool.ts`

**Migration**: Use `DirectoryNotFoundToolError`, `MissingParameterError`

#### 6.2 SearchFilesTool.ts

**File**: `src/core/tools/SearchFilesTool.ts`

**Migration**: Use `DirectoryNotFoundToolError`, `MissingParameterError`

#### 6.3 CodebaseSearchTool.ts

**File**: `src/core/tools/CodebaseSearchTool.ts`

**Migration**: Use `MissingParameterError` for missing query

#### 6.4 UseMcpToolTool.ts

**File**: `src/core/tools/UseMcpToolTool.ts`

**Migration**: Keep existing MCP-specific error handling (already has structured errors)

#### 6.5 AccessMcpResourceTool.ts

**File**: `src/core/tools/accessMcpResourceTool.ts`

**Migration**: Keep existing MCP-specific error handling

---

### Phase 7: Update State/Repetition Detection

#### 7.1 ToolRepetitionDetector.ts

**File**: `src/core/tools/ToolRepetitionDetector.ts`

**Current**: Returns boolean/string

**Migration**:
```typescript
import { ToolRepetitionError } from "../errors/tools/index.js"

// When repetition detected:
throw new ToolRepetitionError(toolName, count, windowSize)
```

---

### Phase 8: Update Shared Errors

#### 8.1 modes.ts - FileRestrictionError

**File**: `src/shared/modes.ts`

**Current** (line 145):
```typescript
export class FileRestrictionError extends Error {
  constructor(mode: string, pattern: string, description: string | undefined, filePath: string, tool?: string)
}
```

**Migration**: Consider moving to `src/core/errors/tools/file-errors.ts` or keep in shared if used across layers

#### 8.2 tools.ts - HandleError Type

**File**: `src/shared/tools.ts`

**Current** (line 14):
```typescript
export type HandleError = (action: string, error: Error) => Promise<void>
```

**Migration**: Update to support structured errors

---

### Phase 9: Cleanup Old Error Types

#### 9.1 packages/types/src/errors.ts

**File**: `packages/types/src/errors.ts`

**Action**: Review which errors should remain in types package vs. moved to src/core/errors

**Keep in types**:
- Errors used by external API consumers
- Type definitions only

**Move to src/core/errors**:
- Implementation-specific errors
- Tool-specific errors

---

## Testing Strategy

### Unit Tests

For each migrated tool:

1. **Test error creation**:
   ```typescript
   const error = new FileNotFoundToolError("read_file", "/nonexistent/path.ts")
   expect(error.name).toBe("FileNotFoundToolError")
   expect(error.toolName).toBe("read_file")
   expect(error.filePath).toBe("/nonexistent/path.ts")
   ```

2. **Test LLM message format**:
   ```typescript
   const llmMessage = error.toLLMMessage()
   expect(llmMessage.status).toBe("error")
   expect(llmMessage.suggestion).toBeDefined()
   expect(llmMessage.suggestion).toContain("list_files")
   ```

3. **Test log entry format**:
   ```typescript
   const logEntry = error.toLogEntry()
   expect(logEntry.level).toBe("error")
   expect(logEntry.category).toBe("file_operation")
   expect(logEntry.timestamp).toBeDefined()
   ```

### Integration Tests

1. Test that tools return proper error format to LLM
2. Test that telemetry captures structured errors
3. Test that error guidance helps LLM recover

---

## Rollback Plan

If issues arise:

1. Keep old error handling code alongside new code
2. Use feature flag to toggle between old/new
3. Gradually migrate tools one at a time
4. Monitor error rates and LLM success rates

---

## Success Metrics

- [ ] All tools use new error types
- [ ] LLM receives actionable guidance in 100% of error cases
- [ ] Telemetry captures structured error data
- [ ] No regression in tool success rate
- [ ] Reduced consecutive error rates (better LLM recovery)

---

## File Index

### Core Error Files (New)
```
src/core/errors/
├── index.ts
├── streaming/
│   ├── index.ts
│   ├── parse-errors.ts
│   ├── handler-errors.ts
│   ├── abort-errors.ts
│   └── provider-errors.ts
└── tools/
    ├── index.ts
    ├── validation-errors.ts
    ├── file-errors.ts
    ├── content-errors.ts
    ├── execution-errors.ts
    └── state-errors.ts
```

### Files to Modify
```
src/core/task/Task.ts
src/core/tools/BaseTool.ts
src/core/tools/WriteToFileTool.ts
src/core/tools/ReadFileTool.ts
src/core/tools/EditFileTool.ts
src/core/tools/EditTool.ts
src/core/tools/ExecuteCommandTool.ts
src/core/tools/ReadCommandOutputTool.ts
src/core/tools/ApplyDiffTool.ts
src/core/tools/ApplyPatchTool.ts
src/core/tools/SearchReplaceTool.ts
src/core/tools/ListFilesTool.ts
src/core/tools/SearchFilesTool.ts
src/core/tools/CodebaseSearchTool.ts
src/core/tools/ToolRepetitionDetector.ts
src/shared/modes.ts
src/shared/tools.ts
src/core/prompts/responses.ts (✅ Done)
```

---

## Related Documents

- [error-architecture.md](../design/error/error-architecture.md) - Design specification
- [ERROR_REFACTORING_PLAN.md](../../ERROR_REFACTORING_PLAN.md) - Original refactoring plan (superseded)
- [ERROR_HANDLING_ANALYSIS.md](../../ERROR_HANDLING_ANALYSIS.md) - Initial analysis
