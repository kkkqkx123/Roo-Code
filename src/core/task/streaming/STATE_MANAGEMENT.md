# 状态管理优化建议

## 当前状态管理问题

### 状态分散

当前状态分散在多个组件中：

```
Task.ts (20+ 个状态变量)
├── isStreaming
├── assistantMessageContent
├── userMessageContent
├── streamingToolCallIndices
├── currentStreamingContentIndex
├── didCompleteReadingStream
├── userMessageContentReady
├── didRejectTool
├── didAlreadyUseTool
├── assistantMessageSavedToHistory
├── didToolFailInCurrentTurn
├── presentAssistantMessageLocked
├── presentAssistantMessageHasPendingUpdates
└── ...

StreamProcessor (内部状态)
├── state: StreamProcessorState
│   ├── inputTokens
│   ├── outputTokens
│   ├── cacheWriteTokens
│   ├── cacheReadTokens
│   ├── totalCost
│   └── hasApiUsageData
├── assistantMessage: string
├── reasoningMessage: string
├── pendingGroundingSources: GroundingSource[]
├── tokenCounter: StreamingTokenCounter
└── deadLoopDetector: DeadLoopDetector

StreamPostProcessor (内部状态)
├── state: StreamPostProcessorState
│   ├── isActive
│   ├── lastResult
│   └── consecutiveNoContentFailures
```

### 问题分析

1. **状态不一致风险**
   - 同一数据在多个地方维护
   - 容易出现同步问题
   - 难以追踪状态变化

2. **调试困难**
   - 状态分散，难以定位问题
   - 需要在多个地方检查状态
   - 状态变化路径不清晰

3. **测试复杂**
   - 需要模拟多个组件的状态
   - 状态初始化复杂
   - 难以隔离测试

4. **内存占用**
   - 重复存储相同数据
   - 状态对象占用内存
   - 清理不彻底可能导致内存泄漏

## 优化方案

### 方案A：无状态处理器（推荐）

将StreamProcessor和StreamPostProcessor改为无状态设计：

```typescript
class StreamProcessor {
  // 不保存实例状态
  // 所有状态通过参数传入和返回

  async processStream(
    stream: ApiStream,
    context: ProcessingContext
  ): Promise<StreamProcessingResult> {
    // 从context读取初始状态
    let state = context.initialState

    // 处理流
    for await (const chunk of stream) {
      state = await this.handleChunk(chunk, state)
    }

    // 返回最终状态
    return state
  }

  private async handleChunk(
    chunk: ApiStreamChunk,
    state: StreamProcessorState
  ): Promise<StreamProcessorState> {
    // 纯函数：输入状态，返回新状态
    // 不修改实例变量
    return { ...state, /* 更新后的状态 */ }
  }
}
```

**优点：**
- 状态集中管理
- 易于测试（纯函数）
- 无副作用
- 易于并行化

**缺点：**
- 需要大量重构
- 可能影响性能（频繁创建状态对象）

### 方案B：状态集中到Task

将所有状态集中到Task，处理器只通过回调访问：

```typescript
class StreamProcessor {
  // 不保存状态
  // 所有状态通过callbacks访问

  async processStream(stream: ApiStream): Promise<void> {
    for await (const chunk of stream) {
      await this.handleChunk(chunk)
    }
  }

  private async handleChunk(chunk: ApiStreamChunk): Promise<void> {
    // 通过callbacks读取和更新状态
    const currentState = await this.callbacks.getState()
    const newState = this.processChunk(chunk, currentState)
    await this.callbacks.updateState(newState)
  }
}
```

**优点：**
- 状态集中
- 重构量较小
- 保持现有架构

**缺点：**
- 回调调用频繁
- 性能可能受影响

### 方案C：状态对象传递

创建一个统一的状态对象，在组件间传递：

```typescript
interface StreamingState {
  // Token使用
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  totalCost?: number
  hasApiUsageData: boolean

  // 内容
  assistantMessage: string
  reasoningMessage: string
  assistantMessageContent: any[]
  pendingGroundingSources: GroundingSource[]

  // 工具调用
  streamingToolCallIndices: Map<string, number>
  currentStreamingContentIndex: number

  // 标志
  isStreaming: boolean
  didCompleteReadingStream: boolean
  userMessageContentReady: boolean
  // ...
}

class StreamProcessor {
  async processStream(
    stream: ApiStream,
    state: StreamingState
  ): Promise<StreamingState> {
    // 处理流，返回更新后的状态
    let currentState = state

    for await (const chunk of stream) {
      currentState = await this.handleChunk(chunk, currentState)
    }

    return currentState
  }
}
```

**优点：**
- 状态统一
- 类型安全
- 易于追踪

**缺点：**
- 需要重构
- 状态对象可能很大

## 推荐实施步骤

### 阶段1：创建统一状态接口（当前）

1. 定义`StreamingState`接口
2. 创建状态工厂函数
3. 添加状态转换函数

### 阶段2：重构StreamProcessor（后续）

1. 移除实例状态变量
2. 通过参数传递状态
3. 返回更新后的状态

### 阶段3：重构StreamPostProcessor（后续）

1. 移除实例状态变量
2. 通过参数传递状态
3. 返回更新后的状态

### 阶段4：更新Task集成（后续）

1. 创建初始状态
2. 传递状态给处理器
3. 接收并保存最终状态

## 当前实施

由于完整重构需要大量工作，当前阶段我们：

1. ✅ 移除了StreamCoordinator（减少抽象层）
2. ✅ 简化了回调接口（使用SharedCallbacks）
3. ⏸️ 保留当前状态管理（避免破坏性变更）

未来可以考虑逐步实施上述优化方案。

## 总结

当前状态管理存在分散和不一致的问题，但完整重构需要大量工作。建议：

1. **短期**：保持当前状态管理，确保代码稳定
2. **中期**：创建统一状态接口，逐步迁移
3. **长期**：实现无状态处理器，提高可测试性

优先级：稳定性 > 可维护性 > 性能