# Anthropic SDK 错误处理集成分析报告

## 执行摘要

本报告分析了当前项目如何集成Anthropic SDK来处理LLM API调用错误，并基于Anthropic SDK官方文档的最佳实践提出了改进建议。

**关键发现：**
- 当前实现存在**关键缺陷**：Anthropic Handler中完全缺失错误捕获和处理
- 项目拥有完善的通用错误处理框架（`handleProviderError`），但未在Anthropic Handler中使用
- Anthropic SDK提供了丰富的错误类型和自动重试机制，但未被充分利用

**主要建议：**
1. 在`AnthropicHandler.createMessage()`和`completePrompt()`方法中添加try-catch错误处理
2. 使用`handleProviderError`包装Anthropic SDK错误以保持一致性
3. 利用Anthropic SDK的内置错误类型进行更精细的错误分类
4. 考虑使用SDK的自动重试机制而非完全自定义的重试逻辑

---

## 1. 当前实现分析

### 1.1 Anthropic SDK集成位置

项目在以下文件中集成了Anthropic SDK：

- **主要实现文件**：`src/api/providers/anthropic.ts` (第1-318行)
  - 类：`AnthropicHandler extends BaseProvider`
  - SDK导入：`import { Anthropic } from "@anthropic-ai/sdk"`
  - 关键方法：
    - `createMessage()` (第42-260行)：流式API调用
    - `completePrompt()` (第301-317行)：非流式补全
    - `getModel()` (第262-299行)：获取模型配置

### 1.2 当前错误处理机制

**关键发现：Anthropic Handler中完全没有错误处理！**

#### 1.2.1 createMessage() 方法分析

```typescript
// src/api/providers/anthropic.ts:42-260
async *createMessage(
    systemPrompt: string,
    messages: Anthropic.Messages.MessageParam[],
    metadata?: ApiHandlerCreateMessageMetadata,
): ApiStream {
    let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
    // ... 配置代码 ...

    stream = await this.client.messages.create({
        model: modelId,
        max_tokens: maxTokens ?? 4096,
        temperature,
        system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
        messages: sanitizedMessages.map(...),
        stream: true,
        ...nativeToolParams,
    }, { headers: { "anthropic-beta": betas.join(",") } })

    // ❌ 没有try-catch包装！如果API调用失败，错误会直接向上抛出

    for await (const chunk of stream) {
        // ❌ 流处理过程中没有错误处理！
        // 如果流中断或chunk解析失败，错误会直接向上抛出
        switch (chunk.type) {
            // ... 处理各种chunk类型 ...
        }
    }
}
```

**问题：**
1. SDK调用（`this.client.messages.create()`）没有任何错误捕获
2. 流迭代过程（`for await (const chunk of stream)`）没有错误捕获
3. 如果发生网络错误、认证错误、速率限制等，错误会直接传播到调用者
4. 没有使用项目已有的`handleProviderError`工具

#### 1.2.2 completePrompt() 方法分析

```typescript
// src/api/providers/anthropic.ts:301-317
async completePrompt(prompt: string) {
    let { id: model, temperature } = this.getModel()

    let message

    message = await this.client.messages.create({
        model,
        max_tokens: 4096,
        thinking: undefined,
        temperature,
        messages: [{ role: "user", content: prompt }],
        stream: false,
    })

    // ❌ 同样没有错误处理！

    const content = message.content.find(({ type }) => type === "text")
    return content?.type === "text" ? content.text : ""
}
```

**问题：**
1. 完全没有错误捕获
2. 如果API调用失败，错误会直接传播

### 1.3 项目现有的错误处理框架

项目拥有一个完善的通用错误处理框架，但**未被Anthropic Handler使用**：

#### 1.3.1 handleProviderError 函数

位置：`src/api/providers/utils/error-handler.ts` (第37-106行)

```typescript
export function handleProviderError(
    error: unknown,
    providerName: string,
    options?: {
        messagePrefix?: string
        messageTransformer?: (msg: string) => string
    },
): Error {
    const messagePrefix = options?.messagePrefix || "completion"

    if (error instanceof Error) {
        const anyErr = error as any
        const msg = anyErr?.error?.metadata?.raw || error.message || ""

        // 记录原始错误详情
        console.error(`[${providerName}] API error:`, {
            message: msg,
            name: error.name,
            stack: error.stack,
            status: anyErr.status,
        })

        let wrapped: Error

        // 特殊处理API密钥格式错误
        if (msg.includes("Cannot convert argument to a ByteString")) {
            wrapped = new Error(i18n.t("common:errors.api.invalidKeyInvalidChars"))
        } else {
            const finalMessage = options?.messageTransformer
                ? options.messageTransformer(msg)
                : `${providerName} ${messagePrefix} error: ${msg}`
            wrapped = new Error(finalMessage)
        }

        // 保留HTTP状态码和结构化详情用于重试逻辑
        if (anyErr.status !== undefined) {
            ;(wrapped as any).status = anyErr.status
        }
        if (anyErr.errorDetails !== undefined) {
            ;(wrapped as any).errorDetails = anyErr.errorDetails
        }
        if (anyErr.code !== undefined) {
            ;(wrapped as any).code = anyErr.code
        }
        // 保留AWS特定元数据（用于Bedrock）
        if (anyErr.$metadata !== undefined) {
            ;(wrapped as any).$metadata = anyErr.$metadata
        }

        return wrapped
    }

    // 处理非Error异常
    console.error(`[${providerName}] Non-Error exception:`, error)
    const wrapped = new Error(`${providerName} ${messagePrefix} error: ${String(error)}`)

    const anyErr = error as any
    if (typeof anyErr?.status === "number") {
        ;(wrapped as any).status = anyErr.status
    }

    return wrapped
}
```

**功能：**
- ✅ 保留HTTP状态码（用于UI显示和重试决策）
- ✅ 保留errorDetails（包含RetryInfo等）
- ✅ 保留code字段（错误代码）
- ✅ 支持自定义消息前缀和转换器
- ✅ 特殊处理ByteString转换错误（API密钥格式错误）
- ✅ 记录详细的错误日志

#### 1.3.2 任务级错误处理

位置：`src/core/task/Task.ts` (第3030-3077行)

```typescript
try {
    const result = await processor.processStream(
        stream,
        this.currentRequestAbortController,
        [...this.apiConversationHistory, { role: "user", content: finalUserContent }],
    )
    // 处理成功结果...
} catch (error) {
    // 确定终止原因
    const cancelReason: ClineApiReqCancelReason =
        this.abort ? "user_cancelled" : "streaming_failed"

    // 提取错误消息
    const rawErrorMessage =
        (error instanceof Error ? error.message : undefined) ??
        JSON.stringify(serializeError(error), null, 2)

    const streamingFailedMessage = this.abort
        ? undefined
        : `${t("common:interruption.streamTerminatedByProvider")}: ${rawErrorMessage}`

    // 终止流
    await abortStream(cancelReason, streamingFailedMessage)

    // 如果是用户取消，终止任务
    if (this.abort) {
        this.abortReason = cancelReason
        await this.abortTask()
        break
    }

    // 否则等待退避并重试
    console.error(`[Task#${this.taskId}.${this.instanceId}] Stream failed, will retry: ${streamingFailedMessage}`)

    const stateForBackoff = await this.providerRef.deref()?.getState()
    if (stateForBackoff?.autoApprovalEnabled) {
        const backoffError =
            error instanceof StreamingRetryError && error.rawError
                ? error.rawError
                : error
        await this.backoffAndAnnounce(currentItem.retryAttempt ?? 0, backoffError)

        // 检查是否在退避期间被取消
        if (this.abort) {
            console.log(`[Task#${this.taskId}.${this.instanceId}] Task aborted during mid-stream retry backoff`)
            this.abortReason = "user_cancelled"
            await this.abortTask()
            break
        }
    }

    // 将请求推回重试栈
    stack.push({
        userContent: currentUserContent,
        includeFileDetails: false,
        retryAttempt: (currentItem.retryAttempt ?? 0) + 1,
    })

    continue
}
```

**功能：**
- ✅ 多层错误捕获和处理
- ✅ 智能重试机制（指数退避）
- ✅ 用户取消检测
- ✅ 流中断恢复
- ✅ AbortController集成

#### 1.3.3 流式错误处理器

位置：`src/core/task/streaming/StreamingErrorHandler.ts`

```typescript
handleError(error: unknown): Promise<StreamingResult> {
    // 支持的错误类型：
    // - STREAM_ABORTED
    // - INVALID_STREAM
    // - STATE_ERROR
    // - STREAM_TIMEOUT
    // - TOKEN_ERROR
    // 返回是否应该重试的建议
}
```

**功能：**
- ✅ 流式错误分类
- ✅ 重试建议
- ✅ 资源清理

### 1.4 对比分析：Anthropic vs 其他提供商

#### OpenAI Native Provider

位置：`src/api/providers/openai-native.ts:642-652`

```typescript
try {
    if (!response.body) {
        throw new Error("Responses API error: No response body")
    }

    // Handle streaming response
    yield* this.handleStreamResponse(response.body, model)
} catch (error) {
    if (error instanceof Error) {
        // Re-throw with the original error message if it's already formatted
        if (error.message.includes("Responses API")) {
            throw error
        }
        // Otherwise, wrap it with context
        throw new Error(`Failed to connect to Responses API: ${error.message}`)
    }
    // Handle non-Error objects
    throw new Error(`Unexpected error connecting to Responses API`)
} finally {
    this.abortController = undefined
}
```

**对比：**
- ✅ OpenAI Native有try-catch包装
- ❌ 但没有使用`handleProviderError`
- ❌ 错误消息处理较为简单

**结论：** 即使是其他提供商，错误处理也不够完善。

---

## 2. Anthropic SDK官方文档分析

基于Context7查询的Anthropic SDK TypeScript官方文档，以下是关键发现：

### 2.1 错误类型体系

Anthropic SDK提供了完整的错误类型层次结构：

#### 2.1.1 APIError及其子类

```typescript
// 基类：APIError
class APIError extends Error {
    status: number      // HTTP状态码
    name: string        // 错误类型名称
    headers: object     // HTTP响应头
    message: string     // 错误消息
}

// 子类映射：
400  → BadRequestError
401  → AuthenticationError
403  → PermissionDeniedError
404  → NotFoundError
422  → UnprocessableEntityError
429  → RateLimitError
5xx  → InternalServerError
```

#### 2.1.2 连接错误

```typescript
// 网络连接失败（无HTTP响应）
class APIConnectionError extends Error {
    // 连接失败时抛出
}

// 请求超时
class APIConnectionTimeoutError extends APIConnectionError {
    // 超时时抛出
}
```

### 2.2 错误处理最佳实践

#### 2.2.1 基本错误捕获

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

try {
    const message = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello!' }]
    });
    console.log(message.content[0].text);
} catch (error) {
    if (error instanceof Anthropic.APIError) {
        console.error(`API Error: ${error.status} - ${error.message}`);
        console.error('Request ID:', error.headers?.['request-id']);

        switch (error.status) {
            case 400:
                console.error('Bad Request - Check your parameters');
                break;
            case 401:
                console.error('Authentication failed - Check your API key');
                break;
            case 403:
                console.error('Permission denied');
                break;
            case 404:
                console.error('Resource not found');
                break;
            case 429:
                console.error('Rate limited - Slow down requests');
                break;
            case 500:
            case 502:
            case 503:
                console.error('Server error - Retry later');
                break;
        }
    } else if (error instanceof Anthropic.APIConnectionError) {
        console.error('Network error - Check your connection');
    } else if (error instanceof Anthropic.APIConnectionTimeoutError) {
        console.error('Request timed out');
    } else {
        throw error;
    }
}
```

#### 2.2.2 访问请求ID

```typescript
// 从成功响应中获取请求ID（用于调试和报告问题）
const message = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
});
console.log('Request ID:', message._request_id);
// 输出: req_018EeWyXxfu5pfWkrYcMdjWG
```

### 2.3 重试机制

#### 2.3.1 自动重试

**特性：**
- SDK默认会自动重试某些错误类型
- 默认重试次数：2次
- 重试策略：指数退避
- 可配置：全局或每次请求

**自动重试的错误类型：**
- 连接错误（网络问题）
- 408 Request Timeout
- 409 Conflict
- 429 Rate Limit
- >=500 Internal Server Error

#### 2.3.2 配置重试

```typescript
// 全局配置
const client = new Anthropic({
    maxRetries: 3,  // 默认2次
});

// 每次请求覆盖
await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
}, {
    maxRetries: 5,
});
```

### 2.4 超时配置

#### 2.4.1 默认超时行为

- **默认超时**：10分钟
- **动态超时**：对于非流式请求，如果指定了较大的`max_tokens`值，超时会根据token数量动态计算
  - 最小：10分钟
  - 最大：60分钟
- **超时错误**：`APIConnectionTimeoutError`

#### 2.4.2 配置超时

```typescript
// 全局配置
const client = new Anthropic({
    timeout: 20 * 1000,  // 20秒（默认10分钟）
});

// 每次请求覆盖
await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
}, {
    timeout: 5 * 1000,  // 5秒
});
```

---

## 3. 问题分析

### 3.1 关键问题

#### 问题1：完全缺失错误处理（严重）

**位置：** `src/api/providers/anthropic.ts`

**描述：**
- `createMessage()` 方法中，SDK调用和流处理都没有任何错误捕获
- `completePrompt()` 方法中，SDK调用也没有错误捕获

**影响：**
1. **用户体验差**：错误消息不友好，缺乏上下文信息
2. **调试困难**：错误日志不完整，难以追踪问题根源
3. **重试失效**：虽然上层有重试逻辑，但错误信息不完整可能导致错误的重试决策
4. **元数据丢失**：HTTP状态码、errorDetails等重要信息可能丢失
5. **不一致性**：与其他提供商使用`handleProviderError`不一致

**示例场景：**
```typescript
// 当前代码
stream = await this.client.messages.create({...})

// 如果API返回401错误，错误会直接抛出：
// Anthropic.AuthenticationError {
//   status: 401,
//   name: 'AuthenticationError',
//   message: 'Invalid API key',
//   headers: {...}
// }

// 但这个错误会直接传播到Task.ts的catch块，
// 缺少Anthropic特定的上下文和格式化
```

#### 问题2：未利用SDK错误类型（中等）

**描述：**
- Anthropic SDK提供了丰富的错误类型（`APIError`、`AuthenticationError`、`RateLimitError`等）
- 当前实现没有使用这些类型进行精细的错误分类
- 无法根据错误类型提供更精确的用户提示或重试策略

**影响：**
1. 错误处理不够精细
2. 无法针对特定错误类型提供定制化处理
3. 错误消息可能不够准确

#### 问题3：未利用SDK自动重试（低）

**描述：**
- Anthropic SDK内置了自动重试机制
- 项目自己实现了重试逻辑（在Task.ts中）
- 可能导致双重重试或重试策略不一致

**影响：**
1. 重试逻辑冗余
2. 可能导致不必要的重试延迟
3. 重试行为不一致

#### 问题4：未提取请求ID（低）

**描述：**
- Anthropic SDK支持从响应中提取请求ID（`_request_id`）
- 当前实现没有提取或记录这个ID
- 请求ID对于调试和向Anthropic报告问题非常有用

**影响：**
1. 调试困难
2. 无法向Anthropic支持团队提供准确的请求信息
3. 问题追踪效率低

### 3.2 与最佳实践的差距

| 最佳实践 | 当前实现 | 状态 |
|---------|---------|------|
| 使用try-catch捕获SDK错误 | ❌ 未实现 | 严重 |
| 使用`handleProviderError`包装错误 | ❌ 未实现 | 严重 |
| 识别SDK错误类型（APIError等） | ❌ 未实现 | 中等 |
| 保留HTTP状态码和元数据 | ⚠️ 部分实现（依赖上层） | 中等 |
| 提取请求ID用于调试 | ❌ 未实现 | 低 |
| 利用SDK自动重试 | ❌ 未实现 | 低 |
| 配置合理的超时值 | ⚠️ 使用默认值 | 低 |

### 3.3 根本原因分析

1. **代码遗漏**：可能是在实现Anthropic Handler时遗漏了错误处理
2. **缺乏测试**：错误处理相关的测试可能不足
3. **文档不完善**：可能缺少错误处理实现的指导文档
4. **代码审查不足**：错误处理的缺失在代码审查中未被发现问题

---

## 4. 改进建议

### 4.1 核心改进：添加错误处理

**优先级：** 🔴 高（必须实现）

**目标：** 在`AnthropicHandler`中添加完整的错误处理

#### 4.1.1 修改 createMessage() 方法

```typescript
// src/api/providers/anthropic.ts:42-260
async *createMessage(
    systemPrompt: string,
    messages: Anthropic.Messages.MessageParam[],
    metadata?: ApiHandlerCreateMessageMetadata,
): ApiStream {
    let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
    const cacheControl: CacheControlEphemeral = { type: "ephemeral" }
    let {
        id: modelId,
        betas = ["fine-grained-tool-streaming-2025-05-14"],
        maxTokens,
        temperature,
        reasoning: thinking,
    } = this.getModel()

    // Filter out non-Anthropic blocks (reasoning, thoughtSignature, etc.) before sending to the API
    const sanitizedMessages = filterNonAnthropicBlocks(messages)

    // Add 1M context beta flag if enabled by user configuration
    if (this.options.anthropicBeta1MContext) {
        betas.push("context-1m-2025-08-07")
    }

    const nativeToolParams = {
        tools: convertOpenAIToolsToAnthropic(metadata?.tools ?? []),
        tool_choice: convertOpenAIToolChoiceToAnthropic(metadata?.tool_choice, metadata?.parallelToolCalls),
    }

    // Use prompt caching for all models if enabled
    // Users can control this through their model configuration
    const usePromptCaching = this.getModel().info.supportsPromptCache !== false

    try {
        if (usePromptCaching) {
            betas.push("prompt-caching-2024-07-31")

            /**
             * The latest message will be the new user message, one before
             * will be the assistant message from a previous request, and
             * the user message before that will be a previously cached user
             * message. So we need to mark the latest user message as
             * ephemeral to cache it for the next request, and mark the
             * second to last user message as ephemeral to let the server
             * know the last message to retrieve from the cache for the
             * current request.
             */
            const userMsgIndices = sanitizedMessages.reduce(
                (acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
                [] as number[],
            )

            const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
            const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

            stream = await this.client.messages.create(
                {
                    model: modelId,
                    max_tokens: maxTokens ?? 4096,
                    temperature,
                    thinking,
                    // Setting cache breakpoint for system prompt so new tasks can reuse it.
                    system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
                    messages: sanitizedMessages.map((message, index) => {
                        if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
                            return {
                                ...message,
                                content:
                                    typeof message.content === "string"
                                        ? [{ type: "text", text: message.content, cache_control: cacheControl }]
                                        : message.content.map((content, contentIndex) =>
                                                contentIndex === message.content.length - 1
                                                    ? { ...content, cache_control: cacheControl }
                                                    : content,
                                            ),
                            }
                        }
                        return message
                    }),
                    stream: true,
                    ...nativeToolParams,
                },
                { headers: { "anthropic-beta": betas.join(",") } },
            )
        } else {
            stream = (await this.client.messages.create({
                model: modelId,
                max_tokens: maxTokens ?? 4096,
                temperature,
                system: [{ text: systemPrompt, type: "text" }],
                messages: sanitizedMessages,
                stream: true,
                ...nativeToolParams,
            })) as any
        }

        let inputTokens = 0
        let outputTokens = 0
        let cacheWriteTokens = 0
        let cacheReadTokens = 0
        let requestId: string | undefined

        // ✅ 添加流处理错误捕获
        try {
            for await (const chunk of stream) {
                // ✅ 提取请求ID（从message_start事件）
                if (chunk.type === "message_start" && chunk.message._request_id) {
                    requestId = chunk.message._request_id
                    console.log(`[${this.providerName}] Request ID: ${requestId}`)
                }

                switch (chunk.type) {
                    case "message_start": {
                        // Tells us cache reads/writes/input/output.
                        const {
                            input_tokens = 0,
                            output_tokens = 0,
                            cache_creation_input_tokens,
                            cache_read_input_tokens,
                        } = chunk.message.usage

                        yield {
                            type: "usage",
                            inputTokens: input_tokens,
                            outputTokens: output_tokens,
                            cacheWriteTokens: cache_creation_input_tokens || undefined,
                            cacheReadTokens: cache_read_input_tokens || undefined,
                        }

                        inputTokens += input_tokens
                        outputTokens += output_tokens
                        cacheWriteTokens += cache_creation_input_tokens || 0
                        cacheReadTokens += cache_read_input_tokens || 0

                        break
                    }
                    case "message_delta":
                        // Tells us stop_reason, stop_sequence, and output tokens
                        // along the way and at the end of the message.
                        yield {
                            type: "usage",
                            inputTokens: 0,
                            outputTokens: chunk.usage.output_tokens || 0,
                        }

                        break
                    case "message_stop":
                        // No usage data, just an indicator that the message is done.
                        break
                    case "content_block_start":
                        switch (chunk.content_block.type) {
                            case "thinking":
                                // We may receive multiple text blocks, in which
                                // case just insert a line break between them.
                                if (chunk.index > 0) {
                                    yield { type: "reasoning", text: "\n" }
                                }

                                yield { type: "reasoning", text: chunk.content_block.thinking }
                                break
                            case "text":
                                // We may receive multiple text blocks, in which
                                // case just insert a line break between them.
                                if (chunk.index > 0) {
                                    yield { type: "text", text: "\n" }
                                }

                                yield { type: "text", text: chunk.content_block.text }
                                break
                            case "tool_use": {
                                // Emit initial tool call partial with id and name
                                yield {
                                    type: "tool_call_partial",
                                    index: chunk.index,
                                    id: chunk.content_block.id,
                                    name: chunk.content_block.name,
                                    arguments: undefined,
                                }
                                break
                            }
                        }
                        break
                    case "content_block_delta":
                        switch (chunk.delta.type) {
                            case "thinking_delta":
                                yield { type: "reasoning", text: chunk.delta.thinking }
                                break
                            case "text_delta":
                                yield { type: "text", text: chunk.delta.text }
                                break
                            case "input_json_delta": {
                                // Emit tool call partial chunks as arguments stream in
                                yield {
                                    type: "tool_call_partial",
                                    index: chunk.index,
                                    id: undefined,
                                    name: undefined,
                                    arguments: chunk.delta.partial_json,
                                }
                                break
                            }
                        }

                        break
                    case "content_block_stop":
                        // Block complete - no action needed for now.
                        // NativeToolCallParser handles tool call completion
                        // Note: Signature for multi-turn thinking would require using stream.finalMessage()
                        // after iteration completes, which requires restructuring the streaming approach.
                        break
                }
            }
        } catch (streamError) {
            // ✅ 流处理错误：包装错误并包含请求ID
            const wrappedError = handleProviderError(streamError, this.providerName, {
                messagePrefix: "streaming",
                messageTransformer: (msg) => {
                    // 如果有请求ID，包含在错误消息中
                    return requestId
                        ? `${this.providerName} streaming error (Request ID: ${requestId}): ${msg}`
                        : `${this.providerName} streaming error: ${msg}`
                }
            })
            throw wrappedError
        }

        if (inputTokens > 0 || outputTokens > 0 || cacheWriteTokens > 0 || cacheReadTokens > 0) {
            const { totalCost } = calculateApiCostAnthropic(
                this.getModel().info,
                inputTokens,
                outputTokens,
                cacheWriteTokens,
                cacheReadTokens,
            )

            yield {
                type: "usage",
                inputTokens: 0,
                outputTokens: 0,
                totalCost,
            }
        }
    } catch (error) {
        // ✅ API调用错误：使用handleProviderError包装
        throw handleProviderError(error, this.providerName, {
            messagePrefix: "streaming",
            messageTransformer: (msg) => {
                // 可以根据错误类型提供更友好的消息
                const anyErr = error as any
                if (anyErr instanceof this.client.constructor.APIError) {
                    switch (anyErr.status) {
                        case 401:
                            return `${this.providerName} authentication failed: ${msg}`
                        case 429:
                            return `${this.providerName} rate limit exceeded: ${msg}`
                        case 500:
                        case 502:
                        case 503:
                            return `${this.providerName} server error: ${msg}`
                        default:
                            return `${this.providerName} streaming error: ${msg}`
                    }
                }
                return `${this.providerName} streaming error: ${msg}`
            }
        })
    }
}
```

#### 4.1.2 修改 completePrompt() 方法

```typescript
// src/api/providers/anthropic.ts:301-317
async completePrompt(prompt: string) {
    let { id: model, temperature } = this.getModel()

    let message

    try {
        message = await this.client.messages.create({
            model,
            max_tokens: 4096,
            thinking: undefined,
            temperature,
            messages: [{ role: "user", content: prompt }],
            stream: false,
        })
    } catch (error) {
        // ✅ 使用handleProviderError包装错误
        throw handleProviderError(error, this.providerName, {
            messagePrefix: "completion",
            messageTransformer: (msg) => {
                const anyErr = error as any
                if (anyErr instanceof this.client.constructor.APIError) {
                    switch (anyErr.status) {
                        case 401:
                            return `${this.providerName} authentication failed: ${msg}`
                        case 429:
                            return `${this.providerName} rate limit exceeded: ${msg}`
                        case 500:
                        case 502:
                        case 503:
                            return `${this.providerName} server error: ${msg}`
                        default:
                            return `${this.providerName} completion error: ${msg}`
                    }
                }
                return `${this.providerName} completion error: ${msg}`
            }
        })
    }

    // ✅ 提取请求ID
    if (message._request_id) {
        console.log(`[${this.providerName}] Request ID: ${message._request_id}`)
    }

    const content = message.content.find(({ type }) => type === "text")
    return content?.type === "text" ? content.text : ""
}
```

### 4.2 增强改进：利用SDK错误类型

**优先级：** 🟡 中（建议实现）

**目标：** 使用Anthropic SDK的错误类型进行更精细的错误分类

#### 4.2.1 创建Anthropic专用错误处理器

```typescript
// src/api/providers/utils/anthropic-error-handler.ts
import { Anthropic } from "@anthropic-ai/sdk"
import { handleProviderError } from "./error-handler"

/**
 * Anthropic专用错误处理器
 * 利用SDK的错误类型提供更精细的错误分类和消息
 */
export function handleAnthropicError(
    error: unknown,
    providerName: string = "Anthropic",
    options?: {
        messagePrefix?: string
        requestId?: string
    },
): Error {
    const messagePrefix = options?.messagePrefix || "completion"
    const requestId = options?.requestId

    // 使用SDK错误类型进行精细分类
    if (error instanceof Anthropic.APIError) {
        console.error(`[${providerName}] API Error (${error.name}):`, {
            status: error.status,
            message: error.message,
            headers: error.headers,
            requestId: error.headers?.['request-id'] || requestId,
        })

        // 根据错误类型提供定制化的错误消息
        let customMessage: string

        switch (error.status) {
            case 400:
                customMessage = `${providerName} bad request: ${error.message}`
                break
            case 401:
                customMessage = `${providerName} authentication failed: ${error.message}. Please check your API key.`
                break
            case 403:
                customMessage = `${providerName} permission denied: ${error.message}`
                break
            case 404:
                customMessage = `${providerName} resource not found: ${error.message}`
                break
            case 422:
                customMessage = `${providerName} unprocessable entity: ${error.message}`
                break
            case 429:
                customMessage = `${providerName} rate limit exceeded: ${error.message}. Please slow down your requests.`
                break
            case 500:
            case 502:
            case 503:
                customMessage = `${providerName} server error (${error.status}): ${error.message}. Please try again later.`
                break
            default:
                customMessage = `${providerName} ${messagePrefix} error: ${error.message}`
        }

        // 如果有请求ID，包含在消息中
        if (requestId || error.headers?.['request-id']) {
            const id = requestId || error.headers?.['request-id']
            customMessage += ` (Request ID: ${id})`
        }

        // 使用handleProviderError保留元数据
        return handleProviderError(error, providerName, {
            messagePrefix,
            messageTransformer: () => customMessage,
        })
    }

    if (error instanceof Anthropic.APIConnectionError) {
        console.error(`[${providerName}] Connection Error:`, error.message)

        const customMessage = requestId
            ? `${providerName} connection error (Request ID: ${requestId}): ${error.message}. Please check your network connection.`
            : `${providerName} connection error: ${error.message}. Please check your network connection.`

        return handleProviderError(error, providerName, {
            messagePrefix,
            messageTransformer: () => customMessage,
        })
    }

    if (error instanceof Anthropic.APIConnectionTimeoutError) {
        console.error(`[${providerName}] Timeout Error:`, error.message)

        const customMessage = requestId
            ? `${providerName} request timeout (Request ID: ${requestId}): ${error.message}. Please try again or increase the timeout.`
            : `${providerName} request timeout: ${error.message}. Please try again or increase the timeout.`

        return handleProviderError(error, providerName, {
            messagePrefix,
            messageTransformer: () => customMessage,
        })
    }

    // 对于其他错误类型，使用默认处理
    return handleProviderError(error, providerName, {
        messagePrefix,
        messageTransformer: requestId
            ? (msg) => `${providerName} ${messagePrefix} error (Request ID: ${requestId}): ${msg}`
            : undefined,
    })
}
```

#### 4.2.2 在Anthropic Handler中使用专用处理器

```typescript
// src/api/providers/anthropic.ts
import { handleAnthropicError } from "./utils/anthropic-error-handler"

export class AnthropicHandler extends BaseProvider implements SingleCompletionHandler {
    // ...

    async *createMessage(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[],
        metadata?: ApiHandlerCreateMessageMetadata,
    ): ApiStream {
        let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
        let requestId: string | undefined

        try {
            // ... 创建stream ...

            try {
                for await (const chunk of stream) {
                    if (chunk.type === "message_start" && chunk.message._request_id) {
                        requestId = chunk.message._request_id
                    }
                    // ... 处理chunk ...
                }
            } catch (streamError) {
                // ✅ 使用专用错误处理器
                throw handleAnthropicError(streamError, this.providerName, {
                    messagePrefix: "streaming",
                    requestId,
                })
            }

            // ...
        } catch (error) {
            // ✅ 使用专用错误处理器
            throw handleAnthropicError(error, this.providerName, {
                messagePrefix: "streaming",
                requestId,
            })
        }
    }

    async completePrompt(prompt: string) {
        let message

        try {
            message = await this.client.messages.create({
                // ...
            })
        } catch (error) {
            // ✅ 使用专用错误处理器
            throw handleAnthropicError(error, this.providerName, {
                messagePrefix: "completion",
            })
        }

        // ...
    }
}
```

### 4.3 优化改进：配置SDK选项

**优先级：** 🟢 低（可选实现）

**目标：** 合理配置Anthropic SDK的重试和超时选项

#### 4.3.1 配置客户端初始化

```typescript
// src/api/providers/anthropic.ts:29-40
constructor(options: ApiHandlerOptions) {
    super()
    this.options = options

    const apiKeyFieldName =
        this.options.anthropicBaseUrl && this.options.anthropicUseAuthToken ? "authToken" : "apiKey"

    this.client = new Anthropic({
        baseURL: this.options.anthropicBaseUrl || undefined,
        [apiKeyFieldName]: this.options.apiKey,

        // ✅ 配置重试选项
        maxRetries: 2,  // 使用默认值，与SDK保持一致

        // ✅ 配置超时选项
        timeout: 10 * 60 * 1000,  // 10分钟默认超时
    })
}
```

**说明：**
- 使用SDK的默认重试机制（2次）
- 使用SDK的默认超时机制（10分钟，动态调整）
- 这样可以避免与项目的重试逻辑冲突

### 4.4 测试改进

**优先级：** 🟡 中（建议实现）

**目标：** 添加错误处理的测试用例

#### 4.4.1 创建Anthropic错误处理器测试

```typescript
// src/api/providers/utils/__tests__/anthropic-error-handler.spec.ts
import { Anthropic } from "@anthropic-ai/sdk"
import { handleAnthropicError } from "../anthropic-error-handler"

describe("handleAnthropicError", () => {
    const providerName = "Anthropic"

    it("should handle AuthenticationError correctly", () => {
        const error = new Anthropic.AuthenticationError({
            message: "Invalid API key",
            status: 401,
            headers: {},
        })

        const result = handleAnthropicError(error, providerName)

        expect(result).toBeInstanceOf(Error)
        expect((result as any).status).toBe(401)
        expect(result.message).toContain("authentication failed")
        expect(result.message).toContain("API key")
    })

    it("should handle RateLimitError correctly", () => {
        const error = new Anthropic.RateLimitError({
            message: "Rate limit exceeded",
            status: 429,
            headers: {},
        })

        const result = handleAnthropicError(error, providerName)

        expect(result).toBeInstanceOf(Error)
        expect((result as any).status).toBe(429)
        expect(result.message).toContain("rate limit exceeded")
        expect(result.message).toContain("slow down")
    })

    it("should include request ID in error message", () => {
        const error = new Anthropic.APIError({
            message: "Server error",
            status: 500,
            headers: { "request-id": "req_123456" },
        })

        const result = handleAnthropicError(error, providerName)

        expect(result.message).toContain("req_123456")
    })

    it("should handle APIConnectionError correctly", () => {
        const error = new Anthropic.APIConnectionError({
            message: "Network error",
        })

        const result = handleAnthropicError(error, providerName)

        expect(result).toBeInstanceOf(Error)
        expect(result.message).toContain("connection error")
        expect(result.message).toContain("network connection")
    })

    it("should handle APIConnectionTimeoutError correctly", () => {
        const error = new Anthropic.APIConnectionTimeoutError({
            message: "Request timeout",
        })

        const result = handleAnthropicError(error, providerName)

        expect(result).toBeInstanceOf(Error)
        expect(result.message).toContain("timeout")
    })
})
```

---

## 5. 实施计划

### 5.1 实施步骤

#### 阶段1：核心错误处理（必须）

1. **修改 `src/api/providers/anthropic.ts`**
   - 在`createMessage()`方法中添加try-catch
   - 在`completePrompt()`方法中添加try-catch
   - 使用`handleProviderError`包装错误
   - 提取并记录请求ID

2. **测试**
   - 测试各种错误场景（401、429、500等）
   - 验证错误消息格式
   - 验证元数据保留

#### 阶段2：增强错误处理（建议）

1. **创建 `src/api/providers/utils/anthropic-error-handler.ts`**
   - 实现Anthropic专用错误处理器
   - 使用SDK错误类型进行精细分类
   - 提供定制化的错误消息

2. **修改 `src/api/providers/anthropic.ts`**
   - 使用`handleAnthropicError`替代`handleProviderError`

3. **测试**
   - 添加单元测试
   - 验证各种错误类型的处理

#### 阶段3：优化和文档（可选）

1. **配置SDK选项**
   - 配置maxRetries
   - 配置timeout

2. **更新文档**
   - 更新API使用文档
   - 添加错误处理最佳实践

3. **代码审查**
   - 确保代码质量
   - 确保与其他提供商的一致性

### 5.2 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 破坏现有功能 | 高 | 低 | 充分测试，保持向后兼容 |
| 错误消息不友好 | 中 | 低 | 使用i18n，提供清晰的错误消息 |
| 重试冲突 | 低 | 低 | 使用SDK默认重试，避免冲突 |
| 性能影响 | 低 | 低 | 错误处理开销很小 |

### 5.3 回滚计划

如果实施后出现问题，可以快速回滚：

1. 保留原始代码的备份
2. 使用git进行版本控制
3. 如果出现问题，快速回滚到上一个稳定版本

---

## 6. 预期效果

### 6.1 用户体验改进

**改进前：**
```
Error: Invalid API key
```

**改进后：**
```
Anthropic authentication failed: Invalid API key. Please check your API key.
```

### 6.2 调试效率改进

**改进前：**
```
Error: 429 Rate limit exceeded
```

**改进后：**
```
[Anthropic] API Error (RateLimitError): {
  status: 429,
  message: "Rate limit exceeded",
  headers: {...},
  requestId: "req_018EeWyXxfu5pfWkrYcMdjWG"
}
Anthropic rate limit exceeded: Rate limit exceeded. Please slow down your requests. (Request ID: req_018EeWyXxfu5pfWkrYcMdjWG)
```

### 6.3 错误恢复改进

**改进前：**
- 错误信息不完整，可能导致错误的重试决策
- 缺少HTTP状态码等元数据

**改进后：**
- 完整的错误元数据（status、errorDetails、code）
- 更准确的重试决策
- 更好的错误恢复

---

## 7. 总结

### 7.1 关键发现

1. **严重问题**：Anthropic Handler完全缺失错误处理
2. **现有资源**：项目拥有完善的错误处理框架，但未被使用
3. **SDK特性**：Anthropic SDK提供了丰富的错误类型和自动重试机制
4. **改进空间**：可以通过添加错误处理显著提升用户体验和调试效率

### 7.2 主要建议

1. **立即实施**：在`AnthropicHandler`中添加try-catch错误处理
2. **使用现有工具**：使用`handleProviderError`包装错误
3. **增强处理**：创建Anthropic专用错误处理器，利用SDK错误类型
4. **提取元数据**：提取请求ID等元数据用于调试
5. **配置SDK**：合理配置SDK的重试和超时选项

### 7.3 预期收益

- ✅ 更好的用户体验（友好的错误消息）
- ✅ 更高的调试效率（完整的错误信息）
- ✅ 更准确的错误恢复（保留元数据）
- ✅ 更一致的错误处理（与其他提供商保持一致）
- ✅ 更好的可维护性（清晰的错误处理逻辑）

---

## 附录A：相关文件清单

### A.1 核心文件

- `src/api/providers/anthropic.ts` - Anthropic Handler实现
- `src/api/providers/utils/error-handler.ts` - 通用错误处理器
- `src/core/task/Task.ts` - 任务级错误处理
- `src/core/task/streaming/StreamingErrorHandler.ts` - 流式错误处理器

### A.2 测试文件

- `src/api/providers/utils/__tests__/error-handler.spec.ts` - 错误处理器测试

### A.3 类型定义

- `src/shared/api.ts` - API配置类型定义
- `src/api/index.ts` - API处理器工厂

### A.4 文档

- 本文档：`docs/analysis/anthropic-sdk-error-handling-analysis.md`

---

## 附录B：参考资料

### B.1 Anthropic SDK文档

- [Anthropic SDK TypeScript - GitHub](https://github.com/anthropics/anthropic-sdk-typescript)
- [Anthropic API Documentation](https://docs.anthropic.com/)

### B.2 项目文档

- 项目README
- API使用文档
- 错误处理最佳实践

### B.3 相关Issue

（如有相关的GitHub Issue，在此列出）

---

**文档版本：** 1.0
**创建日期：** 2026-02-27
**作者：** CodeArts代码智能体
**最后更新：** 2026-02-27
