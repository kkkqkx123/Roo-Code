# 工具调用结果处理失败 - 根本原因与修复方案

## 问题现象

1. UI 正确显示工具调用结果
2. 但发送给 LLM 的工具调用结果显示为失败
3. `consecutiveMistakeCount` 持续增加，触发暂停机制
4. 后端日志显示工具调用失败

## 根本原因

### 原因 1：`ReadFileTool` 执行成功后未重置 `consecutiveMistakeCount`

**位置：`src/core/tools/ReadFileTool.ts` line 607-658**

```typescript
private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
    // ... 构建结果 ...
    
    if (statusMessage || imagesToInclude.length > 0) {
        const result = formatResponse.toolResult(...)
        pushToolResult(...)
    } else {
        pushToolResult(finalResult)  // ✅ 成功执行
    }
    
    // ❌ 缺少：task.consecutiveMistakeCount = 0
}
```

**对比正确实现（WriteToFileTool.ts line 117）：**
```typescript
task.consecutiveMistakeCount = 0  // ✅ 成功执行后重置
```

**影响：**
- 工具执行成功后，错误计数器没有清零
- 多次累积后触发连续失败暂停机制

### 原因 2：`pushToolResult` 将结构化内容降级为纯文本

**位置：`src/core/assistant-message/presentAssistantMessage.ts` line 471-515**

```typescript
const pushToolResult = (content: ToolResponse) => {
    let resultContent: string
    let imageBlocks: Anthropic.ImageBlockParam[] = []

    if (typeof content === "string") {
        resultContent = content
    } else {
        // ❌ 问题：数组内容被拆分
        const textBlocks = content.filter(item => item.type === "text")
        imageBlocks = content.filter(item => item.type === "image")
        resultContent = textBlocks.map(item => item.text).join("\n")
    }

    // ❌ tool_result 只包含文本
    cline.pushToolResultToUserContent({
        type: "tool_result",
        tool_use_id: sanitizeToolUseId(toolCallId),
        content: resultContent,  // 只有文本！
    })

    // ❌ 图片块被分离到 tool_result 外
    if (imageBlocks.length > 0) {
        cline.userMessageContent.push(...imageBlocks)
    }
}
```

**正确的 Anthropic API 格式：**
```typescript
{
    type: "tool_result",
    tool_use_id: "tool_123",
    content: [
        { type: "text", text: "文件内容" },
        { type: "image", source: { ... } }  // 图片应该在 content 数组内
    ]
}
```

**实际发送的格式：**
```typescript
[
    {
        type: "tool_result",
        tool_use_id: "tool_123",
        content: "文件内容"  // 只有文本
    },
    { type: "image", source: { ... } }  // 图片是独立块
]
```

**影响：**
- 对于返回数组格式结果的工具（如包含图片的 read_file），LLM 收到的 tool_result 不完整
- 可能导致 LLM 无法正确解析工具结果

### 原因 3：错误处理路径未增加 `consecutiveMistakeCount`

**位置：`src/core/tools/ReadFileTool.ts` line 265-283**

```typescript
} catch (error) {
    // ... 记录错误 ...
    
    // ❌ 错误：这里应该增加 consecutiveMistakeCount
    // 但没有增加，只是推送了错误结果
    
    task.didToolFailInCurrentTurn = true
    pushToolResult(errorResult)
}
```

**影响：**
- 异常捕获路径没有正确记录错误计数
- 导致错误统计不准确

## 修复方案

### 修复 1：在 `ReadFileTool.buildAndPushResult` 中重置计数器

```typescript
private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
    // ... existing code ...
    
    if (statusMessage || imagesToInclude.length > 0) {
        const result = formatResponse.toolResult(...)
        if (typeof result === "string") {
            pushToolResult(statusMessage ? `${result}\n${finalResult}` : result)
        } else {
            if (statusMessage) {
                const textBlock = { type: "text" as const, text: finalResult }
                pushToolResult([...result, textBlock] as any)
            } else {
                pushToolResult(result as any)
            }
        }
    } else {
        pushToolResult(finalResult)
    }
    
    // ✅ 添加：工具执行成功后重置计数器
    task.consecutiveMistakeCount = 0
}
```

### 修复 2：修复 `pushToolResult` 处理数组内容

```typescript
const pushToolResult = (content: ToolResponse) => {
    if (hasToolResult) {
        console.warn(...)
        return
    }

    // 合并审批反馈
    if (approvalFeedback) {
        // ... existing code ...
    }

    // ✅ 正确处理数组格式
    if (typeof content === "string") {
        cline.pushToolResultToUserContent({
            type: "tool_result",
            tool_use_id: sanitizeToolUseId(toolCallId),
            content: content || "(tool did not return anything)",
        })
    } else {
        // ✅ 保持数组格式，不拆分
        cline.pushToolResultToUserContent({
            type: "tool_result",
            tool_use_id: sanitizeToolUseId(toolCallId),
            content: content,  // 直接传递数组
        })
    }

    hasToolResult = true
}
```

### 修复 3：修复错误处理路径

```typescript
} catch (error) {
    const relPath = filePath || "unknown"
    const errorMsg = error instanceof Error ? error.message : String(error)

    const toolError = new FileNotFoundToolError("read_file", relPath)
    toolError.message = `Error reading file: ${errorMsg}`
    task.recordToolError("read_file", toolError.toLogEntry())

    updateFileResult(relPath, {
        status: "error",
        error: formatResponse.toolErrorFromInstance(toolError.toLLMMessage()),
        nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
    })

    task.didToolFailInCurrentTurn = true
    
    // ✅ 添加：增加错误计数
    task.consecutiveMistakeCount++

    const errorResult = fileResults
        .filter((r) => r.nativeContent)
        .map((r) => r.nativeContent)
        .join("\n\n---\n\n")

    pushToolResult(errorResult || formatResponse.toolErrorFromInstance(toolError.toLLMMessage()))
}
```

### 修复 4：检查其他工具是否有同样问题

运行以下命令检查所有工具文件：

```bash
# 查找成功执行后未重置计数器的工具
grep -L "consecutiveMistakeCount = 0" src/core/tools/*.ts
```

需要检查的工具列表：
- [ ] ReadFileTool.ts - 已确认有问题
- [ ] ListFilesTool.ts
- [ ] SearchFilesTool.ts
- [ ] CodebaseSearchTool.ts
- [ ] 其他...

## 验证步骤

1. **应用修复 1** 后，观察 `consecutiveMistakeCount` 是否正确重置
2. **应用修复 2** 后，检查发送给 LLM 的 tool_result 是否包含完整的结构化内容
3. **应用修复 3** 后，验证错误处理路径是否正确记录错误计数

## 优先级

1. **P0**: 修复 1 - `ReadFileTool` 重置计数器（最直接的原因）
2. **P1**: 修复 2 - `pushToolResult` 保持数组格式（影响结构化结果）
3. **P2**: 修复 3 - 错误处理路径增加计数器（改进错误统计）
4. **P3**: 检查其他工具是否有同样问题
