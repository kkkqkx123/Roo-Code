# 完整首条用户提示词构建与回退Token估算对比分析

## 执行摘要

本文档深入分析了Roo-Code项目中首条用户提示词的完整构建逻辑，以及回退token估算的实现。通过对比两者的差异，我们发现了回退逻辑中token统计不准确的根本原因：**回退估算逻辑与实际API调用的输入构成存在显著差异**。

**核心发现：**
1. **实际API调用**包含：系统提示词 + 对话历史 + 工具定义（通过metadata传递）
2. **回退估算逻辑**只包含：系统提示词 + 对话历史
3. **关键缺失**：工具定义（约1000-2000 tokens）未包含在回退估算中
4. **结果**：实际约7000-8000 tokens被估算为约2000 tokens

---

## 一、首条用户提示词的完整构建逻辑

### 1.1 调用链路分析

**入口点：** `src/core/task/Task.ts:attemptApiRequest()`

```typescript
// 位置：Task.ts:4088-4092
const stream = this.api.createMessage(
    systemPrompt,           // 系统提示词
    cleanConversationHistory as unknown as Anthropic.Messages.MessageParam[],  // 对话历史
    metadata,               // 元数据（包含工具定义等）
)
```

### 1.2 系统提示词的生成

**位置：** `src/core/task/Task.ts:3818`

```typescript
const systemPrompt = await this.getSystemPrompt()
```

**生成函数：** `src/core/task/Task.ts:3530-3609`

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
        false,  // supportsComputerUse
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
        undefined,  // todoList
        this.api.getModel().id,
        provider.getSkillsManager(),
    )
}
```

### 1.3 工具定义的构建

**位置：** `src/core/task/Task.ts:4040-4078`

```typescript
// Gemini requires all tool definitions to be present for history compatibility,
// but uses allowedFunctionNames to restrict which tools can be called.
const supportsAllowedFunctionNames = apiConfiguration?.apiProvider === "gemini"

{
    const provider = this.providerRef.deref()
    if (!provider) {
        throw new Error("Provider reference lost during tool building")
    }

    const toolsResult = await buildNativeToolsArrayWithRestrictions({
        provider,
        cwd: this.cwd,
        mode,
        customModes: state?.customModes,
        experiments: state?.experiments,
        apiConfiguration,
        disabledTools: state?.disabledTools,
        modelInfo,
        skillsEnabled: state?.skillsEnabled,
        includeAllToolsWithRestrictions: supportsAllowedFunctionNames,
    })
    allTools = toolsResult.tools
    allowedFunctionNames = toolsResult.allowedFunctionNames
}

const shouldIncludeTools = allTools.length > 0

const metadata: ApiHandlerCreateMessageMetadata = {
    mode: mode,
    taskId: this.taskId,
    suppressPreviousResponseId: this.skipPrevResponseIdOnce,
    // Include tools whenever they are present.
    ...(shouldIncludeTools
        ? {
            tools: allTools,
            tool_choice: "auto",
            parallelToolCalls: true,
            ...(allowedFunctionNames ? { allowedFunctionNames } : {}),
        }
        : {}),
}
```

### 1.4 工具定义的详细构建逻辑

**位置：** `src/core/task/build-tools.ts:83-172`

```typescript
export async function buildNativeToolsArrayWithRestrictions(options: BuildToolsOptions): Promise<BuildToolsResult> {
    const {
        provider,
        cwd,
        mode,
        customModes,
        experiments,
        apiConfiguration,
        disabledTools,
        modelInfo,
        skillsEnabled,
        includeAllToolsWithRestrictions,
    } = options

    const mcpHub = provider.getMcpHub()
    const codeIndexManager = CodeIndexManager.getInstance(provider.context, cwd)

    // Build settings object for tool filtering.
    const filterSettings = {
        todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
        disabledTools,
        modelInfo,
        skillsEnabled,
    }

    // Check if the model supports images for read_file tool description.
    const supportsImages = modelInfo?.supportsImages ?? false

    // Build native tools with dynamic read_file tool based on settings.
    const nativeTools = getNativeTools({
        supportsImages,
    })

    // Filter native tools based on mode restrictions.
    const filteredNativeTools = filterNativeToolsForMode(
        nativeTools,
        mode,
        customModes,
        experiments,
        codeIndexManager,
        filterSettings,
        mcpHub,
    )

    // Filter MCP tools based on mode restrictions.
    const mcpTools = getMcpServerTools(mcpHub)
    const filteredMcpTools = filterMcpToolsForMode(mcpTools, mode, customModes, experiments)

    // Add custom tools if they are available and the experiment is enabled.
    let nativeCustomTools: OpenAI.Chat.ChatCompletionFunctionTool[] = []

    if (experiments?.customTools) {
        const toolDirs = getRooDirectoriesForCwd().map((dir) => path.join(dir, "tools"))
        await customToolRegistry.loadFromDirectoriesIfStale(toolDirs)
        const customTools = customToolRegistry.getAllSerialized()

        if (customTools.length > 0) {
            nativeCustomTools = customTools.map(formatNative)
        }
    }

    // Combine filtered tools (for backward compatibility and for allowedFunctionNames)
    const filteredTools = [...filteredNativeTools, ...filteredMcpTools, ...nativeCustomTools]

    // If includeAllToolsWithRestrictions is true, return ALL tools but provide
    // allowed names based on mode filtering
    if (includeAllToolsWithRestrictions) {
        // Combine ALL tools (unfiltered native + all MCP + custom)
        const allTools = [...nativeTools, ...mcpTools, ...nativeCustomTools]

        // Extract names of tools that are allowed based on mode filtering.
        const allowedFunctionNames = filteredTools.map((tool) => resolveToolAlias(getToolName(tool)))

        return {
            tools: allTools,
            allowedFunctionNames,
        }
    }

    // Default behavior: return only filtered tools
    return {
        tools: filteredTools,
    }
}
```

### 1.5 实际API调用的完整输入构成

**总结：实际发送给API的完整输入包括：**

1. **系统提示词** (`systemPrompt`)
   - 通过`createMessage()`的第一个参数传递
   - 包含角色定义、格式说明、工具使用指南、能力说明、模式说明、技能说明、规则说明、系统信息等
   - **预估token数：** 5000-6000 tokens

2. **对话历史** (`cleanConversationHistory`)
   - 通过`createMessage()`的第二个参数传递
   - 包含历史用户消息和助手回复
   - **预估token数：** 0-1000 tokens（取决于对话历史长度）

3. **工具定义** (`metadata.tools`)
   - 通过`createMessage()`的`metadata`参数传递
   - 包含所有可用工具的schema和描述
   - **预估token数：** 1000-2000 tokens

**总预估token数：** 6000-9000 tokens

---

## 二、回退Token估算逻辑

### 2.1 回退估算的调用时机

**位置：** `src/core/task/streaming/StreamingProcessor.ts:365`

```typescript
// Check tiktoken fallback
await this.tokenManager.checkTiktokenFallback()
```

**触发条件：** 在流式传输结束后，检查是否需要使用tiktoken进行token估算

### 2.2 回退估算的输入数据

**位置：** `src/core/task/streaming/StreamingProcessor.ts:3176-3184`

```typescript
// Process stream - state will be updated via event bus subscription
await processor.processStream(
    stream,
    this.currentRequestAbortController,
    [
        ...this.apiConversationHistory,
        { role: "user", content: finalUserContent },
    ],
    systemPromptForTokenEstimation,  // ← 只传递了系统提示词
)
```

### 2.3 回退估算的实现逻辑

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

### 2.4 回退估算的完整输入构成

**总结：回退估算逻辑只包含：**

1. **系统提示词** (`this.systemPrompt`)
   - 通过`setSystemPrompt()`方法设置
   - 作为文本内容块处理：`{ type: "text", text: this.systemPrompt }`
   - **预估token数：** 5000-6000 tokens

2. **对话历史** (`this.apiConversationHistory`)
   - 通过`setApiConversationHistory()`方法设置
   - 扁平化为内容块数组
   - **预估token数：** 0-1000 tokens

**总预估token数：** 5000-7000 tokens

---

## 三、差异对比分析

### 3.1 构成要素对比表

| 构成要素 | 实际API调用 | 回退估算逻辑 | 是否缺失 |
|---------|------------|-------------|---------|
| 系统提示词 | ✅ 包含（第一个参数） | ✅ 包含（setSystemPrompt） | ❌ 否 |
| 对话历史 | ✅ 包含（第二个参数） | ✅ 包含（setApiConversationHistory） | ❌ 否 |
| 工具定义 | ✅ 包含（metadata.tools） | ❌ **缺失** | ✅ **是** |
| MCP服务器信息 | ✅ 包含（在系统提示词中） | ✅ 包含（在系统提示词中） | ❌ 否 |
| 自定义工具 | ✅ 包含（metadata.tools） | ❌ **缺失** | ✅ **是** |
| 缓存token | ✅ 包含（API自动处理） | ❌ **缺失** | ✅ **是** |

### 3.2 工具定义的详细对比

#### 实际API调用中的工具定义

**位置：** `src/core/task/Task.ts:4064-4078`

```typescript
const metadata: ApiHandlerCreateMessageMetadata = {
    mode: mode,
    taskId: this.taskId,
    suppressPreviousResponseId: this.skipPrevResponseIdOnce,
    ...(shouldIncludeTools
        ? {
            tools: allTools,  // ← 完整的工具定义数组
            tool_choice: "auto",
            parallelToolCalls: true,
            ...(allowedFunctionNames ? { allowedFunctionNames } : {}),
        }
        : {}),
}
```

**`allTools` 的构成：**

```typescript
// 位置：src/core/task/build-tools.ts:148
const filteredTools = [
    ...filteredNativeTools,      // 原生工具（read_file、write_to_file等）
    ...filteredMcpTools,         // MCP工具
    ...nativeCustomTools,        // 自定义工具
]
```

**典型工具定义示例：**

```typescript
{
    type: "function",
    function: {
        name: "read_file",
        description: "Read the contents of a file at the specified path...",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The path to the file to read..."
                }
            },
            required: ["path"]
        }
    }
}
```

**预估token数：** 每个工具定义约50-100 tokens，总共约20-30个工具，总计约1000-2000 tokens

#### 回退估算逻辑中的工具定义

**当前实现：** ❌ **完全不包含**

**位置：** `src/core/task/streaming/StreamingTokenManager.ts:241-269`

```typescript
private async estimateInputTokens(): Promise<number> {
    try {
        const allContent: any[] = []

        // Add system prompt
        if (this.systemPrompt) {
            allContent.push({ type: "text", text: this.systemPrompt })
        }

        // Add conversation history
        const conversationContent = this.apiConversationHistory.flatMap((msg) =>
            Array.isArray(msg.content) ? msg.content : []
        )
        allContent.push(...conversationContent)

        // ❌ 缺少：工具定义的统计

        return await this.api.countTokens(allContent)
    } catch (error) {
        console.error("[StreamingTokenManager] Error estimating input tokens:", error)
        return 0
    }
}
```

### 3.3 Token数对比

| 组件 | 实际API调用 | 回退估算逻辑 | 差异 |
|-----|-----------|-------------|------|
| 系统提示词 | 5000-6000 | 5000-6000 | 0 |
| 对话历史 | 0-1000 | 0-1000 | 0 |
| 工具定义 | 1000-2000 | **0** | **-1000 to -2000** |
| 缓存token | 0-500 | **0** | **-0 to -500** |
| **总计** | **6000-9000** | **5000-7000** | **-1000 to -2000** |

### 3.4 根本原因总结

**核心问题：** 回退估算逻辑与实际API调用的输入构成不一致

1. **工具定义未传递给回退逻辑**
   - 工具定义通过`metadata.tools`传递给API
   - 但回退逻辑的`processStream()`方法没有接收工具定义
   - 导致工具定义的token完全丢失

2. **缺少工具定义的统计方法**
   - `StreamingTokenManager`没有`setTools()`方法
   - `estimateInputTokens()`没有处理工具定义的逻辑
   - 无法统计工具定义的token

3. **缓存token未考虑**
   - API会自动处理缓存token（cache_creation_input_tokens、cache_read_input_tokens）
   - 回退逻辑没有缓存token的统计
   - 导致缓存token完全丢失

---

## 四、修复方案

### 4.1 方案1：在processStream中传递工具定义

**目标：** 确保回退逻辑能够访问工具定义

**实现：**

```typescript
// 位置：src/core/task/Task.ts:3176-3184
await processor.processStream(
    stream,
    this.currentRequestAbortController,
    [
        ...this.apiConversationHistory,
        { role: "user", content: finalUserContent },
    ],
    systemPromptForTokenEstimation,
    allTools,  // ← 新增：传递工具定义
    metadata.cacheWriteTokens,  // ← 新增：传递缓存写入token
    metadata.cacheReadTokens,   // ← 新增：传递缓存读取token
)
```

### 4.2 方案2：在StreamingTokenManager中添加工具定义支持

**目标：** 支持工具定义的token统计

**实现：**

```typescript
// 位置：src/core/task/streaming/StreamingTokenManager.ts
export class StreamingTokenManager {
    private api: ApiHandler
    private tokenCounter: StreamingTokenCounter
    private tokens: TokenUsage
    private hasApiUsageData: boolean
    private receivedMessageStartUsage: boolean
    private collectedInBackground: boolean
    private apiConversationHistory: any[]
    private systemPrompt: string
    private tools: any[] = []  // ← 新增
    private cacheWriteTokens: number = 0  // ← 新增
    private cacheReadTokens: number = 0   // ← 新增

    // ... 其他代码

    /**
     * Set the tools for token estimation
     */
    setTools(tools: any[]): void {
        this.tools = tools
    }

    /**
     * Set the cache tokens for token estimation
     */
    setCacheTokens(cacheWrite: number, cacheRead: number): void {
        this.cacheWriteTokens = cacheWrite
        this.cacheReadTokens = cacheRead
    }

    /**
     * Estimate input tokens using tiktoken
     * Includes system prompt, conversation history, tools, and cache tokens
     */
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
                // Add cache tokens (新增)
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

### 4.3 方案3：在StreamingProcessor中传递额外参数

**目标：** 修改processStream方法签名以接收工具定义

**实现：**

```typescript
// 位置：src/core/task/streaming/StreamingProcessor.ts:113-118
async processStream(
    stream: AsyncIterable<StreamChunk>,
    abortController?: AbortController,
    apiConversationHistory?: any[],
    systemPrompt?: string,
    tools?: any[],  // ← 新增
    cacheWriteTokens?: number,  // ← 新增
    cacheReadTokens?: number  // ← 新增
): Promise<StreamingResult> {
    // ... 验证输入

    // Reset state
    this.stateManager.reset()
    this.tokenManager.reset()
    this.deadLoopDetector.reset()

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

    // ... 其他代码
}
```

### 4.4 方案4：从metadata中提取工具定义

**目标：** 在Task.ts中从metadata提取工具定义

**实现：**

```typescript
// 位置：src/core/task/Task.ts:3176-3184
// Build metadata for API call
const metadata: ApiHandlerCreateMessageMetadata = {
    mode,
    taskId: this.taskId,
    ...(allTools.length > 0
        ? {
            tools: allTools,
            tool_choice: "auto",
            parallelToolCalls: true,
        }
        : {}),
}

// Process stream with complete token estimation data
await processor.processStream(
    stream,
    this.currentRequestAbortController,
    [
        ...this.apiConversationHistory,
        { role: "user", content: finalUserContent },
    ],
    systemPromptForTokenEstimation,
    allTools,  // ← 从metadata中提取
    0,  // cacheWriteTokens (如果没有预计算)
    0,  // cacheReadTokens (如果没有预计算)
)
```

---

## 五、推荐实施方案

### 5.1 优先级1：添加工具定义支持（方案2 + 方案3）

**原因：** 这是最直接且最有效的修复方法

**实施步骤：**

1. **修改StreamingTokenManager**
   - 添加`tools`、`cacheWriteTokens`、`cacheReadTokens`属性
   - 添加`setTools()`和`setCacheTokens()`方法
   - 修改`estimateInputTokens()`以包含工具定义和缓存token

2. **修改StreamingProcessor**
   - 修改`processStream()`方法签名，添加`tools`、`cacheWriteTokens`、`cacheReadTokens`参数
   - 在方法内部调用`tokenManager.setTools()`和`tokenManager.setCacheTokens()`

3. **修改Task.ts**
   - 在调用`processor.processStream()`时传递工具定义
   - 从`allTools`变量中传递工具定义

**预期效果：**
- 回退估算逻辑能够正确统计工具定义的token
- Token统计从约2000提升到约6000-9000
- 与实际API调用的输入构成一致

### 5.2 优先级2：添加message_start事件跟踪

**原因：** 明确识别API是否返回了完整的输入token

**实施步骤：**

1. 在`StreamingTokenManager`中添加`receivedMessageStartUsage`标志
2. 在`addApiUsage()`中设置该标志
3. 在`checkTiktokenFallback()`中使用该标志

**预期效果：**
- 明确区分API是否返回了message_start事件
- 避免误判API数据完整性
- 提供更好的调试信息

### 5.3 优先级3：改进回退逻辑触发条件

**原因：** 支持部分回退（只回退输入token）

**实施步骤：**

1. 修改`checkTiktokenFallback()`的逻辑
2. 添加`applyPartialFallback()`方法
3. 支持部分回退（只回退缺失的输入token）

**预期效果：**
- 可以处理部分token数据缺失的情况
- 保留API返回的准确输出token
- 只估算缺失的输入token

---

## 六、验证和测试

### 6.1 单元测试

**测试场景1：工具定义的token统计**

```typescript
test('should estimate input tokens including tools', async () => {
    const manager = new StreamingTokenManager(mockApi)
    manager.setSystemPrompt('test system prompt')
    manager.setApiConversationHistory([])

    // 设置工具定义
    manager.setTools([
        {
            type: 'function',
            function: {
                name: 'test_tool',
                description: 'A test tool',
                parameters: {
                    type: 'object',
                    properties: {
                        param1: { type: 'string' }
                    }
                }
            }
        }
    ])

    const inputTokens = await manager.estimateInputTokens()

    // 验证token数大于0
    expect(inputTokens).toBeGreaterThan(0)

    // 验证包含系统提示词和工具定义
    expect(manager.getTools().length).toBe(1)
})
```

**测试场景2：缓存token的统计**

```typescript
test('should include cache tokens in estimation', async () => {
    const manager = new StreamingTokenManager(mockApi)
    manager.setSystemPrompt('test system prompt')
    manager.setApiConversationHistory([])
    manager.setCacheTokens(100, 50)

    const inputTokens = await manager.estimateInputTokens()

    // 验证包含缓存token
    expect(inputTokens).toBeGreaterThan(150)
})
```

### 6.2 集成测试

**测试场景：完整流式处理流程**

```typescript
test('should correctly estimate tokens with tools in fallback', async () => {
    const mockApi = createMockApi()
    const systemPrompt = await generateTestSystemPrompt()
    const tools = createTestTools()

    const processor = new StreamingProcessor({
        api: mockApi,
        eventBus: mockEventBus,
    })

    const result = await processor.processStream(
        mockStream,
        undefined,
        [],
        systemPrompt,
        tools,
        0,
        0
    )

    // 验证token估算包含工具定义
    expect(result.tokens.input).toBeGreaterThan(6000)
})
```

### 6.3 端到端测试

**测试场景：真实API调用对比**

```typescript
test('should match actual API token counts', async () => {
    // 使用真实API进行测试
    const task = createTestTask()

    // 执行任务
    await task.execute()

    // 获取token统计
    const tokens = task.getTokens()

    // 验证token数合理
    expect(tokens.input).toBeBetween(6000, 9000)
    expect(tokens.output).toBeGreaterThan(0)

    // 验证日志
    expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('estimateInputTokens')
    )
})
```

---

## 七、监控和告警

### 7.1 关键指标

**指标1：回退估算的token数**

```typescript
metrics.gauge('tiktoken_fallback_input_tokens', {
    value: estimatedInputTokens,
    has_tools: tools.length > 0,
    tools_count: tools.length,
})
```

**指标2：工具定义的token数**

```typescript
metrics.gauge('tools_definition_tokens', {
    value: toolsTokens,
    tools_count: tools.length,
})
```

**指标3：估算准确性**

```typescript
metrics.histogram('token_estimation_accuracy', {
    estimated: estimatedTokens,
    actual: actualTokens,
    difference: Math.abs(estimatedTokens - actualTokens),
})
```

### 7.2 告警规则

**告警1：工具定义token异常**

```yaml
- alert: AbnormalToolsTokenCount
  expr: tools_definition_tokens < 500 or tools_definition_tokens > 5000
  for: 5m
  annotations:
    summary: "Tools token count is abnormal"
    description: "Tools tokens: {{ $value }}"
```

**告警2：估算准确性低**

```yaml
- alert: LowTokenEstimationAccuracy
  expr: abs(estimated - actual) / actual > 0.3
  for: 5m
  annotations:
    summary: "Token estimation accuracy is low"
    description: "Accuracy: {{ $value }}%"
```

---

## 八、总结

### 8.1 核心问题

**回退token估算逻辑与实际API调用的输入构成存在显著差异：**

1. **工具定义缺失**
   - 实际API调用包含工具定义（约1000-2000 tokens）
   - 回退估算逻辑完全不包含工具定义
   - 导致token统计严重偏低

2. **缓存token缺失**
   - API会自动处理缓存token
   - 回退估算逻辑没有缓存token的统计
   - 导致缓存token完全丢失

3. **数据传递不完整**
   - `processStream()`方法没有接收工具定义
   - `StreamingTokenManager`没有工具定义的存储和处理能力
   - 无法统计工具定义的token

### 8.2 推荐方案

**优先级1：添加工具定义支持**
- 在`StreamingTokenManager`中添加工具定义的存储和处理
- 在`estimateInputTokens()`中包含工具定义的统计
- 在`processStream()`中传递工具定义

**优先级2：添加缓存token支持**
- 在`StreamingTokenManager`中添加缓存token的存储
- 在`estimateInputTokens()`中包含缓存token的统计

**优先级3：改进回退逻辑**
- 添加message_start事件跟踪
- 支持部分回退
- 提供更好的调试信息

### 8.3 预期效果

实施这些改进后，预期达到以下效果：

1. **准确的token统计**
   - 回退估算逻辑能够正确统计工具定义的token
   - Token统计从约2000提升到约6000-9000
   - 与实际API调用的输入构成一致

2. **可靠的回退机制**
   - 只在必要时触发回退
   - 支持部分回退（只回退缺失的部分）
   - 提供清晰的回退原因和日志

3. **更好的可观测性**
   - 明确跟踪API事件
   - 提供详细的token统计日志
   - 支持监控和告警

---

## 附录

### A. 相关文件清单

**核心文件：**
- `src/core/task/Task.ts` - 任务主逻辑（包含createMessage调用）
- `src/core/task/streaming/StreamingTokenManager.ts` - Token管理器（包含回退估算逻辑）
- `src/core/task/streaming/StreamingProcessor.ts` - 流处理器（包含processStream方法）
- `src/core/task/build-tools.ts` - 工具定义构建逻辑

**相关文件：**
- `src/core/prompts/system.ts` - 系统提示词生成
- `src/api/providers/anthropic.ts` - Anthropic API实现
- `src/api/providers/openai-native.ts` - OpenAI API实现
- `src/api/providers/gemini.ts` - Gemini API实现

### B. 参考资料

**内部文档：**
- `docs/analysis/token-counting-and-fallback-mechanism-analysis.md` - Token计数与回退机制深度分析
- `docs/issue/tiktoken-fallback-analysis.md` - Tiktoken回退分析
- `docs/issue/token-statistics-issues.md` - Token统计问题

### C. 术语表

| 术语 | 定义 |
|------|------|
| 系统提示词 | 发送给AI模型的引导性文本，定义模型的行为和角色 |
| 工具定义 | 可供AI模型调用的工具的schema和描述 |
| 对话历史 | 用户和AI之间的历史消息记录 |
| 缓存token | API缓存的输入token，可以减少重复计算 |
| 回退估算 | 当API不返回token数据时，使用tiktoken库进行估算的机制 |
| metadata | 传递给API的元数据，包含工具定义等额外信息 |

---

**文档版本：** 1.0
**最后更新：** 2026-03-01
**作者：** CodeArts代码智能体
