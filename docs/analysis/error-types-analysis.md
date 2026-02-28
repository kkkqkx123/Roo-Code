# 项目错误类型分析报告

## 概述

本报告分析了 Roo-Code 项目中的错误处理架构，包括现有的错误类型定义、错误抛出模式，以及在 `packages/types` 包中需要新增的错误类型建议。

## 一、现有错误类型架构

### 1.1 packages/types 包中的错误类型

`packages/types/src/errors/` 目录已经定义了以下错误类型：

#### 基础错误类
- **BaseError** - 所有应用错误的基础类
  - 包含 `message`, `code`, `context` 属性

#### HTTP 错误（http.ts）
- **HttpError** - HTTP 错误基类
  - **Http401Error** - 认证失败
  - **Http403Error** - 访问被拒绝
  - **Http404Error** - 资源未找到
  - **Http400Error** - 请求无效
  - **Http422Error** - 语义错误
  - **Http429Error** - 速率限制（包含 retry-after 信息）
  - **Http408Error** - 请求超时
  - **Http5xxError** - 服务器错误
  - **HttpConnectionError** - 网络连接问题

#### API Provider 错误（api-provider.ts）
- **ApiProviderError** - API 提供商错误基类
  - **AuthenticationError** - 认证错误
  - **RateLimitError** - 速率限制错误
  - **ServerError** - 服务器错误
  - **ConnectionError** - 连接错误
  - **RequestTimeoutError** - 请求超时
  - **BadRequestError** - 错误请求
  - **PermissionDeniedError** - 权限被拒绝
  - **NotFoundError** - 资源未找到
  - **UnprocessableEntityError** - 无法处理的实体

#### 流处理错误（streaming.ts）
- **StreamingError** - 流处理错误基类
  - **InvalidStreamError** - 无效的流
  - **ChunkHandlerError** - 块处理器错误
  - **StreamAbortedError** - 流被中止
  - **ToolCallError** - 工具调用错误
  - **TokenError** - Token 错误
  - **UserInterruptError** - 用户中断
  - **ToolInterruptError** - 工具中断
  - **StreamProviderError** - 流提供者错误
  - **StreamTimeoutError** - 流超时
  - **StateError** - 状态错误
  - **StreamingRetryError** - 流重试错误

#### Qdrant 错误（qdrant.ts）
- **QdrantConnectionError** - Qdrant 连接错误
- **QdrantCollectionNotFoundError** - 集合未找到
- **QdrantVectorDimensionMismatchError** - 向量维度不匹配
- **QdrantTimeoutError** - Qdrant 超时
- **QdrantQuotaExceededError** - 配额超限

#### 错误提取器（extractor.ts）
- 提供错误分类、格式化和重试决策功能
- **ErrorCategory** 枚举：认证、速率限制、服务器、连接、用户取消等

### 1.2 src 目录中的错误类型

`src/core/errors/` 目录定义了更具体的错误类型：

#### 工具验证错误（tools/validation-errors.ts）
- **ValidationError** - 验证错误基类
  - **MissingParameterError** - 缺少必需参数
  - **InvalidParameterError** - 无效参数值
  - **InvalidToolError** - 无效工具名称
- 特性：
  - `toLLMMessage()` - 为 LLM 格式化错误
  - `toLogEntry()` - 为日志记录格式化错误
  - 敏感数据清理

#### 文件操作错误（tools/file-errors.ts）
- **FileOperationError** - 文件操作错误基类
  - **FileNotFoundToolError** - 文件未找到
  - **FileAlreadyExistsError** - 文件已存在
  - **DirectoryNotFoundToolError** - 目录未找到
  - **PermissionDeniedToolError** - 权限被拒绝
  - **RooIgnoreViolationError** - .rooignore 违规
  - **DirectoryCreationError** - 目录创建失败
  - **BinaryFileError** - 二进制文件错误
  - **FileTooLargeError** - 文件过大

#### 工具执行错误（tools/execution-errors.ts）
- **ExecutionError** - 执行错误基类
  - **CommandTimeoutError** - 命令超时
  - **CommandFailedError** - 命令失败
  - **DiffApplyFailedError** - Diff 应用失败
  - **ShellIntegrationError** - Shell 集成错误
  - **PatchParseError** - Patch 解析错误

#### 内容错误（tools/content-errors.ts）
- 搜索匹配错误
- 内容不匹配错误

#### 状态错误（tools/state-errors.ts）
- 重复检测错误
- 连续错误

#### 流处理错误（streaming/）
- **abort-errors.ts** - 中止错误
- **handler-errors.ts** - 处理器错误
- **parse-errors.ts** - 解析错误
- **provider-errors.ts** - 提供者错误

#### Patch 错误（tools/apply-patch/errors.ts）
- Patch 解析错误
- Patch 应用错误
- Patch 验证错误
- Patch 权限错误

## 二、项目中的错误抛出模式分析

### 2.1 错误抛出统计

通过代码分析，发现项目中有：

- **200+ 处** `throw new Error` 语句
- **40+ 个** 结构化的自定义错误类
- 自定义错误类使用约 **30+ 处**

### 2.2 错误分布（按类别）

#### 配置错误（~40 处）
主要文件：
- `src/core/config/ProviderSettingsManager.ts` - 17 处
- `src/shared/api.ts`
- `src/shared/modes.ts`

典型错误消息：
- `Failed to initialize config: ${error}`
- `Config with name '${name}' not found`
- `Cannot delete the last remaining configuration`

#### MCP 服务错误（~30 处）
主要文件：
- `src/services/mcp/McpHub.ts` - 30+ 处

典型错误消息：
- `Unsupported MCP server type: ${type}`
- `Server ${serverName} not found in config`
- `No connection found for server: ${serverName}`

#### 代码索引错误（~25 处）
主要文件：
- `src/services/code-index/orchestrator.ts`
- `src/services/code-index/service-factory.ts`

典型错误消息：
- 索引初始化失败
- 索引更新失败
- 搜索执行失败

#### 文件操作错误（~30 处）
主要文件：
- `src/utils/fs.ts`
- `src/integrations/editor/DiffViewProvider.ts`

典型错误消息：
- 文件读取失败
- 文件写入失败
- 路径解析错误

#### Token 计数错误（~15 处）
主要文件：
- `src/utils/tokenization/TokenAccountingSession.ts`

典型错误消息：
- Token 计数失败
- 超出 Token 限制

#### API/Provider 错误（~20 处）
主要文件：
- API 调用相关文件

典型错误消息：
- API 调用失败
- 响应解析失败

#### 终端/命令错误（~15 处）
主要文件：
- `src/integrations/terminal/TerminalProcess.ts`
- `src/integrations/terminal/ShellIntegrationManager.ts`
- `src/integrations/terminal/ExecaTerminalProcess.ts`

典型错误消息：
- `Invalid shell type: ${shell}`
- 命令执行失败
- 终端进程错误

#### 测试错误（~50+ 处）
主要在测试文件中，用于验证错误处理逻辑

### 2.3 错误消息模式

#### 标准格式
- `"Failed to ${操作}: ${原因}"`
- `"Cannot ${操作}: ${原因}"`
- `"${资源} not found: ${标识符}"`

#### 包含的上下文信息
- 文件路径
- 配置名称
- 状态信息
- 错误原因
- 建议的修复方法

#### 国际化支持
- 使用 `t()` 函数进行国际化
- 支持多语言错误消息

#### 详细程度
- 高：包含具体原因和位置
- 可操作：提供修复建议

## 三、需要新增的错误类型建议

基于对项目中错误抛出代码的分析，以下是在 `packages/types` 包中建议新增的错误类型：

### 3.1 配置管理错误（config.ts）

当前项目中配置相关的错误抛出较多，但缺乏统一的错误类型。

```typescript
/**
 * 配置管理错误基类
 */
export abstract class ConfigurationError extends BaseError {
  constructor(
    message: string,
    public readonly configType: string,
    public readonly configName?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "CONFIGURATION_ERROR", { configType, configName, ...context })
  }
}

/**
 * 配置未找到错误
 */
export class ConfigNotFoundError extends ConfigurationError {
  constructor(
    configType: string,
    configName: string,
    availableConfigs?: string[]
  ) {
    const suggestion = availableConfigs
      ? `Available configs: ${availableConfigs.join(", ")}`
      : undefined
    super(
      `Configuration not found: ${configName}`,
      configType,
      configName,
      { availableConfigs, suggestion }
    )
  }
}

/**
 * 配置初始化失败错误
 */
export class ConfigInitializationError extends ConfigurationError {
  constructor(
    configType: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to initialize ${configType} configuration`,
      configType,
      undefined,
      { reason, originalError }
    )
  }
}

/**
 * 配置验证失败错误
 */
export class ConfigValidationError extends ConfigurationError {
  constructor(
    configType: string,
    configName: string,
    validationErrors: string[]
  ) {
    super(
      `Configuration validation failed for ${configName}`,
      configType,
      configName,
      { validationErrors }
    )
  }
}

/**
 * 配置删除失败错误
 */
export class ConfigDeletionError extends ConfigurationError {
  constructor(
    configType: string,
    configName: string,
    reason: string
  ) {
    super(
      `Failed to delete configuration: ${configName}`,
      configType,
      configName,
      { reason }
    )
  }
}

/**
 * 最后配置删除错误
 */
export class LastConfigDeletionError extends ConfigurationError {
  constructor(configType: string) {
    super(
      `Cannot delete the last remaining ${configType} configuration`,
      configType,
      undefined,
      { suggestion: "Add another configuration before deleting the last one" }
    )
  }
}
```

### 3.2 MCP 服务错误（mcp.ts）

MCP 服务相关的错误抛出频繁，需要统一的错误类型。

```typescript
/**
 * MCP 服务错误基类
 */
export abstract class McpError extends BaseError {
  constructor(
    message: string,
    public readonly serverName: string,
    public readonly source?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "MCP_ERROR", { serverName, source, ...context })
  }
}

/**
 * MCP 服务器未找到错误
 */
export class McpServerNotFoundError extends McpError {
  constructor(
    serverName: string,
    source?: string,
    availableServers?: string[]
  ) {
    const suggestion = availableServers
      ? `Available servers: ${availableServers.join(", ")}`
      : undefined
    super(
      `MCP server not found: ${serverName}`,
      serverName,
      source,
      { availableServers, suggestion }
    )
  }
}

/**
 * MCP 配置验证错误
 */
export class McpConfigValidationError extends McpError {
  constructor(
    serverName: string,
    validationErrors: string[]
  ) {
    super(
      `MCP server configuration validation failed: ${serverName}`,
      serverName,
      undefined,
      { validationErrors }
    )
  }
}

/**
 * MCP 连接错误
 */
export class McpConnectionError extends McpError {
  constructor(
    serverName: string,
    source?: string,
    reason?: string
  ) {
    super(
      `Failed to connect to MCP server: ${serverName}`,
      serverName,
      source,
      { reason }
    )
  }
}

/**
 * MCP 服务器类型不支持错误
 */
export class McpServerTypeError extends McpError {
  constructor(
    serverName: string,
    serverType: string,
    supportedTypes?: string[]
  ) {
    const suggestion = supportedTypes
      ? `Supported types: ${supportedTypes.join(", ")}`
      : undefined
    super(
      `Unsupported MCP server type: ${serverType}`,
      serverName,
      undefined,
      { serverType, supportedTypes, suggestion }
    )
  }
}

/**
 * MCP 服务器启动错误
 */
export class McpServerError extends McpError {
  constructor(
    serverName: string,
    source?: string,
    reason?: string,
    originalError?: Error
  ) {
    super(
      `MCP server error: ${serverName}`,
      serverName,
      source,
      { reason, originalError }
    )
  }
}
```

### 3.3 代码索引错误（code-index.ts）

代码索引服务需要专门的错误类型。

```typescript
/**
 * 代码索引错误基类
 */
export abstract class CodeIndexError extends BaseError {
  constructor(
    message: string,
    public readonly indexName?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "CODE_INDEX_ERROR", { indexName, ...context })
  }
}

/**
 * 索引初始化失败错误
 */
export class IndexInitializationError extends CodeIndexError {
  constructor(
    indexName: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to initialize code index: ${indexName}`,
      indexName,
      { reason, originalError }
    )
  }
}

/**
 * 索引更新失败错误
 */
export class IndexUpdateError extends CodeIndexError {
  constructor(
    indexName: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to update code index: ${indexName}`,
      indexName,
      { reason, originalError }
    )
  }
}

/**
 * 搜索执行失败错误
 */
export class SearchExecutionError extends CodeIndexError {
  constructor(
    indexName: string,
    query: string,
    reason: string
  ) {
    super(
      `Search execution failed: ${reason}`,
      indexName,
      { query, reason }
    )
  }
}

/**
 * 索引未找到错误
 */
export class IndexNotFoundError extends CodeIndexError {
  constructor(indexName: string) {
    super(
      `Code index not found: ${indexName}`,
      indexName,
      { suggestion: "Initialize the index first" }
    )
  }
}
```

### 3.4 终端/命令错误（terminal.ts）

终端和命令执行相关的错误类型。

```typescript
/**
 * 终端错误基类
 */
export abstract class TerminalError extends BaseError {
  constructor(
    message: string,
    public readonly terminalId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "TERMINAL_ERROR", { terminalId, ...context })
  }
}

/**
 * Shell 类型无效错误
 */
export class InvalidShellTypeError extends TerminalError {
  constructor(
    shellType: string,
    supportedShells?: string[]
  ) {
    const suggestion = supportedShells
      ? `Supported shells: ${supportedShells.join(", ")}`
      : undefined
    super(
      `Invalid shell type: ${shellType}`,
      undefined,
      { shellType, supportedShells, suggestion }
    )
  }
}

/**
 * 命令执行失败错误
 */
export class CommandExecutionError extends TerminalError {
  constructor(
    command: string,
    exitCode: number,
    output?: string,
    terminalId?: string
  ) {
    super(
      `Command execution failed with exit code ${exitCode}`,
      terminalId,
      { command, exitCode, output }
    )
  }
}

/**
 * 终端进程错误
 */
export class TerminalProcessError extends TerminalError {
  constructor(
    terminalId: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Terminal process error: ${reason}`,
      terminalId,
      { originalError }
    )
  }
}

/**
 * Shell 集成错误
 */
export class ShellIntegrationError extends TerminalError {
  constructor(
    terminalId: string,
    reason: string
  ) {
    super(
      `Shell integration error: ${reason}`,
      terminalId,
      { suggestion: "Command will be executed using fallback mode" }
    )
  }
}
```

### 3.5 文件系统错误（filesystem.ts）

文件系统操作的错误类型。

```typescript
/**
 * 文件系统错误基类
 */
export abstract class FileSystemError extends BaseError {
  constructor(
    message: string,
    public readonly filePath: string,
    context?: Record<string, unknown>
  ) {
    super(message, "FILESYSTEM_ERROR", { filePath, ...context })
  }
}

/**
 * 文件读取失败错误
 */
export class FileReadError extends FileSystemError {
  constructor(
    filePath: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to read file: ${filePath}`,
      filePath,
      { reason, originalError }
    )
  }
}

/**
 * 文件写入失败错误
 */
export class FileWriteError extends FileSystemError {
  constructor(
    filePath: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to write file: ${filePath}`,
      filePath,
      { reason, originalError }
    )
  }
}

/**
 * 路径解析错误
 */
export class PathResolutionError extends FileSystemError {
  constructor(
    filePath: string,
    reason: string
  ) {
    super(
      `Failed to resolve path: ${filePath}`,
      filePath,
      { reason }
    )
  }
}

/**
 * 目录遍历错误
 */
export class DirectoryTraversalError extends FileSystemError {
  constructor(
    dirPath: string,
    reason: string
  ) {
    super(
      `Failed to traverse directory: ${dirPath}`,
      dirPath,
      { reason }
    )
  }
}
```

### 3.6 Token 计数错误（token.ts）

Token 计数相关的错误类型。

```typescript
/**
 * Token 错误基类
 */
export abstract class TokenError extends BaseError {
  constructor(
    message: string,
    public readonly tokenCount?: number,
    public readonly tokenLimit?: number,
    context?: Record<string, unknown>
  ) {
    super(message, "TOKEN_ERROR", { tokenCount, tokenLimit, ...context })
  }
}

/**
 * Token 计数失败错误
 */
export class TokenCountingError extends TokenError {
  constructor(
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to count tokens: ${reason}`,
      undefined,
      undefined,
      { originalError }
    )
  }
}

/**
 * Token 限制超出错误
 */
export class TokenLimitExceededError extends TokenError {
  constructor(
    tokenCount: number,
    tokenLimit: number,
    context?: string
  ) {
    super(
      `Token limit exceeded: ${tokenCount} > ${tokenLimit}${context ? ` (${context})` : ""}`,
      tokenCount,
      tokenLimit,
      { context, suggestion: "Reduce content length or increase token limit" }
    )
  }
}

/**
 * Token 编码错误
 */
export class TokenEncodingError extends TokenError {
  constructor(
    text: string,
    reason: string
  ) {
    super(
      `Failed to encode text to tokens: ${reason}`,
      undefined,
      undefined,
      { textLength: text.length, reason }
    )
  }
}
```

### 3.7 任务管理错误（task.ts）

任务管理相关的错误类型。

```typescript
/**
 * 任务错误基类
 */
export abstract class TaskError extends BaseError {
  constructor(
    message: string,
    public readonly taskId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "TASK_ERROR", { taskId, ...context })
  }
}

/**
 * 任务未找到错误
 */
export class TaskNotFoundError extends TaskError {
  constructor(
    taskId: string,
    availableTasks?: string[]
  ) {
    const suggestion = availableTasks
      ? `Available tasks: ${availableTasks.join(", ")}`
      : undefined
    super(
      `Task not found: ${taskId}`,
      taskId,
      { availableTasks, suggestion }
    )
  }
}

/**
 * 任务创建失败错误
 */
export class TaskCreationError extends TaskError {
  constructor(
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to create task: ${reason}`,
      undefined,
      { originalError }
    )
  }
}

/**
 * 任务执行失败错误
 */
export class TaskExecutionError extends TaskError {
  constructor(
    taskId: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Task execution failed: ${reason}`,
      taskId,
      { originalError }
    )
  }
}

/**
 * 任务状态错误
 */
export class TaskStateError extends TaskError {
  constructor(
    taskId: string,
    currentState: string,
    expectedStates: string[]
  ) {
    super(
      `Invalid task state: ${currentState}`,
      taskId,
      { currentState, expectedStates }
    )
  }
}
```

### 3.8 技能管理错误（skills.ts）

技能管理相关的错误类型。

```typescript
/**
 * 技能错误基类
 */
export abstract class SkillError extends BaseError {
  constructor(
    message: string,
    public readonly skillName?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "SKILL_ERROR", { skillName, ...context })
  }
}

/**
 * 技能未找到错误
 */
export class SkillNotFoundError extends SkillError {
  constructor(
    skillName: string,
    availableSkills?: string[]
  ) {
    const suggestion = availableSkills
      ? `Available skills: ${availableSkills.join(", ")}`
      : undefined
    super(
      `Skill not found: ${skillName}`,
      skillName,
      { availableSkills, suggestion }
    )
  }
}

/**
 * 技能加载失败错误
 */
export class SkillLoadError extends SkillError {
  constructor(
    skillName: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Failed to load skill: ${skillName}`,
      skillName,
      { reason, originalError }
    )
  }
}

/**
 * 技能执行失败错误
 */
export class SkillExecutionError extends SkillError {
  constructor(
    skillName: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Skill execution failed: ${skillName}`,
      skillName,
      { reason, originalError }
    )
  }
}
```

### 3.9 工作流错误（workflow.ts）

工作流相关的错误类型。

```typescript
/**
 * 工作流错误基类
 */
export abstract class WorkflowError extends BaseError {
  constructor(
    message: string,
    public readonly workflowName?: string,
    public readonly stepName?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "WORKFLOW_ERROR", { workflowName, stepName, ...context })
  }
}

/**
 * 工作流未找到错误
 */
export class WorkflowNotFoundError extends WorkflowError {
  constructor(
    workflowName: string,
    availableWorkflows?: string[]
  ) {
    const suggestion = availableWorkflows
      ? `Available workflows: ${availableWorkflows.join(", ")}`
      : undefined
    super(
      `Workflow not found: ${workflowName}`,
      workflowName,
      undefined,
      { availableWorkflows, suggestion }
    )
  }
}

/**
 * 工作流步骤失败错误
 */
export class WorkflowStepError extends WorkflowError {
  constructor(
    workflowName: string,
    stepName: string,
    reason: string,
    originalError?: Error
  ) {
    super(
      `Workflow step failed: ${stepName}`,
      workflowName,
      stepName,
      { reason, originalError }
    )
  }
}

/**
 * 工作流验证失败错误
 */
export class WorkflowValidationError extends WorkflowError {
  constructor(
    workflowName: string,
    validationErrors: string[]
  ) {
    super(
      `Workflow validation failed: ${workflowName}`,
      workflowName,
      undefined,
      { validationErrors }
    )
  }
}
```

### 3.10 验证错误（validation.ts）

通用的验证错误类型。

```typescript
/**
 * 验证错误基类
 */
export abstract class ValidationError extends BaseError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, "VALIDATION_ERROR", { field, value, ...context })
  }
}

/**
 * 必需字段缺失错误
 */
export class RequiredFieldError extends ValidationError {
  constructor(
    field: string,
    context?: string
  ) {
    super(
      `Required field is missing: ${field}`,
      field,
      undefined,
      { context, suggestion: `Provide the '${field}' field` }
    )
  }
}

/**
 * 字段值无效错误
 */
export class InvalidFieldValueError extends ValidationError {
  constructor(
    field: string,
    value: unknown,
    reason: string
  ) {
    super(
      `Invalid value for field '${field}': ${reason}`,
      field,
      value,
      { reason }
    )
  }
}

/**
 * 字段类型错误
 */
export class FieldTypeError extends ValidationError {
  constructor(
    field: string,
    expectedType: string,
    actualType: string
  ) {
    super(
      `Invalid type for field '${field}': expected ${expectedType}, got ${actualType}`,
      field,
      undefined,
      { expectedType, actualType }
    )
  }
}
```

## 四、错误类型使用建议

### 4.1 错误类型选择指南

| 错误场景 | 推荐错误类型 | 文件位置 |
|---------|------------|---------|
| 配置初始化/查找/删除 | ConfigurationError | config.ts |
| MCP 服务操作 | McpError | mcp.ts |
| 代码索引操作 | CodeIndexError | code-index.ts |
| 终端/命令执行 | TerminalError | terminal.ts |
| 文件系统操作 | FileSystemError | filesystem.ts |
| Token 计数/限制 | TokenError | token.ts |
| 任务管理 | TaskError | task.ts |
| 技能管理 | SkillError | skills.ts |
| 工作流执行 | WorkflowError | workflow.ts |
| 数据验证 | ValidationError | validation.ts |
| HTTP 请求 | HttpError | http.ts |
| API 调用 | ApiProviderError | api-provider.ts |
| 流处理 | StreamingError | streaming.ts |

### 4.2 错误处理最佳实践

1. **使用自定义错误类**：优先使用自定义错误类而不是标准 `Error`
2. **提供上下文信息**：包含足够的上下文以便调试
3. **包含修复建议**：在 `suggestion` 字段提供可操作的修复建议
4. **保留原始错误**：在 `originalError` 中保留原始错误对象
5. **使用错误代码**：为每个错误类型分配唯一的错误代码
6. **支持国际化**：使用 `t()` 函数支持多语言
7. **敏感数据清理**：在日志中清理敏感数据
8. **错误分类**：使用 `ErrorCategory` 进行错误分类

### 4.3 错误处理示例

```typescript
// 替换前
throw new Error(`Config with name '${name}' not found`)

// 替换后
throw new ConfigNotFoundError('provider', name, availableConfigs)

// 替换前
throw new Error(`Failed to initialize config: ${error}`)

// 替换后
throw new ConfigInitializationError('provider', error.message, error)

// 替换前
throw new Error(`Server ${serverName} not found in config`)

// 替换后
throw new McpServerNotFoundError(serverName, source, availableServers)
```

## 五、实施计划

### 5.1 优先级分类

#### 高优先级（立即实施）
- ConfigurationError - 配置错误使用最频繁
- McpError - MCP 服务错误使用频繁
- ValidationError - 通用验证错误

#### 中优先级（短期实施）
- FileSystemError - 文件操作错误
- TerminalError - 终端命令错误
- TaskError - 任务管理错误

#### 低优先级（长期实施）
- CodeIndexError - 代码索引错误
- TokenError - Token 计数错误
- SkillError - 技能管理错误
- WorkflowError - 工作流错误

### 5.2 实施步骤

1. **创建错误类型文件**
   - 在 `packages/types/src/errors/` 目录下创建新的错误类型文件
   - 按照现有的错误类型模式实现

2. **更新导出**
   - 在 `packages/types/src/errors/index.ts` 中添加新错误类型的导出

3. **迁移现有错误**
   - 逐步将 `throw new Error(...)` 替换为自定义错误类
   - 按优先级从高到低进行迁移

4. **更新错误处理**
   - 更新错误处理逻辑以使用新的错误类型
   - 添加类型守卫函数

5. **测试验证**
   - 添加单元测试
   - 验证错误处理逻辑

6. **文档更新**
   - 更新 API 文档
   - 添加使用示例

## 六、总结

### 6.1 现状总结

项目已经建立了较为完善的错误处理架构，包括：

- **基础错误类**：BaseError、HttpError、ApiProviderError、StreamingError 等
- **具体错误类型**：40+ 个自定义错误类
- **高级特性**：toLLMMessage()、toLogEntry()、敏感数据清理、修复建议

然而，仍存在以下问题：

- **200+ 处**使用标准 `Error` 而非自定义错误类
- **缺乏**统一的错误类型定义
- **错误消息**格式不统一
- **上下文信息**不完整

### 6.2 改进建议

通过在 `packages/types` 包中新增上述错误类型，可以实现：

1. **统一错误处理**：所有错误使用统一的错误类
2. **更好的错误追踪**：包含完整的上下文信息
3. **自动错误分类**：通过错误类型自动分类
4. **改进的用户体验**：提供可操作的修复建议
5. **更好的调试能力**：结构化的错误信息
6. **国际化支持**：统一的多语言支持

### 6.3 预期收益

- **代码质量提升**：更清晰、更一致的错误处理
- **维护成本降低**：统一的错误类型易于维护
- **用户体验改善**：更清晰的错误消息和修复建议
- **调试效率提高**：结构化的错误信息便于调试
- **扩展性增强**：易于添加新的错误类型

---

**文档版本**: 1.0
**创建日期**: 2025-02-28
**最后更新**: 2025-02-28
