import { defaultModeSlug } from "@coder/types"
import { ClineProvider } from "../../webview/ClineProvider"
import type { TaskOptions } from "../Task"

/**
 * TaskStateManager
 * 集中管理 Task 的所有状态，避免状态分散在各处
 */
export class TaskStateManager {
	// 模式和 API 配置
	private _taskMode: string | undefined
	private _taskApiConfigName: string | undefined
	private taskModeReady: Promise<void>
	private taskApiConfigReady: Promise<void>

	// 核心状态
	abort: boolean = false
	isPaused: boolean = false
	isInitialized: boolean = false
	abandoned: boolean = false
	abortReason?: string

	// Ask 状态
	idleAsk?: any
	resumableAsk?: any
	interactiveAsk?: any

	// 流式状态
	isStreaming: boolean = false
	isWaitingForFirstChunk: boolean = false
	assistantMessageSavedToHistory: boolean = false

	// 其他状态
	didFinishAbortingStream: boolean = false
	skipPrevResponseIdOnce: boolean = false
	didRejectTool: boolean = false
	didAlreadyUseTool: boolean = false
	didToolFailInCurrentTurn: boolean = false
	didCompleteReadingStream: boolean = false
	_started: boolean = false

	constructor(private task: any, private options: TaskOptions) {
		this.initializeModeAndApiConfig()
	}

	/**
	 * 初始化模式和 API 配置
	 */
	private initializeModeAndApiConfig(): void {
		const { historyItem, provider } = this.options

		if (historyItem) {
			this._taskMode = historyItem.mode || defaultModeSlug
			this._taskApiConfigName = historyItem.apiConfigName
			this.taskModeReady = Promise.resolve()
			this.taskApiConfigReady = Promise.resolve()
		} else {
			this._taskMode = undefined
			this._taskApiConfigName = undefined
			this.taskModeReady = this.initializeTaskMode(provider)
			this.taskApiConfigReady = this.initializeTaskApiConfigName(provider)
		}
	}

	/**
	 * 初始化任务模式
	 */
	private async initializeTaskMode(provider: ClineProvider): Promise<void> {
		try {
			const state = await provider.getState()
			this._taskMode = state?.mode || defaultModeSlug
		} catch (error) {
			this._taskMode = defaultModeSlug
			const errorMessage = `Failed to initialize task mode: ${error instanceof Error ? error.message : String(error)}`
			provider.log(errorMessage)
		}
	}

	/**
	 * 初始化任务 API 配置名称
	 */
	private async initializeTaskApiConfigName(provider: ClineProvider): Promise<void> {
		try {
			const state = await provider.getState()

			if (this._taskApiConfigName === undefined) {
				this._taskApiConfigName = state?.currentApiConfigName ?? "default"
			}
		} catch (error) {
			if (this._taskApiConfigName === undefined) {
				this._taskApiConfigName = "default"
			}
			const errorMessage = `Failed to initialize task API config name: ${error instanceof Error ? error.message : String(error)}`
			provider.log(errorMessage)
		}
	}

	// Getters
	get taskMode(): string {
		if (this._taskMode === undefined) {
			throw new Error("Task mode accessed before initialization. Use getTaskMode() or wait for taskModeReady.")
		}
		return this._taskMode
	}

	get taskApiConfigName(): string | undefined {
		return this._taskApiConfigName
	}

	get started(): boolean {
		return this._started
	}

	// Setters
	set started(value: boolean) {
		this._started = value
	}

	setTaskMode(mode: string): void {
		this._taskMode = mode
	}

	setTaskApiConfigName(apiConfigName: string | undefined): void {
		this._taskApiConfigName = apiConfigName
	}

	// Async methods
	async waitForModeInitialization(): Promise<void> {
		return this.taskModeReady
	}

	async getTaskMode(): Promise<string> {
		await this.taskModeReady
		return this._taskMode || defaultModeSlug
	}

	async waitForApiConfigInitialization(): Promise<void> {
		return this.taskApiConfigReady
	}

	async getTaskApiConfigName(): Promise<string | undefined> {
		await this.taskApiConfigReady
		return this._taskApiConfigName
	}

	// 状态更新方法
	setAbort(value: boolean): void {
		this.abort = value
	}

	setPaused(value: boolean): void {
		this.isPaused = value
	}

	setInitialized(value: boolean): void {
		this.isInitialized = value
	}

	setAbandoned(value: boolean): void {
		this.abandoned = value
	}

	setAbortReason(reason?: string): void {
		this.abortReason = reason
	}

	setStreaming(value: boolean): void {
		this.isStreaming = value
	}

	setWaitingForFirstChunk(value: boolean): void {
		this.isWaitingForFirstChunk = value
	}

	setAssistantMessageSavedToHistory(value: boolean): void {
		this.assistantMessageSavedToHistory = value
	}

	setDidFinishAbortingStream(value: boolean): void {
		this.didFinishAbortingStream = value
	}

	setSkipPrevResponseIdOnce(value: boolean): void {
		this.skipPrevResponseIdOnce = value
	}

	setDidRejectTool(value: boolean): void {
		this.didRejectTool = value
	}

	setDidAlreadyUseTool(value: boolean): void {
		this.didAlreadyUseTool = value
	}

	setDidToolFailInCurrentTurn(value: boolean): void {
		this.didToolFailInCurrentTurn = value
	}

	setDidCompleteReadingStream(value: boolean): void {
		this.didCompleteReadingStream = value
	}

	// Ask 状态管理
	setIdleAsk(ask?: any): void {
		this.idleAsk = ask
	}

	setResumableAsk(ask?: any): void {
		this.resumableAsk = ask
	}

	setInteractiveAsk(ask?: any): void {
		this.interactiveAsk = ask
	}

	clearAllAsks(): void {
		this.idleAsk = undefined
		this.resumableAsk = undefined
		this.interactiveAsk = undefined
	}
}