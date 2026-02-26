# Streaming Module Integration Guide

本指南说明如何将流式处理模块集成到 `Task.ts` 中。

## 概述

流式处理模块已经完成实现，现在需要将其集成到 `Task.ts` 中以替换现有的流式处理代码。集成过程应该保持向后兼容性，并确保所有现有功能正常工作。

## 集成步骤

### 步骤 1: 导入模块

在 `Task.ts` 文件顶部添加导入：

```typescript
import {
	StreamingProcessor,
	type StreamingProcessorConfig,
	type StreamingResult,
	type StreamingRetryError
} from "./streaming"
```

### 步骤 2: 创建配置方法

在 `Task` 类中添加一个私有方法来创建流式处理配置：

```typescript
private createStreamingProcessorConfig(): StreamingProcessorConfig {
	return {
		taskId: this.taskId,
		api: this.api,
		diffViewProvider: this.diffViewProvider,
		onSay: this.say.bind(this),
		onUpdateMessage: this.updateClineMessage.bind(this),
		onSaveMessages: this.saveClineMessages.bind(this),
		onAddToHistory: this.addToApiConversationHistory.bind(this),
		onPresentAssistant: presentAssistantMessage.bind(this),
	}
}
```

### 步骤 3: 修改流式处理循环

在 `recursivelyMakeClineRequests` 方法中，替换现有的流式处理代码：

#### 原有代码（约第 2715-3632 行）：

```typescript
// 重置流式状态
this.currentStreamingContentIndex = 0
this.currentStreamingDidCheckpoint = false
this.assistantMessageContent = []
// ... 更多状态重置

// 缓存模型信息
this.cachedStreamingModel = this.api.getModel()

// 初始化令牌计数器
const tokenCounter = new StreamingTokenCounter()
let hasApiUsageData = false

// 初始化死循环检测器
const deadLoopDetector = new DeadLoopDetector()

// 主循环
try {
	const iterator = stream[Symbol.asyncIterator]()
	const nextChunkWithAbort = async () => {
		// ... 中断逻辑
	}

	let item = await nextChunkWithAbort()

	while (!item.done) {
		const chunk = item.value
		item = await nextChunkWithAbort()

		if (!chunk) {
			continue
		}

		switch (chunk.type) {
			case "reasoning":
				// 处理推理消息
				break
			case "usage":
				// 处理令牌使用
				break
			// ... 其他情况
		}

		// 检查中断条件
		if (this.abort) {
			await abortStream("user_cancelled")
			break
		}
		// ... 其他检查
	}
} catch (error) {
	// 错误处理
} finally {
	this.isStreaming = false
	this.currentRequestAbortController = undefined
}
```

#### 新代码：

```typescript
// 创建流式处理器配置
const streamingConfig = this.createStreamingProcessorConfig()

// 创建流式处理器
const processor = new StreamingProcessor(streamingConfig)

try {
	// 处理流
	const result = await processor.processStream(
		stream,
		this.currentRequestAbortController,
		this.apiConversationHistory
	)

	// 使用结果
	const {
		assistantMessage,
		reasoningMessage,
		assistantMessageContent,
		userMessageContent,
		groundingSources,
		tokens,
		didUseTool,
		didRejectTool,
		aborted,
		abortReason
	} = result

	// 更新 Task 状态
	this.assistantMessage = assistantMessage
	this.reasoningMessage = reasoningMessage
	this.assistantMessageContent = assistantMessageContent
	this.userMessageContent = userMessageContent
	this.pendingGroundingSources = groundingSources
	this.inputTokens = tokens.input
	this.outputTokens = tokens.output
	this.cacheWriteTokens = tokens.cacheWrite
	this.cacheReadTokens = tokens.cacheRead
	this.totalCost = tokens.totalCost
	this.didRejectTool = didRejectTool

	// 完成推理消息
	await this.completeReasoningMessage()

	// 保存助手消息到历史
	if (!aborted) {
		await this.saveAssistantMessageToHistory(assistantMessageContent, reasoningMessage)
	}

} catch (error) {
	if (error instanceof StreamingRetryError) {
		// 重试逻辑
		const retryAttempt = (currentItem.retryAttempt ?? 0) + 1
		stack.push({
			userContent: currentUserContent,
			includeFileDetails: false,
			retryAttempt,
		})
		continue
	} else {
		// 其他错误处理
		throw error
	}
}
```

### 步骤 4: 移除旧的状态变量

删除或注释掉以下不再需要的状态变量：

```typescript
// 这些变量现在由 StreamingStateManager 管理
// private isStreaming: boolean = false
// private currentStreamingContentIndex: number = 0
// private currentStreamingDidCheckpoint: boolean = false
// private didCompleteReadingStream: boolean = false
// private assistantMessageContent: AssistantMessageContent[] = []
// private userMessageContent: Anthropic.Messages.ContentBlockParam[] = []
// private userMessageContentReady: boolean = false
// private streamingToolCallIndices: Map<string, number> = new Map()
// private didRejectTool: boolean = false
// private didAlreadyUseTool: boolean = false
// private didToolFailInCurrentTurn: boolean = false
// private assistantMessageSavedToHistory: boolean = false
// private cachedStreamingModel?: { id: string; info: ModelInfo }
```

### 步骤 5: 更新辅助方法

更新依赖于流式状态的方法：

```typescript
// presentAssistantMessage 函数现在需要从处理器获取状态
const presentAssistantMessage = (task: Task) => {
	// 从 task 获取最新的状态
	const assistantMessageContent = task.assistantMessageContent
	const reasoningMessage = task.reasoningMessage
	// ... 其他逻辑
}
```

### 步骤 6: 处理完成逻辑

将完成逻辑提取到单独的方法中：

```typescript
private async completeReasoningMessage(): Promise<void> {
	if (this.reasoningMessage) {
		const lastReasoningIndex = findLastIndex(
			this.clineMessages,
			(m) => m.type === "say" && m.say === "reasoning"
		)

		if (lastReasoningIndex !== -1) {
			const msg = this.clineMessages[lastReasoningIndex]
			if (msg && msg.partial) {
				msg.partial = false
				await this.updateClineMessage(msg)
			}
		}
	}
}

private async saveAssistantMessageToHistory(
	assistantMessageContent: AssistantMessageContent[],
	reasoningMessage?: string
): Promise<void> {
	// 检查是否有内容需要处理
	const hasTextContent = this.assistantMessage.length > 0
	const hasToolUses = assistantMessageContent.some(
		(block) => block.type === "tool_use" || block.type === "mcp_tool_use"
	)

	if (hasTextContent || hasToolUses) {
		// 重置计数器
		this.consecutiveNoAssistantMessagesCount = 0

		// 展示引用来源
		if (this.pendingGroundingSources.length > 0) {
			// ... 展示逻辑
		}

		// 构建助手消息内容
		const assistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = []

		// 添加文本内容
		if (this.assistantMessage) {
			assistantContent.push({
				type: "text" as const,
				text: this.assistantMessage,
			})
		}

		// 添加工具调用块
		// ... 工具调用处理逻辑

		// 处理 new_task 隔离
		// ... new_task 处理逻辑

		// 保存助手消息到 API 历史
		await this.addToApiConversationHistory(
			{ role: "assistant", content: assistantContent },
			reasoningMessage || undefined
		)
		this.assistantMessageSavedToHistory = true
	}
}
```

### 步骤 7: 更新错误处理

更新错误处理逻辑以使用新的错误处理器：

```typescript
catch (error) {
	if (!this.abandoned) {
		const cancelReason: ClineApiReqCancelReason = this.abort ? "user_cancelled" : "streaming_failed"

		const rawErrorMessage = (error instanceof Error ? error.message : undefined) ?? JSON.stringify(serializeError(error), null, 2)
		const streamingFailedMessage = this.abort
			? undefined
			: `${t("common:interruption.streamTerminatedByProvider")}: ${rawErrorMessage}`

		await abortStream(cancelReason, streamingFailedMessage)

		if (this.abort) {
			this.abortReason = cancelReason
			await this.abortTask()
		} else {
			// 流式失败，重试
			console.error(`[Task#${this.taskId}] Stream failed, will retry: ${streamingFailedMessage}`)

			// 应用指数退避
			const stateForBackoff = await this.providerRef.deref()?.getState()
			if (stateForBackoff?.autoApprovalEnabled) {
				await this.backoffAndAnnounce(currentItem.retryAttempt ?? 0, error)

				if (this.abort) {
					this.abortReason = "user_cancelled"
					await this.abortTask()
					break
				}
			}

			// 将相同内容推回栈以重试
			stack.push({
				userContent: currentUserContent,
				includeFileDetails: false,
				retryAttempt: (currentItem.retryAttempt ?? 0) + 1,
			})

			continue
		}
	}
}
```

## 测试清单

集成完成后，需要测试以下功能：

- [ ] 基本流式处理（文本响应）
- [ ] 推理消息处理
- [ ] 工具调用（单个和多个）
- [ ] 流式工具调用（增量更新）
- [ ] 令牌计数和成本计算
- [ ] 用户取消
- [ ] 流式中断和重试
- [ ] 死循环检测
- [ ] 引用来源处理
- [ ] new_task 隔离
- [ ] 并行工具执行
- [ ] 历史消息保存

## 回退计划

如果集成过程中遇到问题，可以：

1. **保留旧代码**: 将旧的流式处理代码注释掉而不是删除
2. **逐步迁移**: 先迁移简单的功能，再迁移复杂的功能
3. **特性开关**: 使用环境变量或配置来切换新旧实现
4. **并行运行**: 同时运行新旧实现，比较结果

## 性能对比

集成完成后，对比新旧实现的性能：

| 指标 | 旧实现 | 新实现 | 改进 |
|-----|-------|-------|------|
| 首个数据块时间 | - | - | - |
| 完整流时间 | - | - | - |
| 内存使用 | - | - | - |
| CPU 使用 | - | - | - |

## 注意事项

1. **状态同步**: 确保 Task 的状态与 StreamingProcessor 的状态保持同步
2. **回调函数**: 确保所有回调函数正确绑定到 Task 实例
3. **错误处理**: 确保错误处理逻辑完整，包括重试和退避
4. **清理逻辑**: 确保 finally 块中的清理逻辑正确执行
5. **测试覆盖**: 确保所有现有测试仍然通过

## 下一步

集成完成后，可以考虑：

1. **移除旧代码**: 在验证新实现稳定后，删除旧的流式处理代码
2. **优化性能**: 根据性能测试结果进行优化
3. **增强功能**: 添加新的功能或改进现有功能
4. **文档更新**: 更新相关文档以反映新的架构

## 相关文档

- [README.md](./README.md) - 流式处理模块文档
- [streaming_extraction_plan.md](../../../streaming_extraction_plan.md) - 详细拆分方案
- [streaming_processing_analysis.md](../../../streaming_processing_analysis.md) - 流式处理分析

## 作者

CodeArts Agent

## 版本

1.0
