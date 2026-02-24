import { Anthropic } from "@anthropic-ai/sdk"

import { type TodoItem, CoderEventName } from "@coder/types"

import { getEnvironmentDetails } from "../../environment/getEnvironmentDetails"

/**
 * TaskSubtaskService
 * 管理子任务的创建和恢复
 */
export class TaskSubtaskService {
	constructor(
		private task: any,
		private stateManager: any,
	) {}

	/**
	 * 启动子任务
	 */
	async startSubtask(message: string, initialTodos: TodoItem[], mode: string): Promise<any> {
		const provider = this.task.providerRef?.deref?.()

		if (!provider) {
			throw new Error("Provider not available")
		}

		const child = await (provider as any).delegateParentAndOpenChild({
			parentTaskId: this.task.taskId,
			message,
			initialTodos,
			mode,
		})
		return child
	}

	/**
	 * 在委托完成后恢复父任务
	 */
	async resumeAfterDelegation(): Promise<void> {
		// 清除任何待处理的 ask 状态
		this.stateManager.clearAllAsks()

		// 重置中止和流式状态
		this.stateManager.setAbort(false)
		this.stateManager.setAbandoned(false)
		this.stateManager.setAbortReason(undefined)
		this.stateManager.setDidFinishAbortingStream(false)
		this.stateManager.setStreaming(false)
		this.stateManager.setWaitingForFirstChunk(false)

		// 确保下次 API 调用包含完整上下文
		this.stateManager.setSkipPrevResponseIdOnce(true)

		// 标记为已初始化和活动状态
		this.stateManager.setInitialized(true)
		this.task.emit(CoderEventName.TaskActive, this.task.taskId)

		// 如果尚未加载，加载对话历史
		if (this.task.apiConversationHistory.length === 0) {
			this.task.apiConversationHistory = await this.task.getSavedApiConversationHistory?.()
		}

		// 向现有的最后一条用户消息添加环境详情
		const environmentDetails = await getEnvironmentDetails(this.task, true)
		let lastUserMsgIndex = -1
		for (let i = this.task.apiConversationHistory.length - 1; i >= 0; i--) {
			const message = this.task.apiConversationHistory[i]
			if (message && message.role === "user") {
				lastUserMsgIndex = i
				break
			}
		}

		if (lastUserMsgIndex >= 0) {
			const lastUserMsg = this.task.apiConversationHistory[lastUserMsgIndex]
			if (lastUserMsg && Array.isArray(lastUserMsg.content)) {
				// 移除任何现有的 environment_details 块
				const contentWithoutEnvDetails = lastUserMsg.content.filter(
					(block: Anthropic.Messages.ContentBlockParam) => {
						if (block.type === "text" && typeof block.text === "string") {
							const isEnvironmentDetailsBlock =
								block.text.trim().startsWith("<environment_details>") &&
								block.text.trim().endsWith("</environment_details>")
							return !isEnvironmentDetailsBlock
						}
						return true
					},
				)
				// 添加新的环境详情
				lastUserMsg.content = [...contentWithoutEnvDetails, { type: "text" as const, text: environmentDetails }]
			}
		}

		// 保存更新后的历史
		await this.task.saveApiConversationHistory?.()

		// 继续任务循环
		await this.task.initiateTaskLoop?.([])
	}

	/**
	 * 设置子任务 ID
	 */
	setChildTaskId(childTaskId: string): void {
		this.task.childTaskId = childTaskId
	}

	/**
	 * 获取子任务 ID
	 */
	getChildTaskId(): string | undefined {
		return this.task.childTaskId
	}

	/**
	 * 清除子任务 ID
	 */
	clearChildTaskId(): void {
		this.task.childTaskId = undefined
	}
}