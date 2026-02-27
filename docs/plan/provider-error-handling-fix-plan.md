# Provider错误处理集成修复方案

**文档状态**: 设计方案
**创建日期**: 2026-02-27
**关联问题**: `docs/issue/provider-error-handling-issue.md`

---

## 一、问题概述

当前系统中，供应商（Provider）返回的详细错误信息在Task层被完全忽略，导致前端显示无意义的通用错误消息。核心问题在于：

1. `StreamingResult.error` 字段未被Task层使用
2. 空assistant消息处理时创建新错误，丢失原始错误信息
3. 错误处理逻辑未区分不同错误类型

---

## 二、现有架构分析

### 2.1 错误处理分层结构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层 (Webview)                          │
│  webview-ui/src/components/chat/ErrorRow.tsx                    │
│  webview-ui/src/components/chat/ChatRow.tsx                     │
└─────────────────────────────────────────────────────────────────┘
                              ↑ 错误消息显示
┌─────────────────────────────────────────────────────────────────┐
│                        Task层 (Core)                             │
│  src/core/task/Task.ts                                          │
│  - 处理StreamingResult                                          │
│  - 决定重试/中止策略                                             │
│  - 发送错误消息到前端                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↑ StreamingResult
┌─────────────────────────────────────────────────────────────────┐
│                    Streaming处理层                               │
│  src/core/task/streaming/                                       │
│  ├── StreamingProcessor.ts      (核心控制器)                     │
│  ├── StreamingErrorHandler.ts   (错误处理)                       │
│  ├── StreamingStateManager.ts   (状态管理)                       │
│  └── types.ts                   (类型定义)                       │
└─────────────────────────────────────────────────────────────────┘
                              ↑ StreamChunk / Error
┌─────────────────────────────────────────────────────────────────┐
│                    Provider层 (API)                              │
│  src/api/providers/                                             │
│  ├── anthropic.ts               (Anthropic Provider)            │
│  ├── openai-native.ts           (OpenAI Provider)               │
│  ├── gemini.ts                  (Gemini Provider)               │
│  └── utils/                                                     │
│      ├── anthropic-error-handler.ts                             │
│      ├── openai-native-error-handler.ts                         │
│      └── gemini-error-handler.ts                                │
└─────────────────────────────────────────────────────────────────┘
                              ↑ API Error
┌─────────────────────────────────────────────────────────────────┐
│                    错误类型定义层                                 │
│  packages/types/src/errors/                                     │
│  ├── api-provider.ts            (ApiProviderError系列)          │
│  ├── streaming.ts               (StreamingError系列)            │
│  ├── http.ts                    (HttpError系列)                 │
│  └── utils.ts                   (错误工具函数)                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 现有错误类型层次

```
Error (JavaScript内置)
├── ApiProviderError (packages/types)
│   ├── AuthenticationError (401)
│   ├── RateLimitError (429) - 包含retryAfter
│   ├── ServerError (5xx)
│   ├── ConnectionError
│   ├── RequestTimeoutError (408)
│   ├── BadRequestError (400)
│   ├── PermissionDeniedError (403)
│   ├── NotFoundError (404)
│   └── UnprocessableEntityError (422)
│
├── StreamingError (packages/types)
│   ├── InvalidStreamError
│   ├── ChunkHandlerError
│   ├── StreamAbortedError
│   ├── ToolCallError
│   ├── TokenError
│   ├── UserInterruptError
│   ├── ToolInterruptError
│   ├── StreamProviderError
│   ├── StreamTimeoutError
│   └── StateError
│
└── StreamingRetryError (特殊错误，用于触发重试)
```

### 2.3 现有错误处理流程

```
Provider API调用
    ↓ 发生错误
Provider的catch块
    ↓ handleXxxError() 转换
ApiProviderError (包含status, message, requestId)
    ↓ 抛出到StreamingProcessor
StreamingErrorHandler.handleError()
    ↓ 规范化处理
返回 ErrorHandlingResult { shouldRetry, retryDelay, errorMessage }
    ↓
StreamingProcessor.handleError()
    ↓ 如果shouldRetry=true
抛出 StreamingRetryError
    ↓ 或者
返回 StreamingResult { error: StreamingErrorType }
    ↓
Task.processStream() 接收result
    ↓ [问题所在] result.error被忽略
检查 hasTextContent || hasToolUses
    ↓ 如果都为false
创建新的通用Error消息
    ↓
前端显示无意义错误
```

---

## 三、修改方案设计

### 3.1 新增模块：错误信息提取器

#### 3.1.1 模块位置

```
packages/types/src/errors/
├── api-provider.ts
├── streaming.ts
├── http.ts
├── utils.ts           (现有)
└── extractor.ts        (新增)
```

#### 3.1.2 模块职责

错误信息提取器负责从各种错误类型中提取结构化信息，供上层使用。它是一个**纯函数模块**，无状态，只提供函数导出。

#### 3.1.3 核心功能

**功能一：错误信息提取**

输入：任意错误对象（可能是ApiProviderError、StreamingError、普通Error或未知类型）
输出：结构化的错误信息对象

提取的信息包括：
- 错误类型标识（类名）
- HTTP状态码（如果适用）
- 错误消息文本
- 请求ID（用于调试和支持）
- 供应商名称
- 重试等待时间（如果是限流错误）
- 是否可重试
- 错误上下文（额外信息）

**功能二：错误消息格式化**

输入：错误对象
输出：适合显示给用户的格式化消息字符串

格式化规则：
- 如果有HTTP状态码，添加到消息开头
- 如果有请求ID，添加到消息末尾
- 如果有供应商名称，添加到消息开头
- 保持消息的可读性

**功能三：错误分类判断**

输入：错误对象
输出：错误类别枚举值

错误类别：
- 认证错误（不可重试）
- 限流错误（可重试，有等待时间）
- 服务器错误（可重试）
- 连接错误（可重试）
- 请求错误（不可重试）
- 权限错误（不可重试）
- 未知错误

#### 3.1.4 与其他模块的关系

**依赖关系**：
- 依赖 `api-provider.ts` 中的错误类型定义
- 依赖 `streaming.ts` 中的错误类型定义
- 依赖 `http.ts` 中的HTTP错误工具函数
- 依赖 `utils.ts` 中的现有工具函数

**被依赖关系**：
- 被 `Task.ts` 使用，提取错误信息
- 被 `StreamingErrorHandler.ts` 使用，规范化错误消息
- 被前端 `ErrorRow.tsx` 使用，格式化显示消息

#### 3.1.5 实现方式

采用**纯函数导出**方式，所有函数都是静态的、无副作用的。

导出的主要函数：
- `extractErrorInfo(error)` - 提取错误信息
- `formatErrorForDisplay(error)` - 格式化显示消息
- `formatErrorForLog(error)` - 格式化日志消息
- `categorizeError(error)` - 分类错误
- `isErrorRetryable(error)` - 判断是否可重试

---

### 3.2 修改模块：StreamingResult类型增强

#### 3.2.1 模块位置

```
src/core/task/streaming/types.ts
```

#### 3.2.2 修改内容

在 `StreamingResult` 接口中增强错误相关字段。

**现有定义**：
```
StreamingResult {
    assistantMessage: string
    reasoningMessage: string
    assistantMessageContent: AssistantMessageContent[]
    userMessageContent: Anthropic.Messages.ContentBlockParam[]
    groundingSources: GroundingSource[]
    tokens: TokenUsage
    didUseTool: boolean
    didRejectTool: boolean
    aborted: boolean
    abortReason?: string
    error: StreamingErrorType | null
}
```

**增强后**：
```
StreamingResult {
    // ... 现有字段保持不变
    
    error: StreamingErrorType | null
    
    // 新增字段：提取后的错误信息（便于Task层直接使用）
    extractedErrorInfo?: {
        type: string
        category: string
        status?: number
        message: string
        requestId?: string
        providerName?: string
        retryAfter?: number
        isRetryable: boolean
    }
}
```

#### 3.2.3 修改原因

让 `StreamingProcessor` 在返回结果时，同时提供已提取的错误信息，避免Task层重复提取逻辑。

---

### 3.3 修改模块：StreamingProcessor

#### 3.3.1 模块位置

```
src/core/task/streaming/StreamingProcessor.ts
```

#### 3.3.2 修改内容

**修改点一：在buildResult方法中提取错误信息**

在构建 `StreamingResult` 时，如果存在错误，调用错误提取器提取信息并填充到 `extractedErrorInfo` 字段。

**修改点二：在handleError方法中保留原始错误**

确保 `handleError` 方法在处理错误时，正确保留原始错误对象及其所有属性，不丢失任何信息。

#### 3.3.3 调用链变化

```
processStream()
    ↓ 正常完成
finalize()
    ↓
buildResult(null)
    ↓ 返回

processStream()
    ↓ 发生错误
handleError(error)
    ↓
errorHandler.handleError(error)
    ↓
buildResult(streamingError)
    ↓ [新增] 提取错误信息
extractErrorInfo(streamingError)
    ↓
返回 StreamingResult { error, extractedErrorInfo }
```

---

### 3.4 修改模块：StreamingErrorHandler

#### 3.4.1 模块位置

```
src/core/task/streaming/StreamingErrorHandler.ts
```

#### 3.4.2 修改内容

**修改点一：增强错误消息提取**

在 `handleError` 方法中，使用新的错误提取器来获取更详细的错误信息，而不是简单的字符串拼接。

**修改点二：保留原始错误引用**

确保在创建 `StreamingRetryError` 时，正确传递原始错误对象，以便上层可以访问完整的错误信息。

#### 3.4.3 与错误提取器的集成

```
handleError(error)
    ↓
normalizeError(error)  // 现有逻辑
    ↓
[新增] extractErrorInfo(normalizedError)
    ↓
使用提取的信息构建 streamingFailedMessage
    ↓
abortStream(cancelReason, streamingFailedMessage)
    ↓
返回 ErrorHandlingResult
```

---

### 3.5 修改模块：Task核心逻辑

#### 3.5.1 模块位置

```
src/core/task/Task.ts
```

#### 3.5.2 修改内容

这是修改的核心部分，需要在多个位置添加错误处理逻辑。

**修改点一：处理StreamingResult.error（约第2979行附近）**

在 `processStream` 返回后，立即检查 `result.error` 和 `result.extractedErrorInfo`。

处理逻辑：
1. 如果存在错误信息，记录到日志
2. 根据错误类别决定处理方式
3. 对于认证错误，直接中止任务并显示友好消息
4. 对于限流错误，使用错误中的retryAfter信息
5. 对于服务器错误，执行重试逻辑
6. 对于请求错误，显示详细错误并询问用户

**修改点二：修改空assistant消息处理（约第3136-3230行）**

当 `hasTextContent` 和 `hasToolUses` 都为false时：

现有逻辑：
```
创建新的通用Error("Unexpected API Response...")
调用 backoffAndAnnounce()
```

修改后逻辑：
```
检查 result.error 和 result.extractedErrorInfo
如果存在错误信息：
    使用提取的错误信息
    根据错误类别决定处理方式
否则：
    使用通用错误消息（保持现有行为作为兜底）
```

**修改点三：增强backoffAndAnnounce方法**

修改 `backoffAndAnnounce` 方法，使其能够接受结构化的错误信息，并在显示倒计时时展示更有意义的错误消息。

**修改点四：添加错误处理辅助方法**

在Task类中添加私有方法用于处理不同类型的错误：
- `handleAuthenticationError()` - 处理认证错误
- `handleRateLimitError()` - 处理限流错误
- `handleServerError()` - 处理服务器错误
- `handleRequestError()` - 处理请求错误

#### 3.5.3 调用链变化

**现有调用链**：
```
processStream() 返回 result
    ↓
提取 assistantMessage, reasoningMessage 等字段
    ↓
检查 result.aborted
    ↓
检查 hasTextContent || hasToolUses
    ↓ 如果都为false
创建新Error
    ↓
backoffAndAnnounce()
```

**修改后调用链**：
```
processStream() 返回 result
    ↓
提取 assistantMessage, reasoningMessage 等字段
    ↓
[新增] 检查 result.error 和 result.extractedErrorInfo
    ↓ 如果存在错误
[新增] 根据错误类别分发处理
    ├── AuthenticationError → handleAuthenticationError() → 中止任务
    ├── RateLimitError → handleRateLimitError() → 使用retryAfter重试
    ├── ServerError → handleServerError() → 指数退避重试
    └── 其他 → handleRequestError() → 显示详情并询问
    ↓
检查 result.aborted
    ↓
检查 hasTextContent || hasToolUses
    ↓ 如果都为false
[修改] 优先使用 result.error，否则使用通用消息
    ↓
backoffAndAnnounce()
```

---

### 3.6 修改模块：前端错误显示

#### 3.6.1 模块位置

```
webview-ui/src/components/chat/ErrorRow.tsx
webview-ui/src/components/chat/ChatRow.tsx
```

#### 3.6.2 修改内容

**修改点一：ErrorRow组件增强**

增强 `ErrorRow` 组件，支持显示更多错误详情：

新增属性：
- `requestId` - 请求ID，用于调试
- `providerName` - 供应商名称
- `retryAfter` - 重试等待时间
- `errorCategory` - 错误类别

显示逻辑：
- 在错误消息下方显示请求ID（如果有）
- 显示供应商名称（如果有）
- 对于限流错误，显示重试等待时间
- 添加"查看详情"按钮，展开显示完整错误信息

**修改点二：ChatRow错误消息解析**

修改 `ChatRow` 中解析错误消息的逻辑，从消息文本中提取结构化信息。

解析规则：
- 从消息开头提取HTTP状态码（3位数字）
- 从消息中提取请求ID（格式：Request ID: xxx）
- 从消息中提取供应商名称（格式：[ProviderName]）
- 从消息中提取重试计时器（现有逻辑保持）

#### 3.6.3 错误消息格式约定

为了在前端正确解析错误信息，约定错误消息格式：

```
[ProviderName] [StatusCode] Error message text (Request ID: xxx)
```

示例：
```
[Anthropic] [429] Too many requests. Please slow down your requests. (Request ID: req_abc123)
```

---

### 3.7 新增模块：错误消息格式化器

#### 3.7.1 模块位置

```
src/core/task/utils/error-formatter.ts
```

#### 3.7.2 模块职责

负责将错误信息格式化为适合不同场景的消息字符串。

#### 3.7.3 核心功能

**功能一：格式化前端显示消息**

输入：错误信息对象
输出：符合前端解析格式的消息字符串

格式：`[ProviderName] [StatusCode] Message (Request ID: xxx)`

**功能二：格式化日志消息**

输入：错误信息对象
输出：适合记录到日志的详细消息

格式：包含时间戳、错误类型、堆栈信息等

**功能三：格式化用户询问消息**

输入：错误信息对象
输出：适合在询问对话框中显示的友好消息

#### 3.7.4 实现方式

采用**纯函数导出**方式，无状态。

---

## 四、目录结构设计

### 4.1 新增文件

```
packages/types/src/errors/
└── extractor.ts                    # 错误信息提取器（新增）

src/core/task/utils/
└── error-formatter.ts              # 错误消息格式化器（新增）
```

### 4.2 修改文件

```
packages/types/src/errors/
├── index.ts                        # 导出新增的extractor
└── utils.ts                        # 可能需要增强现有函数

src/core/task/streaming/
├── types.ts                        # 增强StreamingResult
├── StreamingProcessor.ts           # 提取错误信息
└── StreamingErrorHandler.ts        # 使用错误提取器

src/core/task/
└── Task.ts                         # 核心错误处理逻辑修改

webview-ui/src/components/chat/
├── ErrorRow.tsx                    # 增强错误显示
└── ChatRow.tsx                     # 增强错误解析

webview-ui/src/i18n/locales/en/
└── chat.json                       # 新增错误消息翻译
```

---

## 五、模块间关系详细说明

### 5.1 错误提取器（extractor.ts）

**文件实现方式**：无状态，纯函数导出

**依赖关系**：
```
extractor.ts
    ├── 导入 api-provider.ts 中的错误类型
    ├── 导入 streaming.ts 中的错误类型
    ├── 导入 http.ts 中的工具函数
    └── 导入 utils.ts 中的工具函数
```

**被依赖关系**：
```
StreamingProcessor.ts
    └── 导入 extractor.ts 中的 extractErrorInfo()

StreamingErrorHandler.ts
    └── 导入 extractor.ts 中的 formatErrorForLog()

Task.ts
    └── 导入 extractor.ts 中的 extractErrorInfo(), categorizeError()

ErrorRow.tsx (前端)
    └── 通过消息格式间接使用
```

**业务逻辑职责**：
- 从任意错误对象中提取结构化信息
- 提供错误分类判断
- 提供格式化函数

### 5.2 错误格式化器（error-formatter.ts）

**文件实现方式**：无状态，纯函数导出

**依赖关系**：
```
error-formatter.ts
    └── 导入 @coder/types 中的错误类型和提取器
```

**被依赖关系**：
```
Task.ts
    └── 导入 error-formatter.ts 中的格式化函数
```

**业务逻辑职责**：
- 格式化错误消息供前端显示
- 格式化错误消息供日志记录
- 格式化错误消息供用户询问

### 5.3 StreamingProcessor修改

**文件实现方式**：有状态多实例（每个Task创建一个实例）

**依赖关系**：
```
StreamingProcessor.ts
    ├── 导入 StreamingStateManager
    ├── 导入 StreamingTokenManager
    ├── 导入 StreamingErrorHandler
    ├── 导入 各种Handler
    ├── 导入 types.ts
    └── [新增] 导入 extractor.ts
```

**被依赖关系**：
```
Task.ts
    └── 创建并使用 StreamingProcessor 实例
```

**业务逻辑职责**：
- 协调整个流式处理流程
- 管理处理状态
- 处理错误并返回结果

**集成方式**：
- 通过构造函数注入配置（包含回调函数）
- 通过 `processStream()` 方法启动处理
- 返回 `StreamingResult` 给调用者

### 5.4 Task修改

**文件实现方式**：有状态多实例（每个任务一个实例）

**依赖关系**：
```
Task.ts
    ├── 导入 StreamingProcessor
    ├── 导入 各种工具类
    ├── 导入 @coder/types 中的错误类型
    ├── [新增] 导入 extractor.ts
    └── [新增] 导入 error-formatter.ts
```

**被依赖关系**：
```
ClineProvider.ts
    └── 创建并管理 Task 实例
```

**业务逻辑职责**：
- 执行任务的主循环
- 处理API请求和响应
- 管理对话历史
- 处理错误并决定重试/中止

**集成方式**：
- 由 `ClineProvider` 创建和管理
- 通过 `startTask()` 方法启动
- 通过回调与前端通信

---

## 六、业务逻辑调用链

### 6.1 正常流程（无错误）

```
Task.startTask()
    ↓
Task.recursivelyMakeRooRequests()
    ↓
Task.attemptApiRequest()
    ↓ 返回 stream
StreamingProcessor.processStream()
    ↓
processLoop() - 处理所有chunk
    ↓
finalize() - 完成处理
    ↓
buildResult(null) - 构建结果
    ↓ 返回 StreamingResult { error: null }
Task 检查 result.error → 无错误
    ↓
继续处理 assistantMessage
    ↓
presentAssistantMessage() - 执行工具调用
    ↓
继续下一轮请求
```

### 6.2 错误流程（Provider错误）

```
Task.attemptApiRequest()
    ↓ 调用 Provider API
Provider 抛出 ApiProviderError
    ↓
StreamingProcessor.processLoop() catch块
    ↓
StreamingProcessor.handleError(error)
    ↓
StreamingErrorHandler.handleError(error)
    ↓
normalizeError(error) → 转换为StreamingError
    ↓
[新增] extractErrorInfo(streamingError)
    ↓
abortStream() - 清理资源
    ↓
返回 ErrorHandlingResult { shouldRetry, errorMessage }
    ↓
如果 shouldRetry=true:
    抛出 StreamingRetryError
    ↓ Task catch块捕获
    backoffAndAnnounce() - 显示倒计时
    ↓
    重新调用 attemptApiRequest()

如果 shouldRetry=false:
    返回 StreamingResult { error, extractedErrorInfo }
    ↓
[新增] Task 检查 result.error
    ↓
[新增] 根据 extractedErrorInfo.category 分发处理
    ├── authentication_failed → handleAuthenticationError()
    │       ↓
    │   say("error", 友好消息)
    │       ↓
    │   abortTask()
    │
    ├── rate_limited → handleRateLimitError()
    │       ↓
    │   使用 extractedErrorInfo.retryAfter
    │       ↓
    │   backoffAndAnnounce()
    │
    ├── server_error → handleServerError()
    │       ↓
    │   backoffAndAnnounce()
    │       ↓
    │   重试
    │
    └── 其他 → handleRequestError()
            ↓
        say("error", 详细消息)
            ↓
        询问用户是否重试
```

### 6.3 错误流程（空assistant消息）

```
StreamingProcessor.processStream()
    ↓ 返回 result
Task 检查 result
    ↓
hasTextContent = false && hasToolUses = false
    ↓
[修改] 检查 result.error 和 result.extractedErrorInfo
    ↓
如果存在错误信息：
    [修改] 使用 extractedErrorInfo 构建错误消息
    [修改] 根据错误类别决定处理方式
    ↓
否则：
    [保持] 使用通用错误消息
    ↓
consecutiveNoAssistantMessagesCount++
    ↓
如果 autoApprovalEnabled:
    backoffAndAnnounce(retryAttempt, error)
    ↓
    重试
否则:
    ask("api_req_failed", errorMessage)
    ↓
    用户选择重试或中止
```

---

## 七、状态机设计

### 7.1 错误处理状态机

```
                    ┌─────────────────┐
                    │   正常处理中     │
                    └────────┬────────┘
                             │
                    发生错误 │
                             ↓
                    ┌─────────────────┐
                    │   错误检测       │
                    │ (检查result.error)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ↓              ↓              ↓
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ 可重试错误  │  │ 认证错误    │  │ 其他错误    │
     │(429/5xx/连接)│ │  (401)     │  │(400/403/404)│
     └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
           │               │               │
           ↓               ↓               ↓
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ 退避等待    │  │ 显示友好   │  │ 显示详情   │
     │ (倒计时)    │  │ 错误消息   │  │ 询问用户   │
     └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
           │               │               │
           ↓               ↓               ↓
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │   重试      │  │  中止任务   │  │ 用户选择   │
     └─────┬──────┘  └────────────┘  └─────┬──────┘
           │                               │
           │                    ┌──────────┼──────────┐
           │                    │                     │
           ↓                    ↓                     ↓
     ┌────────────┐       ┌────────────┐       ┌────────────┐
     │ 返回正常处理 │       │   重试      │       │  中止任务   │
     └────────────┘       └────────────┘       └────────────┘
```

### 7.2 空assistant消息处理状态机

```
                    ┌─────────────────┐
                    │ 检查响应内容     │
                    │hasText/hasTool  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │                             │
              ↓                             ↓
     ┌────────────────┐            ┌────────────────┐
     │  有内容        │            │  无内容        │
     │ (正常处理)     │            │ (可能错误)     │
     └────────────────┘            └───────┬────────┘
                                           │
                                  检查result.error
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ↓                            ↓                            ↓
     ┌────────────────┐          ┌────────────────┐          ┌────────────────┐
     │ 有错误信息      │          │ 无错误信息      │          │ 连续失败>=2次  │
     │ (使用详细信息)  │          │ (使用通用消息)  │          │ (显示错误)     │
     └───────┬────────┘          └───────┬────────┘          └───────┬────────┘
             │                           │                           │
             ↓                           ↓                           ↓
     ┌────────────────┐          ┌────────────────┐          ┌────────────────┐
     │ 根据类别处理    │          │ 通用重试逻辑    │          │ say("error")   │
     └───────┬────────┘          └───────┬────────┘          └───────┬────────┘
             │                           │                           │
             └───────────────────────────┴───────────────────────────┘
                                         │
                                         ↓
                                 ┌────────────────┐
                                 │ 决定重试或中止  │
                                 └────────────────┘
```

---

## 八、实施步骤

### 第一阶段：基础设施（预计修改3个文件）

1. **创建错误提取器** (`packages/types/src/errors/extractor.ts`)
   - 实现 `extractErrorInfo()` 函数
   - 实现 `formatErrorForDisplay()` 函数
   - 实现 `categorizeError()` 函数
   - 更新 `index.ts` 导出

2. **创建错误格式化器** (`src/core/task/utils/error-formatter.ts`)
   - 实现 `formatForFrontend()` 函数
   - 实现 `formatForLog()` 函数
   - 实现 `formatForAsk()` 函数

3. **增强StreamingResult类型** (`src/core/task/streaming/types.ts`)
   - 添加 `extractedErrorInfo` 字段

### 第二阶段：Streaming层修改（预计修改2个文件）

1. **修改StreamingProcessor** (`src/core/task/streaming/StreamingProcessor.ts`)
   - 在 `buildResult()` 中提取错误信息
   - 确保 `handleError()` 保留原始错误

2. **修改StreamingErrorHandler** (`src/core/task/streaming/StreamingErrorHandler.ts`)
   - 使用错误提取器增强错误消息
   - 确保原始错误正确传递

### 第三阶段：Task层修改（预计修改1个文件）

1. **修改Task核心逻辑** (`src/core/task/Task.ts`)
   - 添加错误处理辅助方法
   - 修改 `processStream()` 结果处理
   - 修改空assistant消息处理
   - 增强 `backoffAndAnnounce()` 方法

### 第四阶段：前端修改（预计修改3个文件）

1. **增强ErrorRow组件** (`webview-ui/src/components/chat/ErrorRow.tsx`)
   - 添加新属性支持
   - 增强显示逻辑

2. **修改ChatRow解析** (`webview-ui/src/components/chat/ChatRow.tsx`)
   - 增强错误消息解析

3. **更新国际化** (`webview-ui/src/i18n/locales/en/chat.json`)
   - 添加新的错误消息翻译

### 第五阶段：测试和验证

1. 单元测试
   - 错误提取器测试
   - 错误格式化器测试
   - StreamingProcessor错误处理测试

2. 集成测试
   - 各种错误场景的端到端测试
   - 前端显示验证

---

## 九、风险和注意事项

### 9.1 向后兼容性

- 保持现有错误消息格式的基本结构
- 新增字段使用可选属性，不影响现有代码
- 前端解析逻辑需要兼容新旧两种格式

### 9.2 性能影响

- 错误提取是轻量级操作，性能影响可忽略
- 避免在正常流程中执行不必要的错误处理逻辑

### 9.3 测试覆盖

- 需要覆盖所有错误类型
- 需要测试边界情况（如错误对象为null）
- 需要测试前端解析各种格式的错误消息

---

## 十、总结

本方案通过以下方式解决Provider错误信息丢失问题：

1. **新增错误提取器**：统一提取各种错误类型的结构化信息
2. **增强StreamingResult**：在结果中携带提取后的错误信息
3. **修改Task层逻辑**：正确处理和传递错误信息
4. **增强前端显示**：向用户展示有意义的错误详情

修改遵循现有架构分层，保持模块职责清晰，最小化对现有代码的侵入。
