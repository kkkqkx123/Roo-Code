/**
 * Task 接口导出
 * 
 * 这个文件导出了所有 Task 相关的接口定义，方便统一导入。
 */

// 依赖接口
export type {
	ITaskDependencies,
	IApiDependencies,
	IMessageDependencies,
	IStreamDependencies,
	IToolDependencies,
	IFileContextDependencies,
	IDiffViewDependencies,
	ICheckpointDependencies,
	IProviderDependencies,
	IStreamProcessorFactory,
	IStreamPostProcessorFactory,
	TaskDependenciesBuilder,
} from "./ITaskDependencies"

// 消息处理接口
export type {
	ITaskMessageHandler,
	AskResult,
	MessageHandlerEvents,
} from "./ITaskMessageHandler"

// 流处理接口
export type {
	ITaskStreamHandler,
	ApiRequestOptions,
	StreamProcessingResult,
	StreamHandlerEvents,
} from "./ITaskStreamHandler"

// 状态管理接口
export type {
	ITaskStateManager,
	TaskState,
	StateUpdateOptions,
	StateManagerEvents,
} from "./ITaskStateManager"

// 指标收集接口
export type {
	ITaskMetrics,
	MetricsSnapshot,
	MetricsEvents,
} from "./ITaskMetrics"