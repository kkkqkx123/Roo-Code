# Tools 模块错误处理分析报告

**日期**: 2026-02-27  
**状态**: 分析完成  
**参考文档**: `docs/design/error/error-architecture.md`

---

## 一、当前实现状态

### 1.1 已实现的错误类型层次

根据设计文档，项目已在 `src/core/errors/tools/` 下实现了结构化错误类型：

```
ToolError
├── ValidationError (validation-errors.ts)
│   ├── MissingParameterError
│   ├── InvalidParameterError
│   └── InvalidToolError
├── FileOperationError (file-errors.ts)
│   ├── FileNotFoundToolError
│   ├── FileAlreadyExistsError
│   ├── PermissionDeniedToolError
│   └── RooIgnoreViolationError
├── ContentError (content-errors.ts)
│   ├── ContentNotFoundError
│   ├── ContentMismatchError
│   ├── DuplicateMatchError
│   └── NoMatchFoundError
└── ExecutionError (execution-errors.ts)
    ├── CommandTimeoutError
    ├── CommandFailedError
    ├── DiffApplyFailedError
    ├── ShellIntegrationError
    └── PatchParseError
```

### 1.2 错误接口设计（符合设计文档）

```typescript
// src/core/errors/tools/validation-errors.ts
export abstract class ValidationError extends Error {
  constructor(
    message: string,
    public readonly toolName: ToolName,
    public readonly suggestion?: string
  ) { ... }

  // LLM 导向 - 提供可操作指导
  toLLMMessage(): LLMErrorPayload { ... }

  // 日志/遥测导向 - 提供结构化数据
  toLogEntry(params?: Record<string, unknown>): LogEntry { ... }
}
```

### 1.3 formatResponse 支持的新方法

```typescript
// src/core/prompts/responses.ts
export const formatResponse = {
  // 旧方法（保留向后兼容）
  toolError: (error?: string) => JSON.stringify({ status: "error", ... }),
  
  // 新方法 - 带指导的错误
  toolErrorWithGuidance: (error: string, suggestion?: string) => ...,
  
  // 新方法 - 从 ToolError 实例创建
  toolErrorFromInstance: (llmPayload: Record<string, unknown>) => ...,
}
```

---

## 二、符合设计文档的部分 ✅

| 设计要求 | 实现状态 | 说明 |
|---------|---------|------|
| 工具错误与流式错误分离 | ✅ 已实现 | `src/core/errors/tools/` 独立于 `packages/types/src/errors.ts` |
| `toLLMMessage()` 方法 | ✅ 已实现 | 所有错误类都有此方法 |
| `toLogEntry()` 方法 | ✅ 已实现 | 所有错误类都有此方法 |
| `instanceof` 类型检查 | ✅ 部分使用 | 部分代码已使用 `error instanceof ValidationError` |
| 建议(suggestion)字段 | ✅ 已实现 | 所有错误类都提供可操作建议 |
| 敏感数据脱敏 | ✅ 已实现 | `sanitizeForLogging()` 函数 |

---

## 三、需要改进的问题 ❌

### 3.1 错误处理模式不一致

**正确的结构化错误处理：**
```typescript
// src/core/tools/ApplyDiffTool.ts
if (!relPath) {
  const error = new MissingParameterError("apply_diff", "path")
  task.recordToolError("apply_diff", error.toLogEntry())
  pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  return
}
```

**需要改进的非结构化处理：**
```typescript
// src/core/tools/WriteToFileTool.ts (第 82-89 行)
task.recordToolError("write_to_file")  // ❌ 缺少 LogEntry
const formattedError = `Failed to create directories for file: ${relPath}
<error_details>${errorDetails}</error_details>`
pushToolResult(formattedError)  // ❌ 非结构化格式
```

### 3.2 LLM 提示与日志信息混淆

```typescript
// src/core/tools/ReadFileTool.ts (第 231-240 行)
catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error)
  // ❌ 同样的信息同时用于多个目的：
  updateFileResult(relPath, { 
    error: `Error reading file: ${errorMsg}`,        // → LLM
    nativeContent: `File: ${relPath}\nError: ...`,   // → LLM
  })
  await task.say("error", `Error reading file...`)   // → 用户 UI
}
```

**设计文档要求的分离：**

| 受众 | 需求 |
|------|------|
| LLM | 可操作指导、错误原因、如何修复 |
| 遥测 | 错误类别、工具名、参数（脱敏）、堆栈跟踪 |
| 用户(UI) | 人类可读消息、进度影响 |

### 3.3 缺失的错误类型

当前某些错误场景使用通用字符串而非专用错误类型：

| 场景 | 当前处理 | 建议错误类型 |
|------|---------|-------------|
| 目录创建失败 | 通用字符串 | `DirectoryCreationError` |
| 二进制文件读取 | 通用字符串 | `BinaryFileError` |
| 文件过大 | 通用字符串 | `FileTooLargeError` |
| 权限问题（非 rooignore） | 通用字符串 | `PermissionDeniedToolError` |

### 3.4 日志输出混杂

```typescript
// src/core/tools/BaseTool.ts (第 121-122 行)
catch (error) {
  console.error(`Error in handlePartial:`, error)  // ❌ 使用 console.error
  await callbacks.handleError(...)
}
```

问题：`console.error` 与结构化日志（`toLogEntry`）混用，不便于统一日志收集和分析。

### 3.5 旧版 BaseError 仍在使用

```typescript
// packages/types/src/errors.ts (第 16-25 行)
export abstract class BaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,  // ❌ 设计文档认为无价值
    public readonly context?: Record<string, any>
  )
}
```

设计文档指出 `code` 字段是多余的，应使用 `instanceof` 进行类型检查。

---

## 四、改进建议

### 4.1 统一使用结构化错误

**Before:**
```typescript
task.recordToolError("write_to_file")
pushToolResult(`Error: ${errorMsg}`)
```

**After:**
```typescript
const error = new DirectoryCreationError("write_to_file", dirPath, reason)
task.recordToolError("write_to_file", error.toLogEntry())
pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
```

### 4.2 增加缺失的错误类型

```typescript
// 建议添加到 src/core/errors/tools/file-errors.ts
export class DirectoryCreationError extends FileOperationError {
  constructor(toolName: ToolName, dirPath: string, reason: string) {
    super(
      `Failed to create directory: ${dirPath}`,
      toolName,
      dirPath,
      "Ensure parent directory exists and you have write permission."
    )
    this.name = "DirectoryCreationError"
  }
}

export class FileTooLargeError extends FileOperationError {
  constructor(toolName: ToolName, filePath: string, size: number, maxSize: number) {
    super(
      `File too large: ${filePath} (${size} bytes > ${maxSize} bytes limit)`,
      toolName,
      filePath,
      "Read the file in chunks using offset/limit parameters, or ask the user to increase the file size limit."
    )
    this.name = "FileTooLargeError"
  }
}
```

### 4.3 统一日志输出

```typescript
// 当前（混合）
console.error(`Error in handlePartial:`, error)

// 建议（统一结构化）
task.logger.error({
  level: "error",
  category: "tool_execution",
  tool: toolName,
  message: error.message,
  stack: error.stack,
  timestamp: Date.now(),
})
```

### 4.4 创建统一的错误处理辅助函数

```typescript
// 建议：创建 src/core/tools/helpers/handle-tool-error.ts
export async function handleToolError(
  error: unknown,
  toolName: ToolName,
  task: Task,
  callbacks: ToolCallbacks,
  params?: Record<string, unknown>
): Promise<void> {
  if (error instanceof ToolError) {
    task.recordToolError(toolName, error.toLogEntry(params))
    callbacks.pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
  } else {
    // 未知错误的统一处理
    const genericMessage = error instanceof Error ? error.message : String(error)
    task.recordToolError(toolName, {
      level: "error",
      category: "tool_execution",
      tool: toolName,
      message: genericMessage,
      timestamp: Date.now(),
    })
    callbacks.pushToolResult(formatResponse.toolError(genericMessage))
  }
}
```

---

## 五、改进优先级

| 优先级 | 改进项 | 影响 | 工作量 |
|-------|-------|------|-------|
| **P0** | 统一所有工具使用结构化错误 | 确保一致的错误处理体验 | 中 |
| **P1** | 添加缺失的错误类型 | 覆盖所有错误场景 | 低 |
| **P2** | 创建统一错误处理辅助函数 | 减少重复代码 | 低 |
| **P3** | 分离 console.error 与结构化日志 | 统一日志系统 | 中 |
| **P4** | 移除旧版 BaseError.code | 清理冗余抽象 | 高 |

---

## 六、统计

### 6.1 工具文件中的错误处理使用情况

| 文件 | 结构化错误 | 非结构化错误 | 改进需求 |
|------|-----------|-------------|---------|
| `ApplyDiffTool.ts` | ✅ 4 处 | 0 | 无 |
| `ExecuteCommandTool.ts` | ✅ 3 处 | 0 | 无 |
| `ReadFileTool.ts` | ✅ 2 处 | ❌ 3 处 | 需改进 |
| `WriteToFileTool.ts` | ✅ 2 处 | ❌ 2 处 | 需改进 |
| `BaseTool.ts` | ✅ 1 处 | ❌ 1 处(console) | 需改进 |

### 6.2 完成度评估

| 指标 | 完成度 |
|------|-------|
| 错误类型层次结构 | 85% |
| toLLMMessage/toLogEntry 方法 | 100% |
| 工具迁移到新模式 | 70% |
| 日志系统统一 | 40% |

---

## 七、相关文件

- 错误设计文档: `docs/design/error/error-architecture.md`
- 工具错误类型: `src/core/errors/tools/`
- 格式化响应: `src/core/prompts/responses.ts`
- 旧版错误类型: `packages/types/src/errors.ts`
