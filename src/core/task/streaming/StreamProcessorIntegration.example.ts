/**
 * StreamProcessor 集成示例
 *
 * 展示如何在 Task 类中集成 StreamProcessor
 * 这是一个示例文件，展示如何实现回调接口
 */

import { StreamProcessor } from "./StreamProcessor"
import type {
	StreamProcessorCallbacks,
	StreamProcessorConfig,
} from "./StreamProcessorCallbacks"
import type { ClineApiReqInfo, ClineApiReqCancelReason } from "@coder/types"
import type { ApiStream } from "../../../api/transform/stream"

/**
 * Task 类中的 StreamProcessor 集成示例
 */
export class TaskWithStreamProcessor {
	// Task 状态
	private clineMessages: any[] = []
	private assistantMessageContent: any[] = []
	private streamingToolCallIndices = new Map<string, number>()
	private userMessageContentReady = false
	private isStreaming = false
	private abort = false
	private abandoned = false
	private abortReason = ""
	private didFinishAbortingStream = false
	private currentRequestAbortController?: AbortController
	private didRejectTool = false
	private didAlreadyUseTool = false
	private taskId = "task-123"
	private apiConfiguration: any = {}
	private currentModelInfo: any = {}
	private diffViewProvider: any = {
		isEditing: false,
		revertChanges: async () => { },
		reset: async () => { },
	}

	// StreamProcessor 实例
	private streamProcessor?: StreamProcessor

	/**
	 * 实现 StreamProcessorCallbacks 接口
	 */
	private createStreamProcessorCallbacks(): StreamProcessorCallbacks {
		return {
			// 消息管理
			updateApiReqMessage: async (apiReqIndex: number, info: ClineApiReqInfo) => {
				if (apiReqIndex >= 0 && this.clineMessages[apiReqIndex]) {
					this.clineMessages[apiReqIndex].text = JSON.stringify(info)
				}
			},

			saveClineMessages: async () => {
				// 实现保存逻辑
				console.log("[Task] Saving cline messages")
			},

			updateClineMessage: async (message: any) => {
				// 实现更新逻辑
				console.log("[Task] Updating cline message")
			},

			say: async (type: string, options?: any) => {
				// 实现发送消息逻辑
				console.log(`[Task] Saying ${type}:`, options?.text?.substring(0, 50))
			},

			// 流控制
			abortStream: async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				console.log(`[Task] Aborting stream: ${cancelReason}`, streamingFailedMessage)
				// 实现中止逻辑
			},

			abortTask: async () => {
				console.log("[Task] Aborting task")
				// 实现任务中止逻辑
			},

			// Diff 视图
			resetDiffView: async () => {
				await this.diffViewProvider.reset()
			},

			revertDiffViewChanges: async () => {
				await this.diffViewProvider.revertChanges()
			},

			isDiffViewEditing: () => {
				return this.diffViewProvider.isEditing
			},

			// 消息访问
			getLastClineMessage: () => {
				return this.clineMessages.at(-1)
			},

			getClineMessage: (index: number) => {
				return this.clineMessages[index]
			},

			// 配置访问
			getApiConfiguration: () => {
				return this.apiConfiguration
			},

			getModelInfo: () => {
				// 返回当前请求的模型信息
				return this.currentModelInfo
			},

			getAbortController: () => {
				return this.currentRequestAbortController
			},

			// 状态检查
			isAborted: () => {
				return this.abort
			},

			isAbandoned: () => {
				return this.abandoned
			},

			didRejectTool: () => {
				return this.didRejectTool
			},

			didAlreadyUseTool: () => {
				return this.didAlreadyUseTool
			},

			// 状态设置
			setAbort: (abort: boolean) => {
				this.abort = abort
			},

			setAbortReason: (reason: string) => {
				this.abortReason = reason
			},

			setDidFinishAbortingStream: (value: boolean) => {
				this.didFinishAbortingStream = value
			},

			// 助手消息内容
			getAssistantMessageContent: () => {
				return this.assistantMessageContent
			},

			setAssistantMessageContent: (content: any[]) => {
				this.assistantMessageContent = content
			},

			// 流式工具调用索引
			getStreamingToolCallIndices: () => {
				return this.streamingToolCallIndices
			},

			setStreamingToolCallIndices: (indices: Map<string, number>) => {
				this.streamingToolCallIndices = indices
			},

			// 流式内容索引
			getCurrentStreamingContentIndex: () => {
				return 0 // 实现中返回真实值
			},

			setCurrentStreamingContentIndex: (index: number) => {
				// 实现设置逻辑
			},

			// 用户消息内容就绪
			getUserMessageContentReady: () => {
				return this.userMessageContentReady
			},

			setUserMessageContentReady: (ready: boolean) => {
				this.userMessageContentReady = ready
			},

			// 流中标志
			getIsStreaming: () => {
				return this.isStreaming
			},

			setIsStreaming: (streaming: boolean) => {
				this.isStreaming = streaming
			},

			// 任务 ID
			getTaskId: () => {
				return this.taskId
			},

			// 通知呈现助手消息
			notifyPresentAssistantMessage: () => {
				// 调用 presentAssistantMessage 函数
				// presentAssistantMessage(this)
				console.log("[Task] Notifying to present assistant message")
			},

			// 检查是否有工具使用
			hasToolUses: () => {
				return this.assistantMessageContent.some((block) => block.type === "tool_use")
			},

			// 获取API请求信息
			getApiReqInfo: () => {
				const lastApiReqIndex = this.clineMessages.filter((m) => (m as any).type === "api_req").length - 1
				if (lastApiReqIndex >= 0) {
					const apiReqMessage = this.clineMessages[lastApiReqIndex]
					if (apiReqMessage && (apiReqMessage as any).text) {
						try {
							return JSON.parse((apiReqMessage as any).text) as ClineApiReqInfo
						} catch {
							return undefined
						}
					}
				}
				return undefined
			},
		}
	}

	/**
	 * 启动 API 请求并使用 StreamProcessor 处理流式响应
	 */
	async startApiRequest(stream: ApiStream, modelInfo: any, apiReqIndex: number): Promise<void> {
		// 重置流式处理状态
		this.resetStreamingState()

		// 保存当前模型信息供回调使用
		this.currentModelInfo = modelInfo

		// 创建 StreamProcessor
		const callbacks = this.createStreamProcessorCallbacks()
		const config: StreamProcessorConfig = {
			apiReqIndex,
			modelInfo,
			skipProviderRateLimit: true,
			usageCollectionTimeoutMs: 5000,
		}

		const options = {
			enableDeadLoopDetection: true,
			enableBackgroundUsageCollection: true,
			enableTokenCounterFallback: true,
		}

		this.streamProcessor = new StreamProcessor(callbacks, config, options)

		// 处理流式响应
		await this.streamProcessor.processStream(stream)

		// 获取最终状态
		const finalState = this.streamProcessor.getState()
		console.log("[Task] Stream processing complete:", finalState)
	}

	/**
	 * 重置流式处理状态
	 */
	private resetStreamingState(): void {
		this.assistantMessageContent = []
		this.streamingToolCallIndices.clear()
		this.userMessageContentReady = false
		this.isStreaming = true
		this.didRejectTool = false
		this.didAlreadyUseTool = false

		// 清理 NativeToolCallParser 状态
		const { NativeToolCallParser } = require("../assistant-message/NativeToolCallParser")
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	}

	/**
	 * 取消当前请求
	 */
	async cancelRequest(): Promise<void> {
		if (this.currentRequestAbortController) {
			this.currentRequestAbortController.abort()
		}
		this.abort = true
	}

	/**
	 * 清理资源
	 */
	dispose(): void {
		if (this.streamProcessor) {
			this.streamProcessor.reset()
		}
	}
}

/**
 * 使用示例
 */
export async function exampleUsage() {
	const task = new TaskWithStreamProcessor()

	// 模拟 API 流
	async function* mockStream(): ApiStream {
		yield { type: "text", text: "Hello" }
		yield { type: "text", text: " world" }
		yield { type: "usage", inputTokens: 10, outputTokens: 5 }
	}

	try {
		await task.startApiRequest(mockStream(), { id: "claude-3-5-sonnet", info: {} }, 0)
		console.log("Stream processing completed successfully")
	} catch (error) {
		console.error("Stream processing failed:", error)
	} finally {
		task.dispose()
	}
}

/**
 * 迁移指南：从 Task.ts 中的内联代码迁移到 StreamProcessor
 *
 * 1. 识别需要提取的代码块：
 *    - updateApiReqMsg 函数
 *    - abortStream 函数
 *    - 流式处理主循环（while (!item.done)）
 *    - drainStreamInBackgroundToFindAllUsage 函数
 *
 * 2. 实现 StreamProcessorCallbacks 接口：
 *    - 将 Task 类中的方法映射到回调接口
 *    - 确保所有状态访问都通过 getter/setter
 *
 * 3. 创建 StreamProcessor 实例：
 *    - 在 startApiRequest 方法中创建实例
 *    - 传入配置和选项
 *
 * 4. 替换流式处理逻辑：
 *    - 删除内联的流式处理代码
 *    - 调用 streamProcessor.processStream(stream)
 *
 * 5. 测试：
 *    - 确保所有功能正常工作
 *    - 验证错误处理
 *    - 检查性能影响
 *
 * 注意事项：
 * - 保持向后兼容性
 * - 逐步迁移，避免大规模重构
 * - 充分测试后再删除旧代码
 * - 考虑添加日志以便调试
 */