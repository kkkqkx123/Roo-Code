# `say` 函数类型使用情况分析报告

## 一、当前定义

### SharedCallbacks.ts 中的接口定义（第29-38行）
```typescript
say: (
    type: string,
    text?: string,
    images?: string[],
    partial?: boolean,
    extra?: any,
) => Promise<void>
```

### Task.ts 中的实际实现（第1747-1759行）
```typescript
async say(
    type: ClineSay,
    text?: string,
    images?: string[],
    partial?: boolean,
    checkpoint?: Record<string, unknown>,
    progressStatus?: ToolProgressStatus,
    options: {
        isNonInteractive?: boolean
    } = {},
    contextCondense?: ContextCondense,
    contextTruncation?: ContextTruncation,
): Promise<undefined>
```

## 二、实际使用模式分析

### 1. 仅 type 参数（最常见）
```typescript
await task.say("error")
await task.say("mcp_server_request_started")
await task.say("api_req_retried")
await task.say("shell_integration_warning")
await task.say("diff_error")
```
**使用场景**：发送简单的状态通知或错误标记，无需额外内容。

### 2. type + text
```typescript
await task.say("error", errorMsg)
await task.say("text", task)
await task.say("user_feedback_diff", JSON.stringify(say))
await task.say("codebase_search_result", JSON.stringify(payload))
```
**使用场景**：发送带有文本内容的消息。

### 3. type + text + images
```typescript
await task.say("user_feedback", text, images)
await task.say("mcp_server_response", toolResultPretty, images)
await task.say("tool", toolResult, images)
```
**使用场景**：发送包含图片的消息（如用户反馈、工具结果）。

### 4. type + text + images + partial
```typescript
await task.say("text", task, images, block.partial)
await task.say("api_req_rate_limit_wait", delayMessage, undefined, true)
await task.say("completion_result", result, undefined, false)
await task.say("reasoning", formattedReasoning, undefined, true)
```
**使用场景**：流式传输时标记消息是否为部分内容。

### 5. type + text + images + partial + extra（使用 extra 传递 options）
```typescript
await task.say("text", sourcesText, undefined, false, {
    isNonInteractive: true,
})
```
**使用场景**：通过 `extra` 参数传递额外配置（如 `isNonInteractive`）。

### 6. 完整参数（仅 Task.ts 内部使用）
```typescript
await this.say(
    "condense_context",
    undefined /* text */,
    undefined /* images */,
    false /* partial */,
    undefined /* checkpoint */,
    undefined /* progressStatus */,
    { isNonInteractive: true } /* options */,
    contextCondense,
)
```
**使用场景**：仅在 Task.ts 内部使用，传递完整的上下文信息。

## 三、参数使用统计

| 参数 | 使用频率 | 主要用途 |
|------|---------|---------|
| `type` | 100% | 消息类型标识 |
| `text` | ~70% | 消息文本内容 |
| `images` | ~20% | 图片数据 |
| `partial` | ~15% | 流式传输标记 |
| `extra` | ~5% | 额外配置（如 `isNonInteractive`） |
| `checkpoint` | <1% | 仅内部使用 |
| `progressStatus` | <1% | 仅内部使用 |
| `options` | <1% | 仅内部使用 |
| `contextCondense` | <1% | 仅内部使用 |
| `contextTruncation` | <1% | 仅内部使用 |

## 四、问题分析

### 1. 接口不一致
- **SharedCallbacks** 定义只有 5 个参数
- **Task.say** 实际有 9 个参数
- 导致类型不匹配，需要使用 `type as any` 强制转换

### 2. 参数语义混乱
- `extra` 参数类型为 `any`，缺乏类型安全
- `extra` 实际用于传递 `options` 对象（如 `{ isNonInteractive: true }`）
- `checkpoint`、`progressStatus` 等参数在接口中未定义

### 3. 可扩展性差
- 添加新参数需要修改函数签名
- 位置参数容易出错（如 `undefined` 占位符）
- 难以维护和阅读

### 4. 使用模式重复
- 大量使用 `undefined` 占位符
- 例如：`await this.say("condense_context", undefined, undefined, false, undefined, undefined, { isNonInteractive: true }, contextCondense)`

## 五、优化建议

### 方案一：合并为配置对象（推荐）

```typescript
interface SayOptions {
    text?: string
    images?: string[]
    partial?: boolean
    isNonInteractive?: boolean
    checkpoint?: Record<string, unknown>
    progressStatus?: ToolProgressStatus
    contextCondense?: ContextCondense
    contextTruncation?: ContextTruncation
}

// SharedCallbacks.ts
say: (type: string, options?: SayOptions) => Promise<void>

// Task.ts
async say(type: ClineSay, options?: SayOptions): Promise<undefined>
```

**优点**：
- ✅ 类型安全
- ✅ 参数语义清晰
- ✅ 易于扩展
- ✅ 无需 `undefined` 占位符
- ✅ 向后兼容（可选参数）

**使用示例**：
```typescript
// 简单使用
await task.say("error")

// 带文本
await task.say("error", { text: errorMsg })

// 带图片
await task.say("user_feedback", { text, images })

// 流式传输
await task.say("text", { text: task, images, partial: block.partial })

// 完整配置
await task.say("condense_context", {
    isNonInteractive: true,
    contextCondense
})
```

### 方案二：保留核心参数，合并扩展参数

```typescript
// SharedCallbacks.ts
say: (
    type: string,
    text?: string,
    images?: string[],
    partial?: boolean,
    extra?: {
        isNonInteractive?: boolean
        checkpoint?: Record<string, unknown>
        progressStatus?: ToolProgressStatus
        contextCondense?: ContextCondense
        contextTruncation?: ContextTruncation
    }
) => Promise<void>
```

**优点**：
- ✅ 保持常用参数的位置参数形式
- ✅ 扩展参数合并到 `extra` 对象
- ✅ 部分向后兼容

**缺点**：
- ❌ 仍有 5 个位置参数
- ❌ `extra` 语义不够清晰

### 方案三：渐进式重构

```typescript
// 第一步：统一接口定义
interface SayMessage {
    type: string
    text?: string
    images?: string[]
    partial?: boolean
    isNonInteractive?: boolean
    checkpoint?: Record<string, unknown>
    progressStatus?: ToolProgressStatus
    contextCondense?: ContextCondense
    contextTruncation?: ContextTruncation
}

// 第二步：提供两种调用方式（过渡期）
say: (type: string, options?: SayOptions) => Promise<void>
// 或
say: (message: SayMessage) => Promise<void>
```

## 六、推荐实施方案

### 阶段一：定义新类型
```typescript
// src/core/task/streaming/SayOptions.ts
export interface SayOptions {
    text?: string
    images?: string[]
    partial?: boolean
    isNonInteractive?: boolean
    checkpoint?: Record<string, unknown>
    progressStatus?: ToolProgressStatus
    contextCondense?: ContextCondense
    contextTruncation?: ContextTruncation
}
```

### 阶段二：更新接口
```typescript
// SharedCallbacks.ts
import type { SayOptions } from './SayOptions'

export interface MessageCallbacks {
    say: (type: string, options?: SayOptions) => Promise<void>
}
```

### 阶段三：更新实现
```typescript
// Task.ts
async say(type: ClineSay, options?: SayOptions): Promise<undefined> {
    const {
        text,
        images,
        partial,
        isNonInteractive = false,
        checkpoint,
        progressStatus,
        contextCondense,
        contextTruncation
    } = options || {}

    // ... 原有逻辑
}
```

### 阶段四：批量更新调用点
使用正则表达式批量替换：
```typescript
// 替换前
await task.say("error", errorMsg)
// 替换后
await task.say("error", { text: errorMsg })

// 替换前
await task.say("user_feedback", text, images)
// 替换后
await task.say("user_feedback", { text, images })

// 替换前
await task.say("text", task, images, block.partial)
// 替换后
await task.say("text", { text: task, images, partial: block.partial })
```

## 七、影响评估

### 需要修改的文件
1. `src/core/task/streaming/SharedCallbacks.ts` - 接口定义
2. `src/core/task/Task.ts` - 实现和回调创建
3. `src/core/task/streaming/StreamProcessor.ts` - 使用点
4. `src/core/task/streaming/StreamPostProcessor.ts` - 使用点
5. 所有 Tool 文件（约 15 个）- 使用点
6. 测试文件 - 使用点

### 预计工作量
- 定义新类型：30 分钟
- 更新接口和实现：1 小时
- 更新调用点（约 112 处）：2-3 小时
- 测试和验证：1 小时
- **总计：4-5 小时**

### 风险评估
- **低风险**：参数合并为对象，类型安全
- **中等风险**：需要更新大量调用点
- **缓解措施**：使用 TypeScript 编译器检查，逐步迁移

## 八、总结

### 当前问题
1. 接口定义与实际实现不一致
2. 参数过多，使用 `undefined` 占位符
3. `extra` 参数类型为 `any`，缺乏类型安全
4. 可扩展性差，难以维护

### 推荐方案
采用**方案一：合并为配置对象**，将所有可选参数合并到 `SayOptions` 对象中。

### 预期收益
- ✅ 提高类型安全性
- ✅ 改善代码可读性
- ✅ 增强可扩展性
- ✅ 减少维护成本
- ✅ 统一接口定义

### 下一步行动
1. 创建 `SayOptions` 类型定义
2. 更新 `SharedCallbacks` 接口
3. 更新 `Task.say` 实现
4. 批量更新所有调用点
5. 运行测试验证