import { z } from "zod"

import { CoderEventName } from "./events.js"
import type { CoderSettings } from "./global-settings.js"
import type { ClineMessage, QueuedMessage, TokenUsage } from "./message.js"
import type { ToolUsage, ToolName } from "./tool.js"
import type { GitProperties, StaticAppProperties } from "./git.js"
import type { TodoItem } from "./todo.js"

/**
 * TaskProviderLike
 */

export interface TaskProviderLike {
	// Tasks
	getCurrentTask(): TaskLike | undefined
	getRecentTasks(): string[]
	createTask(
		text?: string,
		images?: string[],
		parentTask?: TaskLike,
		options?: CreateTaskOptions,
		configuration?: CoderSettings,
	): Promise<TaskLike>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	resumeTask(taskId: string): void

	// Modes
	getModes(): Promise<{ slug: string; name: string }[]>
	getMode(): Promise<string>
	setMode(mode: string): Promise<void>

	// Provider Profiles
	getProviderProfiles(): Promise<{ name: string; provider?: string }[]>
	getProviderProfile(): Promise<string>
	setProviderProfile(providerProfile: string): Promise<void>

	// Other properties
	readonly appProperties: StaticAppProperties
	readonly gitProperties: GitProperties | undefined
	readonly cwd: string

	// Event Emitter
	on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	// @TODO: Find a better way to do this.
	postStateToWebview(): Promise<void>
}

export type TaskProviderEvents = {
	[CoderEventName.TaskCreated]: [task: TaskLike]
	[CoderEventName.TaskStarted]: [taskId: string]
	[CoderEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[CoderEventName.TaskAborted]: [taskId: string]
	[CoderEventName.TaskFocused]: [taskId: string]
	[CoderEventName.TaskUnfocused]: [taskId: string]
	[CoderEventName.TaskActive]: [taskId: string]
	[CoderEventName.TaskInteractive]: [taskId: string]
	[CoderEventName.TaskResumable]: [taskId: string]
	[CoderEventName.TaskIdle]: [taskId: string]

	[CoderEventName.TaskPaused]: [taskId: string]
	[CoderEventName.TaskUnpaused]: [taskId: string]
	[CoderEventName.TaskSpawned]: [taskId: string]
	[CoderEventName.TaskDelegated]: [parentTaskId: string, childTaskId: string]
	[CoderEventName.TaskDelegationCompleted]: [parentTaskId: string, childTaskId: string, summary: string]
	[CoderEventName.TaskDelegationResumed]: [parentTaskId: string, childTaskId: string]

	[CoderEventName.TaskUserMessage]: [taskId: string]

	[CoderEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]

	[CoderEventName.ModeChanged]: [mode: string]
	[CoderEventName.ProviderProfileChanged]: [config: { name: string; provider?: string }]
}

/**
 * TaskLike
 */

export interface CreateTaskOptions {
	enableCheckpoints?: boolean
	consecutiveMistakeLimit?: number
	experiments?: Record<string, boolean>
	initialTodos?: TodoItem[]
	/** Initial status for the task's history item (e.g., "active" for child tasks) */
	initialStatus?: "active" | "delegated" | "completed"
	/** Whether to start the task loop immediately (default: true).
	 *  When false, the caller must invoke `task.start()` manually. */
	startTask?: boolean
}

export enum TaskStatus {
	Running = "running",
	Interactive = "interactive",
	Resumable = "resumable",
	Idle = "idle",
	None = "none",
}

export const taskMetadataSchema = z.object({
	task: z.string().optional(),
	images: z.array(z.string()).optional(),
})

export type TaskMetadata = z.infer<typeof taskMetadataSchema>

export interface TaskLike {
	readonly taskId: string
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	readonly childTaskId?: string
	readonly metadata: TaskMetadata
	readonly taskStatus: TaskStatus
	readonly taskAsk: ClineMessage | undefined
	readonly queuedMessages: QueuedMessage[]
	readonly tokenUsage: TokenUsage | undefined

	on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this
	off<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this

	approveAsk(options?: { text?: string; images?: string[] }): void
	denyAsk(options?: { text?: string; images?: string[] }): void
	submitUserMessage(text: string, images?: string[], mode?: string, providerProfile?: string): Promise<void>
	abortTask(): void
}

export type TaskEvents = {
	// Task Lifecycle
	[CoderEventName.TaskStarted]: []
	[CoderEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[CoderEventName.TaskAborted]: []
	[CoderEventName.TaskFocused]: []
	[CoderEventName.TaskUnfocused]: []
	[CoderEventName.TaskActive]: [taskId: string]
	[CoderEventName.TaskInteractive]: [taskId: string]
	[CoderEventName.TaskResumable]: [taskId: string]
	[CoderEventName.TaskIdle]: [taskId: string]

	// Subtask Lifecycle
	[CoderEventName.TaskPaused]: [taskId: string]
	[CoderEventName.TaskUnpaused]: [taskId: string]
	[CoderEventName.TaskSpawned]: [taskId: string]

	// Task Execution
	[CoderEventName.Message]: [{ action: "created" | "updated"; message: ClineMessage }]
	[CoderEventName.TaskModeSwitched]: [taskId: string, mode: string]
	[CoderEventName.TaskAskResponded]: []
	[CoderEventName.TaskUserMessage]: [taskId: string]
	[CoderEventName.QueuedMessagesUpdated]: [taskId: string, messages: QueuedMessage[]]

	// Task Analytics
	[CoderEventName.TaskToolFailed]: [taskId: string, tool: ToolName, error: string]
	[CoderEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
}
