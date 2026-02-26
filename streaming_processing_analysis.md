# Task.ts 流式处理功能完整分析文档

## 文档概述

本文档详细分析了 `src/core/task/Task.ts` 文件中所有与流式处理相关的功能，包括完整的处理逻辑、状态管理、错误处理和核心流程。

---

## 目录

1. [流式处理核心状态](#1-流式处理核心状态)
2. [流式处理初始化](#2-流式处理初始化)
3. [流式数据处理循环](#3-流式数据处理循环)
4. [各类数据块处理](#4-各类数据块处理)
5. [工具调用流式处理](#5-工具调用流式处理)
6. [令牌计数与成本计算](#6-令牌计数与成本计算)
7. [流式中断与错误处理](#7-流式中断与错误处理)
8. [流式完成与清理](#8-流式完成与清理)
9. [关键流程图](#9-关键流程图)

---

## 1. 流式处理核心状态

### 1.1 流式状态变量

```typescript
// 流式控制标志
isWaitingForFirstChunk = false      // 等待首个数据块标志
isStreaming = false                  // 流式处理进行中标志
currentStreamingContentIndex = 0     // 当前流式内容索引
currentStreamingDidCheckpoint = false // 当前流式是否已创建检查点
didCompleteReadingStream = false     // 是否完成流读取

// 消息内容存储
assistantMessageContent: AssistantMessageContent[] = []  // 助手消息内容
userMessageContent: Anthropic.Messages.ContentBlockParam[] = [] // 用户消息内容
userMessageContentReady = false      // 用户消息内容是否就绪

// 工具调用状态
presentAssistantMessageLocked = false // 是否锁定助手消息展示
presentAssistantMessageHasPendingUpdates = false // 是否有待处理的更新
didRejectTool = false                // 是否拒绝工具
didAlreadyUseTool = false            // 是否已使用工具
didToolFailInCurrentTurn = false     // 当前轮次工具是否失败

// 历史保存状态
assistantMessageSavedToHistory = false // 助手消息是否已保存到历史

// 工具调用索引追踪
private streamingToolCallIndices: Map<string, number> = new Map()

// 缓存的流式模型信息
cachedStreamingModel?: { id: string; info: ModelInfo }

// 中断控制器
currentRequestAbortController?: AbortController
```

### 1.2 流式状态的生命周期

| 状态变量 | 初始化时机 | 重置时机 | 用途 |
|---------|-----------|---------|------|
| `isStreaming` | 开始API请求时设置为true | finally块中设置为false | 标记流式处理是否正在进行 |
| `assistantMessageContent` | 每次API请求开始时清空 | 每次API请求开始时清空 | 存储当前流式响应的助手消息内容 |
| `userMessageContent` | 每次API请求开始时清空 | 工具执行后填充 | 存储工具执行结果，用于构建用户消息 |
| `assistantMessageSavedToHistory` | 初始化为false | 助手消息保存后设置为true | 确保工具调用前助手消息已保存 |
| `streamingToolCallIndices` | 初始化为空Map | 工具调用完成后删除条目 | 追踪每个工具调用在assistantMessageContent中的位置 |

---

## 2. 流式处理初始化

### 2.1 流式状态重置流程

**位置**: `recursivelyMakeClineRequests` 方法，第2715-2737行

```typescript
// 重置流式状态，确保每次API请求都有干净的状态
this.currentStreamingContentIndex = 0
this.currentStreamingDidCheckpoint = false
this.assistantMessageContent = []
this.didCompleteReadingStream = false
this.userMessageContent = []
this.userMessageContentReady = false
this.didRejectTool = false
this.didAlreadyUseTool = false
this.assistantMessageSavedToHistory = false
this.didToolFailInCurrentTurn = false
this.presentAssistantMessageLocked = false
this.presentAssistantMessageHasPendingUpdates = false
this.streamingToolCallIndices.clear()

// 清理NativeToolCallParser的流式状态
NativeToolCallParser.clearAllStreamingToolCalls()
NativeToolCallParser.clearRawChunkState()
```

### 2.2 模型信息缓存

**位置**: 第2739-2743行

```typescript
// 缓存模型信息，避免流式处理期间重复调用
this.cachedStreamingModel = this.api.getModel()
const streamModelInfo = this.cachedStreamingModel.info
const cachedModelId = this.cachedStreamingModel.id
```

**目的**:
- 避免在工具执行和后台令牌收集期间频繁调用 `getModel()`
- 确保成本计算使用一致的模型信息
- 提高性能，减少API调用

### 2.3 中断控制器设置

**位置**: 第2748行

```typescript
const stream = this.attemptApiRequest(currentItem.retryAttempt ?? 0, { skipProviderRateLimit: true })
this.isStreaming = true
```

**后续使用**: 第2766-2786行

```typescript
const nextChunkWithAbort = async () => {
    const nextPromise = iterator.next()

    if (this.currentRequestAbortController) {
        const abortPromise = new Promise<never>((_, reject) => {
            const signal = this.currentRequestAbortController!.signal
            if (signal.aborted) {
                reject(new Error("Request cancelled by user"))
            } else {
                signal.addEventListener("abort", () => {
                    reject(new Error("Request cancelled by user"))
                })
            }
        })
        return await Promise.race([nextPromise, abortPromise])
    }
    return await nextPromise
}
```

---

## 3. 流式数据处理循环

### 3.1 主循环结构

**位置**: 第2763-3076行

```typescript
try {
    const iterator = stream[Symbol.asyncIterator]()
    let item = await nextChunkWithAbort()

    while (!item.done) {
        const chunk = item.value
        item = await nextChunkWithAbort()

        if (!chunk) {
            continue
        }

        switch (chunk.type) {
            case "reasoning":
                // 处理推理消息
                break
            case "usage":
                // 处理令牌使用信息
                break
            case "grounding":
                // 处理引用来源
                break
            case "tool_call_partial":
                // 处理部分工具调用
                break
            case "tool_call":
                // 处理完整工具调用
                break
            case "text":
                // 处理文本内容
                break
        }

        // 检查中断条件
        if (this.abort) {
            await abortStream("user_cancelled")
            break
        }

        if (this.didRejectTool) {
            break
        }

        if (this.didAlreadyUseTool) {
            break
        }
    }
} catch (error) {
    // 错误处理
} finally {
    this.isStreaming = false
    this.currentRequestAbortController = undefined
}
```

### 3.2 循环中断条件

| 条件 | 触发时机 | 处理方式 |
|-----|---------|---------|
| `item.done` | 流式数据结束 | 退出循环，进入完成处理 |
| `this.abort` | 用户取消任务 | 调用 `abortStream`，退出循环 |
| `this.didRejectTool` | 用户拒绝工具 | 中断流式，等待用户反馈 |
| `this.didAlreadyUseTool` | 已使用工具 | 中断流式，处理工具结果 |
| 错误异常 | 流式处理失败 | 捕获异常，决定重试或终止 |

---

## 4. 各类数据块处理

### 4.1 reasoning 数据块

**位置**: 第2799-2836行

```typescript
case "reasoning": {
    reasoningMessage += chunk.text
    tokenCounter.addReasoning(chunk.text)

    // 格式化推理消息：在句子结束后的标题前添加换行
    let formattedReasoning = reasoningMessage
    if (reasoningMessage.includes("**")) {
        formattedReasoning = reasoningMessage.replace(
            /([.!?])\*\*([^*\n]+)\*\*/g,
            "$1\n\n**$2**",
        )
    }

    // 死循环检测
    const detectionResult = deadLoopDetector.detect(reasoningMessage)
    if (detectionResult.detected) {
        const deadLoopErrorMessage = `检测到死循环：${detectionResult.details}。任务已终止，请尝试重新描述任务或调整提示词。`
        await this.say("error", deadLoopErrorMessage)
        await abortStream("streaming_failed", deadLoopErrorMessage)
        this.abort = true
        this.abortReason = "streaming_failed"
        await this.abortTask()
        break
    }

    await this.say("reasoning", formattedReasoning, undefined, true)
    break
}
```

**处理要点**:
1. 累积推理文本
2. 使用 `tokenCounter` 累积令牌计数
3. 格式化推理消息，改善可读性
4. 死循环检测（使用严格阈值）
5. 检测到死循环时立即终止任务

### 4.2 usage 数据块

**位置**: 第2838-2848行

```typescript
case "usage":
    inputTokens += chunk.inputTokens
    outputTokens += chunk.outputTokens
    cacheWriteTokens += chunk.cacheWriteTokens ?? 0
    cacheReadTokens += chunk.cacheReadTokens ?? 0
    totalCost = chunk.totalCost
    // 只有当outputTokens > 0时，才认为API提供了有效的使用数据
    hasApiUsageData = chunk.outputTokens > 0
    break
```

**处理要点**:
1. 累积所有令牌类型
2. 设置 `hasApiUsageData` 标志，用于后续判断是否需要使用tiktoken回退
3. 处理缓存令牌的可选值

### 4.3 grounding 数据块

**位置**: 第2849-2855行

```typescript
case "grounding":
    // 单独存储引用来源，避免状态持久化问题
    if (chunk.sources && chunk.sources.length > 0) {
        pendingGroundingSources.push(...chunk.sources)
    }
    break
```

**处理要点**:
1. 引用来源存储在 `pendingGroundingSources` 数组中
2. 在流式完成后统一展示给用户（第3502-3509行）
3. 避免与主内容混合，防止状态问题

### 4.4 text 数据块

**位置**: 第3023-3043行

```typescript
case "text": {
    assistantMessage += chunk.text
    tokenCounter.addText(chunk.text)

    // 原生工具调用：文本块是纯文本
    const lastBlock = this.assistantMessageContent[this.assistantMessageContent.length - 1]
    if (lastBlock?.type === "text" && lastBlock.partial) {
        lastBlock.content = assistantMessage
    } else {
        this.assistantMessageContent.push({
            type: "text",
            content: assistantMessage,
            partial: true,
        })
        this.userMessageContentReady = false
    }
    presentAssistantMessage(this)
    break
}
```

**处理要点**:
1. 累积文本内容到 `assistantMessage`
2. 使用 `tokenCounter` 累积令牌计数
3. 创建或更新文本内容块
4. 标记为 `partial: true`，表示流式进行中
5. 调用 `presentAssistantMessage` 展示内容

---

## 5. 工具调用流式处理

### 5.1 tool_call_partial 数据块

**位置**: 第2856-2991行

#### 5.1.1 tool_call_start 事件

```typescript
if (event.type === "tool_call_start") {
    // 防止重复的工具调用开始事件
    if (this.streamingToolCallIndices.has(event.id)) {
        console.warn(
            `[Task#${this.taskId}] Ignoring duplicate tool_call_start for ID: ${event.id} (tool: ${event.name})`,
        )
        continue
    }

    // 初始化流式工具调用
    NativeToolCallParser.startStreamingToolCall(event.id, event.name as ToolName)

    // 追踪工具调用令牌
    tokenCounter.addToolCall(event.id, event.name as string, "")

    // 完成前一个文本块
    const lastBlock = this.assistantMessageContent[this.assistantMessageContent.length - 1]
    if (lastBlock?.type === "text" && lastBlock.partial) {
        lastBlock.partial = false
    }

    // 记录工具调用索引
    const toolUseIndex = this.assistantMessageContent.length
    this.streamingToolCallIndices.set(event.id, toolUseIndex)

    // 创建部分工具调用
    const partialToolUse: ToolUse = {
        type: "tool_use",
        name: event.name as ToolName,
        params: {},
        partial: true,
    }
    ;(partialToolUse as any).id = event.id

    this.assistantMessageContent.push(partialToolUse)
    this.userMessageContentReady = false
    presentAssistantMessage(this)
}
```

**处理要点**:
1. **去重检查**: 防止相同ID的工具调用重复添加
2. **状态初始化**: 调用 `NativeToolCallParser.startStreamingToolCall`
3. **文本块完成**: 确保前一个文本块标记为完成
4. **索引追踪**: 存储工具调用在数组中的位置
5. **创建部分工具**: 设置 `partial: true`
6. **展示更新**: 调用 `presentAssistantMessage`

#### 5.1.2 tool_call_delta 事件

```typescript
else if (event.type === "tool_call_delta") {
    const partialToolUse = NativeToolCallParser.processStreamingChunk(
        event.id,
        event.delta,
    )

    if (partialToolUse) {
        const toolUseIndex = this.streamingToolCallIndices.get(event.id)
        if (toolUseIndex !== undefined) {
            ;(partialToolUse as any).id = event.id
            this.assistantMessageContent[toolUseIndex] = partialToolUse

            // 更新工具调用令牌计数
            if (partialToolUse.name) {
                tokenCounter.addToolCall(
                    event.id,
                    partialToolUse.name,
                    JSON.stringify(partialToolUse.params || {}),
                )
            }

            presentAssistantMessage(this)
        }
    }
}
```

**处理要点**:
1. **增量解析**: 使用流式JSON解析器处理参数增量
2. **原地更新**: 通过索引直接更新数组中的工具调用
3. **令牌更新**: 累积工具调用的令牌计数
4. **展示更新**: 每次增量都触发展示更新

#### 5.1.3 tool_call_end 事件

```typescript
else if (event.type === "tool_call_end") {
    const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
    const toolUseIndex = this.streamingToolCallIndices.get(event.id)

    if (finalToolUse) {
        ;(finalToolUse as any).id = event.id
        if (toolUseIndex !== undefined) {
            this.assistantMessageContent[toolUseIndex] = finalToolUse
        }
        this.streamingToolCallIndices.delete(event.id)
        this.userMessageContentReady = false
        presentAssistantMessage(this)
    } else if (toolUseIndex !== undefined) {
        // JSON格式错误或缺少参数
        const existingToolUse = this.assistantMessageContent[toolUseIndex]
        if (existingToolUse && existingToolUse.type === "tool_use") {
            existingToolUse.partial = false
            ;(existingToolUse as any).id = event.id
        }
        this.streamingToolCallIndices.delete(event.id)
        this.userMessageContentReady = false
        presentAssistantMessage(this)
    }
}
```

**处理要点**:
1. **完成工具调用**: 调用 `finalizeStreamingToolCall` 获取最终工具调用
2. **清理追踪**: 删除索引映射
3. **错误处理**: 如果 finalize 返回 null，仍标记为完成，让验证逻辑处理
4. **展示更新**: 展示最终的工具调用

### 5.2 tool_call 数据块（完整工具调用）

**位置**: 第2994-3022行

```typescript
case "tool_call": {
    // 向后兼容：处理完整的工具调用
    const toolUse = NativeToolCallParser.parseToolCall({
        id: chunk.id,
        name: chunk.name as ToolName,
        arguments: chunk.arguments,
    })

    if (!toolUse) {
        console.error(`Failed to parse tool call for task ${this.taskId}:`, chunk)
        break
    }

    toolUse.id = chunk.id
    this.assistantMessageContent.push(toolUse)
    this.userMessageContentReady = false
    presentAssistantMessage(this)
    break
}
```

**处理要点**:
1. **向后兼容**: 支持非流式的完整工具调用
2. **直接添加**: 不需要增量处理，直接添加到内容数组
3. **错误处理**: 解析失败时记录错误并跳过

### 5.3 流式完成后的工具调用清理

**位置**: 第3397-3447行

```typescript
// 完成任何未显式结束的流式工具调用
const finalizeEvents = NativeToolCallParser.finalizeRawChunks()
for (const event of finalizeEvents) {
    if (event.type === "tool_call_end") {
        const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
        const toolUseIndex = this.streamingToolCallIndices.get(event.id)

        if (finalToolUse) {
            ;(finalToolUse as any).id = event.id
            if (toolUseIndex !== undefined) {
                this.assistantMessageContent[toolUseIndex] = finalToolUse
            }
            this.streamingToolCallIndices.delete(event.id)
            this.userMessageContentReady = false
            presentAssistantMessage(this)
        } else if (toolUseIndex !== undefined) {
            const existingToolUse = this.assistantMessageContent[toolUseIndex]
            if (existingToolUse && existingToolUse.type === "tool_use") {
                existingToolUse.partial = false
                ;(existingToolUse as any).id = event.id
            }
            this.streamingToolCallIndices.delete(event.id)
            this.userMessageContentReady = false
            presentAssistantMessage(this)
        }
    }
}
```

**目的**:
- 处理流式结束时可能缺失的 `tool_call_end` 事件
- 确保所有部分工具调用都被标记为完成
- 清理所有追踪状态

---

## 6. 令牌计数与成本计算

### 6.1 令牌计数器初始化

**位置**: 第2754-2760行

```typescript
// 初始化令牌计数器，用于API不提供使用数据时的回退
const tokenCounter = new StreamingTokenCounter()
let hasApiUsageData = false

// 初始化死循环检测器
const deadLoopDetector = new DeadLoopDetector()
```

### 6.2 流式期间的令牌累积

| 数据类型 | 计数方法 | 位置 |
|---------|---------|------|
| Reasoning | `tokenCounter.addReasoning(chunk.text)` | 第2802行 |
| Text | `tokenCounter.addText(chunk.text)` | 第3026行 |
| Tool Call | `tokenCounter.addToolCall(event.id, name, args)` | 第2885, 2934行 |

### 6.3 后台令牌收集

**位置**: 第3087-3244行

```typescript
const drainStreamInBackgroundToFindAllUsage = async (apiReqIndex: number) => {
    const timeoutMs = DEFAULT_USAGE_COLLECTION_TIMEOUT_MS // 5秒
    const startTime = performance.now()

    let bgInputTokens = currentTokens.input
    let bgOutputTokens = currentTokens.output
    let bgCacheWriteTokens = currentTokens.cacheWrite
    let bgCacheReadTokens = currentTokens.cacheRead
    let bgTotalCost = currentTokens.total

    const captureUsageData = async (tokens, messageIndex) => {
        // 更新共享变量
        inputTokens = tokens.input
        outputTokens = tokens.output
        cacheWriteTokens = tokens.cacheWrite
        cacheReadTokens = tokens.cacheRead
        totalCost = tokens.total

        // 更新API请求消息
        updateApiReqMsg()
        await this.saveClineMessages()
        await this.updateClineMessage(apiReqMessage)

        // 计算成本
        const costResult = apiProtocol === "anthropic"
            ? calculateApiCostAnthropic(...)
            : calculateApiCostOpenAI(...)
    }

    try {
        let usageFound = false
        let chunkCount = 0

        // 继续处理主循环离开的流
        while (!item.done) {
            if (performance.now() - startTime > timeoutMs) {
                console.warn(`[Background Usage Collection] Timed out after ${timeoutMs}ms`)
                if (iterator.return) {
                    await iterator.return(undefined)
                }
                break
            }

            const chunk = item.value
            item = await iterator.next()
            chunkCount++

            if (chunk && chunk.type === "usage") {
                usageFound = true
                bgInputTokens += chunk.inputTokens
                bgOutputTokens += chunk.outputTokens
                bgCacheWriteTokens += chunk.cacheWriteTokens ?? 0
                bgCacheReadTokens += chunk.cacheReadTokens ?? 0
                bgTotalCost = chunk.totalCost
            }
        }

        if (usageFound || bgInputTokens > 0 || bgOutputTokens > 0) {
            await captureUsageData({ input: bgInputTokens, output: bgOutputTokens, ... }, lastApiReqIndex)
        }
    } catch (error) {
        console.error("Error draining stream for usage data:", error)
    }
}

// 启动后台任务
drainStreamInBackgroundToFindAllUsage(lastApiReqIndex).catch((error) => {
    console.error("Background usage collection failed:", error)
})
```

**设计要点**:
1. **非阻塞**: 后台任务不阻塞主流程
2. **超时保护**: 5秒超时防止无限等待
3. **局部变量**: 使用局部变量累积，避免竞态条件
4. **原子更新**: 通过 `captureUsageData` 原子性地更新共享状态

### 6.4 Tiktoken 回退机制

**位置**: 第3306-3378行

```typescript
// 如果API未提供有效的使用数据，使用tiktoken进行估算
const isApiUsageInvalid = !hasApiUsageData || (inputTokens === 0 && outputTokens === 0)

if (isApiUsageInvalid && tokenCounter.getTotalTokens() > 0) {
    const tokenBreakdown = tokenCounter.getTokenBreakdown()

    console.log(`[Task#${this.taskId}] API did not provide valid usage data. Using tiktoken fallback.`)

    // 使用tiktoken估算输出令牌
    const estimatedOutputTokens = tokenCounter.getTotalTokens()

    if (estimatedOutputTokens > 0) {
        // 使用tiktoken计算输入令牌
        const fullConversationContent = this.apiConversationHistory.flatMap(msg =>
            Array.isArray(msg.content) ? msg.content : []
        )
        const inputTokensEstimate = await this.api.countTokens(fullConversationContent)

        // 覆盖令牌计数
        inputTokens = inputTokensEstimate
        outputTokens = estimatedOutputTokens

        // 计算成本
        const costResult = apiProtocol === "anthropic"
            ? calculateApiCostAnthropic(streamModelInfo, inputTokens, outputTokens, ...)
            : calculateApiCostOpenAI(streamModelInfo, inputTokens, outputTokens, ...)

        totalCost = costResult.totalCost

        // 更新API请求消息
        updateApiReqMsg()
        await this.saveClineMessages()
        await this.updateClineMessage(apiReqMessage)
    }
}
```

**触发条件**:
1. API未提供usage数据 (`!hasApiUsageData`)
2. 或API提供的usage数据无效 (`inputTokens === 0 && outputTokens === 0`)
3. 且tiktoken计数结果 > 0（避免估算空响应）

**令牌分解**:
```typescript
const tokenBreakdown = tokenCounter.getTokenBreakdown()
// {
//   text: number,        // 文本令牌数
//   reasoning: number,   // 推理令牌数
//   toolCalls: number    // 工具调用令牌数
// }
```

---

## 7. 流式中断与错误处理

### 7.1 流式中断函数

**位置**: 第2691-2713行

```typescript
const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
    // 恢复diff视图更改
    if (this.diffViewProvider.isEditing) {
        await this.diffViewProvider.revertChanges()
    }

    // 完成部分消息
    const lastMessage = this.clineMessages.at(-1)
    if (lastMessage && lastMessage.partial) {
        lastMessage.partial = false
    }

    // 更新api_req_started消息，包含取消原因和成本
    updateApiReqMsg(cancelReason, streamingFailedMessage)
    await this.saveClineMessages()

    // 通知提供者流式中断完成
    this.didFinishAbortingStream = true
}
```

**处理步骤**:
1. **恢复编辑**: 恢复diff视图中的未保存更改
2. **完成消息**: 将部分消息标记为完成
3. **更新成本**: 计算并记录部分流的成本
4. **标记完成**: 设置 `didFinishAbortingStream` 标志

### 7.2 用户取消处理

**位置**: 第3046-3058行

```typescript
if (this.abort) {
    console.log(`aborting stream, this.abandoned = ${this.abandoned}`)

    if (!this.abandoned) {
        // 只有在实例未被放弃时才优雅中断
        await abortStream("user_cancelled")
    }

    break
}
```

**区分场景**:
- `abort && !abandoned`: 用户主动取消，需要优雅中断
- `abandoned`: 扩展不再等待，直接清理

### 7.3 流式失败处理

**位置**: 第3245-3299行

```typescript
catch (error) {
    if (!this.abandoned) {
        const cancelReason: ClineApiReqCancelReason = this.abort ? "user_cancelled" : "streaming_failed"

        const rawErrorMessage = (error instanceof Error ? error.message : undefined) ?? JSON.stringify(serializeError(error), null, 2)
        const streamingFailedMessage = this.abort
            ? undefined
            : `${t("common:interruption.streamTerminatedByProvider")}: ${rawErrorMessage}`

        await abortStream(cancelReason, streamingFailedMessage)

        if (this.abort) {
            this.abortReason = cancelReason
            await this.abortTask()
        } else {
            // 流式失败，重试
            console.error(`[Task#${this.taskId}] Stream failed, will retry: ${streamingFailedMessage}`)

            // 应用指数退避
            const stateForBackoff = await this.providerRef.deref()?.getState()
            if (stateForBackoff?.autoApprovalEnabled) {
                await this.backoffAndAnnounce(currentItem.retryAttempt ?? 0, error)

                if (this.abort) {
                    this.abortReason = "user_cancelled"
                    await this.abortTask()
                    break
                }
            }

            // 将相同内容推回栈以重试
            stack.push({
                userContent: currentUserContent,
                includeFileDetails: false,
                retryAttempt: (currentItem.retryAttempt ?? 0) + 1,
            })

            continue
        }
    }
}
```

**处理逻辑**:
1. **判断原因**: 区分用户取消和流式失败
2. **中断流式**: 调用 `abortStream` 清理状态
3. **用户取消**: 终止整个任务
4. **流式失败**: 应用退避策略并重试

### 7.4 退避策略

**位置**: 第3273-3287行

```typescript
if (stateForBackoff?.autoApprovalEnabled) {
    await this.backoffAndAnnounce(currentItem.retryAttempt ?? 0, error)

    if (this.abort) {
        console.log(`[Task#${this.taskId}] Task aborted during mid-stream retry backoff`)
        this.abortReason = "user_cancelled"
        await this.abortTask()
        break
    }
}
```

**退避参数**:
- 最大退避时间: 600秒（10分钟）
- 退避在 `maybeWaitForProviderRateLimit` 中实现（第2534行）

---

## 8. 流式完成与清理

### 8.1 部分块完成

**位置**: 第3449-3452行

```typescript
// 完成所有仍标记为部分的内容块
const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
partialBlocks.forEach((block) => (block.partial = false))
```

**注意**:
- 必须在 `finalizeRawChunks()` 之后执行
- 避免重复展示已完成的工具调用

### 8.2 推理消息完成

**位置**: 第3463-3479行

```typescript
// 完成推理消息
if (reasoningMessage) {
    const lastReasoningIndex = findLastIndex(
        this.clineMessages,
        (m) => m.type === "say" && m.say === "reasoning",
    )

    if (lastReasoningIndex !== -1) {
        const msg = this.clineMessages[lastReasoningIndex]
        if (msg && msg.partial) {
            msg.partial = false
            await this.updateClineMessage(msg)
        }
    }
}
```

**处理要点**:
- 查找最后一个推理消息
- 标记为完成
- 更新webview显示

### 8.3 助手消息保存

**位置**: 第3486-3632行

```typescript
// 检查是否有内容需要处理
const hasTextContent = assistantMessage.length > 0
const hasToolUses = this.assistantMessageContent.some(
    (block) => block.type === "tool_use" || block.type === "mcp_tool_use",
)

if (hasTextContent || hasToolUses) {
    // 重置计数器
    this.consecutiveNoAssistantMessagesCount = 0

    // 展示引用来源
    if (pendingGroundingSources.length > 0) {
        const citationLinks = pendingGroundingSources.map((source, i) => `[${i + 1}](${source.url})`)
        const sourcesText = `${t("common:gemini.sources")} ${citationLinks.join(", ")}`
        await this.say("text", sourcesText, undefined, false, undefined, undefined, { isNonInteractive: true })
    }

    // 构建助手消息内容
    const assistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = []

    // 添加文本内容
    if (assistantMessage) {
        assistantContent.push({
            type: "text" as const,
            text: assistantMessage,
        })
    }

    // 添加工具调用块，防止重复ID
    const seenToolUseIds = new Set<string>()
    const toolUseBlocks = this.assistantMessageContent.filter(
        (block) => block.type === "tool_use" || block.type === "mcp_tool_use",
    )

    for (const block of toolUseBlocks) {
        if (block.type === "mcp_tool_use") {
            const mcpBlock = block as import("../../shared/tools").McpToolUse
            if (mcpBlock.id) {
                const sanitizedId = sanitizeToolUseId(mcpBlock.id)
                if (seenToolUseIds.has(sanitizedId)) {
                    console.warn(`[Task#${this.taskId}] Pre-flight deduplication: Skipping duplicate MCP tool_use ID: ${sanitizedId}`)
                    continue
                }
                seenToolUseIds.add(sanitizedId)
                assistantContent.push({
                    type: "tool_use" as const,
                    id: sanitizedId,
                    name: mcpBlock.name,
                    input: mcpBlock.arguments,
                })
            }
        } else {
            const toolUse = block as import("../../shared/tools").ToolUse
            const toolCallId = toolUse.id
            if (toolCallId) {
                const sanitizedId = sanitizeToolUseId(toolCallId)
                if (seenToolUseIds.has(sanitizedId)) {
                    console.warn(`[Task#${this.taskId}] Pre-flight deduplication: Skipping duplicate tool_use ID: ${sanitizedId}`)
                    continue
                }
                seenToolUseIds.add(sanitizedId)
                const input = toolUse.nativeArgs || toolUse.params
                const toolNameForHistory = toolUse.originalName ?? toolUse.name

                assistantContent.push({
                    type: "tool_use" as const,
                    id: sanitizedId,
                    name: toolNameForHistory,
                    input,
                })
            }
        }
    }

    // 处理new_task隔离
    const newTaskIndex = assistantContent.findIndex(
        (block) => block.type === "tool_use" && block.name === "new_task",
    )

    if (newTaskIndex !== -1 && newTaskIndex < assistantContent.length - 1) {
        const truncatedTools = assistantContent.slice(newTaskIndex + 1)
        assistantContent.length = newTaskIndex + 1

        const executionNewTaskIndex = this.assistantMessageContent.findIndex(
            (block) => block.type === "tool_use" && block.name === "new_task",
        )
        if (executionNewTaskIndex !== -1) {
            this.assistantMessageContent.length = executionNewTaskIndex + 1
        }

        // 预注入错误工具结果
        for (const tool of truncatedTools) {
            if (tool.type === "tool_use" && (tool as Anthropic.ToolUseBlockParam).id) {
                this.pushToolResultToUserContent({
                    type: "tool_result",
                    tool_use_id: (tool as Anthropic.ToolUseBlockParam).id,
                    content: "This tool was not executed because new_task was called in the same message turn.",
                    is_error: true,
                })
            }
        }
    }

    // 保存助手消息到API历史
    await this.addToApiConversationHistory(
        { role: "assistant", content: assistantContent },
        reasoningMessage || undefined,
    )
    this.assistantMessageSavedToHistory = true
}
```

**关键步骤**:
1. **重置计数器**: 成功响应后重置连续失败计数
2. **展示引用**: 显示grounding sources
3. **构建内容**: 合并文本和工具调用
4. **去重处理**: 使用 `seenToolUseIds` 防止重复ID
5. **new_task隔离**: 确保new_task是最后一个工具
6. **保存历史**: 保存助手消息，设置 `assistantMessageSavedToHistory = true`

### 8.4 finally 块清理

**位置**: 第3300-3304行

```typescript
finally {
    this.isStreaming = false
    // 清理中断控制器
    this.currentRequestAbortController = undefined
}
```

**清理内容**:
1. 重置 `isStreaming` 标志
2. 清理中断控制器

---

## 9. 关键流程图

### 9.1 流式处理主流程

```
开始API请求
    ↓
重置流式状态
    ↓
初始化令牌计数器
    ↓
创建中断控制器
    ↓
获取流式迭代器
    ↓
进入主循环
    ↓
获取下一个数据块 (带中断检查)
    ↓
数据块类型判断
    ├─ reasoning → 累积文本 → 死循环检测 → 展示
    ├─ usage → 累积令牌 → 设置hasApiUsageData
    ├─ grounding → 存储引用来源
    ├─ tool_call_partial → 处理工具调用增量 → 展示
    ├─ tool_call → 处理完整工具调用 → 展示
    └─ text → 累积文本 → 创建/更新文本块 → 展示
    ↓
检查中断条件
    ├─ abort → 中断流式 → 退出循环
    ├─ didRejectTool → 中断流式 → 退出循环
    └─ didAlreadyUseTool → 中断流式 → 退出循环
    ↓
循环继续
    ↓
流式结束
    ↓
完成未完成的工具调用
    ↓
完成部分内容块
    ↓
完成推理消息
    ↓
后台收集令牌使用数据 (5秒超时)
    ↓
检查是否需要tiktoken回退
    ├─ 需要回退 → 使用tiktoken估算令牌
    └─ 不需要 → 使用API提供的令牌数据
    ↓
构建助手消息内容
    ├─ 添加文本内容
    ├─ 添加工具调用 (去重处理)
    └─ 处理new_task隔离
    ↓
保存助手消息到API历史
    ↓
设置 assistantMessageSavedToHistory = true
    ↓
等待工具执行完成 (userMessageContentReady)
    ↓
检查是否使用了工具
    ├─ 未使用工具 → 增加计数器 → 添加提示消息
    └─ 使用了工具 → 重置计数器
    ↓
将工具结果推回处理栈
    ↓
准备下一次API请求
```

### 9.2 工具调用流式处理流程

```
收到 tool_call_partial 数据块
    ↓
通过 NativeToolCallParser 处理原始块
    ↓
处理事件
    ↓
tool_call_start 事件
    ├─ 检查重复ID
    ├─ 初始化流式工具调用
    ├─ 完成前一个文本块
    ├─ 记录工具调用索引
    ├─ 创建部分工具调用 (partial: true)
    └─ 展示工具调用
    ↓
tool_call_delta 事件
    ├─ 通过流式JSON解析器处理增量
    ├─ 原地更新工具调用参数
    ├─ 更新令牌计数
    └─ 展示更新
    ↓
tool_call_end 事件
    ├─ 完成流式工具调用
    ├─ 替换部分工具为最终工具
    ├─ 清理索引追踪
    └─ 展示最终工具调用
    ↓
流式结束
    ↓
完成未完成的工具调用 (finalizeRawChunks)
    ├─ 为每个未完成的工具生成 tool_call_end 事件
    ├─ 完成工具调用
    └─ 清理所有追踪状态
```

### 9.3 令牌计数流程

```
流式处理开始
    ↓
初始化 StreamingTokenCounter
    ↓
处理数据块
    ├─ reasoning → tokenCounter.addReasoning(text)
    ├─ text → tokenCounter.addText(text)
    └─ tool_call → tokenCounter.addToolCall(id, name, args)
    ↓
流式结束
    ↓
启动后台令牌收集任务 (5秒超时)
    ├─ 继续读取流中的 usage 数据块
    ├─ 累积令牌计数
    └─ 更新共享状态 (原子操作)
    ↓
检查API是否提供了有效的使用数据
    ├─ 有效 → 使用API提供的令牌数据
    └─ 无效 → 检查tiktoken计数
        ├─ tiktoken计数 > 0 → 使用tiktoken估算
        └─ tiktoken计数 = 0 → 跳过估算
    ↓
计算成本
    ├─ Anthropic协议 → calculateApiCostAnthropic
    └─ OpenAI协议 → calculateApiCostOpenAI
    ↓
更新API请求消息
    ↓
保存到clineMessages
```

### 9.4 流式中断处理流程

```
检测到中断条件
    ↓
判断中断原因
    ├─ 用户取消 (abort && !abandoned)
    └─ 流式失败 (!abort)
    ↓
调用 abortStream
    ├─ 恢复diff视图更改
    ├─ 完成部分消息
    ├─ 更新api_req_started消息
    │   ├─ 添加取消原因
    │   ├─ 计算部分流的成本
    │   └─ 添加错误消息
    ├─ 保存clineMessages
    └─ 设置 didFinishAbortingStream = true
    ↓
判断中断原因
    ├─ 用户取消
    │   ├─ 设置 abortReason
    │   └─ 调用 abortTask()
    └─ 流式失败
        ├─ 检查是否启用自动审批
        │   ├─ 是 → 应用退避策略
        │   │   ├─ 等待退避时间
        │   │   ├─ 检查是否被取消
        │   │   └─ 继续重试
        │   └─ 否 → 提示用户重试
        └─ 将内容推回处理栈
    ↓
finally 块
    ├─ 设置 isStreaming = false
    └─ 清理中断控制器
```

---

## 10. 关键设计决策

### 10.1 为什么需要 assistantMessageSavedToHistory 标志？

**问题**: 在并行工具调用中，工具会在流式期间执行。如果 `new_task` 工具被调用，它会触发委托，调用 `flushPendingToolResultsToHistory()`。此时，如果助手消息还未保存到历史，工具结果块会出现在工具使用块之前，导致API错误。

**解决方案**: 使用 `assistantMessageSavedToHistory` 标志确保：
1. 在工具执行前，助手消息已保存到历史
2. `flushPendingToolResultsToHistory()` 会等待助手消息保存完成
3. 保证历史记录中工具使用块在工具结果块之前

**相关代码**:
- 第361行: 标志定义
- 第2724行: 重置为false
- 第3631行: 设置为true
- 第1043-1053行: flushPendingToolResultsToHistory 中的等待逻辑

### 10.2 为什么需要后台令牌收集？

**问题**: 某些API在流式结束后才发送最终的usage数据块。如果主循环在流式结束后立即退出，可能会错过这些数据。

**解决方案**: 使用后台任务继续读取流5秒，收集所有usage数据：
1. 不阻塞主流程
2. 使用独立的局部变量累积
3. 原子性地更新共享状态
4. 5秒超时防止无限等待

**相关代码**:
- 第3087-3244行: drainStreamInBackgroundToFindAllUsage 函数

### 10.3 为什么需要 tiktoken 回退？

**问题**: 某些API不提供usage数据，或提供的数据无效（如outputTokens=0）。没有准确的令牌计数，成本计算会失败。

**解决方案**: 使用tiktoken进行估算：
1. 流式期间累积所有文本、推理和工具调用内容
2. 流式结束后，如果API未提供有效数据，使用tiktoken估算
3. 输入令牌：对完整对话历史进行令牌计数
4. 输出令牌：使用流式期间累积的内容进行令牌计数

**相关代码**:
- 第3306-3378行: tiktoken回退逻辑

### 10.4 为什么需要工具调用索引追踪？

**问题**: 流式工具调用通过增量更新，需要知道每个工具在 `assistantMessageContent` 数组中的位置，以便原地更新。

**解决方案**: 使用 `streamingToolCallIndices` Map追踪：
1. key: 工具调用ID
2. value: 工具在数组中的索引
3. 在 tool_call_start 时记录
4. 在 tool_call_delta 时使用索引更新
5. 在 tool_call_end 时删除

**相关代码**:
- 第394行: streamingToolCallIndices 定义
- 第2897行: 记录索引
- 第2923行: 使用索引更新
- 第2962行: 删除索引

### 10.5 为什么需要 new_task 隔离？

**问题**: 如果 `new_task` 与其他工具在同一个消息中被调用，委托会处理父任务，导致后续工具无法执行，产生孤立工具。

**解决方案**: 强制 `new_task` 必须是最后一个工具：
1. 检查 `new_task` 是否是最后一个工具
2. 如果不是，截断后续工具
3. 为被截断的工具预注入错误结果
4. 同时截断执行数组和API历史数组

**相关代码**:
- 第3586-3621行: new_task隔离逻辑

---

## 11. 常见问题与调试

### 11.1 流式处理卡住

**症状**: 流式处理长时间无响应

**可能原因**:
1. 后台令牌收集任务超时
2. 工具执行阻塞
3. `userMessageContentReady` 未被设置

**调试步骤**:
1. 检查日志中的 "Background Usage Collection" 消息
2. 检查工具执行状态
3. 检查 `presentAssistantMessage` 是否正常工作

### 11.2 工具调用重复

**症状**: API返回 "tool_use ids must be unique" 错误

**可能原因**:
1. 流式重试导致重复的 tool_call_start 事件
2. 工具调用ID未正确去重

**解决方案**:
1. 检查 `streamingToolCallIndices` 的去重逻辑（第2873-2878行）
2. 检查 `seenToolUseIds` 的预飞行去重（第3539-3544行）
3. 检查 `pushToolResultToUserContent` 的去重逻辑（第371-383行）

### 11.3 令牌计数不准确

**症状**: 成本计算异常高或低

**可能原因**:
1. API未提供usage数据
2. tiktoken估算不准确
3. 后台令牌收集失败

**调试步骤**:
1. 检查日志中的 "API did not provide valid usage data" 消息
2. 检查 `tokenBreakdown` 的输出
3. 检查后台令牌收集是否成功

### 11.4 new_task 后工具未执行

**症状**: new_task 后的工具显示错误结果

**可能原因**:
1. new_task 隔离逻辑被触发
2. 工具被截断

**预期行为**: 这是正常行为，new_task 必须是最后一个工具。

### 11.5 推理消息死循环

**症状**: 推理消息重复相同内容

**可能原因**:
1. 模型生成死循环内容
2. 死循环检测器阈值设置不当

**解决方案**: 死循环检测器会自动终止任务（第2817-2833行）

---

## 12. 性能优化

### 12.1 模型信息缓存

**优化**: 缓存模型信息，避免重复调用 `getModel()`

**位置**: 第2739-2743行

**效果**: 减少API调用，提高性能

### 12.2 后台令牌收集

**优化**: 非阻塞后台任务收集令牌数据

**位置**: 第3087-3244行

**效果**: 不阻塞主流程，提高响应速度

### 12.3 原地更新工具调用

**优化**: 使用索引原地更新工具调用，避免数组操作

**位置**: 第2929行

**效果**: 减少内存分配，提高性能

### 12.4 局部变量累积

**优化**: 后台任务使用局部变量累积，避免竞态条件

**位置**: 第3093-3097行

**效果**: 线程安全，避免数据竞争

---

## 13. 总结

Task.ts 中的流式处理功能是一个复杂而精密的系统，涵盖了以下核心方面：

1. **状态管理**: 完善的状态标志和生命周期管理
2. **数据流处理**: 多种数据块类型的处理逻辑
3. **工具调用**: 流式工具调用的增量更新和完成
4. **令牌计数**: API数据和tiktoken回退的双重保障
5. **错误处理**: 中断、重试和退避策略
6. **性能优化**: 缓存、后台任务和原地更新

关键设计决策确保了系统的健壮性、性能和用户体验。

---

**文档版本**: 1.0
**最后更新**: 2026-02-26
**分析文件**: src/core/task/Task.ts
**分析行数**: 1-4000+
