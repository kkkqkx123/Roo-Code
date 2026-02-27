# Provider错误与Task错误处理集成问题分析

## 问题概述

当前项目中，供应商（Provider）错误与Task层的错误处理集成存在严重问题。当API请求失败时，前端显示的错误消息几乎毫无意义，例如：

```
Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.
```

这个错误消息完全没有包含供应商返回的原始错误信息（如HTTP状态码、错误详情、请求ID等），导致问题完全不可调试。

## 问题根因分析

### 1. 错误信息丢失的关键位置

#### 1.1 StreamingResult.error字段被完全忽略

**位置**: `src/core/task/Task.ts:2950-3004`

```typescript
const result = await processor.processStream(
    stream,
    this.currentRequestAbortController,
    [
        ...this.apiConversationHistory,
        { role: "user", content: finalUserContent },
    ],
)

// 以下字段被使用
assistantMessage = result.assistantMessage
reasoningMessage = result.reasoningMessage
this.assistantMessageContent = result.assistantMessageContent
this.didRejectTool = result.didRejectTool

// 但是 result.error 字段完全没有被使用！
// result.error 包含了详细的错误信息，但被忽略了
```

`StreamingResult` 接口定义了 `error` 字段：

```typescript
// src/core/task/streaming/types.ts:77-89
export interface StreamingResult {
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
    error: StreamingErrorType | null  // <-- 这个字段被忽略
}
```

#### 1.2 空assistant消息判断逻辑丢失错误上下文

**位置**: `src/core/task/Task.ts:3136-3230`

当 `hasTextContent` 和 `hasToolUses` 都为 `false` 时，代码进入"无assistant消息"处理分支：

```typescript
} else {
    // If there's no assistant_responses, that means we got no text
    // or tool_use content blocks from API which we should assume is
    // an error.

    // Increment consecutive no-assistant-messages counter
    this.consecutiveNoAssistantMessagesCount++

    // ...

    if (state?.autoApprovalEnabled) {
        // 创建了一个全新的Error对象，完全丢失了原始错误信息
        await this.backoffAndAnnounce(
            currentItem.retryAttempt ?? 0,
            new Error(
                "Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
            ),
        )
    }
}
```

**问题**：这里创建了一个全新的 `Error` 对象，完全丢弃了 `result.error` 中可能包含的详细错误信息。

### 2. 错误处理流程分析

#### 2.1 正常的错误传递路径（设计预期）

```
Provider API Error
    ↓
handleAnthropicError() / handleOpenAiNativeError()
    ↓ 转换为 ApiProviderError (包含status, message, requestId等)
    ↓
StreamingErrorHandler.handleError()
    ↓ 包装为 StreamingErrorType
    ↓
StreamingProcessor.handleError()
    ↓ 返回 StreamingResult { error: StreamingErrorType }
    ↓
Task.processStream() [应该检查result.error]
    ↓ [应该传递给前端显示]
```

#### 2.2 实际的错误处理路径（当前实现）

```
Provider API Error
    ↓
handleAnthropicError() → ApiProviderError
    ↓
StreamingErrorHandler.handleError()
    ↓
StreamingProcessor.handleError()
    ↓ 返回 StreamingResult { error: StreamingErrorType }
    ↓
Task.processStream() [result.error被忽略！]
    ↓
检查 hasTextContent || hasToolUses
    ↓ 如果都为false
创建新的通用Error消息 [原始错误信息丢失]
    ↓
前端显示无意义的错误消息
```

### 3. 具体问题场景

#### 场景1: 工具调用格式错误导致API返回400

1. LLM生成了格式错误的工具调用
2. Provider返回400错误，包含详细错误信息
3. `StreamingProcessor` 捕获错误，设置 `result.error`
4. `Task` 忽略 `result.error`
5. 由于没有assistant消息，创建通用错误消息
6. 前端显示："Unexpected API Response..."

#### 场景2: 上下文窗口超限

1. 请求超出上下文窗口限制
2. Provider返回400错误，包含token使用信息
3. 错误信息被忽略
4. 前端显示通用错误消息

#### 场景3: 认证失败

1. API Key无效
2. Provider返回401错误
3. 错误信息被忽略
4. 用户无法知道是认证问题

### 4. 代码层面的问题

#### 4.1 Task.ts中的错误处理逻辑

```typescript
// src/core/task/Task.ts:2979-2986
if (this.abort || this.abandoned || result.aborted) {
    const cancelReason: ClineApiReqCancelReason =
        this.abort || result.abortReason === "user_cancelled" ? "user_cancelled" : "streaming_failed"
    this.abortReason = cancelReason
    await abortStream(cancelReason)
    await this.abortTask()
    break
}
```

这里只检查了 `result.aborted`，但没有检查 `result.error`。

#### 4.2 catch块中的错误处理

```typescript
// src/core/task/Task.ts:3016-3063
} catch (error) {
    if (!this.abandoned) {
        const cancelReason: ClineApiReqCancelReason = this.abort ? "user_cancelled" : "streaming_failed"

        const rawErrorMessage =
            (error instanceof Error ? error.message : undefined) ?? JSON.stringify(serializeError(error), null, 2)
        const streamingFailedMessage = this.abort
            ? undefined
            : `${t("common:interruption.streamTerminatedByProvider")}: ${rawErrorMessage}`

        await abortStream(cancelReason, streamingFailedMessage)
        // ...
    }
}
```

这个catch块只能捕获 `processStream` 抛出的异常，但如果 `processStream` 正常返回（只是 `result.error` 不为null），错误信息就会丢失。

## 修改方案

### 方案1: 在Task层检查并处理result.error

**修改位置**: `src/core/task/Task.ts:2979` 附近

```typescript
// 在检查 result.aborted 之前，先检查 result.error
if (result.error) {
    // 提取错误信息
    const errorMessage = this.extractErrorMessage(result.error)

    // 根据错误类型决定处理方式
    if (result.error instanceof AuthenticationError) {
        await this.say("error", `Authentication failed: ${errorMessage}`)
        await this.abortTask()
        break
    }

    if (result.error instanceof RateLimitError) {
        // 使用错误中的retryAfter信息
        await this.backoffAndAnnounce(
            currentItem.retryAttempt ?? 0,
            result.error,
            result.error.retryAfter
        )
        // 重试逻辑...
        continue
    }

    // 其他错误类型...
}

// 然后检查 aborted
if (this.abort || this.abandoned || result.aborted) {
    // ...
}
```

### 方案2: 修改空assistant消息的处理逻辑

**修改位置**: `src/core/task/Task.ts:3136-3230`

```typescript
} else {
    // 无assistant消息时，优先使用result.error中的信息
    this.consecutiveNoAssistantMessagesCount++

    if (this.consecutiveNoAssistantMessagesCount >= 2) {
        // 使用更详细的错误消息
        const errorDetail = result.error
            ? this.formatErrorForDisplay(result.error)
            : "MODEL_NO_ASSISTANT_MESSAGES"
        await this.say("error", errorDetail)
    }

    // ...

    if (state?.autoApprovalEnabled) {
        // 使用原始错误而不是创建新错误
        const errorToReport = result.error || new Error(
            "Unexpected API Response: The language model did not provide any assistant messages."
        )
        await this.backoffAndAnnounce(
            currentItem.retryAttempt ?? 0,
            errorToReport,
        )
    }
}
```

### 方案3: 增强StreamingResult的错误信息

**修改位置**: `src/core/task/streaming/types.ts`

```typescript
export interface StreamingResult {
    // ... 现有字段

    // 增强error字段
    error: StreamingErrorType | null

    // 新增：原始API错误（如果有）
    apiError?: {
        status?: number
        code?: string
        message: string
        requestId?: string
        providerName?: string
    }
}
```

### 方案4: 添加错误信息提取工具函数

**新增文件**: `src/core/task/utils/error-extractor.ts`

```typescript
import {
    ApiProviderError,
    AuthenticationError,
    RateLimitError,
    ServerError,
    ConnectionError,
    isApiProviderError,
} from "@coder/types"
import type { StreamingErrorType } from "@coder/types"

export interface ExtractedErrorInfo {
    type: string
    status?: number
    message: string
    requestId?: string
    providerName?: string
    retryAfter?: number
    isRetryable: boolean
}

export function extractErrorInfo(error: StreamingErrorType | Error | unknown): ExtractedErrorInfo {
    if (isApiProviderError(error)) {
        return {
            type: error.constructor.name,
            status: error.status,
            message: error.message,
            requestId: error.requestId,
            providerName: error.providerName,
            retryAfter: error instanceof RateLimitError ? error.retryAfter : undefined,
            isRetryable: isRetryableError(error),
        }
    }

    if (error instanceof Error) {
        return {
            type: error.constructor.name,
            message: error.message,
            isRetryable: false,
        }
    }

    return {
        type: "UnknownError",
        message: String(error),
        isRetryable: false,
    }
}

export function formatErrorForDisplay(error: StreamingErrorType | Error | unknown): string {
    const info = extractErrorInfo(error)

    let message = info.message

    if (info.status) {
        message = `[${info.status}] ${message}`
    }

    if (info.requestId) {
        message = `${message} (Request ID: ${info.requestId})`
    }

    if (info.providerName) {
        message = `[${info.providerName}] ${message}`
    }

    return message
}
```

## 推荐实施步骤

### 第一阶段：快速修复

1. **修改Task.ts**：在处理 `StreamingResult` 时检查 `result.error`
2. **修改空assistant消息处理**：使用 `result.error` 而非创建新错误

### 第二阶段：增强错误显示

1. **添加错误提取工具函数**
2. **增强前端ErrorRow组件**：显示更多错误详情
3. **添加错误详情展开/折叠功能**

### 第三阶段：完善错误处理

1. **为不同错误类型添加特定处理逻辑**
2. **添加错误日志记录**
3. **添加错误遥测**

## 影响范围

### 需要修改的文件

1. `src/core/task/Task.ts` - 主要修改点
2. `src/core/task/streaming/types.ts` - 可能需要增强
3. `webview-ui/src/components/chat/ErrorRow.tsx` - 前端显示增强
4. `webview-ui/src/i18n/locales/en/chat.json` - 错误消息国际化

### 测试要点

1. 认证错误（401）是否正确显示
2. 限流错误（429）是否显示retryAfter信息
3. 服务器错误（5xx）是否正确处理
4. 工具调用格式错误是否显示详细错误
5. 上下文窗口超限是否显示token信息

## 总结

当前问题的核心在于：

1. **StreamingResult.error字段被完全忽略**
2. **空assistant消息处理时创建新错误，丢失原始信息**
3. **错误处理逻辑没有区分不同类型的错误**

修复这些问题后，用户将能够看到有意义的错误消息，大大提高问题诊断效率。
