# TaskEventBus 实现文档

**文档版本**: 1.0  
**创建日期**: 2026 年 2 月 28 日  
**状态**: 已完成 - 等待集成

---

## 概述

TaskEventBus 是 Task.ts 架构重构的核心组件，提供解耦的事件驱动通信机制。本文档说明其设计决策、API 和使用方法。

---

## 目录

1. [设计目标](#1-设计目标)
2. [架构设计](#2-架构设计)
3. [API 参考](#3-api-参考)
4. [使用示例](#4-使用示例)
5. [集成指南](#5-集成指南)
6. [测试策略](#6-测试策略)

---

## 1. 设计目标

### 1.1 核心需求

| 需求 | 描述 | 实现方式 |
|------|------|---------|
| **类型安全** | TypeScript 严格模式下的完整类型检查 | 泛型事件映射 |
| **背压控制** | 防止事件发布过快导致系统过载 | PQueue 队列 |
| **可调试性** | 支持事件历史回放 | 事件历史记录 |
| **资源管理** | 防止内存泄漏 | Subscription 模式 |
| **向后兼容** | 支持渐进式迁移 | 特性开关 |

### 1.2 非目标

- ❌ 替代现有 StreamingProcessor（而是增强）
- ❌ 全局事件总线（仅限 Task 范围）
- ❌ 持久化事件存储（仅内存历史）

---

## 2. 架构设计

### 2.1 组件关系

```
┌─────────────────────────────────────────────────────────┐
│                      Task.ts                            │
│  - 订阅事件 (subscribe)                                  │
│  - 发布任务状态事件 (publish)                            │
└─────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────┐
│                   TaskEventBus                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Event Queue (PQueue)                             │  │
│  │  - 背压控制                                        │  │
│  │  - 并发控制                                        │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Event History                                    │  │
│  │  - 记录事件                                        │  │
│  │  - 支持回放                                        │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Subscription Manager                             │  │
│  │  - 订阅管理                                        │  │
│  │  - 自动清理                                        │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ↕
┌──────────────┬──────────────┬──────────────────────────┐
│ Streaming    │ Tool         │ Token                    │
│ Processor    │ Executor     │ Manager                  │
│              │              │                          │
│ - 发布       │ - 发布       │ - 发布                   │
│   stream:*   │   tool:*     │   token:update           │
│ - 订阅       │ - 订阅       │ - 订阅                   │
│   tool:call  │   stream:    │   stream:chunk           │
│   abort      │   complete   │                          │
└──────────────┴──────────────┴──────────────────────────┘
```

### 2.2 事件类型层次

```
TaskEventMap
├── 流式处理事件
│   ├── stream:start (请求开始)
│   ├── stream:chunk (数据块到达)
│   ├── stream:complete (流式完成)
│   └── stream:error (流式错误)
├── 工具调用事件
│   ├── tool:call:start (工具开始)
│   ├── tool:call:progress (工具进度)
│   ├── tool:call:complete (工具完成)
│   └── tool:call:error (工具错误)
├── Token 事件
│   └── token:update (Token 更新)
└── 任务状态事件
    ├── task:state:change (状态变更)
    └── task:abort (任务取消)
```

### 2.3 数据流

```
1. StreamingProcessor 接收 API 流
         ↓
2. Handler 解析 chunk
         ↓
3. 发布 'stream:chunk' 事件
         ↓
4. TaskEventBus 队列处理
         ↓
5. Task 订阅者接收事件
         ↓
6. 更新 UI / 状态
```

---

## 3. API 参考

### 3.1 TaskEventBus

#### 构造函数

```typescript
new TaskEventBus(config?: TaskEventBusConfig)

interface TaskEventBusConfig {
  maxHistorySize?: number      // 默认：1000
  enableHistory?: boolean      // 默认：true
  concurrency?: number         // 默认：1 (顺序处理)
}
```

#### 发布事件

```typescript
// 同步发布（等待处理完成）
await eventBus.publish('stream:chunk', data)

// 异步发布（不等待）
eventBus.publishAsync('token:update', data)
```

#### 订阅事件

```typescript
// 订阅
const subscription = eventBus.subscribe('stream:complete', handler)

// 订阅一次
const onceSub = eventBus.subscribeOnce('stream:complete', handler)

// 订阅所有事件
const allSub = eventBus.subscribeAll(handler)

// 取消订阅
subscription.unsubscribe()
```

#### 事件历史

```typescript
// 获取历史
const history = eventBus.getHistory()
const filtered = eventBus.getHistory({ type: 'stream:', since: Date.now() - 60000 })

// 回放历史
await eventBus.replayHistory(handler)

// 清除历史
eventBus.clearHistory()
```

#### 队列管理

```typescript
// 等待队列清空
await eventBus.drain()

// 清除队列
eventBus.clearQueue()

// 获取统计
const stats = eventBus.getStats()
// { listenerCount, subscriptionCount, pendingEvents, activeProcessors, historySize }
```

#### 清理

```typescript
// 释放所有资源
eventBus.dispose()
```

### 3.2 事件数据类型

详见 `types.ts`，主要类型：

```typescript
// 流式事件
StreamStartEvent
StreamChunkEvent
StreamCompleteEvent
StreamErrorEvent

// 工具事件
ToolCallEvent
ToolCallStartEvent
ToolCallProgressEvent
ToolCallCompleteEvent
ToolCallErrorEvent

// Token 事件
TokenUpdateEvent

// 任务状态事件
TaskStateChangeEvent
TaskAbortEvent
```

---

## 4. 使用示例

### 4.1 基本使用

```typescript
import { TaskEventBus } from './TaskEventBus'

const eventBus = new TaskEventBus()

// 订阅事件
const subscription = eventBus.subscribe('stream:chunk', (data) => {
  console.log('Received chunk:', data)
})

// 发布事件
await eventBus.publish('stream:chunk', {
  type: 'text',
  data: { type: 'text', text: 'Hello, World!' }
})

// 清理
subscription.unsubscribe()
eventBus.dispose()
```

### 4.2 流式处理工作流

```typescript
// Task.ts 中订阅流式事件
eventBus.subscribe('stream:start', (data) => {
  console.log('Stream started:', data.requestId)
})

eventBus.subscribe('stream:chunk', async (data) => {
  // 更新 UI
  await this.updateUI(data)
  
  // 累积内容
  this.accumulatedContent += (data.data as any).text
})

eventBus.subscribe('stream:complete', async (data) => {
  console.log('Stream completed:', data.assistantMessage)
  console.log('Token usage:', data.tokens)
  
  // 保存到历史
  await this.saveToHistory(data)
})

// StreamingProcessor 中发布事件
async function processStream(stream: AsyncIterable<StreamChunk>) {
  await eventBus.publish('stream:start', {
    requestId: generateId(),
    systemPrompt: this.systemPrompt,
    messages: this.messages
  })
  
  for await (const chunk of stream) {
    await eventBus.publish('stream:chunk', {
      type: chunk.type,
      data: chunk.data
    })
  }
  
  await eventBus.publish('stream:complete', result)
}
```

### 4.3 工具调用工作流

```typescript
// 订阅工具事件
eventBus.subscribe('tool:call:start', (data) => {
  console.log('Tool called:', data.toolCall.name)
  this.showToolProgress(data.toolCall)
})

eventBus.subscribe('tool:call:progress', (data) => {
  this.updateToolProgress(data.toolCallId, data.progress)
})

eventBus.subscribe('tool:call:complete', async (data) => {
  if (data.result.success) {
    console.log('Tool completed:', data.result.result)
    await this.handleToolResult(data.result)
  } else {
    console.error('Tool failed:', data.result.error)
  }
})

// 工具执行器中发布事件
async function executeTool(toolCall: ToolCallEvent) {
  await eventBus.publish('tool:call:start', {
    toolCall,
    timestamp: Date.now()
  })
  
  try {
    const result = await tool.execute(toolCall.args)
    
    await eventBus.publish('tool:call:complete', {
      toolCallId: toolCall.id,
      result: {
        toolCallId: toolCall.id,
        result,
        success: true
      }
    })
  } catch (error) {
    await eventBus.publish('tool:call:complete', {
      toolCallId: toolCall.id,
      result: {
        toolCallId: toolCall.id,
        error,
        success: false
      }
    })
  }
}
```

### 4.4 Token 更新监听

```typescript
// 订阅 Token 更新
eventBus.subscribe('token:update', (data) => {
  console.log('Token usage updated:')
  console.log('  Input:', data.tokens.input)
  console.log('  Output:', data.tokens.output)
  console.log('  Breakdown:', data.breakdown)
  
  // 更新 UI 显示
  this.updateTokenDisplay(data.tokens)
})

// StreamingTokenManager 中发布事件
function addApiUsage(input: number, output: number, cost: number) {
  this.tokens.input += input
  this.tokens.output += output
  this.tokens.totalCost = cost
  
  // 发布更新事件
  eventBus.publish('token:update', {
    tokens: this.tokens,
    breakdown: this.getBreakdown(),
    isFinal: false
  })
}
```

### 4.5 调试与回放

```typescript
// 记录所有事件到控制台
eventBus.subscribeAll((event) => {
  console.log(`[${event.type}]`, event.data)
})

// 获取最近的事件历史
const recentEvents = eventBus.getHistory({
  type: 'stream:',
  since: Date.now() - 60000,
  limit: 100
})

// 回放事件用于调试
await eventBus.replayHistory((event) => {
  console.log('Replaying:', event.type, event.data)
}, {
  type: 'tool:'
})

// 获取统计信息
const stats = eventBus.getStats()
console.log('Event Bus Stats:', stats)
```

---

## 5. 集成指南

### 5.1 集成到 StreamingProcessor

**步骤 1**: 修改配置

```typescript
// streaming/types.ts
export interface StreamingProcessorConfig {
  // ... 现有配置
  eventBus?: TaskEventBus  // 新增
}
```

**步骤 2**: 在 Handler 中发布事件

```typescript
// streaming/handlers/TextHandler.ts
export class TextHandler implements ChunkHandler {
  async handle(chunk: StreamChunk) {
    // 现有逻辑
    this.tokenManager.addTextTokens(chunk.text)
    
    // 新增：发布事件
    if (this.config.eventBus) {
      await this.config.eventBus.publish('stream:chunk', {
        type: 'text',
        data: { type: 'text', text: chunk.text }
      })
    }
  }
}
```

**步骤 3**: 在 Task 中订阅

```typescript
// Task.ts
constructor(...) {
  this.eventBus = new TaskEventBus()
  
  this.eventBus.subscribe('stream:complete', this.handleStreamComplete.bind(this))
  this.eventBus.subscribe('token:update', this.handleTokenUpdate.bind(this))
}
```

### 5.2 特性开关

```typescript
// 通过环境变量控制
const USE_EVENT_ARCH = process.env.ROO_EVENT_ARCH === 'true'

// Task.ts 中使用
if (USE_EVENT_ARCH) {
  this.eventBus = new TaskEventBus()
  this.setupEventSubscriptions()
}

// 在关键路径检查
if (USE_EVENT_ARCH && this.eventBus) {
  await this.eventBus.publish('stream:complete', result)
} else {
  // 回退到旧逻辑
  this.legacyHandleStreamComplete(result)
}
```

### 5.3 并行验证

```typescript
// 开发阶段同时运行新旧实现
async function processStreamWithValidation(stream: AsyncIterable<StreamChunk>) {
  const [legacyResult, eventResult] = await Promise.all([
    this.legacyProcessStream(stream),
    this.eventDrivenProcessStream(stream)
  ])
  
  // 验证结果一致
  if (!deepEqual(legacyResult, eventResult)) {
    console.error('Event-driven result differs from legacy!')
    console.error('Legacy:', legacyResult)
    console.error('Event:', eventResult)
  }
  
  return eventResult
}
```

---

## 6. 测试策略

### 6.1 单元测试

```typescript
// __tests__/TaskEventBus.spec.ts
describe('TaskEventBus', () => {
  it('should publish events to subscribers', async () => {
    const handler = vi.fn()
    eventBus.subscribe('stream:chunk', handler)
    
    await eventBus.publish('stream:chunk', testData)
    
    expect(handler).toHaveBeenCalledWith(testData)
  })
  
  it('should handle backpressure', async () => {
    // 测试队列背压
  })
  
  it('should track history', async () => {
    // 测试历史记录
  })
})
```

### 6.2 集成测试

```typescript
// __tests__/TaskEventBus.integration.spec.ts
describe('TaskEventBus Integration', () => {
  it('should coordinate streaming and tool execution', async () => {
    // 测试完整工作流
  })
  
  it('should handle concurrent events', async () => {
    // 测试并发处理
  })
})
```

### 6.3 性能测试

```typescript
// __tests__/TaskEventBus.perf.spec.ts
describe('TaskEventBus Performance', () => {
  it('should handle 1000 events/second', async () => {
    const start = performance.now()
    
    for (let i = 0; i < 1000; i++) {
      eventBus.publishAsync('stream:chunk', testData)
    }
    
    await eventBus.drain()
    const duration = performance.now() - start
    
    expect(duration).toBeLessThan(1000) // 1 秒内完成
  })
})
```

---

## 7. 性能考虑

### 7.1 基准目标

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 事件延迟 | < 10ms | publish 到 handler 调用 |
| 吞吐量 | > 1000 events/s | 连续发布测试 |
| 内存使用 | < 10MB (1000 事件历史) | 堆快照 |
| CPU 使用 | < 5% 额外开销 | 性能分析 |

### 7.2 优化策略

1. **批处理**: 对于高频事件（如 stream:chunk），支持批处理
2. **懒加载**: 历史记录可选禁用
3. **并发控制**: 调整 concurrency 参数
4. **订阅清理**: 及时调用 dispose()

---

## 8. 故障排除

### 8.1 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 事件未触发 | 订阅者未注册 | 检查订阅时机 |
| 内存泄漏 | 未取消订阅 | 使用 Subscription 模式 |
| 事件丢失 | 队列溢出 | 增加 concurrency |
| 顺序错乱 | 异步处理 | 使用 publish 而非 publishAsync |

### 8.2 调试技巧

```typescript
// 启用详细日志
eventBus.subscribeAll((event) => {
  console.log(`[EventBus] ${event.type}:`, event.data)
})

// 检查统计
console.log(eventBus.getStats())

// 回放历史
await eventBus.replayHistory(console.log)
```

---

## 9. 后续计划

### 9.1 短期（已完成）

- [x] TaskEventBus 核心实现
- [x] 类型定义
- [x] 单元测试

### 9.2 中期（计划中）

- [ ] StreamingProcessor 集成
- [ ] Task.ts 事件订阅
- [ ] 集成测试

### 9.3 长期（规划中）

- [ ] 事件持久化（可选）
- [ ] 分布式事件总线
- [ ] 性能监控仪表板

---

## 附录

### A. 相关文件

- `src/core/task/TaskEventBus.ts` - 核心实现
- `src/core/task/types.ts` - 类型定义
- `src/core/task/__tests__/TaskEventBus.spec.ts` - 单元测试

### B. 参考资料

- [Node.js EventEmitter 文档](https://nodejs.org/api/events.html)
- [PQueue 文档](https://github.com/sindresorhus/p-queue)
- [观察者模式](https://en.wikipedia.org/wiki/Observer_pattern)
- [发布 - 订阅模式](https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern)

### C. 变更日志

#### v1.0 (2026-02-28)

- 初始实现
- 支持所有事件类型
- 背压控制
- 事件历史
- 完整测试覆盖
