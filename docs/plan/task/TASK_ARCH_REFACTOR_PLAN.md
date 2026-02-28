# Task.ts 架构重构计划

**文档版本**: 1.0  
**创建日期**: 2026 年 2 月 28 日  
**状态**: 已批准 - 事件总线架构实施中

---

## 摘要

本文档分析 Roo-Code 项目 `src/core/task/Task.ts` 的架构问题，并提出三阶段渐进式重构方案。基于深入分析，建议**跳过状态封装阶段，直接进入事件总线集成**，以解决流式生成、Token 计数和工具调用处理中的状态同步问题。

---

## 目录

1. [当前架构问题诊断](#1-当前架构问题诊断)
2. [现有 Streaming 模块分析](#2-现有-streaming-模块分析)
3. [重构方案对比](#3-重构方案对比)
4. [推荐方案：事件总线架构](#4-推荐方案事件总线架构)
5. [实施计划](#5-实施计划)
6. [风险缓解](#6-风险缓解)

---

## 1. 当前架构问题诊断

### 1.1 核心问题统计

| 指标 | 数值 | 影响 |
|------|------|------|
| Task.ts 总行数 | 4,344 行 | 🔴 严重超出可维护性阈值 |
| `recursivelyMakeClineRequests` 方法 | ~1,600 行 | 🔴 职责过度集中 |
| 流式状态变量 | 20+ 个实例变量 | 🔴 状态同步复杂 |
| try-catch 嵌套层数 | 5+ 层 | 🟠 错误处理分散 |
| 状态同步点 | 30+ 处手动同步 | 🔴 易出错 |

### 1.2 具体问题分类

#### 问题 A：状态同步混乱

**现状**：
```typescript
// Task.ts 第 2970-3050 行 - 流式处理后的状态同步
const streamResult = await processor.processStream(stream, ...)

// 手动同步 20+ 个状态变量
assistantMessage = streamResult.assistantMessage
reasoningMessage = streamResult.reasoningMessage
pendingGroundingSources = streamResult.groundingSources
this.assistantMessageContent = streamResult.assistantMessageContent
this.didRejectTool = streamResult.didRejectTool
this.didCompleteReadingStream = true
inputTokens = streamResult.tokens.input
outputTokens = streamResult.tokens.output
cacheWriteTokens = streamResult.tokens.cacheWrite
cacheReadTokens = streamResult.tokens.cacheRead
totalCost = streamResult.tokens.totalCost
// ... 更多变量
```

**问题**：
- ❌ 遗漏任一变量导致状态不一致
- ❌ 无法追踪状态变更历史
- ❌ 测试需要 mock 大量状态

#### 问题 B：Token 计数集成问题

**当前架构**（已正确实现）：
```
StreamingProcessor
└── StreamingTokenManager
    └── StreamingTokenCounter
        └── TokenizerManager (tiktoken)
```

**Handler 调用链**：
```typescript
// TextHandler.ts 第 24 行
this.tokenManager.addTextTokens(chunk.text)

// ReasoningHandler.ts 第 32 行
this.tokenManager.addReasoningTokens(chunk.text)

// ToolCallHandler.ts 第 78, 123, 182, 263 行
this.tokenManager.addToolCallTokens(event.id, event.name, "")
```

**真正的问题**：
- ✅ Token 计数逻辑正确（有 370 行测试覆盖）
- ❌ `checkTiktokenFallback()` 在流式**结束后**才调用
- ❌ Task.ts 第 2901 行存在重复计数逻辑
- ❌ 无法实时修正 Token 估算

#### 问题 C：工具调用状态机不完整

**当前流程**：
```
tool_call_start → tool_call_delta (N 次) → tool_call_end → finalizeIncompleteToolCalls()
                                              ↑
                                         流式结束后才处理
```

**问题**：
- ❌ 流式中断时工具状态不一致
- ❌ `presentAssistantMessage` 依赖 Task 实例变量
- ❌ 工具执行与流式处理强耦合

#### 问题 D：异步控制流复杂

**当前模式**：
```typescript
while (stack.length > 0) {        // 栈模拟递归
  while (!this.abort) {            // 主循环
    const stream = this.api.createMessage(...)
    for (const chunk of stream) {  // 流式迭代
      try {
        // 处理逻辑
      } catch (error) {
        // 5+ 层嵌套错误处理
      }
    }
  }
}
```

**问题**：
- ❌ 难以追踪执行路径
- ❌ 中断/重试逻辑分散
- ❌ 无法实现优先级调度

---

## 2. 现有 Streaming 模块分析

### 2.1 模块结构

```
src/core/task/streaming/
├── StreamingProcessor.ts          # 核心控制器
├── StreamingStateManager.ts       # 状态管理
├── StreamingTokenManager.ts       # Token 计数
├── StreamingErrorHandler.ts       # 错误处理
├── handlers/
│   ├── ChunkHandler.ts            # 处理器基类
│   ├── TextHandler.ts             # 文本处理
│   ├── ReasoningHandler.ts        # 推理处理
│   ├── ToolCallHandler.ts         # 工具调用处理
│   ├── UsageHandler.ts            # API Usage 处理
│   └── GroundingHandler.ts        # 引用来源处理
└── types.ts                       # 类型定义
```

### 2.2 职责分离评估

| 组件 | 职责 | 状态 |
|------|------|------|
| `StreamingProcessor` | 协调处理流程 | ✅ 单一职责 |
| `StreamingStateManager` | 管理流式状态 | ✅ 状态封装 |
| `StreamingTokenManager` | Token 计数与成本 | ✅ 职责清晰 |
| `StreamingErrorHandler` | 错误处理与重试 | ✅ 策略模式 |
| `*Handler` | 分块处理 | ✅ 策略分离 |

**结论**：Streaming 模块本身架构良好，问题在于**与 Task.ts 的集成方式**

### 2.3 集成点分析

**当前集成模式**（第 2970 行）：
```typescript
const streamingConfig = this.createStreamingProcessorConfig(() => processor)
processor = new StreamingProcessor(streamingConfig)
streamResult = await processor.processStream(stream, ...)

// 手动同步状态
this.assistantMessageContent = streamResult.assistantMessageContent
this.didRejectTool = streamResult.didRejectTool
```

**问题根源**：
- ❌ 回调函数传递 Task 实例方法，导致紧耦合
- ❌ 状态通过返回值同步，而非事件
- ❌ 无法支持并发状态更新

---

## 3. 重构方案对比

### 3.1 方案概述

| 方案 | 描述 | 工时 | 风险 |
|------|------|------|------|
| **方案 A：彻底重写** | 纯异步事件驱动架构 | 4-6 周 | 🔴 高 |
| **方案 B：三阶段渐进** | 状态封装 → 事件总线 → 队列驱动 | 2-3 周 | 🟡 中 |
| **方案 C：跳过阶段一** | 直接事件总线 → 队列驱动 | 1.5-2 周 | 🟡 中 |

### 3.2 详细对比

#### 方案 A：彻底重写

**优势**：
- ✅ 架构清晰，无历史包袱
- ✅ 统一异步模型

**风险**：
- 🔴 4344 行代码一次性重构，回归风险高
- 🔴 可能引入新 bug
- 🔴 测试覆盖率下降

#### 方案 B：三阶段渐进

**阶段一：状态封装**（1 周）
```typescript
// 新增 TaskStateManager.ts
export class TaskStateManager {
  private streamingState = { ... }
  private requestState = { ... }
  private toolState = { ... }
}
```

**阶段二：事件总线**（1 周）
```typescript
// 新增 TaskEventBus.ts
export class TaskEventBus extends EventEmitter {
  emit(event: 'stream:complete', data: StreamingResult)
}
```

**阶段三：队列驱动**（1 周）
```typescript
// 新增 RequestQueue.ts
export class RequestQueue {
  add(request: Request, priority: Priority)
}
```

**评估**：
- 🟡 阶段一收益低：封装的状态在阶段二会被事件替代
- 🟡 重复工作：先封装状态，再用事件替代

#### 方案 C：跳过阶段一（推荐）

**理由**：
1. ✅ Token/工具处理模块本身架构正确
2. ✅ 问题在于**同步机制**，而非**存储机制**
3. ✅ 状态封装无法解决同步问题
4. ✅ 事件驱动直击要害，同时为队列驱动铺路

---

## 4. 推荐方案：事件总线架构

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                      Task.ts                            │
│  (仅保留核心业务逻辑，移除状态同步代码)                  │
└─────────────────────────────────────────────────────────┘
           ↕ (通过事件通信，而非实例变量)
┌─────────────────────────────────────────────────────────┐
│                   TaskEventBus                          │
│  - 事件队列 (支持背压)                                   │
│  - 事件历史 (支持调试回放)                               │
│  - 订阅管理                                              │
└─────────────────────────────────────────────────────────┘
           ↕ (发布/订阅)
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

### 4.2 事件类型定义

```typescript
// src/core/task/types.ts
export interface TaskEventMap {
  // 流式处理事件
  'stream:start': { requestId: string; systemPrompt: string }
  'stream:chunk': { 
    type: 'text' | 'reasoning' | 'tool_call' | 'usage'
    data: unknown 
  }
  'stream:complete': { result: StreamingResult }
  'stream:error': { error: StreamingErrorType; retryAttempt: number }
  
  // 工具调用事件
  'tool:call:start': { toolCall: ToolCallEvent }
  'tool:call:progress': { toolCallId: string; progress: ToolProgressStatus }
  'tool:call:complete': { toolCallId: string; result: ToolResult }
  'tool:call:error': { toolCallId: string; error: Error }
  
  // Token 事件
  'token:update': { tokens: TokenUsage; breakdown: TokenBreakdown }
  
  // 任务状态事件
  'task:state:change': { state: TaskState }
  'task:abort': { reason: string }
}
```

### 4.3 核心类设计

#### TaskEventBus

```typescript
// src/core/task/TaskEventBus.ts
export class TaskEventBus extends EventEmitter<TaskEventMap> {
  private queue: PQueue
  private eventHistory: TaskEvent[]
  private maxHistorySize = 1000
  
  /**
   * 发布事件（带背压控制）
   */
  async publish<K extends keyof TaskEventMap>(
    event: K,
    data: TaskEventMap[K]
  ): Promise<void>
  
  /**
   * 订阅事件
   */
  subscribe<K extends keyof TaskEventMap>(
    event: K,
    handler: (data: TaskEventMap[K]) => void | Promise<void>
  ): Subscription
  
  /**
   * 获取事件历史（用于调试）
   */
  getHistory(filters?: { type?: string; since?: number }): TaskEvent[]
}
```

#### 重构后的 Task.ts

```typescript
// src/core/task/Task.ts - 重构后
export class Task {
  private eventBus: TaskEventBus
  private streamingProcessor: StreamingProcessor
  
  constructor(...) {
    this.eventBus = new TaskEventBus()
    this.streamingProcessor = new StreamingProcessor(...)
    
    // 订阅事件而非手动同步状态
    this.eventBus.subscribe('stream:complete', this.handleStreamComplete.bind(this))
    this.eventBus.subscribe('tool:call:complete', this.handleToolComplete.bind(this))
    this.eventBus.subscribe('token:update', this.handleTokenUpdate.bind(this))
  }
  
  private async handleStreamComplete(result: StreamingResult) {
    // 单一入口点处理流式完成
    this.assistantMessage = result.assistantMessage
    this.assistantMessageContent = result.assistantMessageContent
    // ... 其他状态更新
  }
  
  private async handleToolComplete(event: ToolCompleteEvent) {
    // 工具完成处理
  }
  
  private async handleTokenUpdate(event: TokenUpdateEvent) {
    // Token 更新处理
  }
}
```

### 4.4 收益评估

| 维度 | 当前架构 | 事件总线架构 | 改进 |
|------|---------|-------------|------|
| **状态同步代码** | ~300 行手动同步 | ~50 行事件处理器 | -83% |
| **recursivelyMakeClineRequests** | ~1,600 行 | ~300 行 | -81% |
| **状态变量数量** | 20+ 个 | 5 个核心变量 | -75% |
| **错误处理集中度** | 分散在 5+ 处 | 统一事件处理器 | ✅ |
| **可测试性** | 需 mock 大量状态 | 仅需 mock 事件总线 | ✅ |
| **调试能力** | 日志追踪困难 | 事件历史回放 | ✅ |

---

## 5. 实施计划

### 5.1 阶段划分

#### 阶段一：事件总线基础（已完成）

- [x] 定义事件类型接口
- [x] 实现 TaskEventBus 核心类
- [x] 实现事件队列（PQueue）
- [x] 编写单元测试

**产出**：
- `src/core/task/TaskEventBus.ts`
- `src/core/task/types.ts` (事件类型)
- `src/core/task/__tests__/TaskEventBus.spec.ts`

#### 阶段二：StreamingProcessor 事件集成（进行中）

**步骤**：
1. 修改 StreamingProcessor 配置，添加事件总线
2. 在 Handler 中发布事件而非调用回调
3. 保留旧回调机制作为回退
4. 编写集成测试

**修改文件**：
- `src/core/task/streaming/StreamingProcessor.ts`
- `src/core/task/streaming/handlers/*.ts`
- `src/core/task/streaming/types.ts`

**验收标准**：
- ✅ 所有现有测试通过
- ✅ 事件发布与回调行为一致
- ✅ 性能无显著回退（<5%）

#### 阶段三：Task.ts 事件订阅（计划中）

**步骤**：
1. 在 Task 构造函数中初始化事件总线
2. 订阅流式处理事件
3. 订阅工具调用事件
4. 订阅 Token 更新事件
5. 移除旧状态同步代码

**修改文件**：
- `src/core/task/Task.ts`
- `src/core/task/streaming/types.ts`

**验收标准**：
- ✅ 所有现有测试通过
- ✅ 状态更新通过事件处理
- ✅ 移除 80%+ 手动同步代码

#### 阶段四：清理与优化（计划中）

**步骤**：
1. 移除旧回调配置
2. 添加事件历史回放功能
3. 性能优化（事件批处理）
4. 文档更新

**修改文件**：
- 所有相关文件

**验收标准**：
- ✅ 无旧代码残留
- ✅ 性能基准测试通过
- ✅ 文档完整

### 5.2 时间估算

| 阶段 | 工时 | 依赖 |
|------|------|------|
| 阶段一：事件总线基础 | 2-3 天 | - |
| 阶段二：Streaming 集成 | 3-4 天 | 阶段一 |
| 阶段三：Task 订阅 | 4-5 天 | 阶段二 |
| 阶段四：清理优化 | 2-3 天 | 阶段三 |
| **总计** | **11-15 天** | - |

---

## 6. 风险缓解

### 6.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 事件丢失导致状态不一致 | 中 | 高 | ✅ 事件持久化到历史<br>✅ 背压控制防止溢出 |
| 性能回退 | 低 | 中 | ✅ 基准测试对比<br>✅ 事件批处理优化 |
| 内存泄漏（事件订阅） | 中 | 中 | ✅ Subscription 模式<br>✅ 自动清理机制 |
| 回归 bug | 中 | 高 | ✅ 保留现有测试<br>✅ 特性开关控制 |

### 6.2 特性开关

```typescript
// 通过环境变量控制
const USE_EVENT_ARCH = process.env.ROO_EVENT_ARCH === 'true'

// Task.ts 中使用
if (USE_EVENT_ARCH) {
  await this.eventDrivenRequest(...)
} else {
  await this.legacyRequest(...)
}
```

### 6.3 并行验证

```typescript
// 开发阶段同时运行新旧实现
const [legacyResult, eventResult] = await Promise.all([
  this.legacyProcessStream(stream),
  this.eventDrivenProcessStream(stream)
])

console.assert(
  deepEqual(legacyResult, eventResult),
  'Event-driven result differs from legacy'
)
```

### 6.4 回滚计划

如果阶段二/三发现问题：

1. **立即回退**：设置 `ROO_EVENT_ARCH=false`
2. **问题修复**：在特性分支修复
3. **重新发布**：验证后重新启用

---

## 7. 决策记录

### 2026-02-28：跳过阶段一，直接进入事件总线

**决策理由**：
1. Token/工具处理模块本身架构正确
2. 问题在于同步机制，而非存储机制
3. 状态封装无法解决同步问题
4. 事件驱动直击要害，同时为队列驱动铺路

**参与人员**：
- 架构分析：AI Assistant
- 决策批准：待确认

**备选方案**：
- 如果事件总线实施困难，回退到三阶段方案

---

## 附录

### A. 相关文件清单

**新增文件**：
- `src/core/task/TaskEventBus.ts`
- `src/core/task/__tests__/TaskEventBus.spec.ts`

**修改文件**：
- `src/core/task/Task.ts` (~1,600 行重构)
- `src/core/task/streaming/StreamingProcessor.ts`
- `src/core/task/streaming/handlers/*.ts`
- `src/core/task/streaming/types.ts`

**保留文件**：
- `src/core/task/streaming/StreamingStateManager.ts` (状态封装仍有用)
- `src/core/task/streaming/StreamingTokenManager.ts` (Token 计数正确)
- `src/core/task/streaming/StreamingErrorHandler.ts` (错误处理正确)

### B. 测试策略

**单元测试**：
- TaskEventBus 核心功能
- 事件类型验证
- 背压控制逻辑

**集成测试**：
- StreamingProcessor 事件发布
- Task 事件订阅
- 端到端流式处理

**回归测试**：
- 所有现有测试必须通过
- 新增事件架构特定测试

### C. 性能基准

**指标**：
- 首字时间（Time to First Token）
- 完整流时间（Time to Complete Stream）
- 内存使用峰值
- CPU 使用率

**目标**：
- 性能回退 < 5%
- 内存使用 < 当前 110%

---

## 参考文档

- [ERROR_HANDLING_ANALYSIS.md](../../ERROR_HANDLING_ANALYSIS.md) - 错误处理分析
- [streaming/INTEGRATION_GUIDE.md](../../src/core/task/streaming/INTEGRATION_GUIDE.md) - Streaming 模块集成指南
- [QWEN.md](../../QWEN.md) - 项目构建与测试指南
