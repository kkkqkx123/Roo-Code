# Token统计问题分析报告

**日期**: 2026年2月28日  
**分析来源**: 日志分析与代码审查  
**状态**: 问题确认

---

## 执行摘要

通过对运行日志的深入分析，发现当前token统计实现存在**10个关键问题**：

1. API Usage数据完全缺失（Qwen等模型不返回usage）
2. vscode模块找不到导致token计数失败
3. 系统提示词Token丢失（大于8000 tokens完全未处理）
4. Token用量显示逻辑混乱（累积值与上下文长度数值类似）
5. Tiktoken回退触发条件不完善
6. 输入Token计算时丢失用户消息
7. API响应token统计更新机制缺陷
8. 上下文Token聚合逻辑依赖单条消息
9. MetricsService频繁被throttled导致UI更新延迟
10. **上下文长度在第二次API调用后被错误清零**

---

## 问题详细分析

### 问题1: API Usage数据完全缺失

**日志证据**:
```
[UsageHandler#handle] chunk{input:0,output:0,cacheWrite:0,cacheRead:0,cost:0} | valid:false
[StreamingTokenManager#addApiUsage] chunk{input:0,output:0,...} | valid:false
[StreamingTokenManager#applyTiktokenFallback] reason=no_api_usage_data
```

**问题机制**:
1. Qwen/Qwen3-8B等模型API不返回usage数据
2. `UsageHandler`收到的chunk中所有token值都为0
3. `valid:false`表示数据无效，触发tiktoken回退
4. 但tiktoken回退本身存在问题（见问题3、5）

**根源代码位置**: 
- `src/core/task/streaming/handlers/UsageHandler.ts`
- `src/api/providers/openai-native.ts` 或相关provider未正确解析usage

**影响**:
- 依赖API usage的模型无法获得准确的token统计
- 只能依赖tiktoken估算，但估算不完整

---

### 问题2: vscode模块找不到导致token计数失败

**日志证据**:
```
Error {code: 'MODULE_NOT_FOUND', message: "Cannot find module 'vscode'"
Require stack: ...src\\dist\\workers\\countTokens.js:4:21
```

**问题机制**:
1. `countTokens.ts` worker文件在打包后引用了`vscode`模块
2. Worker运行在独立进程中，无法访问VSCode API
3. 导致tiktoken token计数功能失败

**根源代码位置**: 
- `src/workers/countTokens.ts`
- `src/esbuild.mjs` (打包配置)

**影响**:
- tiktoken回退机制可能失败
- token估算不准确

---

### 问题3: 系统提示词Token丢失（大于8000 tokens未处理）

**问题描述**:
当前的第一条系统提示词大于8000 tokens，完全没有得到任何处理。

**问题机制**:
1. 系统提示词在`apiConversationHistory`之外，作为独立参数传递给API
2. Tiktoken回退时只计算`apiConversationHistory`
3. 如果系统提示词超过8000 tokens：
   - API可能返回错误或截断
   - Token统计完全丢失这部分
   - 上下文管理可能误判

**根源代码位置**: 
- `src/core/task/streaming/StreamingTokenManager.ts:270-289`

```typescript
private async estimateInputTokens(): Promise<number> {
    // 只计算apiConversationHistory，不包含系统提示词
    const fullConversationContent = this.apiConversationHistory.flatMap((msg) =>
        Array.isArray(msg.content) ? msg.content : []
    )
    // ...
}
```

**影响**:
- 长系统提示词的token完全丢失
- 上下文窗口计算严重偏低
- 可能导致上下文溢出错误

---

### 问题4: Token用量显示逻辑混乱

**日志证据**:
```
[MetricsService#getTokenUsage] messages:6 | combined:4 | tokens{in:564,out:587,...}
```

**问题描述**:
Token用量是所有消息的累积，但实际却与上下文长度的数值类似。

**问题机制**:
1. `totalTokensIn`和`totalTokensOut`设计为**累积所有API请求的token**
2. `contextTokens`设计为**当前上下文窗口的token数**
3. 但实际显示时，两者数值接近，说明：
   - 要么累积逻辑有问题
   - 要么上下文计算逻辑有问题

**根源代码位置**: 
- `packages/core/src/message-utils/consolidateTokenUsage.ts:39-136`

```typescript
// 累积所有api_req_started的tokens
messages.forEach((message) => {
    if (message.type === "say" && message.say === "api_req_started" && message.text) {
        result.totalTokensIn += tokensIn   // 累加
        result.totalTokensOut += tokensOut // 累加
    }
})

// 但contextTokens只取最后一条
result.contextTokens = (tokensIn || 0) + (tokensOut || 0)
```

**影响**:
- 用户看到的"总token用量"可能只是最后一次请求的量
- 累积统计与单次统计混淆

---

### 问题5: Tiktoken回退触发条件不完善

**根源代码位置**: `src/core/task/streaming/StreamingTokenManager.ts:221-232`

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

### 问题6: 输入Token计算时丢失用户消息

**根源代码位置**: `src/core/task/streaming/StreamingTokenManager.ts:270-289`

**问题机制**:
1. 在`Task.ts`中，用户消息添加到`apiConversationHistory`有条件判断
2. 在retry场景或空内容场景，用户消息可能不会被添加
3. Tiktoken回退时依赖`apiConversationHistory`计算输入tokens
4. 如果用户消息未被添加，回退计算的输入tokens会缺少该消息内容

**影响**: 
- 首个用户消息的token未被计入`inputTokensEstimate`
- 多轮对话后token统计误差累积
- `contextTokens`显示值严重低于实际值

---

### 问题7: API响应token统计更新机制缺陷

**根源代码位置**: `src/core/task/Task.ts` (updateApiReqMsg函数)

**问题机制**:
1. `inputTokens`/`outputTokens`在流式循环中被累加
2. `updateApiReqMsg`在每次收到usage chunk时被调用
3. 直接赋值导致中间状态被覆盖

**影响**: UI显示的token数可能在流式过程中跳动

---

### 问题8: 上下文Token聚合逻辑依赖单条消息

**根源代码位置**: `packages/core/src/message-utils/consolidateTokenUsage.ts:73-136`

**问题机制**:
1. 如果存在`condense_context`消息，直接使用其`newContextTokens`
2. 如果不存在，累加所有`api_req_started`消息的`tokensIn + tokensOut`
3. 如果某条消息的token数据不正确，累积结果就会错误

**影响**: 当其他问题导致单条消息token数据不正确时，累积结果也会错误

---

### 问题9: MetricsService频繁被throttled导致UI更新延迟

**日志证据**:
```
[MetricsService#emitTokenUsageUpdate] ... | throttled | tokens{...}
```

**问题机制**:
1. MetricsService使用debounce进行节流，间隔2秒
2. 在流式响应过程中，token更新非常频繁
3. 大部分更新被throttled，UI可能显示过时数据

**根源代码位置**: `src/core/metrics/MetricsService.ts:30-54`

**影响**: UI显示的token数据可能不是最新的

---

### 问题10: 上下文长度在第二次API调用后被错误清零

**日志证据**:
```
[MetricsService#getTokenUsage] taskId=019ca387-752c-739c-9afc-301f4511b4e0 | messages:10 | combined:8 | tokens{in:516,out:761,...}
```

**问题描述**:
该对话中上下文长度在第二次API调用结束后被错误清零。

**问题机制**:
1. `consolidateTokenUsage`函数在第81行将`contextTokens`初始化为0
2. 然后查找最后一条`api_req_started`消息来计算`contextTokens`
3. 问题场景：
   - 第一次API调用：`api_req_started`消息被创建，包含token数据
   - 第二次API调用开始：新的`api_req_started`消息被创建（placeholder）
   - 第二次API调用结束：`api_req_started`消息被更新，但可能：
     - JSON解析失败导致跳过
     - `tokensIn`/`tokensOut`为undefined或0
     - 消息合并逻辑问题

**根源代码位置**: 
- `packages/core/src/message-utils/consolidateTokenUsage.ts:118-136`
- `packages/core/src/message-utils/consolidateApiRequests.ts:21-90`

```typescript
// consolidateTokenUsage.ts:118-136
} else {
    // No condense message: use the LAST api_req_started message's tokens
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message && message.type === "say" && message.say === "api_req_started" && message.text) {
            try {
                const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
                const { tokensIn, tokensOut } = parsedText
                // 如果tokensIn/tokensOut为undefined，结果为0
                result.contextTokens = (tokensIn || 0) + (tokensOut || 0)
                break
            } catch {
                // JSON解析失败，继续查找下一条
                continue
            }
        }
    }
}
```

**可能的原因**:
1. **消息合并问题**: `consolidateApiRequests`合并`api_req_started`和`api_req_finished`时，如果`api_req_finished`的JSON数据覆盖了`api_req_started`的数据，可能导致token数据丢失
2. **placeholder消息问题**: 第二次API调用开始时创建的placeholder消息可能没有token数据，如果合并逻辑错误，可能覆盖了之前的数据
3. **JSON解析失败**: 如果消息text不是有效JSON，会被跳过，导致找不到有效的`api_req_started`消息

**影响**:
- 上下文长度显示为0
- 用户无法正确了解当前上下文使用情况
- 可能导致上下文管理误判

---

## 问题根源总结表

| 问题编号 | 问题描述 | 根源文件 | 根源代码位置 |
|---------|---------|---------|-------------|
| 问题1 | API Usage数据完全缺失 | `src/api/providers/*.ts` | provider实现 |
| 问题2 | vscode模块找不到 | `src/workers/countTokens.ts` | 打包配置 |
| 问题3 | 系统提示词Token丢失 | `src/core/task/streaming/StreamingTokenManager.ts` | 270-289行 |
| 问题4 | Token用量显示逻辑混乱 | `packages/core/src/message-utils/consolidateTokenUsage.ts` | 39-136行 |
| 问题5 | Tiktoken回退触发条件不完善 | `src/core/task/streaming/StreamingTokenManager.ts` | 221-232行 |
| 问题6 | 输入Token计算时丢失用户消息 | `src/core/task/streaming/StreamingTokenManager.ts` | 270-289行 |
| 问题7 | API响应token统计更新机制缺陷 | `src/core/task/Task.ts` | updateApiReqMsg函数 |
| 问题8 | 上下文Token聚合逻辑依赖单条消息 | `packages/core/src/message-utils/consolidateTokenUsage.ts` | 73-136行 |
| 问题9 | MetricsService频繁被throttled | `src/core/metrics/MetricsService.ts` | 30-54行 |
| 问题10 | 上下文长度在第二次API调用后被错误清零 | `packages/core/src/message-utils/consolidateTokenUsage.ts` | 118-136行 |

---

## 核心架构问题

### 1. 数据源不一致
- API响应统计依赖API返回的usage数据
- Tiktoken回退依赖`apiConversationHistory`
- 两者统计范围不一致（后者缺少系统提示词和可能缺少用户消息）

### 2. 状态管理分散
- `inputTokens`/`outputTokens`在`Task.ts`中累加
- `tokenCounter`在`StreamingTokenManager`中累加
- `hasApiUsageData`标志与token值不同步

### 3. 回退机制不完善
- 触发条件只检查`hasApiUsageData`，未考虑数据完整性
- 输入token计算使用不完整的数据源

---

## 修复建议优先级

### P0 - 立即修复
1. **问题3**: 系统提示词Token丢失 - 在`estimateInputTokens`中添加系统提示词计算
2. **问题2**: vscode模块找不到 - 修复打包配置，确保worker不依赖VSCode API

### P1 - 短期修复
3. **问题1**: API Usage数据缺失 - 为不返回usage的provider实现tiktoken估算
4. **问题4**: Token用量显示逻辑 - 明确区分累积值和当前上下文值
5. **问题5**: Tiktoken回退触发条件 - 完善触发条件判断

### P2 - 中期优化
6. **问题6**: 输入Token计算 - 确保用户消息被正确添加到历史
7. **问题9**: MetricsService节流 - 优化更新策略
8. **问题10**: 上下文长度清零 - 修复消息合并和token数据更新逻辑

---

## 相关文件清单

| 文件路径 | 问题关联 | 优先级 |
|---------|---------|-------|
| `src/core/task/streaming/StreamingTokenManager.ts` | 问题3, 5, 6 | P0 |
| `src/workers/countTokens.ts` | 问题2 | P0 |
| `src/esbuild.mjs` | 问题2 | P0 |
| `src/api/providers/*.ts` | 问题1 | P1 |
| `packages/core/src/message-utils/consolidateTokenUsage.ts` | 问题4, 8, 10 | P1 |
| `packages/core/src/message-utils/consolidateApiRequests.ts` | 问题10 | P1 |
| `src/core/task/Task.ts` | 问题6, 7, 10 | P2 |
| `src/core/metrics/MetricsService.ts` | 问题9 | P2 |
