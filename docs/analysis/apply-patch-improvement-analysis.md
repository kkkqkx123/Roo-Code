# Apply Patch Tool Improvement Analysis

## Overview

This document analyzes the current `apply_patch` tool implementation in the Roo-Code project and provides improvement recommendations based on the original Codex `apply_patch` specification.

## Current Implementation Status

### Architecture

The current implementation follows a **modular architecture**:

```
src/core/tools/apply-patch/
├── index.ts          # Module exports
├── parser.ts         # Patch text parsing
├── apply.ts          # Patch application logic
└── seek-sequence.ts  # Fuzzy sequence matching

src/core/tools/ApplyPatchTool.ts  # Main tool execution
src/core/prompts/tools/native-tools/apply_patch.backup  # Tool definition
```

### Implemented Features

✅ **Core Functionality**
- Parse patch format with `*** Begin Patch` / `*** End Patch` markers
- Three file operations: `Add File`, `Delete File`, `Update File`
- File rename support via `*** Move to:` directive
- Context-based hunk matching with `@@` markers
- Multi-pass sequence matching (exact, trim-end, trim, Unicode-normalized)
- Parent directory creation for new files
- RooIgnore and write-protection validation
- Diff view integration with user approval workflow

✅ **Advanced Features**
- Unicode normalization for typographic characters
- Flexible whitespace handling
- EOF marker support (`*** End of File`)
- Heredoc wrapper support (`<<EOF`)
- Partial tool state for streaming

## Gap Analysis: Current vs. Codex Specification

### 1. **Patch Format Definition** ⚠️ PARTIAL

**Current State:**
The tool definition in `apply_patch.backup` has a basic format description but lacks complete specification.

**Missing Elements:**

```typescript
// MISSING: Complete format specification
const apply_patch_DESCRIPTION = `Apply patches to files.
Best for batch operations, refactoring, and multi-file changes...

format:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Each file section starts with one of three headers:
- *** Add File: <path> - Create a new file. Every following line is a + line (the initial contents).
- *** Delete File: <path> - Remove an existing file. Nothing follows.
- *** Update File: <path> - Patch an existing file in place.

For Update File operations:
- May be immediately followed by *** Move to: <new path> if you want to rename the file.
- Then one or more "hunks", each introduced by @@ (optionally followed by context like a class or function name).
- Within a hunk each line starts with:
  - ' ' (space) for context lines (unchanged)
  - '-' for lines to remove
  - '+' for lines to add
- May optionally end with *** End of File for clarity

Context guidelines:
- Show 3 lines of code above and below each change.
- If a change is within 3 lines of a previous change, do NOT duplicate context lines.
- Use @@ with a class/function name if 3 lines of context is insufficient to uniquely identify the location.

Example patch:
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** End of File
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch`
```

**Recommendation:** Update `src/core/prompts/tools/native-tools/apply_patch.ts` with complete format specification.

---

### 2. **Parameter Definition** ⚠️ INCOMPLETE

**Current State:**
Only `patch` parameter is defined.

```typescript
// Current implementation (apply_patch.backup)
parameters: {
    type: "object",
    properties: {
        patch: {
            type: "string",
            description: "The complete patch text..."
        }
    },
    required: ["patch"],
    additionalProperties: false
}
```

**Missing Parameters:**

```typescript
// RECOMMENDED: Enhanced parameter definition
parameters: {
    type: "object",
    properties: {
        patch: {
            type: "string",
            description: "The complete patch text in the apply_patch format..."
        },
        workdir: {
            type: "string",
            description: "Optional working directory for the patch operations. If not provided, uses current directory."
        },
        validate_only: {
            type: "boolean",
            description: "If true, only validate the patch without applying it.",
            default: false
        },
        timeout_ms: {
            type: "number",
            description: "Optional timeout in milliseconds for the patch operation.",
            minimum: 100,
            maximum: 30000
        }
    },
    required: ["patch"],
    additionalProperties: false
}
```

**Benefits:**
- `workdir`: Support for multi-root workspaces
- `validate_only`: Dry-run mode for testing patches
- `timeout_ms`: Prevent long-running operations

**Recommendation:** Add optional parameters to support advanced use cases.

---

### 3. **Return Value Structure** ⚠️ UNSTRUCTURED

**Current State:**
Returns unstructured string messages via `pushToolResult()`.

```typescript
// Current implementation (ApplyPatchTool.ts)
pushToolResult("Successfully deleted ${relPath}")
pushToolResult("Changes were rejected by the user.")
pushToolResult(formatResponse.toolError(errorMessage))
```

**Recommended Structure:**

```typescript
interface ApplyPatchResult {
    success: boolean
    results: {
        path: string
        operation: 'add' | 'delete' | 'update' | 'rename'
        success: boolean
        error?: string
        oldPath?: string  // For rename operations
        newPath?: string  // For rename operations
        diffStats?: {
            additions: number
            deletions: number
        }
    }[]
    summary: {
        total: number
        succeeded: number
        failed: number
    }
    error?: string  // Overall error message
}
```

**Benefits:**
- Structured error handling
- Better telemetry and analytics
- Easier debugging and testing
- Support for partial success scenarios

**Recommendation:** Implement structured return values.

---

### 4. **Validation Rules** ⚠️ BASIC

**Current State:**
Basic validation in parser (`parser.ts`):
- Check for begin/end markers
- Validate hunk header format
- Check for non-empty chunks

**Missing Validations:**

```typescript
// RECOMMENDED: Enhanced validation rules
const validatePatch = (patch: string): ValidationResult => {
    const errors: string[] = []
    const warnings: string[] = []

    // 1. Structural validation
    if (!patch.startsWith('*** Begin Patch')) {
        errors.push("Patch must start with '*** Begin Patch'")
    }
    if (!patch.endsWith('*** End Patch')) {
        errors.push("Patch must end with '*** End Patch'")
    }

    // 2. File operation validation
    const lines = patch.split('\n')
    let currentOperation: 'add' | 'delete' | 'update' | null = null

    for (const line of lines) {
        if (line.startsWith('*** Add File:')) {
            currentOperation = 'add'
            // Validate: subsequent lines must start with '+'
        } else if (line.startsWith('*** Update File:')) {
            currentOperation = 'update'
            // Validate: must have at least one hunk
        } else if (line.startsWith('*** Delete File:')) {
            currentOperation = 'delete'
            // Validate: nothing follows
        } else if (currentOperation === 'add' && !line.startsWith('+') && line.trim() !== '') {
            errors.push(`Add File section: expected line starting with '+', got: ${line}`)
        }
    }

    // 3. Path validation
    // - No absolute paths
    // - No path traversal (../)
    // - Valid filename characters

    // 4. Hunk validation
    // - Context lines match file content
    // - No duplicate hunks
    // - Proper line endings

    return { valid: errors.length === 0, errors, warnings }
}
```

**Recommendation:** Implement comprehensive validation in `parser.ts`.

---

### 5. **Error Handling** ⚠️ PARTIAL

**Current State:**
Basic error types defined:
- `ParseError` in `parser.ts`
- `ApplyPatchError` in `apply.ts`

**Missing Error Types:**

```typescript
// RECOMMENDED: Comprehensive error types
enum PatchErrorCode {
    // Format errors
    INVALID_FORMAT = 'INVALID_FORMAT',
    MISSING_BEGIN_MARKER = 'MISSING_BEGIN_MARKER',
    MISSING_END_MARKER = 'MISSING_END_MARKER',
    INVALID_FILE_HEADER = 'INVALID_FILE_HEADER',
    INVALID_HUNK_FORMAT = 'INVALID_HUNK_FORMAT',

    // File operation errors
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    FILE_ALREADY_EXISTS = 'FILE_ALREADY_EXISTS',
    DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',
    PARENT_DIR_CREATE_FAILED = 'PARENT_DIR_CREATE_FAILED',

    // Content matching errors
    CONTEXT_MISMATCH = 'CONTEXT_MISMATCH',
    HUNK_APPLY_FAILED = 'HUNK_APPLY_FAILED',
    SEEK_FAILED = 'SEEK_FAILED',

    // Permission errors
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    WRITE_PROTECTED = 'WRITE_PROTECTED',
    ROOIGNORE_VIOLATION = 'ROOIGNORE_VIOLATION',

    // System errors
    TIMEOUT = 'TIMEOUT',
    DISK_FULL = 'DISK_FULL',
    UNEXPECTED_ERROR = 'UNEXPECTED_ERROR'
}

class PatchError extends Error {
    constructor(
        public code: PatchErrorCode,
        message: string,
        public path?: string,
        public lineNumber?: number
    ) {
        super(message)
        this.name = 'PatchError'
    }
}
```

**Recommendation:** Implement structured error types with error codes.

---

### 6. **Context Overlap Handling** ✅ IMPLEMENTED

**Current State:**
The current implementation handles context overlap correctly via the chunk-based approach:

```typescript
// parser.ts - Multiple chunks can be defined in a single UpdateFile operation
while (remainingLines.length > 0) {
    // Skip blank lines between chunks
    if (remainingLines[0]?.trim() === "") {
        parsedLines++
        remainingLines = remainingLines.slice(1)
        continue
    }

    // Stop if we hit another file operation marker
    if (remainingLines[0]?.startsWith("***")) {
        break
    }

    const { chunk, linesConsumed } = parseUpdateFileChunk(...)
    chunks.push(chunk)
    // ...
}
```

**Status:** ✅ This feature is correctly implemented.

---

### 7. **File Rename Support** ⚠️ PARTIAL

**Current State:**
File rename is supported via `*** Move to:` directive, but the implementation has limitations:

```typescript
// Current implementation (ApplyPatchTool.ts - handleUpdateFile)
if (change.movePath) {
    // Save new content to the new path
    await task.diffViewProvider.saveDirectly(change.movePath, newContent, ...)
    
    // Delete the original file
    await fs.unlink(absolutePath)
}
```

**Issues:**
1. No validation that the new path doesn't already exist
2. No atomic rename operation (could leave file in inconsistent state)
3. No tracking of rename in result structure

**Recommendation:**
```typescript
// IMPROVED: File rename with validation
if (change.movePath) {
    const moveAbsolutePath = path.resolve(task.cwd, change.movePath)
    
    // Validate: destination doesn't exist
    const destinationExists = await fileExistsAtPath(moveAbsolutePath)
    if (destinationExists) {
        throw new PatchError(
            PatchErrorCode.FILE_ALREADY_EXISTS,
            `Cannot rename: destination path already exists: ${change.movePath}`,
            change.movePath
        )
    }
    
    // Validate: destination is writable
    const moveAccessAllowed = task.rooIgnoreController?.validateAccess(change.movePath)
    if (!moveAccessAllowed) {
        throw new PatchError(
            PatchErrorCode.ROOIGNORE_VIOLATION,
            `Cannot rename to RooIgnore-protected path: ${change.movePath}`,
            change.movePath
        )
    }
    
    // Atomic rename: write to new location, then delete old
    // (consider using fs.rename for same-filesystem renames)
}
```

---

### 8. **Tool Definition File** ⚠️ MISSING

**Current State:**
Only a backup file exists: `src/core/prompts/tools/native-tools/apply_patch.backup`

**Recommendation:** Create proper tool definition file:

```typescript
// src/core/prompts/tools/native-tools/apply_patch.ts
import type OpenAI from "openai"

const apply_patch_DESCRIPTION = `Apply patches to files.
Best for batch operations, refactoring, and multi-file changes including creating, deleting, renaming, and updating multiple files in a single operation. Automatically creates parent directories when adding new files.

format:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Each file section starts with one of three headers:
- *** Add File: <path> - Create a new file. Every following line is a + line (the initial contents).
- *** Delete File: <path> - Remove an existing file. Nothing follows.
- *** Update File: <path> - Patch an existing file in place.

For Update File operations:
- May be immediately followed by *** Move to: <new path> if you want to rename the file.
- Then one or more "hunks", each introduced by @@ (optionally followed by context like a class or function name).
- Within a hunk each line starts with:
  - ' ' (space) for context lines (unchanged)
  - '-' for lines to remove
  - '+' for lines to add

Context guidelines:
- Show 3 lines of code above and below each change.
- If a change is within 3 lines of a previous change, do NOT duplicate context lines.
- Use @@ with a class/function name if 3 lines of context is insufficient to uniquely identify the location.

Example patch:
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** End of File
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch`

const apply_patch = {
    type: "function",
    function: {
        name: "apply_patch",
        description: apply_patch_DESCRIPTION,
        parameters: {
            type: "object",
            properties: {
                patch: {
                    type: "string",
                    description: "The complete patch text in the apply_patch format, starting with '*** Begin Patch' and ending with '*** End Patch'."
                },
                workdir: {
                    type: "string",
                    description: "Optional working directory for the patch operations."
                },
                validate_only: {
                    type: "boolean",
                    description: "If true, only validate the patch without applying it.",
                    default: false
                },
                timeout_ms: {
                    type: "number",
                    description: "Optional timeout in milliseconds.",
                    minimum: 100,
                    maximum: 30000
                }
            },
            required: ["patch"],
            additionalProperties: false
        }
    }
} satisfies OpenAI.Chat.ChatCompletionTool

export default apply_patch
```

---

## Priority Recommendations

### High Priority (P0)

| Issue | Impact | Effort |
|-------|--------|--------|
| 1. Complete tool definition file | High (usability) | Low |
| 2. Enhanced error types | High (debugging) | Medium |
| 3. Structured return values | High (analytics) | Medium |

### Medium Priority (P1)

| Issue | Impact | Effort |
|-------|--------|--------|
| 4. Comprehensive validation | Medium (reliability) | Medium |
| 5. Optional parameters (workdir, validate_only, timeout) | Medium (flexibility) | Low |
| 6. File rename improvements | Medium (correctness) | Low |

### Low Priority (P2)

| Issue | Impact | Effort |
|-------|--------|--------|
| 7. Enhanced documentation | Low (developer experience) | Low |
| 8. Performance optimizations | Low (edge cases) | High |

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Create `src/core/prompts/tools/native-tools/apply_patch.ts` with complete definition
- [ ] Add optional parameters (workdir, validate_only, timeout_ms)
- [ ] Define structured return types

### Phase 2: Error Handling (Week 2)
- [ ] Implement comprehensive error types with codes
- [ ] Add validation rules to parser
- [ ] Improve error messages with context

### Phase 3: Reliability (Week 3)
- [ ] Fix file rename edge cases
- [ ] Add atomic operations for rename
- [ ] Enhance test coverage

### Phase 4: Polish (Week 4)
- [ ] Add comprehensive documentation
- [ ] Performance profiling and optimization
- [ ] Integration testing with real-world patches

---

## Testing Recommendations

### Unit Tests

```typescript
// src/core/tools/apply-patch/__tests__/parser.spec.ts
describe('parsePatch', () => {
    it('should reject patch without begin marker', () => {
        const patch = '*** Update File: test.txt\n@@\n-old\n+new\n*** End Patch'
        expect(() => parsePatch(patch)).toThrow('must start with')
    })

    it('should reject Add File with non-plus lines', () => {
        const patch = `*** Begin Patch
*** Add File: test.txt
+line1
invalid line
*** End Patch`
        expect(() => parsePatch(patch)).toThrow('expected line starting')
    })

    it('should accept patch with *** End of File marker', () => {
        const patch = `*** Begin Patch
*** Update File: test.txt
@@
-old
+new
*** End of File
*** End Patch`
        expect(() => parsePatch(patch)).not.toThrow()
    })
})
```

### Integration Tests

```typescript
// src/core/tools/__tests__/ApplyPatchTool.integration.spec.ts
describe('ApplyPatchTool', () => {
    it('should handle multi-file patch with rename', async () => {
        const patch = `*** Begin Patch
*** Add File: src/new.ts
+export const hello = "world"
*** Update File: src/old.ts
*** Move to: src/renamed.ts
@@
-old code
+new code
*** Delete File: src/temp.ts
*** End Patch`

        const result = await tool.execute({ patch }, task, callbacks)

        expect(result.success).toBe(true)
        expect(result.results).toHaveLength(3)
        expect(result.summary.succeeded).toBe(3)
    })
})
```

---

## Conclusion

The current `apply_patch` implementation has a solid foundation with:
- ✅ Correct patch format parsing
- ✅ Multi-pass sequence matching
- ✅ User approval workflow
- ✅ RooIgnore integration

Key improvements needed:
1. **Complete tool definition** with full format specification
2. **Enhanced error handling** with structured error types
3. **Structured return values** for better analytics
4. **Comprehensive validation** for edge cases
5. **Optional parameters** for advanced use cases

These improvements will make the tool more robust, easier to debug, and better aligned with the original Codex specification.

---

## Related Files

| File | Purpose |
|------|---------|
| `src/core/tools/ApplyPatchTool.ts` | Main tool execution |
| `src/core/tools/apply-patch/parser.ts` | Patch parsing |
| `src/core/tools/apply-patch/apply.ts` | Patch application |
| `src/core/tools/apply-patch/seek-sequence.ts` | Sequence matching |
| `src/core/prompts/tools/native-tools/apply_patch.backup` | Tool definition (incomplete) |
| `src/core/tools/__tests__/applyPatchTool.partial.spec.ts` | Partial tool tests |

---

*Document created: 2026-02-27*
*Based on analysis of Codex apply_patch specification and current Roo-Code implementation*
