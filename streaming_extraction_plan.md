# 流式处理功能拆分方案

## 文档概述

本文档基于 `streaming_processing_analysis.md` 的详细分析，提供了将流式处理功能从 `src/core/task/Task.ts` 中拆分出来的完整方案。包括模块划分、接口设计、依赖分析和实施步骤。

---

## 目录

1. [拆分目标与原则](#1-拆分目标与原则)
2. [现有代码结构分析](#2-现有代码结构分析)
3. [模块划分方案](#3-模块划分方案)
4. [核心模块设计](#4-核心模块设计)
5. [接口定义](#5-接口定义)
6. [数据流设计](#6-数据流设计)
7. [实施步骤](#7-实施步骤)
8. [风险评估与缓解](#8-风险评估与缓解)
9. [测试策略](#9-测试策略)

---

## 1. 拆分目标与原则

### 1.1 拆分目标

1. **降低复杂度**: 将 `Task.ts` 中约 400+ 行的流式处理代码独立出来
2. **提高可维护性**: 独立的模块更易于理解、测试和维护
3. **增强可测试性**: 流式逻辑可以独立进行单元测试
4. **改善代码组织**: 相关功能集中在专门的模块中
5. **支持复用**: 流式处理逻辑可以在其他场景中复用

### 1.2 设计原则

1. **单一职责**: 每个模块只负责一个明确的功能
2. **依赖倒置**: 高层模块不依赖低层模块，都依赖抽象
3. **接口隔离**: 客户端不应该依赖它不需要的接口
4. **开闭原则**: 对扩展开放，对修改关闭
5. **最小侵入**: 尽量减少对现有代码的修改

---

## 2. 现有代码结构分析

### 2.1 流式处理相关代码分布

| 代码段 | 行数范围 | 功能描述 |
|-------|---------|---------|
| 流式状态变量 | 全局 | 15+ 个状态变量 |
| 流式状态重置 | 2715-2737 | 重置所有流式状态 |
| 模型信息缓存 | 2739-2743 | 缓存模型信息 |
| 流式初始化 | 2748-2753 | 初始化流式处理 |
| 主循环 | 2763-3076 | 流式数据处理循环 |
| reasoning 处理 | 2799-2836 | 推理消息处理 |
| usage 处理 | 2838-2848 | 令牌使用处理 |
| grounding 处理 | 2849-2855 | 引用来源处理 |
| tool_call_partial 处理 | 2856-2991 | 部分工具调用处理 |
| tool_call 处理 | 2994-3022 | 完整工具调用处理 |
| text 处理 | 3023-3043 | 文本内容处理 |
| 流式中断处理 | 2691-2713, 3046-3058 | 中断逻辑 |
| 错误处理 | 3245-3299 | 异常处理和重试 |
| 后台令牌收集 | 3087-3244 | 后台任务 |
| tiktoken 回退 | 3306-3378 | 令牌估算 |
| 流式完成处理 | 3397-3632 | 完成和清理 |
| finally 块 | 3300-3304 | 清理逻辑 |

**总计**: 约 800+ 行的流式处理相关代码

### 2.2 依赖关系

```
Task.ts
├── StreamingTokenCounter (src/utils/tiktoken.ts)
├── NativeToolCallParser (src/core/assistant-message/NativeToolCallParser.ts)
├── DeadLoopDetector (src/utils/deadLoopDetector.ts)
├── DiffViewProvider (通过 this.diffViewProvider)
├── API (通过 this.api)
├── ClineMessages (通过 this.clineMessages)
└── 其他 Task 方法
    ├── say()
    ├── updateClineMessage()
    ├── saveClineMessages()
    ├── addToApiConversationHistory()
    └── presentAssistantMessage()
```

### 2.3 状态管理

流式处理涉及以下状态：

| 状态类别 | 状态变量 | 作用域 |
|---------|---------|-------|
| 流式控制 | isStreaming, currentStreamingContentIndex, etc. | 实例 |
| 消息内容 | assistantMessageContent, userMessageContent | 实例 |
| 工具调用 | streamingToolCallIndices, didRejectTool, etc. | 实例 |
| 历史保存 | assistantMessageSavedToHistory | 实例 |
| 模型信息 | cachedStreamingModel | 实例 |
| 中断控制 | currentRequestAbortController | 实例 |

---

## 3. 模块划分方案

### 3.1 推荐方案：三层架构

```
┌─────────────────────────────────────────────────────────┐
│                    Task.ts (高层)                        │
│  - 任务协调                                              │
│  - 业务逻辑                                              │
│  - 状态集成                                              │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ 使用
                     │
┌────────────────────▼────────────────────────────────────┐
│          StreamingProcessor (核心层)                     │
│  - 流式处理主循环                                        │
│  - 数据块分发                                            │
│  - 状态管理                                              │
│  - 错误处理                                              │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ 委托
                     │
        ┌────────────┼────────────┐
        │            │            │
┌───────▼──────┐ ┌──▼────────┐ ┌─▼──────────────┐
│ ChunkHandler │ │TokenCounter│ │ErrorHandler    │
│ - reasoning  │ │- counting │ │- abort         │
│ - text       │ │- fallback │ │- retry         │
│ - tool_call  │ │- collection│ │- backoff       │
└──────────────┘ └───────────┘ └────────────────┘
```

### 3.2 模块职责

| 模块 | 文件 | 职责 |
|-----|------|-----|
| StreamingProcessor | `src/core/streaming/StreamingProcessor.ts` | 流式处理核心控制器 |
| ChunkHandler | `src/core/streaming/handlers/ChunkHandler.ts` | 数据块处理接口 |
| ReasoningHandler | `src/core/streaming/handlers/ReasoningHandler.ts` | 推理消息处理 |
| TextHandler | `src/core/streaming/handlers/TextHandler.ts` | 文本内容处理 |
| ToolCallHandler | `src/core/streaming/handlers/ToolCallHandler.ts` | 工具调用处理 |
| UsageHandler | `src/core/streaming/handlers/UsageHandler.ts` | 令牌使用处理 |
| GroundingHandler | `src/core/streaming/handlers/GroundingHandler.ts` | 引用来源处理 |
| StreamingStateManager | `src/core/streaming/StreamingStateManager.ts` | 流式状态管理 |
| StreamingErrorHandler | `src/core/streaming/StreamingErrorHandler.ts` | 错误处理和重试 |
| StreamingTokenManager | `src/core/streaming/StreamingTokenManager.ts` | 令牌计数和成本计算 |
| StreamingContext | `src/core/streaming/StreamingContext.ts` | 流式上下文 |

---

## 4. 核心模块设计

### 4.1 StreamingProcessor (核心控制器)

**职责**: 协调整个流式处理流程

```typescript
// src/core/streaming/StreamingProcessor.ts

export interface StreamingProcessorConfig {
  taskId: string
  api: ApiHandler
  diffViewProvider: DiffViewProvider
  onSay: (type: string, content: string, ...args: any[]) => Promise<void>
  onUpdateMessage: (message: ClineMessage) => Promise<void>
  onSaveMessages: () => Promise<void>
  onAddToHistory: (message: ApiMessage, reasoning?: string) => Promise<void>
  onPresentAssistant: () => void
}

export interface StreamingResult {
  assistantMessage: string
  reasoningMessage: string
  assistantMessageContent: AssistantMessageContent[]
  userMessageContent: Anthropic.Messages.ContentBlockParam[]
  groundingSources: GroundingSource[]
  tokens: {
    input: number
    output: number
    cacheWrite: number
    cacheRead: number
    totalCost: number
  }
  didUseTool: boolean
  didRejectTool: boolean
  aborted: boolean
  abortReason?: string
}

export class StreamingProcessor {
  private config: StreamingProcessorConfig
  private stateManager: StreamingStateManager
  private tokenManager: StreamingTokenManager
  private errorHandler: StreamingErrorHandler
  private handlers: Map<string, ChunkHandler>

  constructor(config: StreamingProcessorConfig) {
    this.config = config
    this.stateManager = new StreamingStateManager()
    this.tokenManager = new StreamingTokenManager(config.api)
    this.errorHandler = new StreamingErrorHandler(config)
    this.handlers = this.initializeHandlers()
  }

  private initializeHandlers(): Map<string, ChunkHandler> {
    const handlers = new Map<string, ChunkHandler>()

    handlers.set('reasoning', new ReasoningHandler(this.stateManager, this.tokenManager, this.config))
    handlers.set('text', new TextHandler(this.stateManager, this.tokenManager, this.config))
    handlers.set('tool_call_partial', new ToolCallHandler(this.stateManager, this.tokenManager, this.config))
    handlers.set('tool_call', new ToolCallHandler(this.stateManager, this.tokenManager, this.config))
    handlers.set('usage', new UsageHandler(this.stateManager, this.tokenManager, this.config))
    handlers.set('grounding', new GroundingHandler(this.stateManager, this.config))

    return handlers
  }

  /**
   * 开始流式处理
   * @param stream API 返回的流式数据
   * @param abortController 中断控制器
   * @returns 处理结果
   */
  async processStream(
    stream: AsyncIterable<StreamChunk>,
    abortController?: AbortController
  ): Promise<StreamingResult> {
    // 重置状态
    this.stateManager.reset()
    this.tokenManager.reset()

    // 设置中断控制器
    this.stateManager.setAbortController(abortController)

    try {
      // 主处理循环
      await this.processLoop(stream)

      // 完成处理
      await this.finalize()

      // 返回结果
      return this.buildResult()
    } catch (error) {
      // 错误处理
      return await this.handleError(error)
    } finally {
      // 清理
      this.cleanup()
    }
  }

  private async processLoop(stream: AsyncIterable<StreamChunk>): Promise<void> {
    const iterator = stream[Symbol.asyncIterator]()
    const nextChunkWithAbort = this.createNextChunkFunction(iterator)

    let item = await nextChunkWithAbort()

    while (!item.done) {
      const chunk = item.value
      item = await nextChunkWithAbort()

      if (!chunk) {
        continue
      }

      // 处理数据块
      await this.handleChunk(chunk)

      // 检查中断条件
      if (this.stateManager.shouldAbort()) {
        await this.abortStream()
        break
      }

      if (this.stateManager.didRejectTool()) {
        break
      }

      if (this.stateManager.didAlreadyUseTool()) {
        break
      }
    }
  }

  private async handleChunk(chunk: StreamChunk): Promise<void> {
    const handler = this.handlers.get(chunk.type)

    if (!handler) {
      console.warn(`[StreamingProcessor] No handler for chunk type: ${chunk.type}`)
      return
    }

    await handler.handle(chunk)
  }

  private createNextChunkFunction(iterator: AsyncIterator<StreamChunk>) {
    return async () => {
      const nextPromise = iterator.next()
      const abortController = this.stateManager.getAbortController()

      if (abortController) {
        const abortPromise = new Promise<never>((_, reject) => {
          const signal = abortController!.signal

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
  }

  private async finalize(): Promise<void> {
    // 完成未完成的工具调用
    await this.finalizeIncompleteToolCalls()

    // 完成部分内容块
    this.stateManager.completePartialBlocks()

    // 完成推理消息
    await this.stateManager.completeReasoningMessage()

    // 后台收集令牌数据
    await this.tokenManager.collectBackgroundUsage()

    // 检查 tiktoken 回退
    await this.tokenManager.checkTiktokenFallback()
  }

  private async finalizeIncompleteToolCalls(): Promise<void> {
    // 完成任何未显式结束的流式工具调用
    const finalizeEvents = NativeToolCallParser.finalizeRawChunks()

    for (const event of finalizeEvents) {
      if (event.type === "tool_call_end") {
        const handler = this.handlers.get('tool_call_partial') as ToolCallHandler
        await handler?.finalizeToolCall(event.id)
      }
    }
  }

  private async abortStream(): Promise<void> {
    await this.errorHandler.abortStream()
  }

  private async handleError(error: unknown): Promise<StreamingResult> {
    const result = await this.errorHandler.handleError(error)

    if (result.shouldRetry) {
      throw new StreamingRetryError(result.retryDelay)
    }

    return this.buildResult()
  }

  private buildResult(): StreamingResult {
    return {
      assistantMessage: this.stateManager.getAssistantMessage(),
      reasoningMessage: this.stateManager.getReasoningMessage(),
      assistantMessageContent: this.stateManager.getAssistantMessageContent(),
      userMessageContent: this.stateManager.getUserMessageContent(),
      groundingSources: this.stateManager.getGroundingSources(),
      tokens: this.tokenManager.getTokens(),
      didUseTool: this.stateManager.didUseTool(),
      didRejectTool: this.stateManager.didRejectTool(),
      aborted: this.stateManager.isAborted(),
      abortReason: this.stateManager.getAbortReason(),
    }
  }

  private cleanup(): void {
    this.stateManager.cleanup()
  }
}

// 自定义错误类型
export class StreamingRetryError extends Error {
  constructor(public retryDelay: number) {
    super("Stream processing failed, will retry")
    this.name = "StreamingRetryError"
  }
}
```

### 4.2 StreamingStateManager (状态管理)

**职责**: 管理流式处理的所有状态

```typescript
// src/core/streaming/StreamingStateManager.ts

export class StreamingStateManager {
  // 流式控制标志
  private isStreaming: boolean = false
  private currentStreamingContentIndex: number = 0
  private currentStreamingDidCheckpoint: boolean = false
  private didCompleteReadingStream: boolean = false

  // 消息内容存储
  private assistantMessage: string = ""
  private reasoningMessage: string = ""
  private assistantMessageContent: AssistantMessageContent[] = []
  private userMessageContent: Anthropic.Messages.ContentBlockParam[] = []
  private userMessageContentReady: boolean = false

  // 工具调用状态
  private streamingToolCallIndices: Map<string, number> = new Map()
  private didRejectTool: boolean = false
  private didAlreadyUseTool: boolean = false
  private didToolFailInCurrentTurn: boolean = false

  // 历史保存状态
  private assistantMessageSavedToHistory: boolean = false

  // 引用来源
  private groundingSources: GroundingSource[] = []

  // 中断控制
  private abortController?: AbortController
  private aborted: boolean = false
  private abortReason?: string

  // 模型信息
  private cachedModel?: { id: string; info: ModelInfo }

  reset(): void {
    this.isStreaming = false
    this.currentStreamingContentIndex = 0
    this.currentStreamingDidCheckpoint = false
    this.didCompleteReadingStream = false
    this.assistantMessage = ""
    this.reasoningMessage = ""
    this.assistantMessageContent = []
    this.userMessageContent = []
    this.userMessageContentReady = false
    this.didRejectTool = false
    this.didAlreadyUseTool = false
    this.didToolFailInCurrentTurn = false
    this.assistantMessageSavedToHistory = false
    this.streamingToolCallIndices.clear()
    this.groundingSources = []
    this.aborted = false
    this.abortReason = undefined

    // 清理 NativeToolCallParser 的流式状态
    NativeToolCallParser.clearAllStreamingToolCalls()
    NativeToolCallParser.clearRawChunkState()
  }

  // Getter 方法
  getAssistantMessage(): string {
    return this.assistantMessage
  }

  getReasoningMessage(): string {
    return this.reasoningMessage
  }

  getAssistantMessageContent(): AssistantMessageContent[] {
    return this.assistantMessageContent
  }

  getUserMessageContent(): Anthropic.Messages.ContentBlockParam[] {
    return this.userMessageContent
  }

  getGroundingSources(): GroundingSource[] {
    return this.groundingSources
  }

  // Setter 方法
  setAssistantMessage(message: string): void {
    this.assistantMessage = message
  }

  appendAssistantMessage(text: string): void {
    this.assistantMessage += text
  }

  setReasoningMessage(message: string): void {
    this.reasoningMessage = message
  }

  appendReasoningMessage(text: string): void {
    this.reasoningMessage += text
  }

  // 内容块管理
  addAssistantContentBlock(block: AssistantMessageContent): void {
    this.assistantMessageContent.push(block)
    this.userMessageContentReady = false
  }

  updateAssistantContentBlock(index: number, block: AssistantMessageContent): void {
    if (index >= 0 && index < this.assistantMessageContent.length) {
      this.assistantMessageContent[index] = block
      this.userMessageContentReady = false
    }
  }

  completePartialBlocks(): void {
    const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
    partialBlocks.forEach((block) => (block.partial = false))
  }

  // 工具调用追踪
  addToolCallIndex(toolCallId: string, index: number): void {
    this.streamingToolCallIndices.set(toolCallId, index)
  }

  getToolCallIndex(toolCallId: string): number | undefined {
    return this.streamingToolCallIndices.get(toolCallId)
  }

  removeToolCallIndex(toolCallId: string): void {
    this.streamingToolCallIndices.delete(toolCallId)
    this.userMessageContentReady = false
  }

  // 状态标志
  setStreaming(streaming: boolean): void {
    this.isStreaming = streaming
  }

  isStreamingActive(): boolean {
    return this.isStreaming
  }

  setDidRejectTool(rejected: boolean): void {
    this.didRejectTool = rejected
  }

  didRejectTool(): boolean {
    return this.didRejectTool
  }

  setDidAlreadyUseTool(used: boolean): void {
    this.didAlreadyUseTool = used
  }

  didAlreadyUseTool(): boolean {
    return this.didAlreadyUseTool
  }

  didUseTool(): boolean {
    return this.assistantMessageContent.some(
      (block) => block.type === "tool_use" || block.type === "mcp_tool_use"
    )
  }

  // 引用来源
  addGroundingSources(sources: GroundingSource[]): void {
    this.groundingSources.push(...sources)
  }

  // 中断控制
  setAbortController(controller?: AbortController): void {
    this.abortController = controller
  }

  getAbortController(): AbortController | undefined {
    return this.abortController
  }

  setAborted(aborted: boolean, reason?: string): void {
    this.aborted = aborted
    this.abortReason = reason
  }

  isAborted(): boolean {
    return this.aborted
  }

  getAbortReason(): string | undefined {
    return this.abortReason
  }

  shouldAbort(): boolean {
    return this.aborted
  }

  // 模型信息
  setCachedModel(model?: { id: string; info: ModelInfo }): void {
    this.cachedModel = model
  }

  getCachedModel(): { id: string; info: ModelInfo } | undefined {
    return this.cachedModel
  }

  // 历史保存
  setAssistantMessageSavedToHistory(saved: boolean): void {
    this.assistantMessageSavedToHistory = saved
  }

  isAssistantMessageSavedToHistory(): boolean {
    return this.assistantMessageSavedToHistory
  }

  // 推理消息完成
  async completeReasoningMessage(): Promise<void> {
    if (this.reasoningMessage) {
      const lastReasoningIndex = findLastIndex(
        this.clineMessages,
        (m) => m.type === "say" && m.say === "reasoning",
      )

      if (lastReasoningIndex !== -1) {
        const msg = this.clineMessages[lastReasoningIndex]
        if (msg && msg.partial) {
          msg.partial = false
          await this.config.onUpdateMessage(msg)
        }
      }
    }
  }

  // 用户消息内容
  setUserMessageContentReady(ready: boolean): void {
    this.userMessageContentReady = ready
  }

  isUserMessageContentReady(): boolean {
    return this.userMessageContentReady
  }

  // 清理
  cleanup(): void {
    this.setStreaming(false)
    this.setAbortController(undefined)
  }
}
```

### 4.3 ChunkHandler (数据块处理接口)

```typescript
// src/core/streaming/handlers/ChunkHandler.ts

export interface ChunkHandlerContext {
  stateManager: StreamingStateManager
  tokenManager: StreamingTokenManager
  config: StreamingProcessorConfig
}

export interface ChunkHandler {
  /**
   * 处理数据块
   * @param chunk 数据块
   */
  handle(chunk: StreamChunk): Promise<void>
}
```

### 4.4 ReasoningHandler (推理消息处理)

```typescript
// src/core/streaming/handlers/ReasoningHandler.ts

export class ReasoningHandler implements ChunkHandler {
  private stateManager: StreamingStateManager
  private tokenManager: StreamingTokenManager
  private config: StreamingProcessorConfig
  private deadLoopDetector: DeadLoopDetector

  constructor(context: ChunkHandlerContext) {
    this.stateManager = context.stateManager
    this.tokenManager = context.tokenManager
    this.config = context.config
    this.deadLoopDetector = new DeadLoopDetector()
  }

  async handle(chunk: StreamChunk): Promise<void> {
    if (chunk.type !== "reasoning") {
      return
    }

    // 累积推理消息
    this.stateManager.appendReasoningMessage(chunk.text)

    // 累积令牌
    this.tokenManager.addReasoningTokens(chunk.text)

    // 格式化推理消息
    const formattedReasoning = this.formatReasoningMessage(
      this.stateManager.getReasoningMessage()
    )

    // 死循环检测
    const detectionResult = this.deadLoopDetector.detect(
      this.stateManager.getReasoningMessage()
    )

    if (detectionResult.detected) {
      await this.handleDeadLoop(detectionResult)
      return
    }

    // 展示推理消息
    await this.config.onSay("reasoning", formattedReasoning, undefined, true)
  }

  private formatReasoningMessage(message: string): string {
    if (message.includes("**")) {
      return message.replace(
        /([.!?])\*\*([^*\n]+)\*\*/g,
        "$1\n\n**$2**"
      )
    }
    return message
  }

  private async handleDeadLoop(result: { detected: boolean; details: string }): Promise<void> {
    const errorMessage = `检测到死循环：${result.details}。任务已终止，请尝试重新描述任务或调整提示词。`

    await this.config.onSay("error", errorMessage)

    this.stateManager.setAborted(true, "streaming_failed")

    throw new Error(errorMessage)
  }
}
```

### 4.5 TextHandler (文本内容处理)

```typescript
// src/core/streaming/handlers/TextHandler.ts

export class TextHandler implements ChunkHandler {
  private stateManager: StreamingStateManager
  private tokenManager: StreamingTokenManager
  private config: StreamingProcessorConfig

  constructor(context: ChunkHandlerContext) {
    this.stateManager = context.stateManager
    this.tokenManager = context.tokenManager
    this.config = context.config
  }

  async handle(chunk: StreamChunk): Promise<void> {
    if (chunk.type !== "text") {
      return
    }

    // 累积文本
    this.stateManager.appendAssistantMessage(chunk.text)

    // 累积令牌
    this.tokenManager.addTextTokens(chunk.text)

    // 创建或更新文本块
    this.updateTextBlock()

    // 展示助手消息
    this.config.onPresentAssistant()
  }

  private updateTextBlock(): void {
    const lastBlock = this.stateManager.getAssistantMessageContent().at(-1)

    if (lastBlock?.type === "text" && lastBlock.partial) {
      lastBlock.content = this.stateManager.getAssistantMessage()
    } else {
      this.stateManager.addAssistantContentBlock({
        type: "text",
        content: this.stateManager.getAssistantMessage(),
        partial: true,
      })
    }
  }
}
```

### 4.6 ToolCallHandler (工具调用处理)

```typescript
// src/core/streaming/handlers/ToolCallHandler.ts

export class ToolCallHandler implements ChunkHandler {
  private stateManager: StreamingStateManager
  private tokenManager: StreamingTokenManager
  private config: StreamingProcessorConfig

  constructor(context: ChunkHandlerContext) {
    this.stateManager = context.stateManager
    this.tokenManager = context.tokenManager
    this.config = context.config
  }

  async handle(chunk: StreamChunk): Promise<void> {
    if (chunk.type === "tool_call_partial") {
      await this.handleToolCallPartial(chunk)
    } else if (chunk.type === "tool_call") {
      await this.handleToolCall(chunk)
    }
  }

  private async handleToolCallPartial(chunk: StreamChunk): Promise<void> {
    const event = chunk.event

    if (!event) {
      return
    }

    switch (event.type) {
      case "tool_call_start":
        await this.handleToolCallStart(event)
        break
      case "tool_call_delta":
        await this.handleToolCallDelta(event)
        break
      case "tool_call_end":
        await this.handleToolCallEnd(event)
        break
    }
  }

  private async handleToolCallStart(event: ToolCallStartEvent): Promise<void> {
    // 防止重复的工具调用开始事件
    if (this.stateManager.getToolCallIndex(event.id) !== undefined) {
      console.warn(
        `[Task#${this.config.taskId}] Ignoring duplicate tool_call_start for ID: ${event.id} (tool: ${event.name})`
      )
      return
    }

    // 初始化流式工具调用
    NativeToolCallParser.startStreamingToolCall(event.id, event.name as ToolName)

    // 追踪工具调用令牌
    this.tokenManager.addToolCallTokens(event.id, event.name as string, "")

    // 完成前一个文本块
    this.completePreviousTextBlock()

    // 记录工具调用索引
    const toolUseIndex = this.stateManager.getAssistantMessageContent().length
    this.stateManager.addToolCallIndex(event.id, toolUseIndex)

    // 创建部分工具调用
    const partialToolUse: ToolUse = {
      type: "tool_use",
      name: event.name as ToolName,
      params: {},
      partial: true,
    }
    ;(partialToolUse as any).id = event.id

    this.stateManager.addAssistantContentBlock(partialToolUse)

    // 展示助手消息
    this.config.onPresentAssistant()
  }

  private async handleToolCallDelta(event: ToolCallDeltaEvent): Promise<void> {
    const partialToolUse = NativeToolCallParser.processStreamingChunk(
      event.id,
      event.delta
    )

    if (!partialToolUse) {
      return
    }

    const toolUseIndex = this.stateManager.getToolCallIndex(event.id)

    if (toolUseIndex === undefined) {
      return
    }

    ;(partialToolUse as any).id = event.id
    this.stateManager.updateAssistantContentBlock(toolUseIndex, partialToolUse)

    // 更新工具调用令牌计数
    if (partialToolUse.name) {
      this.tokenManager.addToolCallTokens(
        event.id,
        partialToolUse.name,
        JSON.stringify(partialToolUse.params || {})
      )
    }

    // 展示助手消息
    this.config.onPresentAssistant()
  }

  private async handleToolCallEnd(event: ToolCallEndEvent): Promise<void> {
    const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
    const toolUseIndex = this.stateManager.getToolCallIndex(event.id)

    if (finalToolUse) {
      ;(finalToolUse as any).id = event.id

      if (toolUseIndex !== undefined) {
        this.stateManager.updateAssistantContentBlock(toolUseIndex, finalToolUse)
      }

      this.stateManager.removeToolCallIndex(event.id)
    } else if (toolUseIndex !== undefined) {
      // JSON格式错误或缺少参数
      const existingToolUse = this.stateManager.getAssistantMessageContent()[toolUseIndex]

      if (existingToolUse && existingToolUse.type === "tool_use") {
        existingToolUse.partial = false
        ;(existingToolUse as any).id = event.id
      }

      this.stateManager.removeToolCallIndex(event.id)
    }

    // 展示助手消息
    this.config.onPresentAssistant()
  }

  private async handleToolCall(chunk: StreamChunk): Promise<void> {
    // 向后兼容：处理完整的工具调用
    const toolUse = NativeToolCallParser.parseToolCall({
      id: chunk.id,
      name: chunk.name as ToolName,
      arguments: chunk.arguments,
    })

    if (!toolUse) {
      console.error(`Failed to parse tool call for task ${this.config.taskId}:`, chunk)
      return
    }

    toolUse.id = chunk.id
    this.stateManager.addAssistantContentBlock(toolUse)

    // 展示助手消息
    this.config.onPresentAssistant()
  }

  private completePreviousTextBlock(): void {
    const lastBlock = this.stateManager.getAssistantMessageContent().at(-1)

    if (lastBlock?.type === "text" && lastBlock.partial) {
      lastBlock.partial = false
    }
  }

  async finalizeToolCall(toolCallId: string): Promise<void> {
    await this.handleToolCallEnd({ type: "tool_call_end", id: toolCallId })
  }
}
```

### 4.7 UsageHandler (令牌使用处理)

```typescript
// src/core/streaming/handlers/UsageHandler.ts

export class UsageHandler implements ChunkHandler {
  private stateManager: StreamingStateManager
  private tokenManager: StreamingTokenManager
  private config: StreamingProcessorConfig

  constructor(context: ChunkHandlerContext) {
    this.stateManager = context.stateManager
    this.tokenManager = context.tokenManager
    this.config = context.config
  }

  async handle(chunk: StreamChunk): Promise<void> {
    if (chunk.type !== "usage") {
      return
    }

    // 累积令牌
    this.tokenManager.addApiUsage(
      chunk.inputTokens,
      chunk.outputTokens,
      chunk.cacheWriteTokens ?? 0,
      chunk.cacheReadTokens ?? 0,
      chunk.totalCost
    )
  }
}
```

### 4.8 GroundingHandler (引用来源处理)

```typescript
// src/core/streaming/handlers/GroundingHandler.ts

export class GroundingHandler implements ChunkHandler {
  private stateManager: StreamingStateManager
  private config: StreamingProcessorConfig

  constructor(context: ChunkHandlerContext) {
    this.stateManager = context.stateManager
    this.config = context.config
  }

  async handle(chunk: StreamChunk): Promise<void> {
    if (chunk.type !== "grounding") {
      return
    }

    // 单独存储引用来源，避免状态持久化问题
    if (chunk.sources && chunk.sources.length > 0) {
      this.stateManager.addGroundingSources(chunk.sources)
    }
  }
}
```

### 4.9 StreamingTokenManager (令牌管理)

```typescript
// src/core/streaming/StreamingTokenManager.ts

export class StreamingTokenManager {
  private api: ApiHandler
  private tokenCounter: StreamingTokenCounter
  private tokens: {
    input: number
    output: number
    cacheWrite: number
    cacheRead: number
    totalCost: number
  }
  private hasApiUsageData: boolean
  private collectedInBackground: boolean

  constructor(api: ApiHandler) {
    this.api = api
    this.tokenCounter = new StreamingTokenCounter()
    this.tokens = {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      totalCost: 0,
    }
    this.hasApiUsageData = false
    this.collectedInBackground = false
  }

  reset(): void {
    this.tokenCounter = new StreamingTokenCounter()
    this.tokens = {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      totalCost: 0,
    }
    this.hasApiUsageData = false
    this.collectedInBackground = false
  }

  // 添加推理令牌
  addReasoningTokens(text: string): void {
    this.tokenCounter.addReasoning(text)
  }

  // 添加文本令牌
  addTextTokens(text: string): void {
    this.tokenCounter.addText(text)
  }

  // 添加工具调用令牌
  addToolCallTokens(id: string, name: string, args: string): void {
    this.tokenCounter.addToolCall(id, name, args)
  }

  // 添加 API 使用数据
  addApiUsage(
    inputTokens: number,
    outputTokens: number,
    cacheWriteTokens: number,
    cacheReadTokens: number,
    totalCost: number
  ): void {
    this.tokens.input += inputTokens
    this.tokens.output += outputTokens
    this.tokens.cacheWrite += cacheWriteTokens
    this.tokens.cacheRead += cacheReadTokens
    this.tokens.totalCost = totalCost

    // 只有当 outputTokens > 0 时，才认为 API 提供了有效的使用数据
    if (outputTokens > 0) {
      this.hasApiUsageData = true
    }
  }

  // 后台收集令牌数据
  async collectBackgroundUsage(): Promise<void> {
    // 实现后台令牌收集逻辑
    // ...
    this.collectedInBackground = true
  }

  // 检查 tiktoken 回退
  async checkTiktokenFallback(): Promise<void> {
    const isApiUsageInvalid = !this.hasApiUsageData ||
      (this.tokens.input === 0 && this.tokens.output === 0)

    if (isApiUsageInvalid && this.tokenCounter.getTotalTokens() > 0) {
      await this.applyTiktokenFallback()
    }
  }

  private async applyTiktokenFallback(): Promise<void> {
    console.log(`[StreamingProcessor] API did not provide valid usage data. Using tiktoken fallback.`)

    const estimatedOutputTokens = this.tokenCounter.getTotalTokens()

    if (estimatedOutputTokens > 0) {
      // 使用 tiktoken 计算输入令牌
      const inputTokensEstimate = await this.estimateInputTokens()

      // 覆盖令牌计数
      this.tokens.input = inputTokensEstimate
      this.tokens.output = estimatedOutputTokens

      // 重新计算成本
      await this.recalculateCost()
    }
  }

  private async estimateInputTokens(): Promise<number> {
    // 实现输入令牌估算
    // ...
    return 0
  }

  private async recalculateCost(): Promise<void> {
    // 实现成本重新计算
    // ...
  }

  // 获取令牌数据
  getTokens() {
    return { ...this.tokens }
  }

  // 获取令牌分解
  getTokenBreakdown() {
    return this.tokenCounter.getTokenBreakdown()
  }

  // 检查是否有 API 使用数据
  hasValidApiUsage(): boolean {
    return this.hasApiUsageData
  }
}
```

### 4.10 StreamingErrorHandler (错误处理)

```typescript
// src/core/streaming/StreamingErrorHandler.ts

export interface ErrorHandlingResult {
  shouldRetry: boolean
  retryDelay?: number
  abortReason?: string
  errorMessage?: string
}

export class StreamingErrorHandler {
  private config: StreamingProcessorConfig
  private stateManager: StreamingStateManager

  constructor(config: StreamingProcessorConfig) {
    this.config = config
    this.stateManager = config.stateManager
  }

  async abortStream(cancelReason?: string, streamingFailedMessage?: string): Promise<void> {
    // 恢复 diff 视图更改
    if (this.config.diffViewProvider.isEditing) {
      await this.config.diffViewProvider.revertChanges()
    }

    // 完成部分消息
    const lastMessage = this.config.clineMessages.at(-1)
    if (lastMessage && lastMessage.partial) {
      lastMessage.partial = false
    }

    // 更新 api_req_started 消息
    // ...

    // 保存消息
    await this.config.onSaveMessages()

    // 标记完成
    this.stateManager.setAborted(true, cancelReason)
  }

  async handleError(error: unknown): Promise<ErrorHandlingResult> {
    if (this.stateManager.isAborted()) {
      return {
        shouldRetry: false,
        abortReason: this.stateManager.getAbortReason(),
      }
    }

    const cancelReason: ClineApiReqCancelReason = this.stateManager.isAborted()
      ? "user_cancelled"
      : "streaming_failed"

    const rawErrorMessage = this.extractErrorMessage(error)
    const streamingFailedMessage = this.stateManager.isAborted()
      ? undefined
      : `${t("common:interruption.streamTerminatedByProvider")}: ${rawErrorMessage}`

    await this.abortStream(cancelReason, streamingFailedMessage)

    if (this.stateManager.isAborted()) {
      return {
        shouldRetry: false,
        abortReason: cancelReason,
      }
    }

    // 流式失败，重试
    return {
      shouldRetry: true,
      retryDelay: await this.calculateBackoffDelay(),
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return JSON.stringify(serializeError(error), null, 2)
  }

  private async calculateBackoffDelay(): Promise<number> {
    // 实现退避延迟计算
    // ...
    return 0
  }
}
```

---

## 5. 接口定义

### 5.1 核心接口

```typescript
// src/core/streaming/types.ts

export interface StreamChunk {
  type: "reasoning" | "usage" | "grounding" | "tool_call_partial" | "tool_call" | "text"
  [key: string]: any
}

export interface ToolCallStartEvent {
  type: "tool_call_start"
  id: string
  name: string
}

export interface ToolCallDeltaEvent {
  type: "tool_call_delta"
  id: string
  delta: string
}

export interface ToolCallEndEvent {
  type: "tool_call_end"
  id: string
}

export type ToolCallEvent = ToolCallStartEvent | ToolCallDeltaEvent | ToolCallEndEvent

export interface GroundingSource {
  url: string
  [key: string]: any
}

export interface AssistantMessageContent {
  type: "text" | "tool_use" | "mcp_tool_use"
  [key: string]: any
}

export interface ClineMessage {
  type: string
  say?: string
  content?: string
  partial?: boolean
  [key: string]: any
}

export interface ApiMessage {
  role: "user" | "assistant"
  content: any
  reasoning?: string
}

export interface ModelInfo {
  id: string
  [key: string]: any
}

export interface DiffViewProvider {
  isEditing: boolean
  reset(): Promise<void>
  revertChanges(): Promise<void>
}

export interface ApiHandler {
  getModel(): { id: string; info: ModelInfo }
  countTokens(content: any[]): Promise<number>
  [key: string]: any
}
```

---

## 6. 数据流设计

### 6.1 流式处理数据流

```
API Stream
    ↓
StreamingProcessor.processStream()
    ↓
processLoop()
    ├─ nextChunkWithAbort() (带中断检查)
    │   ↓
    ├─ handleChunk()
    │   ↓
    │   ChunkHandler (根据类型)
    │   ├─ ReasoningHandler → StateManager + TokenManager
    │   ├─ TextHandler → StateManager + TokenManager
    │   ├─ ToolCallHandler → StateManager + TokenManager
    │   ├─ UsageHandler → TokenManager
    │   └─ GroundingHandler → StateManager
    │
    └─ 检查中断条件
        ├─ shouldAbort() → abortStream()
        ├─ didRejectTool() → 退出循环
        └─ didAlreadyUseTool() → 退出循环
    ↓
finalize()
    ├─ finalizeIncompleteToolCalls()
    ├─ completePartialBlocks()
    ├─ completeReasoningMessage()
    ├─ collectBackgroundUsage()
    └─ checkTiktokenFallback()
    ↓
buildResult()
    ↓
返回 StreamingResult
```

### 6.2 状态管理数据流

```
StreamingStateManager
    ├─ 流式控制状态
    │   ├─ isStreaming
    │   ├─ currentStreamingContentIndex
    │   └─ didCompleteReadingStream
    │
    ├─ 消息内容状态
    │   ├─ assistantMessage
    │   ├─ reasoningMessage
    │   ├─ assistantMessageContent[]
    │   └─ userMessageContent[]
    │
    ├─ 工具调用状态
    │   ├─ streamingToolCallIndices (Map)
    │   ├─ didRejectTool
    │   └─ didAlreadyUseTool
    │
    ├─ 引用来源状态
    │   └─ groundingSources[]
    │
    └─ 中断控制状态
        ├─ abortController
        ├─ aborted
        └─ abortReason
```

---

## 7. 实施步骤

### 7.1 第一阶段：基础设施准备 (1-2天)

1. **创建目录结构**
   ```
   src/core/streaming/
   ├── handlers/
   ├── types.ts
   ├── StreamingProcessor.ts
   ├── StreamingStateManager.ts
   ├── StreamingTokenManager.ts
   └── StreamingErrorHandler.ts
   ```

2. **定义类型和接口**
   - 创建 `types.ts` 文件
   - 定义所有核心接口和类型

3. **创建测试框架**
   - 为每个模块创建单元测试文件
   - 设置测试环境

### 7.2 第二阶段：状态管理实现 (2-3天)

1. **实现 StreamingStateManager**
   - 实现所有状态管理方法
   - 编写单元测试

2. **实现 StreamingTokenManager**
   - 集成 StreamingTokenCounter
   - 实现令牌累积和管理逻辑
   - 实现 tiktoken 回退
   - 编写单元测试

### 7.3 第三阶段：处理器实现 (3-4天)

1. **实现 ChunkHandler 接口**
   - 定义基础接口

2. **实现各个 Handler**
   - ReasoningHandler
   - TextHandler
   - ToolCallHandler
   - UsageHandler
   - GroundingHandler
   - 为每个 Handler 编写单元测试

### 7.4 第四阶段：核心控制器实现 (2-3天)

1. **实现 StreamingProcessor**
   - 实现主处理循环
   - 集成所有 Handler
   - 实现错误处理
   - 编写集成测试

2. **实现 StreamingErrorHandler**
   - 实现中断逻辑
   - 实现重试逻辑
   - 实现退避策略

### 7.5 第五阶段：集成到 Task.ts (2-3天)

1. **修改 Task.ts**
   - 引入 StreamingProcessor
   - 替换现有流式处理代码
   - 保持向后兼容

2. **适配器层**
   - 创建适配器连接 Task 和 StreamingProcessor
   - 处理回调函数

### 7.6 第六阶段：测试和优化 (3-5天)

1. **集成测试**
   - 测试完整的流式处理流程
   - 测试各种边界情况

2. **性能测试**
   - 测试流式处理性能
   - 优化瓶颈

3. **回归测试**
   - 确保所有现有功能正常工作
   - 修复发现的问题

### 7.7 第七阶段：文档和清理 (1-2天)

1. **更新文档**
   - 更新架构文档
   - 添加使用示例

2. **代码清理**
   - 移除未使用的代码
   - 优化代码结构

**总计**: 约 14-22 天

---

## 8. 风险评估与缓解

### 8.1 风险识别

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| 状态同步问题 | 高 | 中 | 使用单一状态管理器，确保状态一致性 |
| 性能下降 | 中 | 低 | 使用原地更新，避免不必要的复制 |
| 测试覆盖不足 | 高 | 中 | 编写全面的单元测试和集成测试 |
| 向后兼容性破坏 | 高 | 低 | 保持现有接口，使用适配器层 |
| 重构工作量过大 | 中 | 高 | 分阶段实施，逐步验证 |
| 依赖关系复杂 | 中 | 中 | 清晰定义接口，使用依赖注入 |

### 8.2 缓解策略

1. **分阶段实施**
   - 每个阶段独立验证
   - 及时发现和解决问题

2. **保持向后兼容**
   - 使用适配器模式
   - 逐步迁移

3. **全面测试**
   - 单元测试覆盖所有模块
   - 集成测试覆盖主要流程
   - 回归测试确保现有功能

4. **代码审查**
   - 每个阶段完成后进行审查
   - 及时发现设计问题

5. **性能监控**
   - 对比重构前后的性能
   - 优化关键路径

---

## 9. 测试策略

### 9.1 单元测试

每个模块都需要编写单元测试：

| 模块 | 测试重点 |
|-----|---------|
| StreamingStateManager | 状态读写、重置、生命周期 |
| StreamingTokenManager | 令牌累积、tiktoken 回退、成本计算 |
| ReasoningHandler | 推理消息处理、死循环检测 |
| TextHandler | 文本累积、内容块管理 |
| ToolCallHandler | 工具调用增量更新、完成处理 |
| UsageHandler | 令牌使用累积 |
| GroundingHandler | 引用来源存储 |
| StreamingErrorHandler | 错误处理、重试逻辑 |
| StreamingProcessor | 主流程、集成测试 |

### 9.2 集成测试

测试完整的流式处理流程：

1. **正常流程**
   - 各种数据块类型
   - 工具调用
   - 令牌计数

2. **异常流程**
   - 中断处理
   - 错误处理
   - 重试逻辑

3. **边界情况**
   - 空响应
   - 超长响应
   - 大量工具调用

### 9.3 回归测试

确保所有现有功能正常工作：

1. **Task 功能测试**
   - 任务创建
   - 工具执行
   - 消息保存

2. **UI 测试**
   - 消息展示
   - 工具调用显示
   - 成本显示

### 9.4 性能测试

对比重构前后的性能：

1. **响应时间**
   - 首个数据块时间
   - 完整流时间

2. **内存使用**
   - 内存占用
   - 垃圾回收

3. **CPU 使用**
   - 处理效率
   - 资源消耗

---

## 10. 总结

### 10.1 拆分优势

1. **降低复杂度**: Task.ts 减少 800+ 行代码
2. **提高可维护性**: 模块职责清晰，易于理解和修改
3. **增强可测试性**: 独立模块可以单独测试
4. **改善代码组织**: 相关功能集中管理
5. **支持复用**: 流式处理逻辑可以在其他场景复用

### 10.2 关键设计决策

1. **三层架构**: 分离关注点，降低耦合
2. **单一状态管理器**: 确保状态一致性
3. **Handler 模式**: 易于扩展新的数据块类型
4. **依赖注入**: 提高灵活性，便于测试
5. **适配器模式**: 保持向后兼容

### 10.3 下一步行动

1. **评审方案**: 与团队讨论和评审
2. **技术选型**: 确认技术方案
3. **制定计划**: 详细实施计划和时间表
4. **开始实施**: 按阶段逐步实施
5. **持续优化**: 根据反馈持续改进

---

**文档版本**: 1.0
**创建日期**: 2026-02-26
**作者**: CodeArts Agent
**基于**: streaming_processing_analysis.md
