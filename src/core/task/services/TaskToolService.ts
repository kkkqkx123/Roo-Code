import { Anthropic } from "@anthropic-ai/sdk"

import { type ToolName, type ToolUsage } from "@coder/types"

/**
 * TaskToolService
 * 管理工具调用和工具使用统计
 */
export class TaskToolService {
	// 工具使用统计
	toolUsage: ToolUsage = {}
	consecutiveMistakeCount: number = 0
	consecutiveMistakeLimit: number
	consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map()
	consecutiveMistakeCountForEditFile: Map<string, number> = new Map()
	consecutiveNoToolUseCount: number = 0
	consecutiveNoAssistantMessagesCount: number = 0

	constructor(
		private task: any,
		private stateManager: any,
		private interactionService: any,
		private metricsService: any,
		consecutiveMistakeLimit: number,
	) {
		this.consecutiveMistakeLimit = consecutiveMistakeLimit
	}

	/**
	 * 记录工具使用
	 */
	recordToolUsage(toolName: ToolName): void {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}
		this.toolUsage[toolName].attempts++
	}

	/**
	 * 记录工具错误
	 */
	recordToolError(toolName: ToolName, error?: string): void {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}
		this.toolUsage[toolName].attempts++
		this.toolUsage[toolName].failures++

		// 更新连续错误计数
		this.consecutiveMistakeCount++

		// 记录特定文件的错误计数
		if (error && (toolName === "apply_diff" || toolName === "edit_file")) {
			const filePathMatch = error.match(/for\s+['"]([^'"]+)['"]/)
			if (filePathMatch) {
				const filePath = filePathMatch[1]
				const errorMap = toolName === "apply_diff" ? this.consecutiveMistakeCountForApplyDiff : this.consecutiveMistakeCountForEditFile
				const currentCount = errorMap.get(filePath) || 0
				errorMap.set(filePath, currentCount + 1)
			}
		}
	}

	/**
	 * 重置连续错误计数
	 */
	resetConsecutiveMistakeCount(): void {
		this.consecutiveMistakeCount = 0
	}

	/**
	 * 重置特定文件的错误计数
	 */
	resetFileErrorCount(filePath: string, toolName: "apply_diff" | "edit_file"): void {
		const errorMap = toolName === "apply_diff" ? this.consecutiveMistakeCountForApplyDiff : this.consecutiveMistakeCountForEditFile
		errorMap.delete(filePath)
	}

	/**
	 * 获取特定文件的错误计数
	 */
	getFileErrorCount(filePath: string, toolName: "apply_diff" | "edit_file"): number {
		const errorMap = toolName === "apply_diff" ? this.consecutiveMistakeCountForApplyDiff : this.consecutiveMistakeCountForEditFile
		return errorMap.get(filePath) || 0
	}

	/**
	 * 增加连续无工具使用计数
	 */
	incrementConsecutiveNoToolUseCount(): void {
		this.consecutiveNoToolUseCount++
	}

	/**
	 * 重置连续无工具使用计数
	 */
	resetConsecutiveNoToolUseCount(): void {
		this.consecutiveNoToolUseCount = 0
	}

	/**
	 * 增加连续无助手消息计数
	 */
	incrementConsecutiveNoAssistantMessagesCount(): void {
		this.consecutiveNoAssistantMessagesCount++
	}

	/**
	 * 重置连续无助手消息计数
	 */
	resetConsecutiveNoAssistantMessagesCount(): void {
		this.consecutiveNoAssistantMessagesCount = 0
	}

	/**
	 * 检查是否达到连续错误限制
	 */
	hasReachedConsecutiveMistakeLimit(): boolean {
		return this.consecutiveMistakeCount >= this.consecutiveMistakeLimit
	}

	/**
	 * 检查特定文件是否达到连续错误限制
	 */
	hasReachedFileErrorLimit(filePath: string, toolName: "apply_diff" | "edit_file"): boolean {
		const errorCount = this.getFileErrorCount(filePath, toolName)
		return errorCount >= this.consecutiveMistakeLimit
	}

	/**
	 * 推送工具结果到用户消息内容
	 * 防止重复的 tool_use_id
	 */
	pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam): boolean {
		const existingResult = this.task.userMessageContent.find(
			(block: { type: string; tool_use_id: string }): block is Anthropic.ToolResultBlockParam =>
				block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id,
		)
		if (existingResult) {
			console.warn(
				`[Task#pushToolResultToUserContent] Skipping duplicate tool_result for tool_use_id: ${toolResult.tool_use_id}`,
			)
			return false
		}
		this.task.userMessageContent.push(toolResult)
		return true
	}

	/**
	 * 清除用户消息内容
	 */
	clearUserMessageContent(): void {
		this.task.userMessageContent = []
	}

	/**
	 * 获取工具使用统计
	 */
	getToolUsage(): ToolUsage {
		return { ...this.toolUsage }
	}

	/**
	 * 重置所有工具使用统计
	 */
	resetToolUsage(): void {
		this.toolUsage = {}
		this.consecutiveMistakeCount = 0
		this.consecutiveMistakeCountForApplyDiff.clear()
		this.consecutiveMistakeCountForEditFile.clear()
		this.consecutiveNoToolUseCount = 0
		this.consecutiveNoAssistantMessagesCount = 0
	}
}