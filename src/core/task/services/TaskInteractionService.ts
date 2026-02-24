import pWaitFor from "p-wait-for"

import {
	type ClineMessage,
	type ClineAsk,
	type ClineSay,
	type ClineAskResponse,
	type ToolProgressStatus,
	type ContextCondense,
	type ContextTruncation,
	CoderEventName,
	isIdleAsk,
	isInteractiveAsk,
	isResumableAsk,
} from "@coder/types"

import { AskIgnoredError } from "../AskIgnoredError"
import { checkAutoApproval } from "../../auto-approval"
import { findLastIndex } from "../../../shared/array"

/**
 * TaskInteractionService
 * 管理任务的用户交互，包括 ask、say、handleWebviewAskResponse 等
 */
export class TaskInteractionService {
	// Ask 响应状态
	private askResponse?: ClineAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	public lastMessageTs?: number
	private autoApprovalTimeoutRef?: NodeJS.Timeout

	constructor(
		private task: any,
		private stateManager: any,
		private messageService: any,
	) { }

	/**
	 * 向用户发起一个提问
	 */
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: ToolProgressStatus,
		isProtected?: boolean,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
		if (this.stateManager.abort) {
			throw new Error(`[Coder#ask] task ${this.task.taskId}.${this.task.instanceId} aborted`)
		}

		let askTs: number

		if (partial !== undefined) {
			const lastMessage = this.messageService.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					lastMessage.text = text
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					lastMessage.isProtected = isProtected
					await this.messageService.updateClineMessage(lastMessage)
					throw new AskIgnoredError("updating existing partial")
				} else {
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.messageService.addToClineMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
						partial,
						isProtected,
					})
					throw new AskIgnoredError("new partial")
				}
			} else {
				if (isUpdatingPreviousPartial) {
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined

					askTs = lastMessage.ts
					this.lastMessageTs = askTs
					lastMessage.text = text
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus
					lastMessage.isProtected = isProtected
					await this.messageService.saveClineMessages()
					await this.messageService.updateClineMessage(lastMessage)
				} else {
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					askTs = Date.now()
					this.lastMessageTs = askTs
					await this.messageService.addToClineMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
						isProtected,
					})
				}
			}
		} else {
			this.askResponse = undefined
			this.askResponseText = undefined
			this.askResponseImages = undefined
			askTs = Date.now()
			this.lastMessageTs = askTs
			await this.messageService.addToClineMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
				isProtected,
			})
		}

		let timeouts: NodeJS.Timeout[] = []

		// 自动审批
		const provider = this.task.providerRef?.deref?.()
		const state = provider ? await provider.getState() : undefined
		const approval = await checkAutoApproval({ state, ask: type, text, isProtected })

		if (approval.decision === "approve") {
			this.approveAsk()
		} else if (approval.decision === "deny") {
			this.denyAsk()
		} else if (approval.decision === "timeout") {
			this.autoApprovalTimeoutRef = setTimeout(() => {
				const { askResponse, text, images } = approval.fn()
				this.handleWebviewAskResponse(askResponse, text, images)
				this.autoApprovalTimeoutRef = undefined
			}, approval.timeout)
			timeouts.push(this.autoApprovalTimeoutRef)
		}

		// 状态变更
		const isBlocking = !(this.askResponse !== undefined || this.lastMessageTs !== askTs)
		const isMessageQueued = !this.task.messageQueueService.isEmpty()
		const isStatusMutable = !partial && isBlocking && !isMessageQueued && approval.decision === "ask"

		if (isStatusMutable) {
			const statusMutationTimeout = 2_000

			if (isInteractiveAsk(type)) {
				timeouts.push(
					setTimeout(() => {
						const message = this.messageService.findMessageByTimestamp(askTs)

						if (message) {
							this.stateManager.setInteractiveAsk(message)
							this.task.emit(CoderEventName.TaskInteractive, this.task.taskId)
							provider?.postMessageToWebview({ type: "interactionRequired" })
						}
					}, statusMutationTimeout),
				)
			} else if (isResumableAsk(type)) {
				timeouts.push(
					setTimeout(() => {
						const message = this.messageService.findMessageByTimestamp(askTs)

						if (message) {
							this.stateManager.setResumableAsk(message)
							this.task.emit(CoderEventName.TaskResumable, this.task.taskId)
						}
					}, statusMutationTimeout),
				)
			} else if (isIdleAsk(type)) {
				timeouts.push(
					setTimeout(() => {
						const message = this.messageService.findMessageByTimestamp(askTs)

						if (message) {
							this.stateManager.setIdleAsk(message)
							this.task.emit(CoderEventName.TaskIdle, this.task.taskId)
						}
					}, statusMutationTimeout),
				)
			}
		} else if (isMessageQueued) {
			const message = this.task.messageQueueService.dequeueMessage()

			if (message) {
				if (type === "tool" || type === "command" || type === "use_mcp_server") {
					this.handleWebviewAskResponse("yesButtonClicked", message.text, message.images)
				} else {
					this.handleWebviewAskResponse("messageResponse", message.text, message.images)
				}
			}
		}

		// 等待响应
		await pWaitFor(
			() => {
				if (this.askResponse !== undefined || this.lastMessageTs !== askTs) {
					return true
				}

				if (!this.task.messageQueueService.isEmpty()) {
					const message = this.task.messageQueueService.dequeueMessage()
					if (message) {
						if (type === "tool" || type === "command" || type === "use_mcp_server") {
							this.handleWebviewAskResponse("yesButtonClicked", message.text, message.images)
						} else {
							this.handleWebviewAskResponse("messageResponse", message.text, message.images)
						}
					}
				}

				return false
			},
			{ interval: 100 },
		)

		if (this.lastMessageTs !== askTs) {
			throw new AskIgnoredError("superseded")
		}

		const result = { response: this.askResponse!, text: this.askResponseText, images: this.askResponseImages }
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined

		timeouts.forEach((timeout) => clearTimeout(timeout))

		if (this.stateManager.idleAsk || this.stateManager.resumableAsk || this.stateManager.interactiveAsk) {
			this.stateManager.clearAllAsks()
			this.task.emit(CoderEventName.TaskActive, this.task.taskId)
		}

		this.task.emit(CoderEventName.TaskAskResponded)
		return result
	}

	/**
	 * 处理来自 Webview 的用户响应
	 */
	handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]): void {
		this.cancelAutoApprovalTimeout()

		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images

		// 创建检查点
		if (askResponse === "messageResponse") {
			void this.task.checkpointSave?.(false, true)
		}

		// 标记 follow-up 为已回答
		if (askResponse === "messageResponse" || askResponse === "yesButtonClicked") {
			const lastFollowUpIndex = findLastIndex(
				this.messageService.clineMessages,
				(msg: ClineMessage) => msg.type === "ask" && msg.ask === "followup" && !msg.isAnswered,
			)

			if (lastFollowUpIndex !== -1) {
				const followUpMsg = this.messageService.clineMessages[lastFollowUpIndex]
				if (followUpMsg) {
					followUpMsg.isAnswered = true
					this.messageService.saveClineMessages().catch((error: any) => {
						console.error("Failed to save answered follow-up state:", error)
					})
				}
			}
		}

		// 标记工具审批为已回答
		if (askResponse === "yesButtonClicked") {
			const lastToolAskIndex = findLastIndex(
				this.messageService.clineMessages,
				(msg: ClineMessage) => msg.type === "ask" && msg.ask === "tool" && !msg.isAnswered,
			)
			if (lastToolAskIndex !== -1) {
				const toolAskMsg = this.messageService.clineMessages[lastToolAskIndex]
				if (toolAskMsg) {
					toolAskMsg.isAnswered = true
					void this.messageService.updateClineMessage(toolAskMsg)
					this.messageService.saveClineMessages().catch((error: any) => {
						console.error("Failed to save answered tool-ask state:", error)
					})
				}
			}
		}
	}

	/**
	 * 取消自动审批超时
	 */
	cancelAutoApprovalTimeout(): void {
		if (this.autoApprovalTimeoutRef) {
			clearTimeout(this.autoApprovalTimeoutRef)
			this.autoApprovalTimeoutRef = undefined
		}
	}

	/**
	 * 批准 ask
	 */
	approveAsk({ text, images }: { text?: string; images?: string[] } = {}): void {
		this.handleWebviewAskResponse("yesButtonClicked", text, images)
	}

	/**
	 * 拒绝 ask
	 */
	denyAsk({ text, images }: { text?: string; images?: string[] } = {}): void {
		this.handleWebviewAskResponse("noButtonClicked", text, images)
	}

	/**
	 * 覆盖待处理的 ask
	 */
	supersedePendingAsk(): void {
		this.lastMessageTs = Date.now()
	}

	/**
	 * 向用户发送通知消息
	 */
	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: ToolProgressStatus,
		options: {
			isNonInteractive?: boolean
		} = {},
		contextCondense?: ContextCondense,
		contextTruncation?: ContextTruncation,
	): Promise<undefined> {
		if (this.stateManager.abort) {
			throw new Error(`[Coder#say] task ${this.task.taskId}.${this.task.instanceId} aborted`)
		}

		if (partial !== undefined) {
			const lastMessage = this.messageService.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					await this.messageService.updateClineMessage(lastMessage)
				} else {
					const sayTs = Date.now()

					if (!options.isNonInteractive) {
						this.lastMessageTs = sayTs
					}

					await this.messageService.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						partial,
						contextCondense,
						contextTruncation,
					})
				}
			} else {
				if (isUpdatingPreviousPartial) {
					if (!options.isNonInteractive) {
						this.lastMessageTs = lastMessage.ts
					}

					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus

					await this.messageService.saveClineMessages()
					await this.messageService.updateClineMessage(lastMessage)
				} else {
					const sayTs = Date.now()

					if (!options.isNonInteractive) {
						this.lastMessageTs = sayTs
					}

					await this.messageService.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						contextCondense,
						contextTruncation,
					})
				}
			}
		} else {
			const sayTs = Date.now()

			if (!options.isNonInteractive) {
				this.lastMessageTs = sayTs
			}

			await this.messageService.addToClineMessages({
				ts: sayTs,
				type: "say",
				say: type,
				text,
				images,
				checkpoint,
				contextCondense,
				contextTruncation,
			})
		}
	}

	/**
	 * 提交用户消息
	 */
	async submitUserMessage(
		text: string,
		images?: string[],
		mode?: string,
		providerProfile?: string,
	): Promise<void> {
		try {
			text = (text ?? "").trim()
			images = images ?? []

			if (text.length === 0 && images.length === 0) {
				return
			}

			const provider = this.task.providerRef?.deref?.()

			if (provider) {
				if (mode) {
					await provider.setMode(mode)
				}

				if (providerProfile) {
					await provider.setProviderProfile(providerProfile)

					const newState = await provider.getState()
					if (newState?.apiConfiguration) {
						this.task.updateApiConfiguration?.(newState.apiConfiguration)
					}
				}

				this.task.emit(CoderEventName.TaskUserMessage, this.task.taskId)
				this.handleWebviewAskResponse("messageResponse", text, images)
			} else {
				console.error("[Task#submitUserMessage] Provider reference lost")
			}
		} catch (error) {
			console.error("[Task#submitUserMessage] Failed to submit user message:", error)
		}
	}
}