import Anthropic from "@anthropic-ai/sdk"
import { ApiMessage } from "../../task-persistence"
import { ClineAsk, ClineApiReqInfo, ClineMessage } from "@coder/types"
import { Task } from "../Task"
import { TaskStateManager } from "../managers/TaskStateManager"
import { TaskApiService } from "./TaskApiService"
import { TaskInteractionService } from "./TaskInteractionService"
import { TaskMessageService } from "./TaskMessageService"
import { TaskCheckpointService } from "./TaskCheckpointService"
import { McpServerManager } from "../../../services/mcp/McpServerManager"
import { countEnabledMcpTools, MAX_MCP_TOOLS_THRESHOLD } from "@coder/types"
import { findLastIndex } from "../../../shared/array"
import { getCheckpointService } from "../../checkpoints"
import { CoderEventName } from "@coder/types"
import { formatResponse } from "../../prompts/responses"
import { getEnvironmentDetails } from "../../environment/getEnvironmentDetails"

/**
 * 生命周期管理服务
 * 负责管理任务的完整生命周期：启动、恢复、中止、清理
 */
export class TaskLifecycleService {
	private _started: boolean = false

	constructor(
		private task: Task,
		private stateManager: TaskStateManager,
		private apiService: TaskApiService,
		private interactionService: TaskInteractionService,
		private messageService: TaskMessageService,
		private checkpointService: TaskCheckpointService,
	) { }

	/**
	 * 手动启动新任务（当创建时使用 startTask: false）
	 */
	public start(): void {
		if (this._started) {
			return
		}
		this._started = true

		const { task, images } = this.task.metadata

		if (task || images) {
			this.startTask(task ?? undefined, images ?? undefined)
		}
	}

	/**
	 * 启动新任务
	 */
	public async startTask(task?: string, images?: string[]): Promise<void> {
		try {
			// 清空消息历史
			this.messageService.clineMessages = []
			this.messageService.apiConversationHistory = []

			await this.task.providerRef.deref()?.postStateToWebviewWithoutTaskHistory()

			await this.interactionService.say("text", task, images)

			// 检查MCP工具数量并警告
			const { enabledToolCount, enabledServerCount } = await this.getEnabledMcpToolsCount()
			if (enabledToolCount > MAX_MCP_TOOLS_THRESHOLD) {
				await this.interactionService.say(
					"too_many_tools_warning",
					JSON.stringify({
						toolCount: enabledToolCount,
						serverCount: enabledServerCount,
						threshold: MAX_MCP_TOOLS_THRESHOLD,
					}),
					undefined,
					undefined,
					undefined,
					undefined,
					{ isNonInteractive: true },
				)
			}
			this.stateManager.isInitialized = true

			const imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)

			// 启动任务循环
			await this.initiateTaskLoop([
				{
					type: "text",
					text: `<user_message>\n${task}\n</user_message>`,
				},
				...imageBlocks,
			]).catch((error) => {
				// 吞弃循环拒绝，当任务被有意放弃/中止时
				if (this.stateManager.abandoned || this.stateManager.abortReason === "user_cancelled") {
					return
				}
				throw error
			})
		} catch (error) {
			// 在测试和某些UX流程中，任务可能在 startTask 初始化期间被中止
			if (this.stateManager.abandoned || this.stateManager.abort || this.stateManager.abortReason === "user_cancelled") {
				return
			}
			throw error
		}
	}

	/**
	 * 从历史记录恢复任务
	 */
	public async resumeTaskFromHistory(): Promise<void> {
		try {
			const modifiedClineMessages = await this.messageService.getSavedClineMessages()

			// 移除之前可能添加的恢复消息
			const lastRelevantMessageIndex = findLastIndex(
				modifiedClineMessages,
				(m: any) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
			)

			if (lastRelevantMessageIndex !== -1) {
				modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
			}

			// 移除任何尾随的仅推理UI消息
			while (modifiedClineMessages.length > 0) {
				const last = modifiedClineMessages[modifiedClineMessages.length - 1]
				if (last && last.type === "say" && last.say === "reasoning") {
					modifiedClineMessages.pop()
				} else {
					break
				}
			}

			// 检查最后一个 api_req_started 是否有成本值
			const lastApiReqStartedIndex = findLastIndex(
				modifiedClineMessages,
				(m: any) => m.type === "say" && m.say === "api_req_started",
			)

			if (lastApiReqStartedIndex !== -1) {
				const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex]
				if (lastApiReqStarted) {
					const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")

					if (cost === undefined && cancelReason === undefined) {
						modifiedClineMessages.splice(lastApiReqStartedIndex, 1)
					}
				}
			}

			await this.messageService.overwriteClineMessages(modifiedClineMessages)
			this.messageService.clineMessages = await this.messageService.getSavedClineMessages()

			// 初始化API对话历史
			this.messageService.apiConversationHistory = await this.messageService.getSavedApiConversationHistory()

			const lastClineMessage = this.messageService.clineMessages
				.slice()
				.reverse()
				.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

			let askType: ClineAsk
			if (lastClineMessage?.ask === "completion_result") {
				askType = "resume_completed_task"
			} else {
				askType = "resume_task"
			}

			this.stateManager.isInitialized = true

			const { response, text, images } = await this.interactionService.ask(askType)

			let responseText: string | undefined
			let responseImages: string[] | undefined

			if (response === "messageResponse") {
				await this.interactionService.say("user_feedback", text, images)
				responseText = text
				responseImages = images
			}

			// 确保API对话历史可以被API恢复
			let existingApiConversationHistory: ApiMessage[] = await this.messageService.getSavedApiConversationHistory()

			let modifiedOldUserContent: Anthropic.Messages.ContentBlockParam[]
			let modifiedApiConversationHistory: ApiMessage[]

			if (existingApiConversationHistory.length > 0) {
				const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

				if (lastMessage && lastMessage.isSummary) {
					// 保留摘要消息
					modifiedApiConversationHistory = [...existingApiConversationHistory]
					modifiedOldUserContent = []
				} else if (lastMessage && lastMessage.role === "assistant") {
					const content = Array.isArray(lastMessage.content)
						? lastMessage.content
						: [{ type: "text", text: lastMessage.content }]
					const hasToolUse = content.some((block: { type: string }) => block.type === "tool_use")

					if (hasToolUse) {
						const toolUseBlocks = content.filter(
							(block: { type: string }) => block.type === "tool_use",
						) as Anthropic.Messages.ToolUseBlock[]
						const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
							type: "tool_result",
							tool_use_id: block.id,
							content: "Task was interrupted before this tool call could be completed.",
						}))
						modifiedApiConversationHistory = [...existingApiConversationHistory]
						modifiedOldUserContent = [...toolResponses]
					} else {
						modifiedApiConversationHistory = [...existingApiConversationHistory]
						modifiedOldUserContent = []
					}
				} else if (lastMessage && lastMessage.role === "user") {
					const previousAssistantMessage: ApiMessage | undefined =
						existingApiConversationHistory[existingApiConversationHistory.length - 2]

					const existingUserContent: Anthropic.Messages.ContentBlockParam[] = Array.isArray(
						lastMessage.content,
					)
						? lastMessage.content
						: [{ type: "text", text: lastMessage.content }]

					if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
						const assistantContent = Array.isArray(previousAssistantMessage.content)
							? previousAssistantMessage.content
							: [{ type: "text", text: previousAssistantMessage.content }]

						const toolUseBlocks = assistantContent.filter(
							(block: { type: string }) => block.type === "tool_use",
						) as Anthropic.Messages.ToolUseBlock[]

						if (toolUseBlocks.length > 0) {
							const existingToolResults = existingUserContent.filter(
								(block) => block.type === "tool_result",
							) as Anthropic.ToolResultBlockParam[]

							const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
								.filter(
									(toolUse) =>
										!existingToolResults.some((result) => result.tool_use_id === toolUse.id),
								)
								.map((toolUse) => ({
									type: "tool_result",
									tool_use_id: toolUse.id,
									content: "Task was interrupted before this tool call could be completed.",
								}))

							modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
							modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
						} else {
							modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
							modifiedOldUserContent = [...existingUserContent]
						}
					} else {
						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
						modifiedOldUserContent = [...existingUserContent]
					}
				} else {
					modifiedApiConversationHistory = existingApiConversationHistory
					modifiedOldUserContent = []
				}
			} else {
				modifiedApiConversationHistory = existingApiConversationHistory
				modifiedOldUserContent = []
			}

			// 添加用户反馈（如果有）
			let newUserContent: Anthropic.Messages.ContentBlockParam[] = []
			if (responseText || responseImages) {
				newUserContent = [
					{
						type: "text",
						text: `<user_message>\n${responseText ?? ""}\n</user_message>`,
					},
					...formatResponse.imageBlocks(responseImages),
				]
			}

			// 合并旧用户内容和新用户内容
			if (modifiedOldUserContent.length > 0 || newUserContent.length > 0) {
				modifiedApiConversationHistory.push({
					role: "user",
					content: [...modifiedOldUserContent, ...newUserContent],
				})
			}

			// 如果新用户内容为空，添加最小恢复消息
			if (newUserContent.length === 0) {
				newUserContent.push({
					type: "text",
					text: "[TASK RESUMPTION] Resuming task...",
				})
			}

			await this.messageService.overwriteApiConversationHistory(modifiedApiConversationHistory)

			// 从历史记录恢复任务
			await this.initiateTaskLoop(newUserContent)
		} catch (error) {
			// 恢复和取消可能竞争
			if (this.stateManager.abandoned || this.stateManager.abort || this.stateManager.abortReason === "user_cancelled") {
				return
			}
			throw error
		}
	}

	/**
	 * 中止任务
	 */
	public async abortTask(isAbandoned = false): Promise<void> {
		if (isAbandoned) {
			this.stateManager.abandoned = true
		}

		this.stateManager.abort = true

		// 重置连续错误计数器
		this.task.consecutiveNoToolUseCount = 0
		this.task.consecutiveNoAssistantMessagesCount = 0

		// 在中止事件前强制发出最终token使用更新
		this.task.emitFinalTokenUsageUpdate()

		this.task.emit(CoderEventName.TaskAborted)

		try {
			this.dispose()
		} catch (error) {
			console.error(`Error during task ${this.task.taskId}.${this.task.instanceId} disposal:`, error)
		}

		try {
			await this.messageService.saveClineMessages()
		} catch (error) {
			console.error(`Error saving messages during abort for task ${this.task.taskId}.${this.task.instanceId}:`, error)
		}
	}

	/**
	 * 清理资源
	 */
	public dispose(): void {
		console.log(`[Task#dispose] disposing task ${this.task.taskId}.${this.task.instanceId}`)

		// 取消任何进行中的HTTP请求
		try {
			this.apiService.cancelCurrentRequest()
		} catch (error) {
			console.error("Error cancelling current request:", error)
		}

		// 移除提供商配置文件更改监听器
		try {
			if ((this.task as any).providerProfileChangeListener) {
				const provider = this.task.providerRef.deref()
				if (provider) {
					provider.off(CoderEventName.ProviderProfileChanged, (this.task as any).providerProfileChangeListener)
				}
				(this.task as any).providerProfileChangeListener = undefined
			}
		} catch (error) {
			console.error("Error removing provider profile change listener:", error)
		}

		// 释放消息队列并移除事件监听器
		try {
			if ((this.task as any).messageQueueStateChangedHandler) {
				(this.task.messageQueueService as any).removeListener("stateChanged", (this.task as any).messageQueueStateChangedHandler)
				(this.task as any).messageQueueStateChangedHandler = undefined
			}

			this.task.messageQueueService.dispose()
		} catch (error) {
			console.error("Error disposing message queue:", error)
		}

		// 移除所有事件监听器以防止内存泄漏
		try {
			this.task.removeAllListeners()
		} catch (error) {
			console.error("Error removing event listeners:", error)
		}

		// 释放与此任务关联的任何终端
		try {
			const TerminalRegistry = require("../../integrations/terminal/TerminalRegistry").TerminalRegistry
			TerminalRegistry.releaseTerminalsForTask(this.task.taskId)
		} catch (error) {
			console.error("Error releasing terminals:", error)
		}

		// 清理命令输出工件
		const path = require("path")
		const OutputInterceptor = require("../../integrations/terminal/OutputInterceptor").OutputInterceptor
		const getTaskDirectoryPath = require("../../utils/storage").getTaskDirectoryPath

		getTaskDirectoryPath((this.task as any).globalStoragePath, this.task.taskId)
			.then((taskDir: string) => {
				const outputDir = path.join(taskDir, "command-output")
				return OutputInterceptor.cleanup(outputDir)
			})
			.catch((error: Error) => {
				console.error("Error cleaning up command output artifacts:", error)
			})

		// 清理 RooIgnoreController
		try {
			if (this.task.rooIgnoreController) {
				this.task.rooIgnoreController.dispose()
				this.task.rooIgnoreController = undefined
			}
		} catch (error) {
			console.error("Error disposing RooIgnoreController:", error)
		}

		// 清理文件上下文跟踪器
		try {
			this.task.fileContextTracker.dispose()
		} catch (error) {
			console.error("Error disposing file context tracker:", error)
		}

		// 如果正在流式传输且正在编辑，则恢复更改
		try {
			if (this.stateManager.isStreaming && this.task.diffViewProvider.isEditing) {
				this.task.diffViewProvider.revertChanges().catch(console.error)
			}
		} catch (error) {
			console.error("Error reverting diff changes:", error)
		}
	}

	/**
	 * 启动任务循环
	 */
	private async initiateTaskLoop(userContent: Anthropic.Messages.ContentBlockParam[]): Promise<void> {
		// 在后台启动检查点初始化过程
		getCheckpointService(this.task)

		let nextUserContent = userContent
		let includeFileDetails = true

		this.task.emit(CoderEventName.TaskStarted)

		while (!this.stateManager.abort) {
			const didEndLoop = await this.task.recursivelyMakeClineRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false

			// 代理循环工作方式：cline被赋予一个任务，然后调用工具来完成
			// 除非有 attempt_completion 调用，否则我们继续用工具响应回复
			// 直到他要么 attempt_completion 要么不再使用工具
			// 如果他不再使用工具，我们要求他考虑是否完成任务并调用 attempt_completion

			if (didEndLoop) {
				break
			} else {
				nextUserContent = [{ type: "text", text: formatResponse.noToolsUsed() }]
			}
		}
	}

	/**
	 * 获取启用的MCP工具数量
	 */
	private async getEnabledMcpToolsCount(): Promise<{ enabledToolCount: number; enabledServerCount: number }> {
		try {
			const provider = this.task.providerRef.deref()
			if (!provider) {
				return { enabledToolCount: 0, enabledServerCount: 0 }
			}

			const { mcpEnabled } = (await provider.getState()) ?? {}
			if (!(mcpEnabled ?? true)) {
				return { enabledToolCount: 0, enabledServerCount: 0 }
			}

			const mcpHub = await McpServerManager.getInstance(provider.context, provider)
			if (!mcpHub) {
				return { enabledToolCount: 0, enabledServerCount: 0 }
			}

			const servers = mcpHub.getServers()
			return countEnabledMcpTools(servers)
		} catch (error) {
			console.error("[TaskLifecycleService#getEnabledMcpToolsCount] Error counting MCP tools:", error)
			return { enabledToolCount: 0, enabledServerCount: 0 }
		}
	}
}