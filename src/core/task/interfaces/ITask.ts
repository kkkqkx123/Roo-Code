import { EventEmitter } from "events"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	type TaskEvents,
	type TokenUsage,
	type ToolUsage,
	type ToolName,
	type ClineMessage,
	type ClineAsk,
	type ClineSay,
	type ClineAskResponse,
	type TodoItem,
	type CheckpointRestoreOptions,
	type CheckpointDiffOptions,
	type CheckpointResult,
	type DiffResult,
	type QueuedMessage,
} from "@coder/types"

import { MessageManager } from "../../message-manager"

/**
 * Task 接口定义
 * 定义了 Task 类的公共方法和属性，用于依赖注入和类型安全
 */
export interface ITask extends EventEmitter<TaskEvents> {
	// 核心标识符
	readonly taskId: string
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	childTaskId?: string
	readonly instanceId: string
	readonly cwd: string
	readonly workspacePath: string

	// 核心状态
	get taskStatus(): string
	get taskAsk(): ClineMessage | undefined
	get abort(): boolean
	get isPaused(): boolean
	get isInitialized(): boolean
	get abandoned(): boolean
	get abortReason(): string | undefined

	// 消息历史
	apiConversationHistory: ApiMessage[]
	clineMessages: ClineMessage[]

	// 工具使用统计
	toolUsage: ToolUsage
	consecutiveMistakeCount: number
	consecutiveMistakeLimit: number

	// 消息队列
	get messageQueueService(): any
	get queuedMessages(): QueuedMessage[]

	// 消息管理器
	get messageManager(): MessageManager

	// 生命周期方法
	start(): void
	abortTask(isAbandoned?: boolean): Promise<void>
	dispose(): void
	pause(): void
	resume(): void

	// 交互方法
	ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		isProtected?: boolean,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>
	say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
	): Promise<undefined>
	handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]): void
	submitUserMessage(text: string, images?: string[], mode?: string, providerProfile?: string): Promise<void>
	approveAsk(options?: { text?: string; images?: string[] }): void
	denyAsk(options?: { text?: string; images?: string[] }): void
	cancelAutoApprovalTimeout(): void

	// 工具方法
	recordToolUsage(toolName: ToolName): void
	recordToolError(toolName: ToolName, error?: string): void
	pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam): boolean

	// 消息管理方法
	combineMessages(messages: ClineMessage[]): ClineMessage[]
	flushPendingToolResultsToHistory(): Promise<boolean>

	// 检查点方法
	checkpointSave(force?: boolean, suppressMessage?: boolean): Promise<CheckpointResult>
	checkpointRestore(options: CheckpointRestoreOptions): Promise<void>
	checkpointDiff(options: CheckpointDiffOptions): Promise<DiffResult>

	// 子任务方法
	startSubtask(message: string, initialTodos: TodoItem[], mode: string): Promise<ITask>
	resumeAfterDelegation(): Promise<void>

	// 上下文管理方法
	condenseContext(): Promise<void>

	// 统计方法
	getTokenUsage(): TokenUsage
	emitFinalTokenUsageUpdate(): void

	// 模式和 API 配置
	getTaskMode(): Promise<string>
	get taskMode(): string
	waitForModeInitialization(): Promise<void>
	getTaskApiConfigName(): Promise<string | undefined>
	get taskApiConfigName(): string | undefined
	waitForApiConfigInitialization(): Promise<void>
	updateApiConfiguration(newConfig: any): void
}

// 导出 ApiMessage 类型以供接口使用
export type ApiMessage = any