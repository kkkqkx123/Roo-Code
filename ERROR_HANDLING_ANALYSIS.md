# 错误处理架构分析与设计文档

**文档版本**: 1.0  
**创建日期**: 2026 年 2 月 25 日  
**状态**: 提案

---

## 摘要

本文档分析了 Roo-Code 项目当前的错误处理现状，识别出 381+ 处错误抛出点和 12+ 个自定义错误类分散在各模块中。建议在 `packages/types` 中建立全局错误类型体系，以实现类型安全、可维护的错误管理架构。

---

## 目录

1. [当前错误处理现状](#1-当前错误处理现状)
2. [问题分析](#2-问题分析)
3. [建议的错误架构](#3-建议的错误架构)
4. [实施路线图](#4-实施路线图)
5. [迁移指南](#5-迁移指南)
6. [最佳实践](#6-最佳实践)

---

## 1. 当前错误处理现状

### 1.1 错误抛出统计

| 位置 | `throw new Error` 数量 | 自定义错误类 |
|------|----------------------|-------------|
| `src/` | 381 | 10+ |
| `packages/` | 8 | 2+ |
| **总计** | **389+** | **12+** |

### 1.2 现有自定义错误类

| 错误类 | 文件路径 | 继承 | 用途 |
|--------|---------|------|------|
| `OrganizationAllowListViolationError` | `src/utils/errors.ts` | `Error` | 组织允许列表违规 |
| `FileRestrictionError` | `src/shared/modes.ts` | `Error` | 文件访问限制 |
| `QdrantConnectionError` | `src/services/code-index/vector-store/qdrant-errors.ts` | `Error` | Qdrant 连接失败 (可重试) |
| `QdrantCollectionNotFoundError` | `src/services/code-index/vector-store/qdrant-errors.ts` | `Error` | Qdrant 集合不存在 (不可重试) |
| `AskIgnoredError` | `src/core/task/AskIgnoredError.ts` | `Error` | 控制流错误 (ask 被忽略) |
| `ToolResultIdMismatchError` | `src/core/task/validateToolResultIds.ts` | `Error` | 工具结果 ID 不匹配 |
| `MissingToolResultError` | `src/core/task/validateToolResultIds.ts` | `Error` | 缺少工具结果 |
| `DeadLoopDetectedError` | `src/core/task/streaming/StreamProcessor.ts` | `Error` | 死循环检测 |
| `UserCancelledError` | `src/core/task/streaming/StreamProcessor.ts` | `Error` | 用户取消操作 |
| `ParseError` | `src/core/tools/apply-patch/parser.ts` | `Error` | 补丁解析错误 |
| `ApplyPatchError` | `src/core/tools/apply-patch/apply.ts` | `Error` | 补丁应用错误 |
| `ShellIntegrationError` | `src/core/tools/ExecuteCommandTool.ts` | `Error` | Shell 集成失败 |

### 1.3 现有错误类型定义

```typescript
// packages/types/src/api.ts - CoderAPI 接口
resumeTask(taskId: string): Promise<void>
// @throws Error if the task is not found in the task history

// packages/types/src/message.ts - 错误消息类型
export const clineSays = ["error", "api_req_failed", ...] as const

// packages/types/src/mcp.ts - MCP 错误条目
export type McpErrorEntry = { /* ... */ }
```

### 1.4 错误处理模式

#### A. 通用捕获模式 (550+ 处)

```typescript
try {
  // operation
} catch (error) {
  // handle error
}
```

#### B. 类型检查模式 (266 处 `instanceof`)

```typescript
if (error instanceof Error) {
  // handle Error
} else if (error instanceof AxiosError) {
  // handle AxiosError
} else {
  // handle unknown
}
```

#### C. 状态码检查模式

```typescript
if (error?.status === 429) {
  // rate limit handling
}
if (error?.response?.status === 404) {
  // not found handling
}
if (error?.code === "ENOTFOUND" || error?.code === "ECONNREFUSED") {
  // connection error handling
}
```

#### D. 错误包装模式

```typescript
throw new Error("API request failed", { cause: error })
throw new Error(`File not found: ${filePath}`, { cause: error })
```

### 1.5 现有错误处理工具

| 文件 | 功能 |
|------|------|
| `src/api/providers/utils/error-handler.ts` | API 提供者错误转换 |
| `src/api/providers/utils/openai-error-handler.ts` | OpenAI 专用错误处理 |
| `src/core/context/management/error-handling.ts` | 上下文窗口错误检测 |
| `src/services/code-index/shared/validation-helpers.ts` | 错误 sanitization 和格式化 |

---

## 2. 问题分析

### 2.1 当前架构问题

| 问题 | 描述 | 影响 |
|------|------|------|
| ❌ **缺乏统一层次** | 所有错误直接继承 `Error` | 无法通过类型区分错误类别 |
| ❌ **元数据丢失** | `status`、`code` 等通过 `any` 附加 | 类型不安全，易出错 |
| ❌ **重复代码** | 各模块重复实现相似错误处理 | 维护成本高 |
| ❌ **文档分散** | 错误类型散落在各处 | 难以查找和理解 |
| ❌ **测试困难** | 缺乏统一接口 | 难以编写通用错误处理测试 |

### 2.2 典型问题示例

#### 问题 1: 类型不安全

```typescript
// 当前代码
try {
  await api.call()
} catch (error: any) {
  // 依赖运行时检查
  if (error?.status === 429) {
    await backoff(error.retryAfter) // retryAfter 可能不存在
  }
}
```

#### 问题 2: 重复的错误处理

```typescript
// 在 5 个不同文件中找到相似的代码
if (error?.status === 401) {
  // 5 处几乎相同的认证错误处理
}
```

#### 问题 3: 元数据不一致

```typescript
// 不同模块使用不同的元数据字段
error.status = 429
error.code = "RATE_LIMIT"
error.errorDetails = { ... }
error.$metadata = { ... }
```

### 2.3 需求分析

基于项目规模和复杂度，需要：

1. ✅ **类型安全**: TypeScript 严格模式下的完整类型检查
2. ✅ **统一层次**: 清晰的错误分类体系
3. ✅ **元数据保留**: 结构化的错误上下文信息
4. ✅ **可测试性**: 易于编写错误处理测试
5. ✅ **可维护性**: 易于扩展和修改
6. ✅ **向后兼容**: 渐进式迁移，不影响现有代码

---

## 3. 建议的错误架构

### 3.1 错误层次结构

```
Error (内置)
└── ApplicationError (抽象基类)
    ├── ApiError
    │   ├── AuthenticationError (401)
    │   ├── AuthorizationError (403)
    │   ├── NotFoundError (404)
    │   ├── RateLimitError (429)
    │   ├── TimeoutError
    │   └── NetworkError
    ├── FileSystemError
    │   ├── FileNotFound
    │   ├── PermissionDenied
    │   └── InvalidFileType
    ├── ConfigurationError
    │   ├── MissingRequiredField
    │   ├── InvalidConfiguration
    │   └── ProfileNotFound
    ├── ValidationError
    │   ├── ToolValidationError
    │   ├── InputValidationError
    │   └── SchemaValidationError
    ├── ToolError
    │   ├── ToolNotAllowed
    │   ├── ToolExecutionFailed
    │   └── ToolResultError
    ├── TaskError
    │   ├── TaskNotFound
    │   ├── TaskCancelled
    │   └── TaskFailed
    ├── StreamingError
    │   ├── DeadLoopDetectedError
    │   ├── UserCancelledError
    │   └── StreamProcessingError
    └── ControlFlowError (不可重试)
        ├── AskIgnoredError
        └── SupersededRequestError
```

### 3.2 核心类型定义

#### 3.2.1 基础错误接口

```typescript
// packages/types/src/errors.ts

/**
 * 所有应用错误的公共接口
 * 
 * @example
 * ```typescript
 * try {
 *   await api.call()
 * } catch (error) {
 *   if (isApplicationError(error)) {
 *     console.error(error.code, error.status)
 *   }
 * }
 * ```
 */
export interface BaseError extends Error {
  /**
   * 错误名称（类名）
   */
  readonly name: string
  
  /**
   * 错误代码（机器可读）
   * @example "AUTH_FAILED", "FILE_NOT_FOUND", "RATE_LIMIT_EXCEEDED"
   */
  readonly code?: string
  
  /**
   * HTTP 状态码（如果适用）
   * @example 401, 404, 429, 500
   */
  readonly status?: number
  
  /**
   * 额外的错误元数据
   */
  readonly metadata?: Record<string, unknown>
  
  /**
   * 是否可重试
   */
  readonly isRetryable?: boolean
  
  /**
   * 原始错误原因（如果存在）
   */
  readonly cause?: unknown
}
```

#### 3.2.2 应用基础错误类

```typescript
/**
 * 所有应用错误的抽象基类
 * 
 * 提供统一的错误信息格式、元数据保留和原型链设置
 * 
 * @example
 * ```typescript
 * class MyCustomError extends ApplicationError {
 *   constructor(message: string, details?: { userId: string }) {
 *     super(message, {
 *       code: "MY_CUSTOM_ERROR",
 *       metadata: { details },
 *       isRetryable: false
 *     })
 *   }
 * }
 * ```
 */
export abstract class ApplicationError extends Error implements BaseError {
  public readonly code?: string
  public readonly status?: number
  public readonly metadata?: Record<string, unknown>
  public readonly isRetryable?: boolean
  public readonly cause?: unknown

  constructor(
    message: string,
    options?: {
      code?: string
      status?: number
      metadata?: Record<string, unknown>
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, { cause: options?.cause })
    this.name = this.constructor.name
    this.code = options?.code
    this.status = options?.status
    this.metadata = options?.metadata
    this.isRetryable = options?.isRetryable
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * 序列化为普通对象（用于日志和传输）
   */
  toJSON(): SerializableError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      metadata: this.metadata,
      stack: this.stack,
      cause: this.cause instanceof ApplicationError 
        ? this.cause.toJSON() 
        : this.cause
    }
  }
}
```

#### 3.2.3 可序列化错误

```typescript
/**
 * 可序列化的错误表示
 * 用于日志记录、错误报告和跨进程传输
 */
export interface SerializableError {
  name: string
  message: string
  code?: string
  status?: number
  stack?: string
  metadata?: Record<string, unknown>
  cause?: SerializableError | unknown
}
```

### 3.3 具体错误类

#### 3.3.1 API 错误

```typescript
// packages/types/src/errors/api.ts

/**
 * API 相关错误的基类
 */
export abstract class ApiError extends ApplicationError {
  public readonly endpoint?: string
  public readonly method?: string

  constructor(
    message: string,
    options?: {
      code?: string
      status?: number
      metadata?: Record<string, unknown>
      isRetryable?: boolean
      cause?: unknown
      endpoint?: string
      method?: string
    }
  ) {
    super(message, options)
    this.endpoint = options?.endpoint
    this.method = options?.method
  }
}

/**
 * 认证失败 (HTTP 401)
 */
export class AuthenticationError extends ApiError {
  constructor(
    message: string = "Authentication failed",
    options?: {
      endpoint?: string
      method?: string
      cause?: unknown
    }
  ) {
    super(message, {
      code: "AUTHENTICATION_FAILED",
      status: 401,
      isRetryable: false,
      ...options
    })
  }
}

/**
 * 权限不足 (HTTP 403)
 */
export class AuthorizationError extends ApiError {
  constructor(
    message: string = "Insufficient permissions",
    options?: {
      endpoint?: string
      method?: string
      cause?: unknown
    }
  ) {
    super(message, {
      code: "AUTHORIZATION_FAILED",
      status: 403,
      isRetryable: false,
      ...options
    })
  }
}

/**
 * 资源不存在 (HTTP 404)
 */
export class NotFoundError extends ApiError {
  public readonly resourceId?: string

  constructor(
    message: string,
    options?: {
      resourceId?: string
      endpoint?: string
      method?: string
      cause?: unknown
    }
  ) {
    super(message, {
      code: "NOT_FOUND",
      status: 404,
      isRetryable: false,
      ...options
    })
    this.resourceId = options?.resourceId
  }
}

/**
 * 请求限流 (HTTP 429)
 */
export class RateLimitError extends ApiError {
  public readonly retryAfter?: number
  public readonly limit?: number
  public readonly remaining?: number
  public readonly resetAt?: number

  constructor(
    message: string = "Rate limit exceeded",
    options?: {
      retryAfter?: number
      limit?: number
      remaining?: number
      resetAt?: number
      endpoint?: string
      method?: string
      cause?: unknown
    }
  ) {
    super(message, {
      code: "RATE_LIMIT_EXCEEDED",
      status: 429,
      isRetryable: true,
      metadata: {
        retryAfter: options?.retryAfter,
        limit: options?.limit,
        remaining: options?.remaining,
        resetAt: options?.resetAt
      },
      ...options
    })
    this.retryAfter = options?.retryAfter
    this.limit = options?.limit
    this.remaining = options?.remaining
    this.resetAt = options?.resetAt
  }
}

/**
 * 请求超时
 */
export class TimeoutError extends ApiError {
  public readonly timeoutMs?: number

  constructor(
    message: string = "Request timed out",
    options?: {
      timeoutMs?: number
      endpoint?: string
      method?: string
      cause?: unknown
    }
  ) {
    super(message, {
      code: "TIMEOUT",
      isRetryable: true,
      ...options
    })
    this.timeoutMs = options?.timeoutMs
  }
}

/**
 * 网络错误
 */
export class NetworkError extends ApiError {
  public readonly networkCode?: string

  constructor(
    message: string,
    options?: {
      networkCode?: string
      endpoint?: string
      method?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: "NETWORK_ERROR",
      isRetryable: options?.isRetryable ?? true,
      ...options
    })
    this.networkCode = options?.networkCode
  }
}
```

#### 3.3.2 文件系统错误

```typescript
// packages/types/src/errors/filesystem.ts

/**
 * 文件系统错误的基类
 */
export abstract class FileSystemError extends ApplicationError {
  public readonly path?: string
  public readonly fsCode?: string // ENOENT, EACCES, etc.

  constructor(
    message: string,
    options?: {
      code?: string
      path?: string
      fsCode?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "FILE_SYSTEM_ERROR",
      metadata: { path: options?.path, fsCode: options?.fsCode },
      ...options
    })
    this.path = options?.path
    this.fsCode = options?.fsCode
  }
}

/**
 * 文件不存在
 */
export class FileNotFound extends FileSystemError {
  constructor(
    path: string,
    cause?: unknown
  ) {
    super(`File not found: ${path}`, {
      code: "FILE_NOT_FOUND",
      path,
      fsCode: "ENOENT",
      isRetryable: false,
      cause
    })
  }
}

/**
 * 权限不足
 */
export class PermissionDenied extends FileSystemError {
  constructor(
    path: string,
    operation: string,
    cause?: unknown
  ) {
    super(`Permission denied: ${operation} ${path}`, {
      code: "PERMISSION_DENIED",
      path,
      fsCode: "EACCES",
      isRetryable: false,
      cause
    })
  }
}

/**
 * 不支持的文件类型
 */
export class InvalidFileType extends FileSystemError {
  constructor(
    path: string,
    extension: string,
    allowedExtensions?: string[]
  ) {
    super(
      `Unsupported file type: ${extension} (${path})`,
      {
        code: "INVALID_FILE_TYPE",
        path,
        metadata: { extension, allowedExtensions },
        isRetryable: false
      }
    )
  }
}
```

#### 3.3.3 配置错误

```typescript
// packages/types/src/errors/configuration.ts

/**
 * 配置相关错误的基类
 */
export abstract class ConfigurationError extends ApplicationError {
  public readonly key?: string

  constructor(
    message: string,
    options?: {
      code?: string
      key?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "CONFIGURATION_ERROR",
      ...options
    })
    this.key = options?.key
  }
}

/**
 * 缺少必需的配置项
 */
export class MissingRequiredField extends ConfigurationError {
  constructor(
    fieldName: string,
    context?: string
  ) {
    super(
      `Required field '${fieldName}' is missing${context ? ` in ${context}` : ""}`,
      {
        code: "MISSING_REQUIRED_FIELD",
        key: fieldName,
        isRetryable: false
      }
    )
  }
}

/**
 * 配置值无效
 */
export class InvalidConfiguration extends ConfigurationError {
  constructor(
    key: string,
    value: unknown,
    reason: string
  ) {
    super(
      `Invalid configuration for '${key}': ${reason}`,
      {
        code: "INVALID_CONFIGURATION",
        key,
        metadata: { value },
        isRetryable: false
      }
    )
  }
}

/**
 * 配置文件不存在
 */
export class ProfileNotFound extends ConfigurationError {
  constructor(profileName: string) {
    super(`Profile '${profileName}' not found`, {
      code: "PROFILE_NOT_FOUND",
      key: profileName,
      isRetryable: false
    })
  }
}
```

#### 3.3.4 验证错误

```typescript
// packages/types/src/errors/validation.ts

/**
 * 验证相关错误的基类
 */
export abstract class ValidationError extends ApplicationError {
  public readonly field?: string
  public readonly value?: unknown

  constructor(
    message: string,
    options?: {
      code?: string
      field?: string
      value?: unknown
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "VALIDATION_ERROR",
      ...options
    })
    this.field = options?.field
    this.value = options?.value
  }
}

/**
 * 工具参数验证失败
 */
export class ToolValidationError extends ValidationError {
  constructor(
    toolName: string,
    field: string,
    value: unknown,
    reason: string
  ) {
    super(
      `Invalid parameter '${field}' for tool '${toolName}': ${reason}`,
      {
        code: "TOOL_VALIDATION_FAILED",
        field,
        value,
        metadata: { toolName },
        isRetryable: false
      }
    )
  }
}

/**
 * 输入验证失败
 */
export class InputValidationError extends ValidationError {
  constructor(
    message: string,
    field?: string,
    value?: unknown
  ) {
    super(message, {
      code: "INPUT_VALIDATION_FAILED",
      field,
      value,
      isRetryable: false
    })
  }
}
```

#### 3.3.5 工具错误

```typescript
// packages/types/src/errors/tool.ts

/**
 * 工具相关错误的基类
 */
export abstract class ToolError extends ApplicationError {
  public readonly toolName?: string

  constructor(
    message: string,
    options?: {
      code?: string
      toolName?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "TOOL_ERROR",
      ...options
    })
    this.toolName = options?.toolName
  }
}

/**
 * 工具在当前模式下不允许使用
 */
export class ToolNotAllowed extends ToolError {
  constructor(
    toolName: string,
    mode: string,
    reason?: string
  ) {
    super(
      `Tool '${toolName}' is not allowed in mode '${mode}'${reason ? `: ${reason}` : ""}`,
      {
        code: "TOOL_NOT_ALLOWED",
        toolName,
        metadata: { mode },
        isRetryable: false
      }
    )
  }
}

/**
 * 工具执行失败
 */
export class ToolExecutionFailed extends ToolError {
  constructor(
    toolName: string,
    reason: string,
    cause?: unknown
  ) {
    super(
      `Tool '${toolName}' execution failed: ${reason}`,
      {
        code: "TOOL_EXECUTION_FAILED",
        toolName,
        isRetryable: true,
        cause
      }
    )
  }
}

/**
 * 工具结果错误
 */
export class ToolResultError extends ToolError {
  constructor(
    toolName: string,
    reason: string,
    cause?: unknown
  ) {
    super(
      `Tool '${toolName}' returned invalid result: ${reason}`,
      {
        code: "TOOL_RESULT_ERROR",
        toolName,
        isRetryable: false,
        cause
      }
    )
  }
}
```

#### 3.3.6 任务错误

```typescript
// packages/types/src/errors/task.ts

/**
 * 任务相关错误的基类
 */
export abstract class TaskError extends ApplicationError {
  public readonly taskId?: string

  constructor(
    message: string,
    options?: {
      code?: string
      taskId?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "TASK_ERROR",
      ...options
    })
    this.taskId = options?.taskId
  }
}

/**
 * 任务不存在
 */
export class TaskNotFound extends TaskError {
  constructor(taskId: string) {
    super(`Task '${taskId}' not found`, {
      code: "TASK_NOT_FOUND",
      taskId,
      isRetryable: false
    })
  }
}

/**
 * 任务已取消
 */
export class TaskCancelled extends TaskError {
  constructor(taskId: string, reason?: string) {
    super(
      `Task '${taskId}' was cancelled${reason ? `: ${reason}` : ""}`,
      {
        code: "TASK_CANCELLED",
        taskId,
        isRetryable: false
      }
    )
  }
}

/**
 * 任务执行失败
 */
export class TaskFailed extends TaskError {
  constructor(
    taskId: string,
    reason: string,
    cause?: unknown
  ) {
    super(
      `Task '${taskId}' failed: ${reason}`,
      {
        code: "TASK_FAILED",
        taskId,
        isRetryable: false,
        cause
      }
    )
  }
}
```

#### 3.3.7 流式处理错误

```typescript
// packages/types/src/errors/streaming.ts

/**
 * 流式处理相关错误的基类
 */
export abstract class StreamingError extends ApplicationError {
  constructor(
    message: string,
    options?: {
      code?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "STREAMING_ERROR",
      ...options
    })
  }
}

/**
 * 检测到死循环
 */
export class DeadLoopDetectedError extends StreamingError {
  constructor(details: string) {
    super(`Dead loop detected: ${details}`, {
      code: "DEAD_LOOP_DETECTED",
      isRetryable: false
    })
  }
}

/**
 * 用户取消操作
 */
export class UserCancelledError extends StreamingError {
  constructor(reason?: string) {
    super(
      `Operation cancelled by user${reason ? `: ${reason}` : ""}`,
      {
        code: "USER_CANCELLED",
        isRetryable: false
      }
    )
  }
}

/**
 * 流处理失败
 */
export class StreamProcessingError extends StreamingError {
  constructor(
    reason: string,
    cause?: unknown
  ) {
    super(`Stream processing failed: ${reason}`, {
      code: "STREAM_PROCESSING_FAILED",
      isRetryable: true,
      cause
    })
  }
}
```

#### 3.3.8 控制流错误

```typescript
// packages/types/src/errors/control-flow.ts

/**
 * 控制流错误的基类
 * 这些错误用于内部流程控制，不应被视为真正的错误
 */
export abstract class ControlFlowError extends ApplicationError {
  constructor(
    message: string,
    options?: {
      code?: string
      cause?: unknown
    }
  ) {
    super(message, {
      code: options?.code ?? "CONTROL_FLOW_ERROR",
      isRetryable: false,
      ...options
    })
  }
}

/**
 * Ask 被忽略（被更新的请求取代）
 */
export class AskIgnoredError extends ControlFlowError {
  constructor(reason?: string) {
    super(`Ask ignored: ${reason}`, {
      code: "ASK_IGNORED"
    })
  }
}

/**
 * 请求被取代
 */
export class SupersededRequestError extends ControlFlowError {
  constructor(reason?: string) {
    super(`Request superseded: ${reason}`, {
      code: "REQUEST_SUPERSEDED"
    })
  }
}
```

### 3.4 类型守卫工具

```typescript
// packages/types/src/errors/guards.ts

import {
  BaseError,
  ApplicationError,
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  FileSystemError,
  FileNotFound,
  ConfigurationError,
  ValidationError,
  ToolError,
  TaskError,
  StreamingError,
  ControlFlowError
} from "./index.js"

/**
 * 检查是否为 Error 对象
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error
}

/**
 * 检查是否为 ApplicationError
 */
export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError
}

/**
 * 检查是否为 BaseError（具有完整元数据）
 */
export function isBaseError(error: unknown): error is BaseError {
  return isApplicationError(error)
}

/**
 * 检查是否为 API 错误
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * 检查是否为认证错误
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError
}

/**
 * 检查是否为权限错误
 */
export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError
}

/**
 * 检查是否为 404 错误
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError
}

/**
 * 检查是否为限流错误
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError
}

/**
 * 检查是否为超时错误
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

/**
 * 检查是否为网络错误
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError
}

/**
 * 检查是否为文件系统错误
 */
export function isFileSystemError(error: unknown): error is FileSystemError {
  return error instanceof FileSystemError
}

/**
 * 检查是否为文件不存在错误
 */
export function isFileNotFoundError(error: unknown): error is FileNotFound {
  return error instanceof FileNotFound
}

/**
 * 检查是否为配置错误
 */
export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError
}

/**
 * 检查是否为验证错误
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

/**
 * 检查是否为工具错误
 */
export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError
}

/**
 * 检查是否为任务错误
 */
export function isTaskError(error: unknown): error is TaskError {
  return error instanceof TaskError
}

/**
 * 检查是否为流式处理错误
 */
export function isStreamingError(error: unknown): error is StreamingError {
  return error instanceof StreamingError
}

/**
 * 检查是否为控制流错误
 */
export function isControlFlowError(error: unknown): error is ControlFlowError {
  return error instanceof ControlFlowError
}

/**
 * 检查错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (isApplicationError(error)) {
    return error.isRetryable ?? false
  }
  // 对于非 ApplicationError，检查常见可重试条件
  if (error instanceof Error) {
    const anyErr = error as any
    // HTTP 状态码判断
    if (anyErr?.status === 429 || anyErr?.status === 503) {
      return true
    }
    // 网络错误代码判断
    if (anyErr?.code === "ECONNREFUSED" || anyErr?.code === "ETIMEDOUT") {
      return true
    }
  }
  return false
}

/**
 * 获取错误的 HTTP 状态码
 */
export function getHttpStatus(error: unknown): number | undefined {
  if (isApplicationError(error)) {
    return error.status
  }
  const anyErr = error as any
  return anyErr?.status ?? anyErr?.response?.status
}
```

### 3.5 错误处理工具

```typescript
// packages/types/src/errors/handlers.ts

import { ApplicationError, SerializableError } from "./index.js"
import { isRetryableError, getHttpStatus } from "./guards.js"

/**
 * 错误处理结果
 */
export interface ErrorResolution {
  /**
   * 是否应重试
   */
  shouldRetry: boolean
  
  /**
   * 用户友好的错误消息
   */
  userMessage: string
  
  /**
   * 日志级别
   */
  logLevel: "debug" | "info" | "warn" | "error"
  
  /**
   * 额外的元数据
   */
  metadata?: Record<string, unknown>
}

/**
 * 错误上下文
 */
export interface ErrorContext {
  /**
   * 操作名称
   */
  operation: string
  
  /**
   * 模块名称
   */
  module: string
  
  /**
   * 时间戳
   */
  timestamp: number
  
  /**
   * 用户 ID（如果适用）
   */
  userId?: string
  
  /**
   * 任务 ID（如果适用）
   */
  taskId?: string
}

/**
 * 将错误序列化为普通对象
 */
export function serializeError(error: unknown): SerializableError {
  if (error instanceof ApplicationError) {
    return error.toJSON()
  }
  
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    }
  }
  
  return {
    name: "UnknownError",
    message: String(error)
  }
}

/**
 * 从序列化数据恢复错误
 */
export function deserializeError(data: SerializableError): Error {
  const error = new Error(data.message)
  error.name = data.name
  if (data.stack) {
    error.stack = data.stack
  }
  return error
}

/**
 * 格式化错误消息（用于日志）
 */
export function formatErrorForLogging(
  error: unknown,
  context?: ErrorContext
): string {
  const serialized = serializeError(error)
  const parts: string[] = [
    `[${context?.module ?? "unknown"}]`,
    `[${context?.operation ?? "operation"}]`,
    `${serialized.name}: ${serialized.message}`
  ]
  
  if (serialized.code) {
    parts.push(`(code: ${serialized.code})`)
  }
  
  if (serialized.status) {
    parts.push(`(status: ${serialized.status})`)
  }
  
  return parts.join(" ")
}

/**
 * 决定如何处理错误
 */
export function resolveErrorHandling(
  error: unknown,
  options?: {
    defaultRetryable?: boolean
    userMessagePrefix?: string
  }
): ErrorResolution {
  const shouldRetry = isRetryableError(error)
  const status = getHttpStatus(error)
  
  let userMessage: string
  let logLevel: ErrorResolution["logLevel"] = "error"
  
  if (error instanceof Error) {
    userMessage = options?.userMessagePrefix 
      ? `${options.userMessagePrefix}: ${error.message}`
      : error.message
  } else {
    userMessage = String(error)
  }
  
  // 根据状态码调整日志级别
  if (status === 401 || status === 403) {
    logLevel = "warn"
  } else if (status === 404) {
    logLevel = "info"
  } else if (status === 429) {
    logLevel = "warn"
  }
  
  return {
    shouldRetry,
    userMessage,
    logLevel,
    metadata: {
      status,
      code: (error as any)?.code
    }
  }
}
```

### 3.6 导出结构

```typescript
// packages/types/src/errors/index.ts

// 核心类型和基类
export * from "./types.js"
export * from "./application-error.js"

// 具体错误类
export * from "./api.js"
export * from "./filesystem.js"
export * from "./configuration.js"
export * from "./validation.js"
export * from "./tool.js"
export * from "./task.js"
export * from "./streaming.js"
export * from "./control-flow.js"

// 工具函数
export * from "./guards.js"
export * from "./handlers.js"
```

---

## 4. 实施路线图

### 阶段 1: 基础架构 (Week 1)

**目标**: 建立基础错误类和类型系统

**任务**:
- [ ] 创建 `packages/types/src/errors/types.ts`
  - `BaseError` 接口
  - `SerializableError` 接口
  - `ErrorResolution` 接口
  - `ErrorContext` 接口
- [ ] 创建 `packages/types/src/errors/application-error.ts`
  - `ApplicationError` 抽象类
- [ ] 创建 `packages/types/src/errors/guards.ts`
  - 基础类型守卫函数
- [ ] 创建 `packages/types/src/errors/handlers.ts`
  - 错误序列化和处理工具
- [ ] 更新 `packages/types/src/index.ts` 导出错误模块

**验收标准**:
- [ ] TypeScript 编译无错误
- [ ] 单元测试覆盖基础功能
- [ ] 文档完整

### 阶段 2: 错误分类 (Week 2)

**目标**: 实现所有具体错误类

**任务**:
- [ ] 创建 `packages/types/src/errors/api.ts`
  - `ApiError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `RateLimitError`, `TimeoutError`, `NetworkError`
- [ ] 创建 `packages/types/src/errors/filesystem.ts`
  - `FileSystemError`, `FileNotFound`, `PermissionDenied`, `InvalidFileType`
- [ ] 创建 `packages/types/src/errors/configuration.ts`
  - `ConfigurationError`, `MissingRequiredField`, `InvalidConfiguration`, `ProfileNotFound`
- [ ] 创建 `packages/types/src/errors/validation.ts`
  - `ValidationError`, `ToolValidationError`, `InputValidationError`
- [ ] 创建 `packages/types/src/errors/tool.ts`
  - `ToolError`, `ToolNotAllowed`, `ToolExecutionFailed`, `ToolResultError`
- [ ] 创建 `packages/types/src/errors/task.ts`
  - `TaskError`, `TaskNotFound`, `TaskCancelled`, `TaskFailed`
- [ ] 创建 `packages/types/src/errors/streaming.ts`
  - `StreamingError`, `DeadLoopDetectedError`, `UserCancelledError`, `StreamProcessingError`
- [ ] 创建 `packages/types/src/errors/control-flow.ts`
  - `ControlFlowError`, `AskIgnoredError`, `SupersededRequestError`

**验收标准**:
- [ ] 所有错误类继承 `ApplicationError`
- [ ] 每个错误类有完整的 JSDoc 文档
- [ ] 每个错误类有单元测试

### 阶段 3: 迁移现有代码 (Week 3-4)

**目标**: 渐进式迁移现有错误类

**任务**:
- [ ] **优先级 1**: 迁移 API 相关错误
  - 更新 `src/api/providers/utils/error-handler.ts`
  - 使用新的 `AuthenticationError`, `RateLimitError` 等
- [ ] **优先级 2**: 迁移文件系统错误
  - 更新文件操作相关代码
  - 使用新的 `FileNotFound`, `PermissionDenied` 等
- [ ] **优先级 3**: 迁移配置错误
  - 更新配置验证代码
  - 使用新的 `MissingRequiredField`, `InvalidConfiguration` 等
- [ ] **优先级 4**: 迁移现有自定义错误
  - 更新 `src/utils/errors.ts` - `OrganizationAllowListViolationError`
  - 更新 `src/shared/modes.ts` - `FileRestrictionError`
  - 更新 `src/services/code-index/vector-store/qdrant-errors.ts`
  - 更新 `src/core/task/AskIgnoredError.ts`
  - 更新 `src/core/task/streaming/StreamProcessor.ts`
  - 更新 `src/core/tools/apply-patch/` 相关错误
  - 更新 `src/core/tools/ExecuteCommandTool.ts` - `ShellIntegrationError`

**迁移策略**:
1. 保持向后兼容（不删除旧代码）
2. 新代码使用新错误类
3. 逐步重构旧代码
4. 每个模块迁移后运行测试

### 阶段 4: 工具函数和集成 (Week 5)

**目标**: 完善错误处理工具链

**任务**:
- [ ] 创建统一的错误日志格式
- [ ] 集成到现有日志系统
- [ ] 创建错误报告工具
- [ ] 添加 i18n 支持
- [ ] 更新文档

---

## 5. 迁移指南

### 5.1 迁移现有错误类

#### 示例 1: QdrantConnectionError

**迁移前**:
```typescript
// src/services/code-index/vector-store/qdrant-errors.ts
export class QdrantConnectionError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message)
    this.name = "QdrantConnectionError"
    Object.setPrototypeOf(this, QdrantConnectionError.prototype)
  }
}
```

**迁移后**:
```typescript
// src/services/code-index/vector-store/qdrant-errors.ts
import { NetworkError } from "@coder/types"

export class QdrantConnectionError extends NetworkError {
  constructor(
    message: string,
    options?: {
      networkCode?: string
      isRetryable?: boolean
      cause?: unknown
    }
  ) {
    super(message, {
      endpoint: "qdrant",
      networkCode: options?.networkCode,
      isRetryable: options?.isRetryable ?? true,
      cause: options?.cause
    })
  }
}
```

#### 示例 2: FileRestrictionError

**迁移前**:
```typescript
// src/shared/modes.ts
export class FileRestrictionError extends Error {
  constructor(mode: string, pattern: string, description: string | undefined, filePath: string, tool?: string) {
    const toolInfo = tool ? `Tool '${tool}' in mode '${mode}'` : `This mode (${mode})`
    super(`${toolInfo} can only edit files matching pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`)
    this.name = "FileRestrictionError"
  }
}
```

**迁移后**:
```typescript
// src/shared/modes.ts
import { ToolNotAllowed } from "@coder/types"

export class FileRestrictionError extends ToolNotAllowed {
  constructor(
    mode: string,
    pattern: string,
    filePath: string,
    tool?: string,
    description?: string
  ) {
    super(
      tool ?? "file_operation",
      mode,
      `Files must match pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`
    )
  }
}
```

### 5.2 迁移错误处理代码

#### 示例 1: API 错误处理

**迁移前**:
```typescript
// src/api/providers/utils/error-handler.ts
export function handleProviderError(
  error: unknown,
  providerName: string,
): Error {
  if (error instanceof Error) {
    const anyErr = error as any
    const msg = anyErr?.error?.metadata?.raw || error.message
    
    if (anyErr.status === 401) {
      const wrapped = new Error("Authentication failed")
      ;(wrapped as any).status = 401
      return wrapped
    }
    
    if (anyErr.status === 429) {
      const wrapped = new Error("Rate limit exceeded")
      ;(wrapped as any).status = 429
      ;(wrapped as any).retryAfter = anyErr.retryAfter
      return wrapped
    }
    
    return new Error(`${providerName} error: ${msg}`)
  }
  
  return new Error(`${providerName} error: ${String(error)}`)
}
```

**迁移后**:
```typescript
// src/api/providers/utils/error-handler.ts
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  isApiError
} from "@coder/types"

export function handleProviderError(
  error: unknown,
  providerName: string,
): Error {
  if (error instanceof Error) {
    const anyErr = error as any
    const msg = anyErr?.error?.metadata?.raw || error.message
    const status = anyErr?.status ?? anyErr?.response?.status
    
    if (status === 401) {
      return new AuthenticationError(
        `${providerName} authentication failed: ${msg}`,
        { cause: error }
      )
    }
    
    if (status === 429) {
      return new RateLimitError(
        `${providerName} rate limit exceeded: ${msg}`,
        {
          retryAfter: anyErr?.retryAfter,
          limit: anyErr?.limit,
          remaining: anyErr?.remaining,
          cause: error
        }
      )
    }
    
    return new NetworkError(
      `${providerName} API error: ${msg}`,
      {
        status,
        isRetryable: status === 503 || status >= 500,
        cause: error
      }
    )
  }
  
  return new NetworkError(
    `${providerName} error: ${String(error)}`,
    { cause: error }
  )
}
```

#### 示例 2: 类型安全的错误捕获

**迁移前**:
```typescript
try {
  await api.call()
} catch (error: any) {
  if (error?.status === 429) {
    await backoff(error.retryAfter)
  } else if (error instanceof Error) {
    console.error(error.message)
  }
}
```

**迁移后**:
```typescript
import { RateLimitError, isApiError } from "@coder/types"

try {
  await api.call()
} catch (error) {
  if (error instanceof RateLimitError) {
    // 类型安全，retryAfter 已知存在
    await backoff(error.retryAfter)
  } else if (isApiError(error)) {
    // 统一的 API 错误处理
    logger.error(error.code, error.metadata)
  } else {
    // 其他错误
    console.error(error)
  }
}
```

---

## 6. 最佳实践

### 6.1 何时使用自定义错误类

**应该创建自定义错误类的情况**:
- ✅ 需要携带特定的元数据字段
- ✅ 需要特定的错误处理逻辑
- ✅ 表示业务领域的特定错误场景
- ✅ 需要被类型守卫识别

**不应该创建自定义错误类的情况**:
- ❌ 只是改变错误消息
- ❌ 没有额外的元数据或行为
- ❌ 仅用于控制流（考虑使用 `ControlFlowError`）

### 6.2 错误消息指南

**好的错误消息**:
```typescript
// ✅ 具体且可操作
throw new FileNotFound("/path/to/config.json")
// "File not found: /path/to/config.json"

// ✅ 包含上下文
throw new ToolNotAllowed("edit_file", "read-only", "File is in read-only mode")
// "Tool 'edit_file' is not allowed in mode 'read-only': File is in read-only mode"

// ✅ 包含建议的解决方案
throw new MissingRequiredField("apiKey", "provider configuration")
// "Required field 'apiKey' is missing in provider configuration"
```

**不好的错误消息**:
```typescript
// ❌ 太模糊
throw new Error("Something went wrong")

// ❌ 缺少上下文
throw new Error("File not found")

// ❌ 技术术语过多
throw new Error("ENOENT: no such file or directory")
```

### 6.3 错误处理模式

**推荐模式**:

```typescript
// 1. 精确捕获
try {
  await operation()
} catch (error) {
  if (error instanceof RateLimitError) {
    await handleRateLimit(error)
  } else if (error instanceof AuthenticationError) {
    await reauthenticate()
  } else {
    throw error // 重新抛出未知错误
  }
}

// 2. 错误包装
async function loadConfig(path: string): Promise<Config> {
  try {
    return await fs.readJson(path)
  } catch (error) {
    throw new ConfigurationError(
      `Failed to load configuration from ${path}`,
      { cause: error }
    )
  }
}

// 3. 错误边界
async function handleRequest(request: Request): Promise<Response> {
  try {
    return await processRequest(request)
  } catch (error) {
    logger.error("Request failed", { error, requestId: request.id })
    
    if (isAuthenticationError(error)) {
      return Response.unauthorized()
    }
    if (isNotFoundError(error)) {
      return Response.notFound()
    }
    
    return Response.internalServerError()
  }
}
```

### 6.4 日志记录

```typescript
import { formatErrorForLogging, serializeError } from "@coder/types"

// 结构化日志
logger.error(formatErrorForLogging(error, {
  operation: "api_call",
  module: "anthropic_provider",
  timestamp: Date.now(),
  taskId: currentTask.id
}))

// 错误报告
reportError(serializeError(error), {
  userId: currentUser.id,
  environment: process.env.NODE_ENV
})
```

### 6.5 测试错误处理

```typescript
import { AuthenticationError, RateLimitError } from "@coder/types"

describe("error handling", () => {
  it("should handle authentication errors", async () => {
    mockApi.mockImplementation(() => {
      throw new AuthenticationError("Invalid API key")
    })
    
    await expect(handler()).rejects.toThrow(AuthenticationError)
    await expect(handler()).rejects.toHaveProperty("status", 401)
  })
  
  it("should retry on rate limit errors", async () => {
    mockApi
      .mockImplementationOnce(() => {
        throw new RateLimitError("Rate limit exceeded", {
          retryAfter: 1000
        })
      })
      .mockImplementationOnce(() => ({ success: true }))
    
    const result = await handlerWithRetry()
    expect(result).toEqual({ success: true })
    expect(mockApi).toHaveBeenCalledTimes(2)
  })
})
```

---

## 附录

### A. 错误代码列表

| 错误代码 | 状态码 | 描述 |
|---------|--------|------|
| `AUTHENTICATION_FAILED` | 401 | 认证失败 |
| `AUTHORIZATION_FAILED` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `RATE_LIMIT_EXCEEDED` | 429 | 超过请求限制 |
| `TIMEOUT` | - | 请求超时 |
| `NETWORK_ERROR` | - | 网络错误 |
| `FILE_NOT_FOUND` | - | 文件不存在 |
| `PERMISSION_DENIED` | - | 权限不足 |
| `INVALID_FILE_TYPE` | - | 不支持的文件类型 |
| `MISSING_REQUIRED_FIELD` | - | 缺少必需字段 |
| `INVALID_CONFIGURATION` | - | 配置无效 |
| `PROFILE_NOT_FOUND` | - | 配置文件不存在 |
| `TOOL_VALIDATION_FAILED` | - | 工具参数验证失败 |
| `TOOL_NOT_ALLOWED` | - | 工具不允许使用 |
| `TOOL_EXECUTION_FAILED` | - | 工具执行失败 |
| `TASK_NOT_FOUND` | - | 任务不存在 |
| `TASK_CANCELLED` | - | 任务已取消 |
| `DEAD_LOOP_DETECTED` | - | 检测到死循环 |
| `USER_CANCELLED` | - | 用户取消 |
| `ASK_IGNORED` | - | Ask 被忽略 |

### B. 相关文件

- `packages/types/src/errors/` - 错误类型定义
- `src/api/providers/utils/error-handler.ts` - API 错误处理
- `src/services/code-index/shared/validation-helpers.ts` - 验证错误处理
- `src/core/context/management/error-handling.ts` - 上下文错误检测

### C. 参考资料

- [TypeScript Error Handling](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html)
- [Node.js Error Handling Best Practices](https://nodejs.org/api/errors.html)
- [Error Handling Patterns](https://www.davidbcalhoun.com/writing/error-handling-patterns)

---

**文档结束**
