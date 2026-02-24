import debounce from "lodash.debounce"

import { type TokenUsage, type ToolUsage, CoderEventName } from "@coder/types"

import { getApiMetrics, hasTokenUsageChanged, hasToolUsageChanged } from "../../../shared/getApiMetrics"

/**
 * TaskMetricsService
 * 管理任务的统计指标，包括 token 使用和工具使用统计
 */
export class TaskMetricsService {
	private readonly TOKEN_USAGE_EMIT_INTERVAL_MS = 2000 // 2 seconds
	private debouncedEmitTokenUsage!: ReturnType<typeof debounce>

	// 缓存
	private tokenUsageSnapshot?: TokenUsage
	private tokenUsageSnapshotAt?: number
	private toolUsageSnapshot?: ToolUsage

	constructor(
		private task: any,
		private messageService: any,
	) {
		this.initializeDebouncedEmit()
	}

	/**
	 * 初始化防抖的 token 使用量发送函数
	 */
	private initializeDebouncedEmit(): void {
		this.debouncedEmitTokenUsage = debounce(
			(tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
				const tokenChanged = hasTokenUsageChanged(tokenUsage, this.tokenUsageSnapshot)
				const toolChanged = hasToolUsageChanged(toolUsage, this.toolUsageSnapshot)

				if (tokenChanged || toolChanged) {
					this.task.emit(CoderEventName.TaskTokenUsageUpdated, this.task.taskId, tokenUsage, toolUsage)
					this.tokenUsageSnapshot = tokenUsage
					this.tokenUsageSnapshotAt = this.messageService.clineMessages.at(-1)?.ts
					// Deep copy tool usage for snapshot
					this.toolUsageSnapshot = JSON.parse(JSON.stringify(toolUsage))
				}
			},
			this.TOKEN_USAGE_EMIT_INTERVAL_MS,
			{ leading: true, trailing: true, maxWait: this.TOKEN_USAGE_EMIT_INTERVAL_MS },
		)
	}

	/**
	 * 获取 token 使用量
	 */
	getTokenUsage(): TokenUsage {
		return getApiMetrics(this.task.combineMessages(this.messageService.clineMessages.slice(1)))
	}

	/**
	 * 发送最终的 token 使用量更新
	 */
	emitFinalTokenUsageUpdate(): void {
		const tokenUsage = this.getTokenUsage()
		this.debouncedEmitTokenUsage(tokenUsage, this.task.toolUsage)
		this.debouncedEmitTokenUsage.flush()
	}

	/**
	 * 获取工具使用量
	 */
	getToolUsage(): ToolUsage {
		return { ...this.task.toolUsage }
	}

	/**
	 * 获取 token 使用快照
	 */
	getTokenUsageSnapshot(): TokenUsage | undefined {
		return this.tokenUsageSnapshot
	}

	/**
	 * 获取工具使用快照
	 */
	getToolUsageSnapshot(): ToolUsage | undefined {
		return this.toolUsageSnapshot
	}

	/**
	 * 获取 token 使用快照时间戳
	 */
	getTokenUsageSnapshotAt(): number | undefined {
		return this.tokenUsageSnapshotAt
	}

	/**
	 * 手动触发 token 使用量更新
	 */
	emitTokenUsageUpdate(): void {
		const tokenUsage = this.getTokenUsage()
		this.debouncedEmitTokenUsage(tokenUsage, this.task.toolUsage)
	}

	/**
	 * 重置所有快照
	 */
	resetSnapshots(): void {
		this.tokenUsageSnapshot = undefined
		this.tokenUsageSnapshotAt = undefined
		this.toolUsageSnapshot = undefined
	}
}