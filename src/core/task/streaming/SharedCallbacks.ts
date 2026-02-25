/**
 * Shared Callbacks
 *
 * 定义StreamProcessor和StreamPostProcessor共享的回调接口
 * 避免重复定义，提高代码复用性
 */

import type { ClineMessage, ClineApiReqInfo, ModelInfo, ProviderSettings } from "@coder/types"
import type { SayOptions } from "./SayOptions"

/**
 * 消息操作回调
 */
export interface MessageCallbacks {
	/**
	 * 保存 Cline 消息
	 */
	saveClineMessages: () => Promise<void>

	/**
	 * 更新 Cline 消息到 webview
	 */
	updateClineMessage: (message: ClineMessage) => Promise<void>

	/**
	 * 获取 Cline 消息
	 */
	getClineMessage: (index: number) => ClineMessage | undefined

	/**
	 * 发送消息到 webview
	 */
	say: (type: string, options?: SayOptions) => Promise<void>
}

/**
 * 状态访问回调
 */
export interface StateAccessCallbacks {
	/**
	 * 获取 API 配置
	 */
	getApiConfiguration: () => ProviderSettings

	/**
	 * 获取模型信息
	 */
	getModelInfo: () => ModelInfo

	/**
	 * 获取任务 ID
	 */
	getTaskId: () => string

	/**
	 * 获取 API 请求信息
	 */
	getApiReqInfo: () => ClineApiReqInfo | undefined
}

/**
 * 中止控制回调
 */
export interface AbortControlCallbacks {
	/**
	 * 获取中止控制器
	 */
	getAbortController: () => AbortController | undefined

	/**
	 * 检查是否中止
	 */
	isAborted: () => boolean

	/**
	 * 检查是否被放弃
	 */
	isAbandoned: () => boolean

	/**
	 * 设置中止标志
	 */
	setAbort: (abort: boolean) => void

	/**
	 * 设置中止原因
	 */
	setAbortReason: (reason: string) => void
}

/**
 * 内容操作回调
 */
export interface ContentCallbacks {
	/**
	 * 设置助手消息内容
	 */
	setAssistantMessageContent: (content: any[]) => void

	/**
	 * 获取用户消息内容就绪标志
	 */
	getUserMessageContentReady: () => boolean

	/**
	 * 设置用户消息内容就绪标志
	 */
	setUserMessageContentReady: (ready: boolean) => void

	/**
	 * 获取流中标志
	 */
	getIsStreaming: () => boolean

	/**
	 * 设置流中标志
	 */
	setIsStreaming: (streaming: boolean) => void
}

/**
 * 工具调用回调
 */
export interface ToolCallCallbacks {
	/**
	 * 检查是否有工具使用
	 */
	hasToolUses: () => boolean

	/**
	 * 获取流式工具调用索引
	 */
	getStreamingToolCallIndices: () => Map<string, number>

	/**
	 * 设置流式工具调用索引
	 */
	setStreamingToolCallIndices: (indices: Map<string, number>) => void

	/**
	 * 获取当前流式内容索引
	 */
	getCurrentStreamingContentIndex: () => number

	/**
	 * 设置当前流式内容索引
	 */
	setCurrentStreamingContentIndex: (index: number) => void
}

/**
 * Diff视图回调
 */
export interface DiffViewCallbacks {
	/**
	 * 重置 diff 视图
	 */
	resetDiffView: () => Promise<void>

	/**
	 * 回滚 diff 视图更改
	 */
	revertDiffViewChanges: () => Promise<void>

	/**
	 * 检查 diff 视图是否正在编辑
	 */
	isDiffViewEditing: () => boolean
}

/**
 * 用户反馈回调
 */
export interface UserFeedbackCallbacks {
	/**
	 * 检查是否拒绝工具
	 */
	didRejectTool: () => boolean

	/**
	 * 检查是否已使用工具
	 */
	didAlreadyUseTool: () => boolean
}

/**
 * 通知回调
 */
export interface NotificationCallbacks {
	/**
	 * 通知需要呈现助手消息
	 */
	notifyPresentAssistantMessage: () => void
}

/**
 * 完整的共享回调接口
 *
 * 注意：这个接口定义了StreamProcessor和StreamPostProcessor真正共享的回调
 * 各自特有的方法（如getAssistantMessageContent的不同签名）在各自的接口中定义
 */
export interface SharedCallbacks
	extends MessageCallbacks,
		StateAccessCallbacks,
		AbortControlCallbacks,
		ContentCallbacks,
		ToolCallCallbacks,
		DiffViewCallbacks,
		UserFeedbackCallbacks,
		NotificationCallbacks {}