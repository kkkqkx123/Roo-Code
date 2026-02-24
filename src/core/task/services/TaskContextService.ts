import { type ContextCondense, type ContextTruncation } from "@coder/types"

import { summarizeConversation } from "../../condense"
import { getEnvironmentDetails } from "../../environment/getEnvironmentDetails"
import { buildNativeToolsArrayWithRestrictions } from "../build-tools"

/**
 * TaskContextService
 * 管理任务的上下文，包括总结和截断
 */
export class TaskContextService {
	constructor(
		private task: any,
		private stateManager: any,
		private apiService: any,
		private messageService: any,
		private interactionService: any,
	) {}

	/**
	 * 安全地获取 Roo 读取的文件列表
	 */
	private async getFilesReadByRooSafely(context: string): Promise<string[] | undefined> {
		try {
			return await this.task.fileContextTracker?.getFilesReadByRoo?.()
		} catch (error) {
			console.error(`[Task#${context}] Failed to get files read by Roo:`, error)
			return undefined
		}
	}

	/**
	 * 总结上下文
	 */
	async condenseContext(): Promise<void> {
		// 关键：在总结之前刷新待处理的工具结果
		await this.messageService.flushPendingToolResultsToHistory()

		const systemPrompt = await this.task.getSystemPrompt?.()

		// 获取总结配置
		const provider = this.task.providerRef?.deref?.()
		const state = provider ? await provider.getState() : undefined
		const customCondensingPrompt = state?.customSupportPrompts?.CONDENSE
		const { mode, apiConfiguration } = state ?? {}

		const { contextTokens: prevContextTokens } = this.task.getTokenUsage?.()

		// 构建工具用于总结元数据
		let allTools: any[] = []
		if (provider) {
			const modelInfo = this.task.api?.getModel?.().info
			const toolsResult = await buildNativeToolsArrayWithRestrictions({
				provider,
				cwd: this.task.cwd,
				mode,
				customModes: state?.customModes,
				experiments: state?.experiments,
				apiConfiguration,
				disabledTools: state?.disabledTools,
				modelInfo,
				skillsEnabled: state?.skillsEnabled,
				includeAllToolsWithRestrictions: false,
			})
			allTools = toolsResult.tools
		}

		// 构建元数据
		const metadata: any = {
			mode,
			taskId: this.task.taskId,
			...(allTools.length > 0
				? {
						tools: allTools,
						tool_choice: "auto",
						parallelToolCalls: true,
				  }
				: {}),
		}

		// 生成环境详情
		const environmentDetails = await getEnvironmentDetails(this.task, true)

		const filesReadByRoo = await this.getFilesReadByRooSafely("condenseContext")

		const {
			messages,
			summary,
			cost,
			newContextTokens = 0,
			error,
			errorDetails,
			condenseId,
		} = await summarizeConversation({
			messages: this.messageService.apiConversationHistory,
			apiHandler: this.task.api,
			systemPrompt,
			taskId: this.task.taskId,
			isAutomaticTrigger: false,
			customCondensingPrompt,
			metadata,
			environmentDetails,
			filesReadByRoo,
			cwd: this.task.cwd,
			rooIgnoreController: this.task.rooIgnoreController,
		})

		if (error) {
			await this.interactionService.say(
				"condense_context_error",
				error,
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
			return
		}

		await this.messageService.overwriteApiConversationHistory(messages)

		const contextCondense: ContextCondense = {
			summary,
			cost,
			newContextTokens,
			prevContextTokens,
			condenseId: condenseId!,
		}

		await this.interactionService.say(
			"condense_context",
			undefined,
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
			contextCondense,
		)

		// 处理任何排队的消息
		this.task.processQueuedMessages?.()
	}

	/**
	 * 处理上下文窗口超出错误
	 */
	async handleContextWindowExceededError(): Promise<void> {
		const state = await this.task.providerRef?.deref?.()?.getState()
		const { contextTokens } = this.task.getTokenUsage?.()
		const modelInfo = this.task.api?.getModel?.().info

		if (!modelInfo) {
			throw new Error("Model info not available")
		}

		// 检查是否应该自动总结
		const autoCondenseContext = state?.autoCondenseContext ?? true

		if (autoCondenseContext) {
			// 自动总结上下文
			await this.condenseContext()
		} else {
			// 截断上下文
			const truncateResult = await this.task.manageContext?.({
				messages: this.messageService.apiConversationHistory,
				totalTokens: contextTokens,
				modelInfo,
				taskId: this.task.taskId,
				systemPrompt: await this.task.getSystemPrompt?.(),
				autoCondenseContextPercent: 75,
			})

			if (truncateResult?.messages !== this.messageService.apiConversationHistory) {
				await this.messageService.overwriteApiConversationHistory(truncateResult.messages)

				const contextTruncation: ContextTruncation = {
					truncationId: crypto.randomUUID(),
					messagesRemoved: 0,
					prevContextTokens: contextTokens,
					newContextTokens: truncateResult.totalTokens,
				}

				await this.interactionService.say(
					"truncated_context",
					undefined,
					undefined,
					false,
					undefined,
					undefined,
					{ isNonInteractive: true },
					contextTruncation,
				)
			}
		}
	}

	/**
	 * 获取上下文使用情况
	 */
	getContextUsage(): { contextTokens: number; maxTokens: number } {
		const { contextTokens } = this.task.getTokenUsage?.() || { contextTokens: 0 }
		const maxTokens = this.task.api?.getModel?.().info?.contextWindow || 200000
		return { contextTokens, maxTokens }
	}

	/**
	 * 检查上下文是否接近限制
	 */
	isContextNearLimit(threshold: number = 0.8): boolean {
		const { contextTokens, maxTokens } = this.getContextUsage()
		return contextTokens >= maxTokens * threshold
	}

	/**
	 * 获取上下文使用百分比
	 */
	getContextUsagePercentage(): number {
		const { contextTokens, maxTokens } = this.getContextUsage()
		return (contextTokens / maxTokens) * 100
	}
}