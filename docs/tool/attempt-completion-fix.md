# attempt_completion 工具修复文档

## 问题概述

在 LLM 调用 `attempt_completion` 工具后，任务无法正常结束，导致无法接收新的用户指令。

### 问题根因

当 `attempt_completion` 工具执行并发出 `TaskCompleted` 事件后，任务状态被设置为 `'completed'`，但主循环 `Task.ts:2724` 的条件是 `while (!this.abort)`，只检查 `abort` 标志而不检查 `taskState`。这导致：

1. **任务状态是 `'completed'`，但 `abort` 标志仍然是 `false`**
2. **主循环继续执行**，即使任务已经"完成"
3. **当用户确认完成时**，`attempt_completion` 工具直接返回，不向 `userMessageContent` 添加任何内容
4. **主循环检查 `this.userMessageContent.length > 0`**，发现为 0，不将新内容推入 stack
5. **循环退出到 `initiateTaskLoop`**，检查 `while (!this.abort)`，发现 `abort = false`，继续执行下一次循环
6. **发起无意义的 API 请求**，没有新的用户输入
7. **无法接收新的用户指令**，因为主循环仍在运行

### 修复方案

在 `AttemptCompletionTool.ts:151` 中，当用户确认完成（`response === "yesButtonClicked"`）时，设置 `task.abort = true`：

```typescript
if (response === "yesButtonClicked") {
    // CRITICAL FIX: Set abort flag to stop the main task loop when user confirms completion
    // Without this, the loop continues running (while (!this.abort)) even though taskState is 'completed',
    // preventing the task from properly ending and blocking new user input.
    task.abort = true
    return
}
```

## 修复后的流程验证

### 场景1: 主任务完成

**流程：**

1. LLM 调用 `attempt_completion` 工具
2. 工具显示完成结果，发出 `TaskCompleted` 事件
3. 工具调用 `task.ask("completion_result", "", false)` 等待用户确认
4. 用户点击"是"按钮
5. **修复**: 工具设置 `task.abort = true` 并返回
6. `presentAssistantMessage` 设置 `userMessageContentReady = true`
7. 主循环检查 `this.userMessageContent.length > 0`，发现为 0
8. 不将新内容推入 stack，循环退出
9. 返回到 `initiateTaskLoop`，检查 `while (!this.abort)`，发现 `abort = true`
10. **主循环退出，任务正常结束**

**预期结果：** 任务正常结束，可以接收新的用户指令。

---

### 场景2: 主任务完成但用户提供反馈

**流程：**

1. LLM 调用 `attempt_completion` 工具
2. 工具显示完成结果，发出 `TaskCompleted` 事件
3. 工具调用 `task.ask("completion_result", "", false)` 等待用户确认
4. 用户提供反馈文本
5. 工具调用 `task.say("user_feedback", text, images)` 并 `pushToolResult`
6. 工具返回
7. `presentAssistantMessage` 设置 `userMessageContentReady = true`
8. 主循环检查 `this.userMessageContent.length > 0`，发现不为 0
9. 将新内容推入 stack，循环继续
10. **主循环继续执行，使用用户反馈进行下一次 API 请求**

**预期结果：** 任务继续执行，LLM 可以根据用户反馈调整任务。

---

### 场景3: 子任务完成并委托给父任务

**流程：**

1. 子任务调用 `attempt_completion` 工具
2. 工具检查 `task.parentTaskId`，发现不为空
3. 工具调用 `delegateToParent` 方法
4. `delegateToParent` 调用 `askFinishSubTaskApproval()` 等待用户确认
5. 用户确认子任务完成
6. `delegateToParent` 调用 `provider.reopenParentFromDelegation()` 将控制权返回给父任务
7. `delegateToParent` 返回 `true`
8. `attempt_completion` 工具提前返回，**不会设置 `abort` 标志**
9. **子任务正常完成，控制权返回给父任务**

**预期结果：** 子任务正常完成，父任务继续执行。

---

### 场景4: 子任务完成但用户拒绝委托

**流程：**

1. 子任务调用 `attempt_completion` 工具
2. 工具检查 `task.parentTaskId`，发现不为空
3. 工具调用 `delegateToParent` 方法
4. `delegateToParent` 调用 `askFinishSubTaskApproval()` 等待用户确认
5. 用户拒绝委托
6. `delegateToParent` 调用 `pushToolResult(formatResponse.toolDenied())` 并返回 `true`
7. `attempt_completion` 工具提前返回，**不会设置 `abort` 标志**
8. **子任务继续执行，不会中止**

**预期结果：** 子任务继续执行，不会中止。

---

## 相关文件

- `src/core/tools/AttemptCompletionTool.ts` - attempt_completion 工具实现
- `src/core/assistant-message/presentAssistantMessage.ts` - 消息处理逻辑
- `src/core/task/Task.ts` - 任务主循环

## 测试覆盖

测试文件：`src/core/tools/__tests__/AttemptCompletionTool.test.ts`

测试用例覆盖以下场景：

1. 主任务完成，用户确认
2. 主任务完成，用户提供反馈
3. 子任务完成，用户确认委托
4. 子任务完成，用户拒绝委托
