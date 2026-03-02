# 工具调用结果处理失败的根本原因分析

## 问题描述

UI 正确显示工具调用结果，但后端将工具调用视为失败，导致：
1. `consecutiveMistakeCount` 持续增加
2. 触发连续失败暂停机制
3. 发送给 LLM 的工具调用结果显示错误/失败

## 根本原因

### 原因 1：`pushToolResult` 中 `content` 被错误转换为纯文本（HIGH LIKELIHOOD）

**问题位置：`presentAssistantMessage.ts` line 471-515**

```typescript
const pushToolResult = (content: ToolResponse) => {
    if (hasToolResult) {
        console.warn(...)
        return
    }

    let resultContent: string
    let imageBlocks: Anthropic.ImageBlockParam[] = []

    if (typeof content === "string") {
        resultContent = content || "(tool did not return anything)"
    } else {
        // ⚠️ 问题：当 content 是数组时，只提取文本块
        const textBlocks = content.filter((item) => item.type === "text")
        imageBlocks = content.filter((item) => item.type === "image")
        resultContent = textBlocks
            .map((item) => (item as Anthropic.TextBlockParam).text)
            .join("\n") || "(tool did not return anything)"
    }

    // 合并审批反馈
    if (approvalFeedback) { ... }

    // ⚠️ 关键问题：pushToolResultToUserContent 只接收文本内容
    cline.pushToolResultToUserContent({
        type: "tool_result",
        tool_use_id: sanitizeToolUseId(toolCallId),
        content: resultContent,  // 只有文本！
    })

    // ⚠️ 图片块被单独添加到 userMessageContent，但不在 tool_result 内
    if (imageBlocks.length > 0) {
        cline.userMessageContent.push(...imageBlocks)
    }

    hasToolResult = true
}
```

**问题影响：**

1. **tool_result 的 content 字段只包含文本**，丢失了结构化信息
2. **图片块被分离到 userMessageContent 数组中**，与 tool_result 不在同一个块内
3. 当 `userMessageContent` 被发送到 LLM 时，tool_result 和图片块是分开的，导致 LLM 收到的 tool_result 不完整

**正确的 Anthropic API 格式应该是：**

```typescript
{
    type: "tool_result",
    tool_use_id: "tool_123",
    content: [
        { type: "text", text: "文件内容..." },
        { type: "image", source: { ... } }  // 图片应该在 content 数组内
    ]
}
```

**但实际发送的格式是：**

```typescript
// userMessageContent 数组包含：
[
    {
        type: "tool_result",
        tool_use_id: "tool_123",
        content: "文件内容..."  // 只有文本
    },
    { type: "image", source: { ... } }  // 图片是独立的块！
]
```

### 原因 2：`ReadFileTool` 执行成功后未重置 `consecutiveMistakeCount`

**对比其他工具的正确实现：**

```typescript
// WriteToFileTool.ts line 117 - ✅ 正确
task.consecutiveMistakeCount = 0

// ExecuteCommandTool.ts line 54 - ✅ 正确  
task.consecutiveMistakeCount = 0

// UseMcpToolTool.ts line 52 - ✅ 正确
task.consecutiveMistakeCount = 0

// ReadFileTool.ts - ❌ 错误：缺少重置！
```

**`ReadFileTool.ts` 的问题代码：**

```typescript
// Line 103: 参数验证失败时增加计数器
if (!filePath) {
    task.consecutiveMistakeCount++  // ✅ 正确
    // ...
    return
}

// Line 607: buildAndPushResult 方法 - 工具执行成功后
private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
    // ... 构建结果 ...
    
    // ❌ 错误：缺少 task.consecutiveMistakeCount = 0
    pushToolResult(finalResult)  // 成功执行但没有重置计数器
}
```

**影响：**
- 每次成功执行 `read_file` 后，`consecutiveMistakeCount` 保持之前的值
- 如果之前有失败，计数器不会清零
- 多次成功后，计数器累积到阈值，触发暂停机制

### 原因 2：`didAlreadyUseTool` 标志设置问题

**问题代码位置：`presentAssistantMessage.ts` line 332**

```typescript
case "tool_use": {
    const toolCallId = (block as any).id as string | undefined
    if (!toolCallId) {
        // ...
        cline.consecutiveMistakeCount++
        await cline.say("error", errorMessage)
        cline.userMessageContent.push({ type: "text", text: errorMessage })
        cline.didAlreadyUseTool = true  // ⚠️ 这里设置了标志
        break
    }
    // ...
}
```

**这是唯一设置 `didAlreadyUseTool = true` 的地方！**

**问题场景：**
1. 当工具调用缺少 `tool_use.id` 时，设置 `didAlreadyUseTool = true`
2. 后续的 text block 会被跳过（line 293）：
   ```typescript
   case "text": {
       if (cline.didRejectTool || cline.didAlreadyUseTool) {
           break  // ⚠️ 被跳过
       }
       // ...
   }
   ```
3. 后续的工具调用也会被影响

**但这个问题相对较少见，因为正常的工具调用都会有 ID。**

### 原因 3：工具调用结果可能未被正确添加到 `userMessageContent`

**检查 `pushToolResultToUserContent` 方法：**

```typescript
// Task.ts line 380
public pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam): boolean {
    const existingResult = this.userMessageContent.find(
        (block): block is Anthropic.ToolResultBlockParam =>
            block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id,
    )
    if (existingResult) {
        console.warn(
            `[Task#pushToolResultToUserContent] Skipping duplicate tool_result for tool_use_id: ${toolResult.tool_use_id}`,
        )
        return false  // ⚠️ 重复的结果被跳过
    }
    this.userMessageContent.push(toolResult)
    return true
}
```

**潜在问题：**
- 如果同一个 `tool_use_id` 被多次调用 `pushToolResultToUserContent`，只有第一次会成功
- 但根据代码审查，每个工具调用只应该调用一次 `pushToolResult`

## 验证方法

### 验证原因 1（最可能）

在 `ReadFileTool.buildAndPushResult` 方法末尾添加日志：

```typescript
private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
    // ... existing code ...
    
    // 添加调试日志
    console.log(
        `[ReadFileTool.buildAndPushResult] Before push: consecutiveMistakeCount=${task.consecutiveMistakeCount}`
    )
    
    pushToolResult(finalResult)
    
    console.log(
        `[ReadFileTool.buildAndPushResult] After push: consecutiveMistakeCount=${task.consecutiveMistakeCount}`
    )
}
```

### 验证原因 2

检查日志中是否有 "Invalid tool call: missing tool_use.id" 错误。

## 修复方案

### 修复 1：在 `ReadFileTool.buildAndPushResult` 中重置计数器

```typescript
private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
    const finalResult = fileResults
        .filter((r) => r.nativeContent)
        .map((r) => r.nativeContent)
        .join("\n\n---\n\n")

    // ... existing code ...

    if (statusMessage || imagesToInclude.length > 0) {
        const result = formatResponse.toolResult(
            statusMessage || finalResult,
            imagesToInclude.length > 0 ? imagesToInclude : undefined,
        )

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

### 修复 2：检查其他工具是否也有同样问题

需要检查所有工具文件，确保成功执行后都重置了 `consecutiveMistakeCount`：

```bash
# 搜索所有工具文件
grep -L "consecutiveMistakeCount = 0" src/core/tools/*.ts
```

### 修复 3：添加防御性日志

在 `presentAssistantMessage.ts` 的工具执行成功路径添加日志：

```typescript
switch (block.name) {
    case "read_file":
        await readFileTool.handle(cline, block as ToolUse<"read_file">, {
            askApproval,
            handleError,
            pushToolResult,
        })
        // ✅ 添加：工具执行成功后重置计数器（作为防御性编程）
        if (!block.partial && !cline.didRejectTool) {
            clime.consecutiveMistakeCount = 0
        }
        break
    // ...
}
```

## 其他可能的问题

### 问题 A：`didToolFailInCurrentTurn` 标志

在 `ReadFileTool.ts` line 257-259：

```typescript
const hasErrors = fileResults.some((r) => r.status === "error" || r.status === "blocked")
if (hasErrors) {
    task.didToolFailInCurrentTurn = true  // ⚠️ 部分失败也被视为失败
}
```

**问题：** 如果读取多个文件，其中一个失败，整个工具调用被视为失败。

### 问题 B：错误处理路径

在 `ReadFileTool.ts` line 265-283：

```typescript
} catch (error) {
    const relPath = filePath || "unknown"
    const errorMsg = error instanceof Error ? error.message : String(error)

    const toolError = new FileNotFoundToolError("read_file", relPath)
    toolError.message = `Error reading file: ${errorMsg}`
    task.recordToolError("read_file", toolError.toLogEntry())

    // ❌ 错误：这里应该增加 consecutiveMistakeCount
    // 但没有增加，只是推送了错误结果

    updateFileResult(relPath, {
        status: "error",
        error: formatResponse.toolErrorFromInstance(toolError.toLLMMessage()),
        nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
    })

    task.didToolFailInCurrentTurn = true

    const errorResult = fileResults
        .filter((r) => r.nativeContent)
        .map((r) => r.nativeContent)
        .join("\n\n---\n\n")

    pushToolResult(errorResult || formatResponse.toolErrorFromInstance(toolError.toLLMMessage()))
}
```

**问题：** 异常捕获路径没有增加 `consecutiveMistakeCount`，但设置了 `didToolFailInCurrentTurn = true`。

## 总结

**最可能的根本原因：** `ReadFileTool` 执行成功后没有重置 `consecutiveMistakeCount`，导致计数器持续累积，最终触发连续失败暂停机制。

**修复优先级：**
1. **P0**: 修复 `ReadFileTool.buildAndPushResult` 添加 `task.consecutiveMistakeCount = 0`
2. **P1**: 检查其他工具是否有同样问题
3. **P2**: 在 `presentAssistantMessage` 中添加防御性重置逻辑
4. **P3**: 改进错误处理路径的计数器逻辑
