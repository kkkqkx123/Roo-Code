/**
 * Say Options
 *
 * 定义 say 函数的可选参数配置
 */

import type { ToolProgressStatus, ContextCondense, ContextTruncation } from "@coder/types"

/**
 * say 函数的可选参数
 */
export interface SayOptions {
	/**
	 * 消息文本内容
	 */
	text?: string

	/**
	 * 图片数据（base64 编码）
	 */
	images?: string[]

	/**
	 * 是否为部分消息（用于流式传输）
	 */
	partial?: boolean

	/**
	 * 是否为非交互式消息（不更新 lastMessageTs）
	 */
	isNonInteractive?: boolean

	/**
	 * 检查点信息
	 */
	checkpoint?: Record<string, unknown>

	/**
	 * 工具进度状态
	 */
	progressStatus?: ToolProgressStatus

	/**
	 * 上下文压缩信息
	 */
	contextCondense?: ContextCondense

	/**
	 * 上下文截断信息
	 */
	contextTruncation?: ContextTruncation
}