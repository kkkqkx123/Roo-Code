/**
 * Task 状态管理接口
 * 
 * 定义了 Task 类中状态管理相关的接口。
 */

import type { TaskStatus, ClineMessage, TodoItem } from "@coder/types"
import type { ClineApiReqCancelReason } from "@coder/types"
import type { TokenUsage, ToolUsage } from "@coder/types"

/**
 * Task 状态
 */
export interface TaskState {
	/** 任务 ID */
	taskId: string
	/** 根任务 ID */
	rootTaskId?: string
	/** 父任务 ID */
	parentTaskId?: string
	/** 子任务 ID */
	childTaskId?: string
	/** 待处理的新任务工具调用 ID */
	pendingNewTaskToolCallId?: string
	/** 实例 ID */
	instanceId: string
	/** 工作区路径 */
	workspacePath: string
	/** 任务编号 */
	taskNumber: number

	/** 任务模式 */
	taskMode?: string
	/** 任务 API 配置名称 */
	taskApiConfigName?: string

	/** 是否已中止 */
	abort: boolean
	/** 中止原因 */
	abortReason?: ClineApiReqCancelReason
	/** 是否已放弃 */
	abandoned: boolean
	/** 是否已完成中止流 */
	didFinishAbortingStream: boolean
	/** 是否已初始化 */
	isInitialized: boolean
	/** 是否已暂停 */
	isPaused: boolean

	/** 空闲 ask */
	idleAsk?: ClineMessage
	/** 可恢复 ask */
	resumableAsk?: ClineMessage
	/** 交互式 ask */
	interactiveAsk?: ClineMessage

	/** 是否正在等待第一个块 */
	isWaitingForFirstChunk: boolean
	/** 是否正在流式传输 */
	isStreaming: boolean
	/** 当前流式传输内容索引 */
	currentStreamingContentIndex: number
	/** 当前流式传输是否已完成 checkpoint */
	currentStreamingDidCheckpoint: boolean
	/** 助手消息是否已保存到历史 */
	assistantMessageSavedToHistory: boolean

	/** 是否拒绝工具 */
	didRejectTool: boolean
	/** 是否已使用工具 */
	didAlreadyUseTool: boolean
	/** 当前轮次工具是否失败 */
	didToolFailInCurrentTurn: boolean
	/** 是否完成读取流 */
	didCompleteReadingStream: boolean

	/** 连续错误计数 */
	consecutiveMistakeCount: number
	/** 连续错误限制 */
	consecutiveMistakeLimit: number
	/** 连续无工具使用计数 */
	consecutiveNoToolUseCount: number
	/** 连续无助手消息计数 */
	consecutiveNoAssistantMessagesCount: number

	/** 是否已编辑文件 */
	didEditFile: boolean

	/** 最后消息时间戳 */
	lastMessageTs?: number

	/** 是否已启动 */
	started: boolean
}

/**
 * 状态更新选项
 */
export interface StateUpdateOptions {
	/** 是否触发事件 */
	emitEvent?: boolean
	/** 事件数据 */
	eventData?: any
}

/**
 * Task 状态管理接口
 * 
 * 这个接口定义了 Task 类中状态管理相关的方法。
 * 通过这个接口，可以轻松地 mock 状态管理逻辑进行测试。
 */
export interface ITaskStateManager {
	/**
	 * 获取当前状态
	 * 
	 * @returns 当前状态的只读副本
	 */
	getState(): Readonly<TaskState>

	/**
	 * 更新状态
	 * 
	 * @param updates - 状态更新
	 * @param options - 更新选项
	 */
	updateState(updates: Partial<TaskState>, options?: StateUpdateOptions): void

	/**
	 * 重置状态
	 * 
	 * @param initialState - 初始状态（可选）
	 */
	resetState(initialState?: Partial<TaskState>): void

	/**
	 * 获取任务状态
	 * 
	 * @returns 任务状态
	 */
	getTaskStatus(): TaskStatus

	/**
	 * 获取待处理的 ask
	 * 
	 * @returns 待处理的 ask 消息
	 */
	getTaskAsk(): ClineMessage | undefined

	/**
	 * 检查是否已中止
	 * 
	 * @returns 是否已中止
	 */
	isAborted(): boolean

	/**
	 * 检查是否已放弃
	 * 
	 * @returns 是否已放弃
	 */
	isAbandoned(): boolean

	/**
	 * 检查是否已初始化
	 * 
	 * @returns 是否已初始化
	 */
	isInitialized(): boolean

	/**
	 * 检查是否正在流式传输
	 * 
	 * @returns 是否正在流式传输
	 */
	isStreaming(): boolean

	/**
	 * 检查是否正在等待第一个块
	 * 
	 * @returns 是否正在等待第一个块
	 */
	isWaitingForFirstChunk(): boolean

	/**
	 * 设置中止状态
	 * 
	 * @param abort - 是否中止
	 * @param reason - 中止原因
	 */
	setAbort(abort: boolean, reason?: ClineApiReqCancelReason): void

	/**
	 * 设置放弃状态
	 * 
	 * @param abandoned - 是否放弃
	 */
	setAbandoned(abandoned: boolean): void

	/**
	 * 设置初始化状态
	 * 
	 * @param initialized - 是否已初始化
	 */
	setInitialized(initialized: boolean): void

	/**
	 * 设置流式传输状态
	 * 
	 * @param streaming - 是否正在流式传输
	 */
	setStreaming(streaming: boolean): void

	/**
	 * 设置等待第一个块状态
	 * 
	 * @param waiting - 是否正在等待
	 */
	setWaitingForFirstChunk(waiting: boolean): void

	/**
	 * 增加连续错误计数
	 */
	incrementConsecutiveMistakeCount(): void

	/**
	 * 重置连续错误计数
	 */
	resetConsecutiveMistakeCount(): void

	/**
	 * 增加连续无工具使用计数
	 */
	incrementConsecutiveNoToolUseCount(): void

	/**
	 * 重置连续无工具使用计数
	 */
	resetConsecutiveNoToolUseCount(): void

	/**
	 * 增加连续无助手消息计数
	 */
	incrementConsecutiveNoAssistantMessagesCount(): void

	/**
	 * 重置连续无助手消息计数
	 */
	resetConsecutiveNoAssistantMessagesCount(): void

	/**
	 * 设置任务模式
	 * 
	 * @param mode - 任务模式
	 */
	setTaskMode(mode: string): void

	/**
	 * 获取任务模式
	 * 
	 * @returns 任务模式
	 */
	getTaskMode(): string | undefined

	/**
	 * 设置任务 API 配置名称
	 * 
	 * @param apiConfigName - API 配置名称
	 */
	setTaskApiConfigName(apiConfigName: string | undefined): void

	/**
	 * 获取任务 API 配置名称
	 * 
	 * @returns API 配置名称
	 */
	getTaskApiConfigName(): string | undefined

	/**
	 * 设置待处理的 ask
	 * 
	 * @param type - ask 类型
	 * @param message - ask 消息
	 */
	setPendingAsk(type: "idle" | "resumable" | "interactive", message?: ClineMessage): void

	/**
	 * 清除所有待处理的 ask
	 */
	clearPendingAsks(): void

	/**
	 * 设置最后消息时间戳
	 * 
	 * @param ts - 时间戳
	 */
	setLastMessageTs(ts?: number): void

	/**
	 * 获取最后消息时间戳
	 * 
	 * @returns 最后消息时间戳
	 */
	getLastMessageTs(): number | undefined

	/**
	 * 设置子任务 ID
	 * 
	 * @param childTaskId - 子任务 ID
	 */
	setChildTaskId(childTaskId?: string): void

	/**
	 * 获取子任务 ID
	 * 
	 * @returns 子任务 ID
	 */
	getChildTaskId(): string | undefined

	/**
	 * 设置待处理的新任务工具调用 ID
	 * 
	 * @param toolCallId - 工具调用 ID
	 */
	setPendingNewTaskToolCallId(toolCallId?: string): void

	/**
	 * 获取待处理的新任务工具调用 ID
	 * 
	 * @returns 工具调用 ID
	 */
	getPendingNewTaskToolCallId(): string | undefined
}

/**
 * 状态管理事件
 */
export interface StateManagerEvents {
	/** 状态已更新 */
	stateUpdated: (state: Readonly<TaskState>) => void
	/** 任务状态已变更 */
	taskStatusChanged: (status: TaskStatus) => void
	/** 中止状态已变更 */
	abortStateChanged: (abort: boolean, reason?: ClineApiReqCancelReason) => void
	/** 流式传输状态已变更 */
	streamingStateChanged: (streaming: boolean) => void
	/** 错误计数已更新 */
	errorCountUpdated: (count: number) => void
}