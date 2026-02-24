import type { CheckpointRestoreOptions, CheckpointDiffOptions } from "@coder/types"
import type { CheckpointResult } from "../../../services/checkpoints/types"

import {
	getCheckpointService,
	checkpointSave,
	checkpointRestore,
	checkpointDiff,
} from "../../checkpoints"

/**
 * TaskCheckpointService
 * 管理任务的检查点功能
 */
export class TaskCheckpointService {
	checkpointService?: any
	checkpointServiceInitializing = false

	constructor(private task: any) {}

	/**
	 * 保存检查点
	 */
	async checkpointSave(force: boolean = false, suppressMessage: boolean = false): Promise<CheckpointResult | undefined> {
		return (await checkpointSave(this.task, force, suppressMessage)) as CheckpointResult | undefined
	}

	/**
	 * 恢复检查点
	 */
	async checkpointRestore(options: CheckpointRestoreOptions): Promise<void> {
		return checkpointRestore(this.task, options)
	}

	/**
	 * 查看检查点差异
	 */
	async checkpointDiff(options: CheckpointDiffOptions): Promise<void> {
		return checkpointDiff(this.task, options)
	}

	/**
	 * 初始化检查点服务
	 */
	async initializeCheckpointService(): Promise<void> {
		if (this.checkpointServiceInitializing || this.checkpointService) {
			return
		}

		this.checkpointServiceInitializing = true

		try {
			this.checkpointService = await getCheckpointService(this.task)
		} catch (error) {
			console.error("[TaskCheckpointService] Failed to initialize checkpoint service:", error)
		} finally {
			this.checkpointServiceInitializing = false
		}
	}

	/**
	 * 获取检查点服务
	 */
	getCheckpointService(): any {
		return this.checkpointService
	}

	/**
	 * 检查检查点服务是否已初始化
	 */
	isCheckpointServiceInitialized(): boolean {
		return this.checkpointService !== undefined
	}

	/**
	 * 销毁检查点服务
	 */
	async disposeCheckpointService(): Promise<void> {
		if (this.checkpointService) {
			try {
				await this.checkpointService.dispose()
			} catch (error) {
				console.error("[TaskCheckpointService] Failed to dispose checkpoint service:", error)
			}
			this.checkpointService = undefined
		}
	}
}