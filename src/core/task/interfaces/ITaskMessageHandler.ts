/**
 * Task 消息处理接口
 * 
 * 定义了 Task 类中与消息处理相关的方法接口，
 * 包括 ask、say 以及消息历史管理。
 */

import type { ClineAsk, ClineAskResponse, ClineMessage, ClineSay } from "@coder/types"
import type { SayOptions } from "../streaming/SayOptions"
import type { ApiMessage } from "../../task-persistence"

/**
 * 消息处理结果
 */
export interface AskResult {
	response: ClineAskResponse
	text?: string
	images?: string[]
}

/**
 * Task 消息处理接口
 * 
 * 这个接口定义了 Task 类中所有与消息处理相关的方法。
 * 通过这个接口，可以轻松地 mock 消息处理逻辑进行测试。
 */
export interface ITaskMessageHandler {
	/**
	 * 向用户提问并等待响应
	 * 
	 * @param type - 问题类型
	 * @param text - 问题文本
	 * @param partial - 是否为部分消息
	 * @param progressStatus - 进度状态
	 * @param isProtected - 是否受保护
	 * @returns 用户的响应
	 */
	ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: any,
		isProtected?: boolean
	): Promise<AskResult>

	/**
	 * 向用户发送消息
	 * 
	 * @param type - 消息类型
	 * @param options - 消息选项
	 */
	say(type: ClineSay, options?: SayOptions): Promise<void>

	/**
	 * 处理 webview 的 ask 响应
	 * 
	 * @param askResponse - 响应类型
	 * @param text - 响应文本
	 * @param images - 响应图片
	 */
	handleWebviewAskResponse(
		askResponse: ClineAskResponse,
		text?: string,
		images?: string[]
	): void

	/**
	 * 批准当前的 ask
	 * 
	 * @param options - 批准选项
	 */
	approveAsk(options?: { text?: string; images?: string[] }): void

	/**
	 * 拒绝当前的 ask
	 * 
	 * @param options - 拒绝选项
	 */
	denyAsk(options?: { text?: string; images?: string[] }): void

	/**
	 * 取消待处理的 ask
	 */
	supersedePendingAsk(): void

	/**
	 * 取消自动批准超时
	 */
	cancelAutoApprovalTimeout(): void

	/**
	 * 添加消息到 API 对话历史
	 * 
	 * @param message - API 消息
	 * @param reasoning - 推理内容
	 */
	addToApiConversationHistory(
		message: any,
		reasoning?: string
	): Promise<void>

	/**
	 * 覆盖 API 对话历史
	 * 
	 * @param newHistory - 新的历史记录
	 */
	overwriteApiConversationHistory(newHistory: ApiMessage[]): Promise<void>

	/**
	 * 保存 API 对话历史
	 */
	saveApiConversationHistory(): Promise<boolean>

	/**
	 * 重试保存 API 对话历史
	 */
	retrySaveApiConversationHistory(): Promise<boolean>

	/**
	 * 刷新待处理的工具结果到历史
	 */
	flushPendingToolResultsToHistory(): Promise<boolean>

	/**
	 * 添加消息到 Cline 消息列表
	 * 
	 * @param message - Cline 消息
	 */
	addToClineMessages(message: ClineMessage): Promise<void>

	/**
	 * 覆盖 Cline 消息列表
	 * 
	 * @param newMessages - 新的消息列表
	 */
	overwriteClineMessages(newMessages: ClineMessage[]): Promise<void>

	/**
	 * 更新 Cline 消息
	 * 
	 * @param message - 要更新的消息
	 */
	updateClineMessage(message: ClineMessage): Promise<void>

	/**
	 * 保存 Cline 消息
	 */
	saveClineMessages(): Promise<boolean>

	/**
	 * 根据时间戳查找消息
	 * 
	 * @param ts - 时间戳
	 * @returns 找到的消息或 undefined
	 */
	findMessageByTimestamp(ts: number): ClineMessage | undefined

	/**
	 * 提交用户消息
	 * 
	 * @param text - 消息文本
	 * @param images - 消息图片
	 * @param mode - 模式
	 * @param providerProfile - 提供者配置
	 */
	submitUserMessage(
		text: string,
		images?: string[],
		mode?: string,
		providerProfile?: string
	): Promise<void>
}

/**
 * 消息处理事件
 */
export interface MessageHandlerEvents {
	/** 消息已创建 */
	messageCreated: (message: ClineMessage) => void
	/** 消息已更新 */
	messageUpdated: (message: ClineMessage) => void
	/** 用户消息已提交 */
	userMessageSubmitted: (text: string, images?: string[]) => void
	/** Ask 已响应 */
	askResponded: (response: ClineAskResponse) => void
}