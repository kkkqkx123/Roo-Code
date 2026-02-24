# TikToken 统计回退方案问题分析

**日期**: 2026 年 2 月 24 日  
**问题**: UI 界面最终更新上下文长度时显示的 token 数只有几百，与实际值严重不符

---

## 问题现象

在 UI 界面的上下文窗口显示中，`contextTokens` 经常显示为几百的低值，而不是实际的上下文 token 占用量。这导致用户无法准确了解当前上下文的使用情况。

---

## 根本原因分析

经过深入分析代码，发现当前 tiktoken 统计回退方案存在以下**4 个关键问题**：

---

### 🔴 问题 1：`tokensIn`/`tokensOut` 被覆盖而非累积（最严重）

**位置**: `src/core/task/Task.ts:2693-2703`

**问题代码**:
```typescript
const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
    // ...
    this.clineMessages[lastApiReqIndex].text = JSON.stringify({
        ...existingData,
        tokensIn: costResult.totalInputTokens,   // ❌ 直接赋值，不是累加
        tokensOut: costResult.totalOutputTokens, // ❌ 直接赋值，不是累加
        cacheWrites: cacheWriteTokens,
        cacheReads: cacheReadTokens,
        cost: totalCost ?? costResult.totalCost,
        cancelReason,
        streamingFailedMessage,
    } satisfies ClineApiReqInfo)
}
```

**问题分析**: 
- `updateApiReqMsg()` 在流式响应过程中被**多次调用**（每次收到 usage chunk 或累积 token 时）
- 每次调用都使用 `costResult.totalInputTokens` **覆盖** 之前的值，而不是累加
- 但 `costResult` 是基于**当前请求的增量 token** 计算的，不是历史累积值

**影响**:
- 如果 API 分多次返回 usage 数据（例如：第一次返回 100 tokens，第二次返回 200 tokens）
- 最终 `tokensIn` = 200（最后一次的增量），而不是 300（累积值）
- 导致 `contextTokens` 严重偏低

**修复方案**:
```typescript
this.clineMessages[lastApiReqIndex].text = JSON.stringify({
    ...existingData,
    tokensIn: (existingData.tokensIn || 0) + costResult.totalInputTokens,
    tokensOut: (existingData.tokensOut || 0) + costResult.totalOutputTokens,
    cacheWrites: (existingData.cacheWrites || 0) + cacheWriteTokens,
    cacheReads: (existingData.cacheReads || 0) + cacheReadTokens,
    cost: totalCost ?? costResult.totalCost,
    cancelReason,
    streamingFailedMessage,
})
```

---

### 🔴 问题 2：背景 usage 收集与主循环重复更新

**位置**: `src/core/task/Task.ts:3125-3135` 和 `L3356-3362`

**问题代码**:
```typescript
// 主循环中调用 captureUsageData
await captureUsageData(tokens, apiReqIndex)

// 背景流中也调用 captureUsageData
await captureUsageData({...}, messageIndex)
```

**问题分析**:
- `captureUsageData` 会调用 `updateApiReqMsg()` 和 `saveClineMessages()`
- 背景流收集的 token 是**额外的增量**，可能与主循环的增量重复
- 背景流收集的 token 直接赋值给共享变量 (`inputTokens = tokens.input`)，但这些变量在主循环中也在累加

**影响**:
- 可能导致 token 重复计算或覆盖
- 背景流收集的 token 可能覆盖主循环已累积的值

**修复方案**:
```typescript
// 背景流使用独立变量，不污染主循环的 inputTokens/outputTokens
let bgInputTokens = 0
let bgOutputTokens = 0
// ...
bgInputTokens += chunk.inputTokens
bgOutputTokens += chunk.outputTokens
// ...
// 最后合并时：
inputTokens += bgInputTokens
outputTokens += bgOutputTokens
```

---

### 🔴 问题 3：tiktoken 回退触发时机不正确

**位置**: `src/core/task/Task.ts:3310-3365`

**问题代码**:
```typescript
// Fallback: If API didn't provide valid usage data (non-zero output tokens),
// use tiktoken for estimation.
if (!hasApiUsageData && tokenCounter.getTotalTokens() > 0) {
    const tokenBreakdown = tokenCounter.getTokenBreakdown()
    
    // Use tiktoken as fallback for output tokens (text + reasoning + tool calls)
    const estimatedOutputTokens = tokenCounter.getTotalTokens()
    
    // Calculate input tokens using tiktoken on the full conversation content
    const inputTokensEstimate = await this.api.countTokens(finalUserContent)
    
    inputTokens = inputTokensEstimate
    outputTokens = estimatedOutputTokens
    // ...
}
```

**问题分析**:
1. **只在 API 未返回 usage 数据时触发**：如果 API 返回了 usage 但数据不准确（例如 outputTokens=0），回退逻辑不会执行
2. **tiktoken 计数器从头累积**：`StreamingTokenCounter` 在整个流式过程中累积 token，但最终只调用一次 `updateApiReqMsg()`，导致中间状态丢失
3. **input tokens 计算不准确**：`finalUserContent` 可能不是完整的上下文历史

**影响**:
- 当 API 返回 `outputTokens: 0` 时（某些模型/提供商的行为），不会触发 tiktoken 回退
- tiktoken 累积的 token 在流式过程中被逐步计算，但最终只更新一次消息
- 如果流式过程中有多次 `updateApiReqMsg()` 调用，tiktoken 累积值会被覆盖

**修复方案**:
```typescript
// 修改触发条件：当 API usage 数据无效时也触发回退
const isApiUsageInvalid = !hasApiUsageData || 
                          (inputTokens === 0 && outputTokens === 0 && tokenCounter.getTotalTokens() > 0)

if (isApiUsageInvalid) {
    // 使用 tiktoken 累积值
    const tokenBreakdown = tokenCounter.getTokenBreakdown()
    const estimatedOutputTokens = tokenCounter.getTotalTokens()
    
    // 计算完整的上下文历史 token
    const fullContextContent = buildFullContextContent(this.apiConversationHistory)
    const inputTokensEstimate = await this.api.countTokens(fullContextContent)
    
    // 累加到现有值，而不是覆盖
    inputTokens += inputTokensEstimate
    outputTokens += estimatedOutputTokens
    // ...
}
```

---

### 🔴 问题 4：`contextTokens` 计算依赖最后一条消息

**位置**: `packages/core/src/message-utils/consolidateTokenUsage.ts:75-97`

**问题代码**:
```typescript
// Calculate context tokens, from the last API request started or condense
// context message.
result.contextTokens = 0

for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === "say" && message.say === "api_req_started" && message.text) {
        const { tokensIn, tokensOut } = parsedText
        
        // Since tokensIn now stores TOTAL input tokens (including cache tokens),
        // we no longer need to add cacheWrites and cacheReads separately.
        result.contextTokens = (tokensIn || 0) + (tokensOut || 0)
    }
    if (result.contextTokens) {
        break  // ❌ 找到第一个非零值就退出
    }
}
```

**问题分析**:
- 如果最后一条 `api_req_started` 消息的 `tokensIn`/`tokensOut` 被错误覆盖为很小的值（或不完整），`contextTokens` 就会显示几百
- 没有考虑历史消息的累积
- 注释说 `tokensIn` 存储的是 TOTAL，但实际代码中是增量覆盖（问题 1）

**影响**:
- 当问题 1 导致 `tokensIn`/`tokensOut` 不完整时，`contextTokens` 会直接显示错误值
- 多轮对话后，只有最后一次 API 调用的 token 被计算

**修复方案**（短期）:
```typescript
// 如果 tokensIn/tokensOut 是累积的，当前逻辑可以保持不变
// 但需要确保问题 1 被修复

// 或者，改为累加所有 api_req_started 消息（更健壮）
let lastValidContextTokens = 0
for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === "say" && message.say === "api_req_started" && message.text) {
        const { tokensIn, tokensOut } = parsedText
        const currentTokens = (tokensIn || 0) + (tokensOut || 0)
        if (currentTokens > 0) {
            lastValidContextTokens = currentTokens
            break
        }
    }
}
result.contextTokens = lastValidContextTokens
```

**修复方案**（长期）:
```typescript
// 累加所有 api_req_started 消息的 tokens
let totalContextTokens = 0
for (const message of messages) {
    if (message.type === "say" && message.say === "api_req_started" && message.text) {
        const { tokensIn, tokensOut } = parsedText
        totalContextTokens += (tokensIn || 0) + (tokensOut || 0)
    }
}
result.contextTokens = totalContextTokens
```

---

## 问题链路图

```
[API 流式响应]
    │
    ├─→ [usage chunk] → inputTokens += chunk.inputTokens
    │                   outputTokens += chunk.outputTokens
    │                   ↓
    │              captureUsageData()
    │                   ↓
    │              updateApiReqMsg()  ←── 覆盖 tokensIn/tokensOut（问题 1）
    │                   ↓
    │              saveClineMessages() → postStateToWebview()
    │                                       ↓
    │                                  ChatView.tsx → getApiMetrics()
    │                                       ↓
    │                                  consolidateTokenUsage()
    │                                       ↓
    │                                  contextTokens = 最后一条消息的 tokensIn+tokensOut（问题 4）
    │                                       ↓
    │                                  ContextWindowProgress.tsx → 显示"几百"
    │
    └─→ [无 usage chunk] → tiktoken 回退（问题 3）
                          ↓
                     只调用一次 updateApiReqMsg()
                          ↓
                     tokensIn/tokensOut 不完整
                          ↓
                     contextTokens 显示错误值
```

---

## 修复优先级

| 优先级 | 问题 | 影响范围 | 修复难度 |
|--------|------|----------|----------|
| **P0** | 问题 1: tokensIn/tokensOut 被覆盖 | 所有 API 请求 | 低 |
| **P1** | 问题 4: contextTokens 计算逻辑 | 所有上下文显示 | 低 |
| **P2** | 问题 3: tiktoken 回退时机 | 无 usage 数据的请求 | 中 |
| **P3** | 问题 2: 背景流重复更新 | 部分模型/提供商 | 中 |

---

## 修复验证步骤

1. **单元测试**:
   - 测试 `updateApiReqMsg()` 多次调用后 `tokensIn`/`tokensOut` 是否正确累加
   - 测试 `consolidateTokenUsage()` 在多轮对话后是否返回正确的 `contextTokens`

2. **集成测试**:
   - 模拟 API 分多次返回 usage 数据，验证最终 token 统计是否正确
   - 模拟 API 返回 `outputTokens: 0`，验证 tiktoken 回退是否触发

3. **手动测试**:
   - 执行多轮对话，观察 UI 界面 `contextTokens` 是否持续增长
   - 对比 UI 显示值与 API 实际返回的 usage 数据

---

## 相关文件

- `src/core/task/Task.ts` - 主要问题代码位置
- `packages/core/src/message-utils/consolidateTokenUsage.ts` - contextTokens 计算逻辑
- `src/utils/tiktoken.ts` - tiktoken 计数器实现
- `src/shared/cost.ts` - token 成本计算逻辑
- `webview-ui/src/components/chat/ContextWindowProgress.tsx` - UI 显示组件
- `webview-ui/src/utils/model-utils.ts` - token 分布计算逻辑
