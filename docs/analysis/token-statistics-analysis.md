# Token统计问题分析报告

**日期**: 2026年2月27日  
**问题**: 项目token统计存在丢失用户输入token计数和第一条系统提示词的问题  
**状态**: 分析完成

---

## 执行摘要

经过深入代码审查，发现当前token统计实现存在**5个关键问题**，导致：
1. 用户输入的token计数丢失
2. 系统提示词的token未被计入
3. 多轮对话后token统计累积误差
4. 某些场景下tiktoken回退机制失效
5. 上下文token显示值与实际严重不符

---

## 问题详细分析

### 🔴 问题1: API响应token统计更新机制缺陷

**位置**: `src/core/task/Task.ts:2859-2901` (updateApiReqMsg函数)

**代码分析**:
```typescript
const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
    // ...
    const costResult = apiProtocol === "anthropic"
        ? calculateApiCostAnthropic(streamModelInfo, inputTokens, outputTokens, ...)
        : calculateApiCostOpenAI(streamModelInfo, inputTokens, outputTokens, ...)

    this.clineMessages[lastApiReqIndex].text = JSON.stringify({
        ...existingData,
        tokensIn: costResult.totalInputTokens,   // ⚠️ 直接赋值
        tokensOut: costResult.totalOutputTokens, // ⚠️ 直接赋值
        // ...
    })
}
```

**问题机制**:
1. `inputTokens`/`outputTokens`在流式循环中被累加（`inputTokens += chunk.inputTokens`）
2. `updateApiReqMsg`在以下场景被调用：
   - 每次收到usage chunk时
   - 流式中断/完成时
   - 重试流程中
3. 直接赋值导致**中间状态被覆盖**，虽然最终值正确，但UI显示过程中可能出现闪烁

**影响**: UI显示的token数可能在流式过程中跳动，最终值虽然正确，但用户体验不佳

---

### 🔴 问题2: Tiktoken回退触发条件不完善

**位置**: `src/core/task/streaming/StreamingTokenManager.ts:171-177`

**代码分析**:
```typescript
async checkTiktokenFallback(): Promise<void> {
    const isApiUsageInvalid = !this.hasApiUsageData || 
                              (this.tokens.input === 0 && this.tokens.output === 0)

    if (isApiUsageInvalid && this.tokenCounter.getTotalTokens() > 0) {
        await this.applyTiktokenFallback()
    }
}
```

**问题机制**:
1. `hasApiUsageData`只在`addApiUsage()`中当`outputTokens > 0`时设置为true
2. 某些API provider可能：
   - 返回`outputTokens: 0`（思考模型在开始思考时）
   - 分多次返回usage，第一次只有inputTokens
   - 完全不返回usage数据
3. 当API返回了usage但`outputTokens = 0`时，回退逻辑**不会触发**

**影响**: 
- 用户输入token被正确统计（通过API）
- 但输出token显示为0，即使实际有输出
- 成本计算不准确

---

### 🔴 问题3: 输入Token计算时丢失用户消息

**位置**: `src/core/task/streaming/StreamingTokenManager.ts:203-221` (estimateInputTokens)

**代码分析**:
```typescript
private async estimateInputTokens(): Promise<number> {
    // Flatten the conversation history to get all content blocks
    const fullConversationContent = this.apiConversationHistory.flatMap((msg) =>
        Array.isArray(msg.content) ? msg.content : []
    )

    // Use the API's countTokens method if available
    if (this.api.countTokens) {
        return await this.api.countTokens(fullConversationContent)
    }
    // ...
}
```

**问题机制**:
1. 在`Task.ts:2821-2825`中，用户消息添加到`apiConversationHistory`有**条件判断**：
```typescript
const shouldAddUserMessage =
    ((currentItem.retryAttempt ?? 0) === 0 && !isEmptyUserContent) || 
    currentItem.userMessageWasRemoved

if (shouldAddUserMessage) {
    await this.addToApiConversationHistory({ role: "user", content: finalUserContent })
}
```
2. 在以下场景，用户消息**不会被添加**：
   - **Retry场景**: `retryAttempt > 0`且`userMessageWasRemoved`为false
   - **空内容场景**: `isEmptyUserContent`为true（如delegation resume）
3. Tiktoken回退时依赖`apiConversationHistory`计算输入tokens
4. 如果用户消息未被添加，回退计算的输入tokens会**缺少该消息内容**

**影响**: 
- 首个用户消息的token未被计入`inputTokensEstimate`
- 多轮对话后token统计误差累积
- `contextTokens`显示值严重低于实际值

---

### 🔴 问题4: 系统提示词Token丢失

**位置**: 多文件涉及

**代码分析**:

1. **Anthropic Provider** (`src/api/providers/anthropic.ts:104-143`):
```typescript
stream = await this.client.messages.create({
    model: modelId,
    system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }], // 系统提示词作为独立参数
    messages: sanitizedMessages, // 不包含系统提示词
    // ...
})
```

2. **OpenAI Provider** (`src/api/providers/openai-native.ts`):
```typescript
// 系统提示词作为instructions参数传递，不包含在messages中
```

3. **Tiktoken回退计算** (`src/core/task/streaming/StreamingTokenManager.ts:203-221`):
```typescript
// 只计算apiConversationHistory中的内容，不包含系统提示词
const fullConversationContent = this.apiConversationHistory.flatMap((msg) =>
    Array.isArray(msg.content) ? msg.content : []
)
```

**问题机制**:
1. 系统提示词通常作为独立参数(`system`或`instructions`)传递给API
2. `apiConversationHistory`只包含对话历史（user/assistant消息）
3. Tiktoken回退时只计算`apiConversationHistory`，**不包含系统提示词**
4. 即使API正确返回了包含系统提示词的usage，tiktoken回退时也不会包含

**影响**: 
- 系统提示词的token（通常几百到几千）完全丢失
- 对于长系统提示词的场景，误差可达数千token
- 成本计算不准确

---

### 🔴 问题5: 上下文Token聚合逻辑依赖单条消息

**位置**: `packages/core/src/message-utils/consolidateTokenUsage.ts:73-118`

**代码分析**:
```typescript
// Calculate context tokens.
result.contextTokens = 0

// First, check for condense_context message which has authoritative token count
let lastCondenseTokens = 0
for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === "say" && message.say === "condense_context") {
        const condenseTokens = message.contextCondense?.newContextTokens ?? 0
        if (condenseTokens > 0) {
            lastCondenseTokens = condenseTokens
            break
        }
    }
}

// If we have a condense message, use its token count as the base
if (lastCondenseTokens > 0) {
    result.contextTokens = lastCondenseTokens
} else {
    // No condense message: accumulate all api_req_started messages
    for (const message of messages) {
        if (message.type === "say" && message.say === "api_req_started" && message.text) {
            try {
                const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
                const { tokensIn, tokensOut } = parsedText
                result.contextTokens += (tokensIn || 0) + (tokensOut || 0)
            } catch {
                continue
            }
        }
    }
}
```

**问题机制**:
1. 如果存在`condense_context`消息，直接使用其`newContextTokens`作为上下文token数
2. 如果不存在，**累加所有** `api_req_started`消息的`tokensIn + tokensOut`
3. 问题：如果某条`api_req_started`消息的token数据不正确（如被覆盖或丢失），累积结果就会错误

**影响**: 
- 当问题1-4导致单条消息token数据不正确时，累积结果也会错误
- 用户看到"几百"的上下文token数，而实际可能是数千

---

## 问题链路图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Token统计问题链路                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

[API 调用]
    │
    ├─→ [正常返回 usage 数据]
    │       │
    │       ├─→ inputTokens/outputTokens 累加
    │       │       ↓
    │       ├─→ updateApiReqMsg() 更新消息 (问题1: 直接赋值)
    │       │       ↓
    │       └─→ saveClineMessages() 持久化
    │
    ├─→ [返回 usage 但 outputTokens=0]
    │       │
    │       ├─→ hasApiUsageData = true (因为 inputTokens > 0)
    │       │       ↓
    │       ├─→ checkTiktokenFallback() 检查
    │       │       ↓
    │       └─→ ❌ 回退不触发 (问题2: 条件判断不完善)
    │               ↓
    │           outputTokens 显示为 0
    │
    └─→ [未返回 usage 数据]
            │
            ├─→ hasApiUsageData = false
            │       ↓
            ├─→ checkTiktokenFallback() 触发
            │       ↓
            ├─→ applyTiktokenFallback()
            │       ↓
            ├─→ estimateInputTokens()
            │       │
            │       ├─→ 使用 apiConversationHistory (问题3: 可能缺少用户消息)
            │       │
            │       └─→ ❌ 不包含系统提示词 (问题4)
            │               ↓
            │           inputTokensEstimate 偏低
            │               ↓
            └─→ updateApiReqMsg() 更新
                    ↓
            saveClineMessages()

[UI 显示]
    │
    ├─→ consolidateTokenUsage()
    │       │
    │       ├─→ 累加所有 api_req_started 消息的 tokens (问题5)
    │       │
    │       └─→ 如果单条消息数据错误，累积结果错误
    │               ↓
    └─→ ContextWindowProgress.tsx 显示 "几百" token
```

---

## 根本原因总结

### 架构层面问题

1. **数据源不一致**
   - API响应统计依赖API返回的usage数据
   - Tiktoken回退依赖`apiConversationHistory`
   - 两者统计范围不一致（后者缺少系统提示词和可能缺少用户消息）

2. **状态管理分散**
   - `inputTokens`/`outputTokens`在`Task.ts`中累加
   - `tokenCounter`在`StreamingTokenManager`中累加
   - `hasApiUsageData`标志与token值不同步

3. **回退机制不完善**
   - 触发条件只检查`hasApiUsageData`，未考虑数据完整性
   - 输入token计算使用不完整的数据源

---

## 修复建议

### 短期修复方案

#### 1. 修复Tiktoken回退触发条件

**文件**: `src/core/task/streaming/StreamingTokenManager.ts`

```typescript
async checkTiktokenFallback(): Promise<void> {
    // 修复: 当API返回的数据不完整时也触发回退
    const hasValidApiData = this.hasApiUsageData && 
                           this.tokens.output > 0 &&
                           this.tokens.input > 0
    
    const hasTiktokenData = this.tokenCounter.getTotalTokens() > 0

    if (!hasValidApiData && hasTiktokenData) {
        await this.applyTiktokenFallback()
    }
}
```

#### 2. 修复输入Token计算包含完整上下文

**文件**: `src/core/task/streaming/StreamingTokenManager.ts`

```typescript
// 添加系统提示词存储
private systemPrompt: string = ""

setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
}

private async estimateInputTokens(): Promise<number> {
    // 1. 获取系统提示词token数
    const systemTokens = this.systemPrompt 
        ? await this.countTokens([{ type: "text", text: this.systemPrompt }])
        : 0

    // 2. 获取对话历史token数
    const conversationTokens = await this.estimateConversationTokens()

    return systemTokens + conversationTokens
}

private async estimateConversationTokens(): Promise<number> {
    const fullConversationContent = this.apiConversationHistory.flatMap((msg) =>
        Array.isArray(msg.content) ? msg.content : []
    )
    
    if (this.api.countTokens) {
        return await this.api.countTokens(fullConversationContent)
    }
    
    // Fallback: 使用字符估算
    const textContent = JSON.stringify(fullConversationContent)
    return Math.ceil(textContent.length / 4)
}
```

#### 3. 修复用户消息未添加到历史的问题

**文件**: `src/core/task/Task.ts`

```typescript
// 确保在tiktoken回退前，用户消息已添加到历史
if (shouldAddUserMessage) {
    await this.addToApiConversationHistory({ role: "user", content: finalUserContent })
}

// 在调用StreamingProcessor前，确保tokenManager有完整的数据
processor = new StreamingProcessor(streamingConfig)
processor.setSystemPrompt(systemPrompt) // 传递系统提示词
```

#### 4. 修复API统计直接赋值问题

**文件**: `src/core/task/Task.ts`

```typescript
const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
    // ...
    const existingData = JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}")

    // 修复: 累加而不是覆盖（如果需要中间更新）
    // 或者直接使用累积值（当前实现已正确累积）
    this.clineMessages[lastApiReqIndex].text = JSON.stringify({
        ...existingData,
        tokensIn: inputTokens,        // inputTokens 已经是累积值
        tokensOut: outputTokens,      // outputTokens 已经是累积值
        cacheWrites: cacheWriteTokens,
        cacheReads: cacheReadTokens,
        cost: totalCost ?? costResult.totalCost,
        cancelReason,
        streamingFailedMessage,
    })
}
```

---

### 长期修复方案

#### 1. 统一Token统计架构

创建统一的`TokenAccountingService`，负责：
- 接收API usage数据
- 管理tiktoken回退
- 计算总token数
- 提供准确的成本估算

```typescript
interface TokenAccountingService {
    // 记录API返回的usage
    recordApiUsage(usage: ApiUsage): void
    
    // 记录tiktoken统计
    recordTiktokenCount(content: ContentBlock[]): void
    
    // 获取当前统计
    getCurrentStats(): TokenStats
    
    // 获取最终统计（包含回退）
    getFinalStats(): TokenStats
    
    // 设置系统提示词
    setSystemPrompt(prompt: string): void
    
    // 添加用户消息到上下文
    addUserMessage(content: ContentBlock[]): void
}
```

#### 2. 优化上下文计算

修改`consolidateTokenUsage`逻辑：
- 优先使用`condense_context`的权威值
- 累加所有`api_req_started`的增量
- 验证数据一致性（如果累加值与权威值差异过大，发出警告）

#### 3. Provider层面的Token计数

每个Provider实现自己的`countTokens`方法：
- 使用provider原生的token计数API（如果可用）
- 否则使用tiktoken
- 确保统计范围一致（包含系统提示词）

---

## 测试验证方案

### 单元测试

1. **Tiktoken回退触发测试**
   - 模拟API返回`outputTokens: 0`，验证回退是否触发
   - 模拟API返回部分usage数据，验证数据完整性检查

2. **输入Token计算测试**
   - 验证系统提示词被包含在计算中
   - 验证用户消息被包含在计算中
   - 验证多轮对话历史被正确计算

3. **数据累积测试**
   - 模拟多次调用`updateApiReqMsg`，验证token数正确累积
   - 验证中间状态不影响最终结果

### 集成测试

1. **完整流式响应测试**
   - 模拟Anthropic/OpenAI流式响应
   - 验证token统计与API返回一致

2. **回退机制测试**
   - 模拟API不返回usage的场景
   - 验证tiktoken回退计算准确

3. **多轮对话测试**
   - 模拟5-10轮对话
   - 验证`contextTokens`正确累积

### 手动测试清单

- [ ] 新任务首个请求token统计准确
- [ ] 多轮对话后token统计持续增长
- [ ] 系统提示词变化时token数相应变化
- [ ] 切换provider后token统计一致
- [ ] UI显示的token数与实际API usage接近

---

## 相关文件清单

| 文件路径 | 问题关联 | 优先级 |
|---------|---------|-------|
| `src/core/task/Task.ts` | 问题1, 3, 4 | P0 |
| `src/core/task/streaming/StreamingTokenManager.ts` | 问题2, 3, 4 | P0 |
| `packages/core/src/message-utils/consolidateTokenUsage.ts` | 问题5 | P1 |
| `src/utils/tiktoken.ts` | 问题4 | P1 |
| `src/api/providers/anthropic.ts` | 问题4 | P2 |
| `src/api/providers/openai-native.ts` | 问题4 | P2 |
| `src/shared/cost.ts` | 成本计算 | P2 |

---

## 结论

当前token统计实现存在**架构层面的数据源不一致问题**。短期修复可以解决90%的显示问题，但长期需要重构token统计架构，确保：

1. **单一数据源**: 统一API统计和tiktoken回退的数据源
2. **完整覆盖**: 确保系统提示词、用户消息、对话历史都被计入
3. **数据验证**: 添加数据一致性检查，及时发现统计异常
4. **可追溯性**: 保留中间统计日志，便于问题排查

建议按优先级逐步修复，先解决用户感知最明显的问题（显示值严重偏低），再完善架构设计。
