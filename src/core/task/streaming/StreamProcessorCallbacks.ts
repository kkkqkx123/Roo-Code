/**
 * StreamProcessor 事件回调接口
 *
 * 定义 StreamProcessor 与外部（Task）交互的事件回调接口
 * 通过回调机制实现解耦，避免直接依赖 Task 类
 */

import type { ClineApiReqCancelReason, ClineApiReqInfo, ModelInfo } from "@coder/types"
import type { SharedCallbacks } from "./SharedCallbacks"

/**
 * 流式处理配置
 */
export interface StreamProcessorConfig {
	/** API 请求消息索引 */
	apiReqIndex: number
	/** 模型信息 */
	modelInfo: ModelInfo
	/** 是否跳过提供商速率限制 */
	skipProviderRateLimit?: boolean
	/** 使用数据收集超时时间（毫秒） */
	usageCollectionTimeoutMs?: number
}

/**
 * 流式处理状态
 */
export interface StreamProcessorState {
	/** 输入 token 数 */
	inputTokens: number
	/** 输出 token 数 */
	outputTokens: number
	/** 缓存写入 token 数 */
	cacheWriteTokens: number
	/** 缓存读取 token 数 */
	cacheReadTokens: number
	/** 总成本 */
	totalCost?: number
	/** 是否有 API 使用数据 */
	hasApiUsageData: boolean
}

/**
 * 流式处理事件回调接口
 *
 * 继承SharedCallbacks以避免重复定义
 */
export interface StreamProcessorCallbacks extends SharedCallbacks {
	/**
	 * 更新 API 请求消息
	 * @param apiReqIndex API 请求消息索引
	 * @param info API 请求信息
	 */
	updateApiReqMessage: (apiReqIndex: number, info: ClineApiReqInfo) => Promise<void>

	/**
	 * 中止流
	 * @param cancelReason 取消原因
	 * @param streamingFailedMessage 流失败消息
	 */
	abortStream: (
		cancelReason: ClineApiReqCancelReason,
		streamingFailedMessage?: string,
	) => Promise<void>

	/**
	 * 中止任务
	 */
	abortTask: () => Promise<void>

	/**
	 * 设置流完成中止标志
	 */
	setDidFinishAbortingStream: (value: boolean) => void

	/**
	 * 获取最后一个 Cline 消息
	 */
	getLastClineMessage: () => any

	/**
	 * 获取助手消息内容（同步版本）
	 */
	getAssistantMessageContent: () => any[]
}

/**
 * 流式处理事件类型
 */
export type StreamProcessorEventType =
	| "reasoning"
	| "text"
	| "tool_call_start"
	| "tool_call_delta"
	| "tool_call_end"
	| "tool_call"
	| "usage"
	| "grounding"
	| "error"
	| "abort"
	| "complete"

/**
 * 流式处理事件
 */
export interface StreamProcessorEvent {
	type: StreamProcessorEventType
	data?: any
	error?: Error
}

/**
 * 流式处理选项
 */
export interface StreamProcessorOptions {
	/** 是否启用死循环检测 */
	enableDeadLoopDetection?: boolean
	/** 是否启用后台使用数据收集 */
	enableBackgroundUsageCollection?: boolean
	/** 是否启用 token 计数器回退 */
	enableTokenCounterFallback?: boolean
}