# attempt_completion 工具流式输出优化方案

## 概述

本文档描述优化 `attempt_completion` 工具流式显示体验的实施方案。核心目标是**允许长输出内容在流式传输期间就开始显示**，而不是等待整个工具调用完成后才统一处理。

## 背景

### 当前问题

**问题描述：** 当 `attempt_completion` 工具的 `result` 参数内容较长时，用户需要等待整个 JSON 参数传输完成后才能看到任何输出，导致长时间无任何信息显示。

**根本原因：**

1. **统一延迟执行机制**：`presentAssistantMessage.ts` 中的 defer 逻辑将所有完整的工具调用延迟到流式传输结束后才执行：

```typescript
// presentAssistantMessage.ts 第 313-320 行
if (cline.isStreaming === true && cline.didCompleteReadingStream !== true && !block.partial) {
    if (cline.presentAssistantMessageHasPendingUpdates) {
        presentAssistantMessage(cline)
    }
    return  // ← 提前返回，不执行工具
}
```

2. **流式解析限制**：`handlePartial` 只在 `block.partial === true` 时调用，但此时 `block.params.result` 可能只包含部分 JSON 内容。

3. **执行时机**：只有当 `tool_call_end` 事件触发后，`block.partial` 变为 `false`，才会执行完整的 `execute()` 方法，调用 `task.say("completion_result", result)`。

### 影响范围

- **用户体验**：长文本输出（如详细总结、代码片段、多步骤结果）场景下，用户需要等待更长时间才能看到结果
- **感知性能**：即使后台已经在处理，用户界面无任何反馈，造成"卡住"的错觉
- **流式优势未发挥**：流式传输的优势是渐进式显示，但当前设计未能利用这一优势

## 解决方案

### 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **方案 1：特殊处理** | 允许 `attempt_completion` 在流式期间提前执行 | 用户体验提升明显，技术风险低 | 需要特殊逻辑，增加代码复杂度 |
| **方案 2：改进解析** | 优化 partial-json 对 result 字段的提取 | 通用解决方案 | 受限于 JSON chunk 边界，改进有限 |
| **方案 3：混合方案** | 结合方案 1 和方案 2 | 最佳效果 | 实现复杂度最高 |

### 推荐方案：混合方案（方案 3）

**核心思路：**
1. **允许 `attempt_completion` 提前执行**：修改 defer 逻辑，为 `attempt_completion` 开特殊通道
2. **增强 `handlePartial` 显示**：改进流式片段的内容提取和显示逻辑
3. **优化状态管理**：确保流式内容和最终内容的平滑过渡

## 实施计划

### 阶段 1：修改 presentAssistantMessage.ts

**文件：** `src/core/assistant-message/presentAssistantMessage.ts`

**修改位置：** 第 313-320 行的 defer 逻辑

**修改内容：**

```typescript
// Defer execution of complete tool calls until the stream finishes.
// Running tools during active streaming can supersede pending asks and
// leave tool calls unprocessed when additional chunks arrive.
//
// EXCEPTION: attempt_completion is allowed to execute early because:
// 1. It's a read-only operation (no side effects on file system)
// 2. Early display significantly improves UX for long completion results
// 3. The completion result is what users are most interested in seeing
if (cline.isStreaming === true && cline.didCompleteReadingStream !== true && !block.partial) {
    // Special case: allow attempt_completion to start displaying early
    if (block.name === "attempt_completion") {
        // Continue to execute - handlePartial will show partial content
        // and execute() will update with final content when complete
    } else {
        if (cline.presentAssistantMessageHasPendingUpdates) {
            presentAssistantMessage(cline)
        }
        return
    }
}
```

**理由：**
- `attempt_completion` 是只读操作，提前执行不会产生副作用
- 完成结果是用户最关心的内容，优先显示符合用户体验优先原则
- 保持其他工具的 defer 逻辑不变，最小化影响范围

### 阶段 2：增强 AttemptCompletionTool.handlePartial()

**文件：** `src/core/tools/AttemptCompletionTool.ts`

**当前实现：**

```typescript
override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
    const result: string | undefined = block.params.result
    const command: string | undefined = block.params.command

    const lastMessage = task.clineMessages.at(-1)

    if (command) {
        // ...command handling...
    } else {
        await task.say("completion_result", result ?? "", undefined, block.partial)
    }
}
```

**问题分析：**
1. `block.params.result` 在流式早期可能是 `undefined` 或不完整字符串
2. 没有追踪上一次显示的内容，可能导致重复或跳变
3. 没有利用 `partial-json` 解析器的能力尽早提取内容

**改进实现：**

```typescript
// Add state tracking for streaming content
private lastStreamedResult: string | undefined = undefined

override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
    const result: string | undefined = block.params.result
    const command: string | undefined = block.params.command

    // Only handle partial display for non-command cases
    if (command) {
        const lastMessage = task.clineMessages.at(-1)
        if (lastMessage && lastMessage.ask === "command") {
            await task.ask("command", command ?? "", block.partial).catch(() => { })
        } else {
            await task.say("completion_result", result ?? "")
            task.emitFinalTokenUsageUpdate()
            task.emit(CoderEventName.TaskCompleted, task.taskId, 
                task.metricsService.getTokenUsage(task.clineMessages.slice(1)), 
                task.metricsService.getToolUsage())
            await task.ask("command", command ?? "", block.partial).catch(() => { })
        }
        return
    }

    // For result-only cases, show streaming content if we have something new
    if (result !== undefined && result !== this.lastStreamedResult) {
        await task.say("completion_result", result, undefined, block.partial)
        this.lastStreamedResult = result
    }
}

// Reset streaming state on execute completion
async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
    // ... existing validation logic ...
    
    try {
        if (!result) {
            // ... error handling ...
            return
        }

        // Reset streaming state before final display
        this.lastStreamedResult = undefined
        
        await task.say("completion_result", result)
        // ... rest of existing logic ...
    } catch (error) {
        // Reset state on error too
        this.lastStreamedResult = undefined
        await handleError("inspecting site", error as Error)
    }
}
```

**改进点：**
1. **状态追踪**：记录上一次显示的内容，避免重复渲染
2. **增量更新**：只有当内容真正变化时才更新显示
3. **状态清理**：在执行完成后重置状态，避免影响下一次调用

### 阶段 3：优化 NativeToolCallParser（可选增强）

**文件：** `src/core/assistant-message/NativeToolCallParser.ts`

**目标：** 针对 `attempt_completion` 的简单结构优化 partial-json 提取

**修改位置：** `createPartialToolUse` 方法中的 `attempt_completion` case

**当前实现：**

```typescript
case "attempt_completion":
    if (partialArgs.result) {
        nativeArgs = { result: partialArgs.result }
    }
    break
```

**潜在优化：** 确保 `partialArgs.result` 在 JSON 不完整时也能被提取

由于 `partial-json-parser` 库已经处理了这种情况，此阶段为可选优化。

### 阶段 4：测试

**新增测试文件：** `src/core/tools/__tests__/attemptCompletionTool.streaming.spec.ts`

**测试场景：**

1. **流式片段显示**：验证 `handlePartial` 能正确显示部分结果
2. **内容去重**：验证相同内容不会重复显示
3. **最终更新**：验证完整内容能正确替换流式内容
4. **状态清理**：验证执行完成后状态正确重置
5. **错误处理**：验证错误情况下状态正确清理

## 技术风险与缓解

### 风险 1：流式内容与最终内容不一致

**风险描述：** 流式显示的内容可能与最终内容不一致，导致显示跳变。

**缓解措施：**
- 使用 `partial` 参数标记流式内容，UI 层可以据此调整样式（如添加加载指示器）
- 状态追踪确保只有内容真正变化时才更新

### 风险 2：重复渲染

**风险描述：** 流式更新可能导致频繁渲染，影响性能。

**缓解措施：**
- 内容比较避免相同内容重复渲染
- React/Vue 等框架的虚拟 DOM 会自动优化相同内容的渲染

### 风险 3：其他工具的不一致行为

**风险描述：** 只对 `attempt_completion` 特殊处理可能导致工具行为不一致。

**缓解措施：**
- 在代码注释中明确说明特殊处理的理由
- 未来可以根据需要扩展到其他"只读"工具（如 `read_file`）

## 预期效果

### 用户体验改进

| 场景 | 改进前 | 改进后 |
|------|--------|--------|
| 短结果（<100 字） | 等待 ~500ms | 等待 ~100ms（首个 chunk 到达即显示） |
| 中等结果（500 字） | 等待 ~2s | 等待 ~100ms 后渐进显示 |
| 长结果（2000+ 字） | 等待 ~5s+ | 等待 ~100ms 后渐进显示 |

### 技术收益

1. **发挥流式优势**：真正实现了渐进式显示
2. **架构扩展性**：为其他工具的流式优化提供了范例
3. **用户感知性能**：显著减少"无反馈等待时间"

## 实施时间表

| 阶段 | 预计时间 | 依赖 |
|------|----------|------|
| 阶段 1：修改 presentAssistantMessage.ts | 1 小时 | 无 |
| 阶段 2：增强 AttemptCompletionTool | 2 小时 | 阶段 1 |
| 阶段 3：优化 NativeToolCallParser（可选） | 1 小时 | 阶段 2 |
| 阶段 4：测试 | 2 小时 | 阶段 2 |
| **总计** | **6 小时** | - |

## 参考

- Partial JSON Parser: https://github.com/partial-json/partial-json-parser
- 流式传输设计模式：https://developer.mozilla.org/en-US/docs/Web/API/Streams_API
