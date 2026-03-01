# Token计数与回退机制深度分析

## 执行摘要

本文档深入分析了Roo-Code项目中token计数的实现机制，特别是系统提示词的token统计问题和回退逻辑的触发机制。通过分析日志、代码和各大API提供商的文档，我们发现了系统提示词统计不准确（约7000-8000 tokens被统计为2000 tokens）的根本原因，并提出了详细的修复方案。

**核心发现：**
1. **系统提示词统计不完整**：回退逻辑中只统计了部分系统提示词组件
2. **API流式返回机制差异**：不同API提供商的token返回时机不同
3. **回退逻辑触发条件过于严格**：无法处理部分token数据缺失的情况
4. **缺少message_start事件跟踪**：无法区分API是否返回了完整的输入token

---

## 一、问题背景

### 1.1 日志分析

从提供的日志中可以看到：

```
[ToolCallHandler#handleDirectToolCallStart] id=call_69b654e670a5420c8e2a1b name=execute_command | delta=8 | total=341 | breakdown{text:0,reasoning:333,toolCalls:8}
[StreamingTokenManager#applyTiktokenFallback] reason=no_api_usage_data | estimatedOutput=341
[StreamingTokenManager#applyTiktokenFallback#after] new{input:2112,output:341,cost:0.000000} | old{input:0,output:0}
```

**关键观察：**
- 回退逻辑被触发：`reason=no_api_usage_data`
- 输入token统计为2112，但实际系统提示词约有7000-8000 tokens
- 输出token统计为341（reasoning: 333 + toolCalls: 8）
- 没有看到`message_start`事件的usage日志

### 1.2 问题描述

**主要问题：**
1. 系统提示词的实际token数（7000-8000）与统计值（2112）差距巨大
2. 回退逻辑被触发，但统计结果不准确
3. 无法确定API是否返回了完整的token数据

---

## 二、系统提示词的完整构成分析

### 2.1 系统提示词生成流程

**位置：** `src/core/task/Task.ts:3530-3609`

```typescript
private async getSystemPrompt(): Promise<string> {
    // 1. 获取MCP Hub
    const mcpHub = await McpServerManager.getInstance(provider.context, provider)

    // 2. 获取rooIgnore指令
    const rooIgnoreInstructions = this.rooIgnoreController?.getInstructions()

    // 3. 获取状态信息
    const {
        mode,
        customModes,
        customModePrompts,
        customInstructions,
        experiments,
        language,
        apiConfiguration,
        enableSubfolderRules,
        skillsEnabled,
        disabledSkills,
    } = state ?? {}

    // 4. 生成系统提示词
    return SYSTEM_PROMPT(
        provider.context,
        this.cwd,
        false, // supportsComputerUse
        mcpHub,
        this.diffStrategy,
        mode ?? defaultModeSlug,
        customModePrompts,
        customModes,
        customInstructions,
        experiments,
        language,
        rooIgnoreInstructions,
        {
            todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
            useAgentRules: vscode.workspace.getConfiguration(Package.name).get<boolean>("useAgentRules") ?? true,
            enableSubfolderRules: enableSubfolderRules ?? false,
            newTaskRequireTodos: vscode.workspace.getConfiguration(Package.name).get<boolean>("newTaskRequireTodos", false),
            isStealthModel: modelInfo?.isStealthModel,
            skillsEnabled: skillsEnabled ?? true,
            disabledSkills: disabledSkills ?? [],
        },
        undefined, // todoList
        this.api.getModel().id,
        provider.getSkillsManager(),
    )
}
```

### 2.2 系统提示词的组成部分

**位置：** `src/core/prompts/system.ts:85-100`

```typescript
const basePrompt = `${roleDefinition}

${markdownFormattingSection()}

${getSharedToolUseSection()}${toolsCatalog}

${getToolUseGuidelinesSection()}

${getCapabilitiesSection(cwd, shouldIncludeMcp ? mcpHub : undefined)}

${modesSection}
${skillsSection ? `\n${skillsSection}` : ""}
${getRulesSection(cwd, settings)}

${getSystemInfoSection(cwd)}
```

**主要组件：**

1. **roleDefinition** - 角色定义（约500-1000 tokens）
2. **markdownFormattingSection()** - Markdown格式说明（约200-300 tokens）
3. **getSharedToolUseSection()** - 工具使用说明（约1000-1500 tokens）
4. **toolsCatalog** - 工具目录（约500-1000 tokens）
5. **getToolUseGuidelinesSection()** - 工具使用指南（约800-1200 tokens）
6. **getCapabilitiesSection()** - 能力说明（约1000-1500 tokens）
   - 包含MCP服务器信息
   - 包含工具定义
7. **modesSection** - 模式说明（约500-800 tokens）
8. **skillsSection** - 技能说明（约500-1000 tokens）
9. **getRulesSection()** - 规则说明（约500-800 tokens）
10. **getSystemInfoSection()** - 系统信息（约300-500 tokens）

**预估总token数：** 7000-8000 tokens

---

## 三、各大API提供商的Token计数机制

### 3.1 Anthropic API

**流式返回机制：**

根据Anthropic SDK文档，流式响应通过SSE（Server-Sent Events）返回多个事件：

#### 3.1.1 message_start 事件

```typescript
{
  type: "message_start",
  message: {
    id: "msg_xxx",
    type: "message",
    role: "assistant",
    content: [],
    model: "claude-3-5-sonnet-20241022",
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 12345,      // 完整输入token（包含系统提示词）
      output_tokens: 0,         // 初始为0
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  }
}
```

**关键特性：**
- **在流开始时立即返回**
- `input_tokens` 包含完整的输入token数：
  - 系统提示词（system参数）
  - 对话历史（messages参数）
  - 工具定义（tools参数）
- `output_tokens` 初始为0

#### 3.1.2 message_delta 事件

```typescript
{
  type: "message_delta",
  delta: {
    stop_reason: null,
    stop_sequence: null
  },
  usage: {
    output_tokens: 123,         // 累积的输出token
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  }
}
```

**关键特性：**
- **在流式输出过程中多次返回**
- `input_tokens` 始终为0（只在message_start中返回）
- `output_tokens` 累积增长

#### 3.1.3 message_stop 事件

```typescript
{
  type: "message_stop"
}
```

**关键特性：**
- 表示流式传输结束
- 不包含token信息

**实现位置：** `src/api/providers/anthropic.ts:160-193`

```typescript
case "message_start": {
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
    yield {
        type: "usage",
        inputTokens: 0,
        outputTokens: chunk.usage.output_tokens || 0,
    }
    break
```

### 3.2 OpenAI API

**流式返回机制：**

根据OpenAI SDK文档：

#### 3.2.1 ChatCompletionChunk 结构

```typescript
{
  id: "chatcmpl_xxx",
  object: "chat.completion.chunk",
  created: 1234567890,
  model: "gpt-4",
  choices: [
    {
      index: 0,
      delta: {
        content: "Hello"
      },
      finish_reason: null
    }
  ],
  usage: {
    prompt_tokens: 0,           // 大多数chunk中为空
    completion_tokens: 0,       // 大多数chunk中为空
    total_tokens: 0
  }
}
```

**关键特性：**
- **流式chunk中通常不包含usage字段**
- usage信息主要通过`totalUsage`事件在流结束时返回
- 某些情况下，最后一个chunk可能包含完整的usage信息

#### 3.2.2 totalUsage 事件

```javascript
runner.on('totalUsage', (usage) => {
    console.log('Total usage:', usage);
    console.log('Prompt tokens:', usage.prompt_tokens);
    console.log('Completion tokens:', usage.completion_tokens);
    console.log('Total tokens:', usage.total_tokens);
});
```

**关键特性：**
- **在流结束时触发**
- 返回完整的token统计信息
- `prompt_tokens` 包含系统提示词

**实现位置：** `src/api/providers/openai-native.ts:767-769, 1100-1102`

```typescript
// 在completed事件中
if (parsed.response.usage) {
    const usageData = this.normalizeUsage(parsed.response.usage, model)
    if (usageData) {
        yield usageData
    }
}

// 在单独的usage事件中
else if (parsed.usage) {
    const usageData = this.normalizeUsage(parsed.usage, model)
    if (usageData) {
        yield usageData
    }
}
```

### 3.3 Google Gemini API

**流式返回机制：**

根据Gemini API文档：

#### 3.3.1 GenerateContentResponseUsageMetadata

```python
{
  "usage_metadata": {
    "input_token_count": 12345,      # 输入token（包含系统提示词）
    "output_token_count": 678,       # 输出token
    "cached_content_token_count": 0, # 缓存内容token
    "cache_tokens_details": {}
  }
}
```

**关键特性：**
- **在流结束时返回**
- `usage_metadata` 包含完整的token统计
- `input_token_count` 包含系统提示词

**实现位置：** `src/api/providers/gemini.ts:...`

---

## 四、当前回退逻辑的实现分析

### 4.1 回退逻辑触发条件

**位置：** `src/core/task/streaming/StreamingTokenManager.ts:182-199`

```typescript
async checkTiktokenFallback(): Promise<void> {
    const estimatedOutputTokens = this.tokenCounter.getTotalTokens()

    // Only apply fallback if:
    // 1. API did NOT provide any valid usage data (both input and output are 0)
    // 2. We have estimated output tokens from tiktoken
    //
    // If API provided ANY token data (input OR output), we trust it completely
    // and do NOT use tiktoken estimates, as they may be inaccurate.
    const needsFallback = !this.hasApiUsageData &&
        this.tokens.input === 0 &&
        this.tokens.output === 0 &&
        estimatedOutputTokens > 0

    if (needsFallback) {
        await this.applyTiktokenFallback()
    }
}
```

**触发条件：**
1. `!this.hasApiUsageData` - 没有收到有效的API使用数据
2. `this.tokens.input === 0` - 输入token为0
3. `this.tokens.output === 0` - 输出token为0
4. `estimatedOutputTokens > 0` - 有估算的输出token

### 4.2 hasApiUsageData 的设置逻辑

**位置：** `src/core/task/streaming/StreamingTokenManager.ts:98-119`

```typescript
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

    // Consider API provided valid usage data when either input or output tokens are > 0
    // This handles cases where:
    // 1. API returns inputTokens > 0 but outputTokens = 0 (e.g., thinking models at start)
    // 2. API returns outputTokens > 0 (normal streaming completion)
    const hadValidUsageData = this.hasApiUsageData
    if (inputTokens > 0 || outputTokens > 0) {
        this.hasApiUsageData = true
    }
}
```

**设置条件：**
- 只要收到任何非零的token数据（input或output），就设置为true
- **问题：** 无法区分是否收到了完整的token数据

### 4.3 回退逻辑的输入token估算

**位置：** `src/core/task/streaming/StreamingTokenManager.ts:241-269`

```typescript
private async estimateInputTokens(): Promise<number> {
    try {
        // Start with system prompt if available
        const allContent: any[] = []

        // Add system prompt as a text content block
        if (this.systemPrompt) {
            allContent.push({ type: "text", text: this.systemPrompt })
        }

        // Flatten the conversation history to get all content blocks
        const conversationContent = this.apiConversationHistory.flatMap((msg) =>
            Array.isArray(msg.content) ? msg.content : []
        )
        allContent.push(...conversationContent)

        // Use the API's countTokens method if available
        if (this.api.countTokens) {
            return await this.api.countTokens(allContent)
        }

        // Fallback: estimate based on character count (rough approximation)
        const textContent = JSON.stringify(allContent)
        return Math.ceil(textContent.length / 4) // Approximate 4 chars per token
    } catch (error) {
        console.error("[StreamingTokenManager] Error estimating input tokens:", error)
        return 0
    }
}
```

**关键问题：**
1. **系统提示词作为纯文本处理**：`{ type: "text", text: this.systemPrompt }`
2. **没有处理工具定义**：工具定义通常单独传递，不包含在systemPrompt中
3. **没有处理MCP服务器信息**：MCP服务器信息可能动态生成

---

## 五、问题根因分析

### 5.1 系统提示词统计不完整的根本原因

**问题：** 系统提示词实际约7000-8000 tokens，但回退逻辑只统计了2112 tokens

**根因分析：**

1. **工具定义未包含在统计中**
   - 工具定义通过`metadata.tools`单独传递给API
   - 不包含在`systemPrompt`字符串中
   - 但工具定义会被API计入输入token

2. **MCP服务器信息可能动态生成**
   - MCP服务器信息在`getCapabilitiesSection()`中生成
   - 可能包含大量工具描述和schema
   - 某些情况下可能未正确传递

3. **回退逻辑的输入token估算不完整**
   ```typescript
   // 只统计了systemPrompt和apiConversationHistory
   if (this.systemPrompt) {
       allContent.push({ type: "text", text: this.systemPrompt })
   }
   const conversationContent = this.apiConversationHistory.flatMap((msg) =>
       Array.isArray(msg.content) ? msg.content : []
   )
   allContent.push(...conversationContent)
   ```
   - 缺少工具定义的统计
   - 缺少其他动态生成的内容

### 5.2 API可能不返回message_start事件

**可能原因：**

1. **Anthropic SDK版本问题**
   - 某些版本可能不正确处理message_start事件
   - 需要验证SDK版本和配置

2. **网络或代理问题**
   - SSE事件可能在传输过程中丢失
   - 代理服务器可能过滤某些事件

3. **模型或配置问题**
   - 某些模型可能不返回usage数据
   - 特定配置可能禁用usage统计

### 5.3 回退逻辑触发条件过于严格

**问题：** 当API只返回输出token（没有输入token）时，回退逻辑不会触发

**场景：**
```
1. message_delta事件返回: { inputTokens: 0, outputTokens: 341 }
2. hasApiUsageData = true (因为outputTokens > 0)
3. 回退逻辑不触发 (因为hasApiUsageData = true)
4. 输入token (包括系统提示词) 完全丢失
```

**当前逻辑的问题：**
```typescript
const needsFallback = !this.hasApiUsageData &&
    this.tokens.input === 0 &&
    this.tokens.output === 0 &&
    estimatedOutputTokens > 0
```

- 只要`hasApiUsageData = true`，就不会触发回退
- 无法处理"有输出无输入"的情况

---

## 六、改进方案

### 6.1 方案1：改进回退逻辑的触发条件

**目标：** 支持部分回退（只回退输入token）

**实现：**

```typescript
async checkTiktokenFallback(): Promise<void> {
    const estimatedOutputTokens = this.tokenCounter.getTotalTokens()

    // 情况1: 完全没有API数据 - 完全回退
    if (!this.hasApiUsageData &&
        this.tokens.input === 0 &&
        this.tokens.output === 0 &&
        estimatedOutputTokens > 0) {
        await this.applyTiktokenFallback()
        return
    }

    // 情况2: 有输出但没有输入 - 只回退输入部分
    if (this.tokens.output > 0 &&
        this.tokens.input === 0 &&
        estimatedOutputTokens > 0) {
        console.log(
            "[StreamingTokenManager#applyPartialFallback] " +
            "reason=missing_input_tokens | " +
            `estimatedOutput=${estimatedOutputTokens}`
        )

        const inputTokensEstimate = await this.estimateInputTokens()
        const oldInput = this.tokens.input

        this.tokens.input = inputTokensEstimate
        await this.recalculateCost()

        console.log(
            "[StreamingTokenManager#applyPartialFallback#after] " +
            `new{input:${this.tokens.input},output:${this.tokens.output},cost:${this.tokens.totalCost.toFixed(6)}} | ` +
            `old{input:${oldInput},output:${this.tokens.output}}`
        )
    }
}
```

**优点：**
- 可以处理部分token数据缺失的情况
- 保留API返回的准确输出token
- 只估算缺失的输入token

### 6.2 方案2：添加message_start事件跟踪

**目标：** 明确跟踪是否收到了message_start事件

**实现：**

```typescript
export class StreamingTokenManager {
    private api: ApiHandler
    private tokenCounter: StreamingTokenCounter
    private tokens: TokenUsage
    private hasApiUsageData: boolean
    private receivedMessageStartUsage: boolean  // 新增标志
    private collectedInBackground: boolean
    private apiConversationHistory: any[]
    private systemPrompt: string

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
        this.receivedMessageStartUsage = false  // 初始化
        this.collectedInBackground = false
        this.apiConversationHistory = []
        this.systemPrompt = ""
    }

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

        // 如果inputTokens > 0，说明收到了message_start
        if (inputTokens > 0) {
            this.receivedMessageStartUsage = true
            console.log("[StreamingTokenManager] Received message_start usage event")
        }

        if (inputTokens > 0 || outputTokens > 0) {
            this.hasApiUsageData = true
        }
    }

    async checkTiktokenFallback(): Promise<void> {
        const estimatedOutputTokens = this.tokenCounter.getTotalTokens()

        // 只有确认没有收到message_start时才回退
        const needsFallback =
            !this.receivedMessageStartUsage &&  // 关键：检查是否收到message_start
            estimatedOutputTokens > 0

        if (needsFallback) {
            if (this.tokens.input === 0 && this.tokens.output === 0) {
                // 完全没有数据
                await this.applyTiktokenFallback()
            } else if (this.tokens.input === 0) {
                // 只有输出token
                await this.applyPartialFallback()
            }
        } else {
            console.log(
                "[StreamingTokenManager] Skipping fallback - received message_start usage"
            )
        }
    }

    private async applyPartialFallback(): Promise<void> {
        console.log(
            "[StreamingTokenManager#applyPartialFallback] " +
            "reason=missing_input_tokens | " +
            `estimatedOutput=${this.tokenCounter.getTotalTokens()}`
        )

        const inputTokensEstimate = await this.estimateInputTokens()
        const oldInput = this.tokens.input

        this.tokens.input = inputTokensEstimate
        await this.recalculateCost()

        console.log(
            "[StreamingTokenManager#applyPartialFallback#after] " +
            `new{input:${this.tokens.input},output:${this.tokens.output},cost:${this.tokens.totalCost.toFixed(6)}} | ` +
            `old{input:${oldInput},output:${this.tokens.output}}`
        )
    }
}
```

**优点：**
- 明确跟踪是否收到了message_start事件
- 避免误判API是否返回了完整数据
- 提供更好的日志信息用于调试

### 6.3 方案3：完善输入token的估算逻辑

**目标：** 在回退逻辑中正确统计所有输入token

**问题：** 当前回退逻辑只统计了systemPrompt和apiConversationHistory，缺少工具定义等

**实现：**

在`StreamingProcessor.processStream()`中传递完整的输入信息：

```typescript
async processStream(
    stream: AsyncIterable<StreamChunk>,
    abortController?: AbortController,
    apiConversationHistory?: any[],
    systemPrompt?: string,
    tools?: any[],  // 新增：工具定义
    cacheWriteTokens?: number,  // 新增：缓存写入token
    cacheReadTokens?: number  // 新增：缓存读取token
): Promise<StreamingResult> {
    // ...

    // Set API conversation history for tiktoken fallback
    if (apiConversationHistory) {
        this.tokenManager.setApiConversationHistory(apiConversationHistory)
    }

    // Set system prompt for token estimation
    if (systemPrompt) {
        this.tokenManager.setSystemPrompt(systemPrompt)
    }

    // Set tools for token estimation (新增)
    if (tools) {
        this.tokenManager.setTools(tools)
    }

    // Set cache tokens (新增)
    if (cacheWriteTokens || cacheReadTokens) {
        this.tokenManager.setCacheTokens(cacheWriteTokens || 0, cacheReadTokens || 0)
    }

    // ...
}
```

在`StreamingTokenManager`中实现：

```typescript
export class StreamingTokenManager {
    private tools: any[] = []  // 新增
    private cacheWriteTokens: number = 0  // 新增
    private cacheReadTokens: number = 0  // 新增

    setTools(tools: any[]): void {
        this.tools = tools
    }

    setCacheTokens(cacheWrite: number, cacheRead: number): void {
        this.cacheWriteTokens = cacheWrite
        this.cacheReadTokens = cacheRead
    }

    private async estimateInputTokens(): Promise<number> {
        try {
            const allContent: any[] = []

            // 1. Add system prompt
            if (this.systemPrompt) {
                allContent.push({ type: "text", text: this.systemPrompt })
            }

            // 2. Add conversation history
            const conversationContent = this.apiConversationHistory.flatMap((msg) =>
                Array.isArray(msg.content) ? msg.content : []
            )
            allContent.push(...conversationContent)

            // 3. Add tools (新增)
            if (this.tools.length > 0) {
                for (const tool of this.tools) {
                    allContent.push({
                        type: "tool_use",
                        name: tool.function.name,
                        input: tool.function.parameters
                    })
                }
            }

            // 4. Use the API's countTokens method if available
            if (this.api.countTokens) {
                const baseTokens = await this.api.countTokens(allContent)
                // Add cache tokens
                return baseTokens + this.cacheWriteTokens + this.cacheReadTokens
            }

            // Fallback: estimate based on character count
            const textContent = JSON.stringify(allContent)
            return Math.ceil(textContent.length / 4) + this.cacheWriteTokens + this.cacheReadTokens
        } catch (error) {
            console.error("[StreamingTokenManager] Error estimating input tokens:", error)
            return 0
        }
    }
}
```

**优点：**
- 完整统计所有输入token
- 包括工具定义、缓存token等
- 更准确的token估算

### 6.4 方案4：延迟回退逻辑的检查时机

**目标：** 在流结束后再检查是否需要回退

**当前实现：** 在`finalize()`中检查（已经是流结束后）

**改进：** 添加额外的验证逻辑

```typescript
private async finalize(): Promise<void> {
    // Finalize incomplete tool calls
    await this.finalizeIncompleteToolCalls()

    // Complete partial blocks
    this.stateManager.completePartialBlocks()

    // Background token collection
    await this.tokenManager.collectBackgroundUsage()

    // Check tiktoken fallback (延迟到最后)
    await this.tokenManager.checkTiktokenFallback()

    // Final validation (新增)
    await this.validateTokenData()
}

private async validateTokenData(): Promise<void> {
    const tokens = this.tokenManager.getTokens()
    const breakdown = this.tokenManager.getTokenBreakdown()

    console.log(
        "[StreamingProcessor] Final token data validation:",
        `input=${tokens.input},`,
        `output=${tokens.output},`,
        `breakdown=${JSON.stringify(breakdown)}`
    )

    // 验证输出token是否合理
    if (tokens.output === 0 && breakdown.total > 0) {
        console.warn(
            "[StreamingProcessor] Token data inconsistency: " +
            `output=0 but breakdown.total=${breakdown.total}`
        )
    }

    // 验证输入token是否合理
    if (tokens.input === 0 && this.tokenManager.hasSystemPrompt()) {
        console.warn(
            "[StreamingProcessor] Missing input tokens despite having system prompt"
        )
    }
}
```

**优点：**
- 提供额外的验证逻辑
- 帮助识别token数据不一致的情况
- 提供更好的调试信息

---

## 七、推荐的实施计划

### 7.1 优先级1：添加message_start事件跟踪

**原因：** 这是最简单且最有效的改进，可以明确识别API是否返回了完整的输入token

**实施步骤：**
1. 在`StreamingTokenManager`中添加`receivedMessageStartUsage`标志
2. 在`addApiUsage()`中设置该标志
3. 在`checkTiktokenFallback()`中使用该标志
4. 添加相关日志

**预期效果：**
- 明确区分API是否返回了message_start事件
- 避免误判API数据完整性
- 提供更好的调试信息

### 7.2 优先级2：改进回退逻辑触发条件

**原因：** 处理"有输出无输入"的情况，避免输入token完全丢失

**实施步骤：**
1. 修改`checkTiktokenFallback()`的逻辑
2. 添加`applyPartialFallback()`方法
3. 支持部分回退（只回退输入token）

**预期效果：**
- 可以处理部分token数据缺失的情况
- 保留API返回的准确输出token
- 只估算缺失的输入token

### 7.3 优先级3：完善输入token估算逻辑

**原因：** 确保回退逻辑能够正确统计所有输入token

**实施步骤：**
1. 在`processStream()`中传递工具定义等额外信息
2. 在`estimateInputTokens()`中包含工具定义
3. 添加缓存token的统计

**预期效果：**
- 回退逻辑能够正确统计所有输入token
- 包括系统提示词、工具定义、缓存token等
- 更准确的token估算

### 7.4 优先级4：添加验证和调试日志

**原因：** 帮助识别和诊断token统计问题

**实施步骤：**
1. 添加`validateTokenData()`方法
2. 在关键位置添加日志
3. 提供token数据一致性检查

**预期效果：**
- 更容易发现和诊断问题
- 提供更好的调试信息
- 帮助验证修复效果

---

## 八、测试建议

### 8.1 单元测试

**测试场景1：message_start事件跟踪**
```typescript
test('should set receivedMessageStartUsage when inputTokens > 0', () => {
    const manager = new StreamingTokenManager(mockApi)
    expect(manager.getReceivedMessageStartUsage()).toBe(false)

    manager.addApiUsage(1000, 0, 0, 0, 0)
    expect(manager.getReceivedMessageStartUsage()).toBe(true)
})

test('should not set receivedMessageStartUsage when only outputTokens > 0', () => {
    const manager = new StreamingTokenManager(mockApi)
    expect(manager.getReceivedMessageStartUsage()).toBe(false)

    manager.addApiUsage(0, 100, 0, 0, 0)
    expect(manager.getReceivedMessageStartUsage()).toBe(false)
})
```

**测试场景2：部分回退逻辑**
```typescript
test('should apply partial fallback when output exists but input is missing', async () => {
    const manager = new StreamingTokenManager(mockApi)
    manager.setSystemPrompt('test system prompt')
    manager.setApiConversationHistory([])

    // Simulate API returning only output tokens
    manager.addApiUsage(0, 100, 0, 0, 0)

    await manager.checkTiktokenFallback()

    const tokens = manager.getTokens()
    expect(tokens.input).toBeGreaterThan(0)  // Should be estimated
    expect(tokens.output).toBe(100)  // Should be preserved
})
```

**测试场景3：完整输入token估算**
```typescript
test('should estimate input tokens including tools', async () => {
    const manager = new StreamingTokenManager(mockApi)
    manager.setSystemPrompt('test system prompt')
    manager.setApiConversationHistory([])
    manager.setTools([
        {
            type: 'function',
            function: {
                name: 'test_tool',
                parameters: { type: 'object', properties: {} }
            }
        }
    ])

    const inputTokens = await manager.estimateInputTokens()
    expect(inputTokens).toBeGreaterThan(0)
})
```

### 8.2 集成测试

**测试场景：完整流式处理流程**
```typescript
test('should handle streaming with missing message_start', async () => {
    // 模拟API只返回message_delta事件，不返回message_start
    const mockStream = createMockStream([
        { type: 'text', text: 'Hello' },
        { type: 'usage', inputTokens: 0, outputTokens: 5 }
    ])

    const processor = new StreamingProcessor(mockConfig)
    const result = await processor.processStream(
        mockStream,
        undefined,
        [],
        'test system prompt'
    )

    expect(result.tokens.input).toBeGreaterThan(0)  // Should be estimated
    expect(result.tokens.output).toBe(5)  // Should be from API
})
```

### 8.3 端到端测试

**测试场景：真实API调用**
```typescript
test('should correctly count tokens with real API', async () => {
    // 使用真实API进行测试
    const result = await task.executeWithRealApi()

    // 验证token统计
    expect(result.tokens.input).toBeGreaterThan(7000)  // 系统提示词
    expect(result.tokens.output).toBeGreaterThan(0)

    // 验证日志
    expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('receivedMessageStartUsage')
    )
})
```

---

## 九、监控和告警

### 9.1 关键指标

**指标1：回退逻辑触发率**
```typescript
metrics.increment('tiktoken_fallback_triggered', {
    reason: 'no_api_usage_data'
})
```

**指标2：message_start事件接收率**
```typescript
metrics.increment('message_start_received', {
    received: manager.getReceivedMessageStartUsage()
})
```

**指标3：token数据一致性**
```typescript
if (tokens.input === 0 && manager.hasSystemPrompt()) {
    metrics.increment('token_data_inconsistency', {
        type: 'missing_input_tokens'
    })
}
```

### 9.2 告警规则

**告警1：回退逻辑频繁触发**
```yaml
- alert: HighTiktokenFallbackRate
  expr: rate(tiktoken_fallback_triggered_total[5m]) > 0.1
  for: 5m
  annotations:
    summary: "Tiktoken fallback triggered frequently"
    description: "Fallback rate is {{ $value }} per second"
```

**告警2：message_start事件丢失**
```yaml
- alert: MissingMessageStartEvents
  expr: rate(message_start_received{received="false"}[5m]) > 0.05
  for: 5m
  annotations:
    summary: "Message start events missing"
    description: "Missing rate is {{ $value }} per second"
```

---

## 十、总结

### 10.1 核心问题

1. **系统提示词统计不完整**
   - 回退逻辑只统计了部分系统提示词组件
   - 工具定义等动态生成的内容未包含在统计中
   - 实际约7000-8000 tokens被统计为2112 tokens

2. **API流式返回机制差异**
   - Anthropic: message_start返回完整输入token，message_delta返回累积输出token
   - OpenAI: 通常在totalUsage事件中返回完整token信息
   - Gemini: 在流结束时返回usage_metadata

3. **回退逻辑触发条件过于严格**
   - 只要收到任何token数据就认为数据完整
   - 无法处理"有输出无输入"的情况
   - 缺少message_start事件跟踪

### 10.2 推荐方案

**优先级1：** 添加message_start事件跟踪
- 明确识别API是否返回了完整的输入token
- 避免误判API数据完整性

**优先级2：** 改进回退逻辑触发条件
- 支持部分回退（只回退输入token）
- 处理"有输出无输入"的情况

**优先级3：** 完善输入token估算逻辑
- 包含工具定义等所有输入内容
- 更准确的token估算

**优先级4：** 添加验证和调试日志
- 帮助识别和诊断问题
- 提供更好的调试信息

### 10.3 预期效果

实施这些改进后，预期达到以下效果：

1. **准确的token统计**
   - 系统提示词token统计准确（7000-8000 tokens）
   - 工具定义等动态内容正确包含
   - 输入和输出token都准确统计

2. **可靠的回退机制**
   - 只在必要时触发回退
   - 支持部分回退（只回退缺失的部分）
   - 提供清晰的回退原因和日志

3. **更好的可观测性**
   - 明确跟踪API事件
   - 提供详细的token统计日志
   - 支持监控和告警

4. **更强的鲁棒性**
   - 处理API各种异常情况
   - 避免token数据丢失
   - 提供一致的token统计

---

## 附录

### A. 相关文件清单

**核心文件：**
- `src/core/task/streaming/StreamingTokenManager.ts` - Token管理器
- `src/core/task/streaming/StreamingProcessor.ts` - 流处理器
- `src/core/task/streaming/handlers/UsageHandler.ts` - Usage事件处理器
- `src/core/task/Task.ts` - 任务主逻辑
- `src/core/prompts/system.ts` - 系统提示词生成

**API提供商实现：**
- `src/api/providers/anthropic.ts` - Anthropic API实现
- `src/api/providers/openai-native.ts` - OpenAI API实现
- `src/api/providers/gemini.ts` - Gemini API实现

**工具函数：**
- `src/utils/tiktoken.ts` - Token计数工具
- `src/utils/countTokens.ts` - Token计数接口
- `packages/core/src/message-utils/consolidateTokenUsage.ts` - Token使用统计

### B. 参考资料

**API文档：**
- [Anthropic SDK TypeScript](https://github.com/anthropics/anthropic-sdk-typescript)
- [OpenAI Node.js SDK](https://github.com/openai/openai-node)
- [Google Gen AI Python SDK](https://github.com/googleapis/python-genai)

**内部文档：**
- `docs/issue/tiktoken-fallback-analysis.md` - Tiktoken回退分析
- `docs/issue/token-statistics-issues.md` - Token统计问题
- `docs/plan/token-statistics-refactoring-plan.md` - Token统计重构计划

### C. 术语表

| 术语 | 定义 |
|------|------|
| message_start | Anthropic API流式响应的第一个事件，包含完整的输入token |
| message_delta | Anthropic API流式响应的中间事件，包含累积的输出token |
| message_stop | Anthropic API流式响应的结束事件 |
| totalUsage | OpenAI SDK在流结束时触发的事件，返回完整的token统计 |
| usage_metadata | Gemini API在流结束时返回的token统计信息 |
| tiktoken fallback | 当API不返回token数据时，使用tiktoken库进行估算的机制 |
| 系统提示词 | 发送给AI模型的引导性文本，定义模型的行为和角色 |
| 工具定义 | 可供AI模型调用的工具的schema和描述 |

---

**文档版本：** 1.0
**最后更新：** 2026-03-01
**作者：** CodeArts代码智能体
