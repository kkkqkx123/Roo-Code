/**
 * Task 流处理接口
 * 
 * 定义了 Task 类中与 API 请求流处理相关的方法接口。
 */

import type { ApiStream } from "../../../api/transform/stream"
import type { ClineApiReqCancelReason } from "@coder/types"
import type { StreamProcessorCallbacks } from "../streaming/StreamProcessorCallbacks"
import type { StreamPostProcessorCallbacks } from "../streaming/StreamPostProcessorCallbacks"

/**
 * API 请求选项
 */
export interface ApiRequestOptions {
	/** 是否跳过提供者速率限制 */
	skipProviderRateLimit?: boolean
}

/**
 * 流处理结果
 */
export interface StreamProcessingResult {
	/** 是否成功 */
	success: boolean
	/** 错误信息（如果有） */
	error?: string
	/** 取消原因（如果被取消） */
	cancelReason?: ClineApiReqCancelReason
}

/**
 * Task 流处理接口
 * 
 * 这个接口定义了 Task 类中所有与 API 请求流处理相关的方法。
 * 通过这个接口，可以轻松地 mock 流处理逻辑进行测试。
 */
export interface ITaskStreamHandler {
	/**
	 * 尝试发起 API 请求
	 * 
	 * @param retryAttempt - 重试次数
	 * @param options - 请求选项
	 * @returns API 流
	 */
	attemptApiRequest(
		retryAttempt?: number,
		options?: ApiRequestOptions
	): AsyncGenerator<ApiStream>

	/**
	 * 取消当前请求
	 */
	cancelCurrentRequest(): void

	/**
	 * 创建 StreamProcessor 回调
	 * 
	 * @returns StreamProcessor 回调对象
	 */
	createStreamProcessorCallbacks(): StreamProcessorCallbacks

	/**
	 * 创建 StreamPostProcessor 回调
	 * 
	 * @returns StreamPostProcessor 回调对象
	 */
	createStreamPostProcessorCallbacks(): StreamPostProcessorCallbacks

	/**
	 * 中止流
	 * 
	 * @param cancelReason - 取消原因
	 * @param streamingFailedMessage - 流失败消息
	 */
	abortStream(
		cancelReason: ClineApiReqCancelReason,
		streamingFailedMessage?: string
	): Promise<void>

	/**
	 * 等待提供者速率限制
	 * 
	 * @param retryAttempt - 重试次数
	 */
	maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void>

	/**
	 * 指数退避并通知
	 * 
	 * @param retryAttempt - 重试次数
	 * @param error - 错误对象
	 */
	backoffAndAnnounce(retryAttempt: number, error: any): Promise<void>

	/**
	 * 处理上下文窗口超出错误
	 */
	handleContextWindowExceededError(): Promise<void>

	/**
	 * 获取系统提示词
	 * 
	 * @returns 系统提示词
	 */
	getSystemPrompt(): Promise<string>

	/**
	 * 获取当前配置文件 ID
	 * 
	 * @param state - 状态对象
	 * @returns 配置文件 ID
	 */
	getCurrentProfileId(state: any): string
}

/**
 * 流处理事件
 */
export interface StreamHandlerEvents {
	/** 流已开始 */
	streamStarted: () => void
	/** 流已完成 */
	streamCompleted: (result: StreamProcessingResult) => void
	/** 流已中止 */
	streamAborted: (reason: ClineApiReqCancelReason) => void
	/** 流已失败 */
	streamFailed: (error: Error) => void
	/** 第一个块已接收 */
	firstChunkReceived: () => void
	/** 速率限制等待中 */
	rateLimitWaiting: (seconds: number) => void
	/** 重试中 */
	retrying: (attempt: number, delay: number) => void
}