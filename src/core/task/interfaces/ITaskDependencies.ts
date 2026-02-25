/**
 * Task 依赖接口定义
 * 
 * 这个文件定义了 Task 类所需的所有依赖接口，通过依赖注入的方式，
 * 使 Task 类更容易测试和维护。
 */

import type { ApiHandler } from "../../../api"
import type { ProviderSettings } from "@coder/types"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { MessageQueueService } from "../../message-queue/MessageQueueService"
import type { FileContextTracker } from "../../context/tracking/FileContextTracker"
import type { RooIgnoreController } from "../../ignore/RooIgnoreController"
import type { RooProtectedController } from "../../protect/RooProtectedController"
import type { DiffViewProvider } from "../../../integrations/editor/DiffViewProvider"
import type { RepoPerTaskCheckpointService } from "../../../services/checkpoints"
import type { ToolRepetitionDetector } from "../../tools/ToolRepetitionDetector"
import type { AutoApprovalHandler } from "../../auto-approval"
import type { StreamProcessor } from "../streaming/StreamProcessor"
import type { StreamPostProcessor } from "../streaming/StreamPostProcessor"
import type { MessageManager } from "../../message-manager"

/**
 * API 相关依赖
 */
export interface IApiDependencies {
	/** API 处理器 */
	apiHandler: ApiHandler
	/** API 配置 */
	apiConfiguration: ProviderSettings
}

/**
 * 消息管理依赖
 */
export interface IMessageDependencies {
	/** 消息管理器 */
	messageManager: MessageManager
	/** 消息队列服务 */
	messageQueueService: MessageQueueService
}

/**
 * 流处理依赖
 */
export interface IStreamDependencies {
	/** StreamProcessor 工厂 */
	streamProcessorFactory: IStreamProcessorFactory
	/** StreamPostProcessor 工厂 */
	streamPostProcessorFactory: IStreamPostProcessorFactory
}

/**
 * 工具管理依赖
 */
export interface IToolDependencies {
	/** 工具重复检测器 */
	toolRepetitionDetector: ToolRepetitionDetector
	/** 自动批准处理器 */
	autoApprovalHandler: AutoApprovalHandler
}

/**
 * 文件和上下文依赖
 */
export interface IFileContextDependencies {
	/** 文件上下文跟踪器 */
	fileContextTracker: FileContextTracker
	/** Roo 忽略控制器 */
	rooIgnoreController: RooIgnoreController
	/** Roo 保护控制器 */
	rooProtectedController: RooProtectedController
}

/**
 * Diff 视图依赖
 */
export interface IDiffViewDependencies {
	/** Diff 视图提供者 */
	diffViewProvider: DiffViewProvider
}

/**
 * Checkpoint 依赖
 */
export interface ICheckpointDependencies {
	/** Checkpoint 服务 */
	checkpointService: RepoPerTaskCheckpointService | undefined
	/** 是否启用 checkpoint */
	enableCheckpoints: boolean
	/** Checkpoint 超时时间（秒） */
	checkpointTimeout: number
}

/**
 * Provider 依赖
 */
export interface IProviderDependencies {
	/** Provider 弱引用 */
	provider: WeakRef<ClineProvider>
	/** 全局存储路径 */
	globalStoragePath: string
}

/**
 * StreamProcessor 工厂接口
 */
export interface IStreamProcessorFactory {
	create(
		callbacks: any,
		options: any,
		features: any
	): StreamProcessor
}

/**
 * StreamPostProcessor 工厂接口
 */
export interface IStreamPostProcessorFactory {
	create(
		callbacks: any,
		options: any
	): StreamPostProcessor
}

/**
 * Task 所有依赖的聚合接口
 * 
 * 使用这个接口可以一次性注入所有依赖，避免构造函数参数过多。
 */
export interface ITaskDependencies
	extends IApiDependencies,
		IMessageDependencies,
		IStreamDependencies,
		IToolDependencies,
		IFileContextDependencies,
		IDiffViewDependencies,
		ICheckpointDependencies,
		IProviderDependencies {
	/** 工作区路径 */
	workspacePath: string
	/** 任务 ID */
	taskId: string
	/** 实例 ID */
	instanceId: string
}

/**
 * Task 依赖构建器
 * 
 * 提供链式 API 来构建 Task 依赖对象，使依赖注入更加清晰和类型安全。
 */
export class TaskDependenciesBuilder {
	private dependencies: Partial<ITaskDependencies> = {}

	withApiDependencies(deps: IApiDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withMessageDependencies(deps: IMessageDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withStreamDependencies(deps: IStreamDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withToolDependencies(deps: IToolDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withFileContextDependencies(deps: IFileContextDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withDiffViewDependencies(deps: IDiffViewDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withCheckpointDependencies(deps: ICheckpointDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withProviderDependencies(deps: IProviderDependencies): this {
		Object.assign(this.dependencies, deps)
		return this
	}

	withWorkspacePath(path: string): this {
		this.dependencies.workspacePath = path
		return this
	}

	withTaskId(taskId: string): this {
		this.dependencies.taskId = taskId
		return this
	}

	withInstanceId(instanceId: string): this {
		this.dependencies.instanceId = instanceId
		return this
	}

	build(): ITaskDependencies {
		// 验证必需的依赖
		const required: (keyof ITaskDependencies)[] = [
			"apiHandler",
			"apiConfiguration",
			"messageManager",
			"messageQueueService",
			"streamProcessorFactory",
			"streamPostProcessorFactory",
			"toolRepetitionDetector",
			"autoApprovalHandler",
			"fileContextTracker",
			"rooIgnoreController",
			"rooProtectedController",
			"diffViewProvider",
			"provider",
			"globalStoragePath",
			"workspacePath",
			"taskId",
			"instanceId",
		]

		for (const key of required) {
			if (!(key in this.dependencies)) {
				throw new Error(`Missing required dependency: ${key}`)
			}
		}

		return this.dependencies as ITaskDependencies
	}
}

/**
 * 创建默认的 Task 依赖
 * 
 * 这是一个便利函数，用于从 TaskOptions 创建默认的依赖对象。
 * 在生产环境中使用，测试环境中应该使用 mock 依赖。
 */
export function createDefaultTaskDependencies(
	options: any,
	provider: ClineProvider
): ITaskDependencies {
	// 这里应该实现实际的依赖创建逻辑
	// 为了示例，返回一个空对象
	return {} as ITaskDependencies
}