/**
 * MessageHandler 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { MessageHandler } from "./MessageHandler"
import type { Task } from "../Task"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { ClineMessage, ClineAsk, ClineSay } from "@coder/types"
import { AskIgnoredError } from "../AskIgnoredError"

describe("MessageHandler", () => {
	let messageHandler: MessageHandler
	let mockTask: Partial<Task>
	let mockProvider: WeakRef<ClineProvider>
	let mockProviderDeref: any

	beforeEach(() => {
		// Mock Task
		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance-id",
			cwd: "/test/workspace",
			abort: false,
			lastMessageTs: undefined,
			clineMessages: [],
			apiConversationHistory: [],
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			globalStoragePath: "/test/storage",
			rootTaskId: undefined,
			parentTaskId: undefined,
			taskNumber: 1,
			initialStatus: "active",
			_taskMode: "code",
			_taskApiConfigName: "default",
			taskApiConfigReady: Promise.resolve(),
			toolUsage: {},
			userMessageContent: [],
			assistantMessageSavedToHistory: false,
			messageQueueService: {
				isEmpty: vi.fn(() => false),
				dequeueMessage: vi.fn(() => undefined),
			},
			emit: vi.fn(),
			checkpointSave: vi.fn(),
			api: {
				getModel: vi.fn(() => ({ id: "claude-3-5-sonnet-20241022" })),
			},
			getSystemPromptForHandler: vi.fn(async () => "System prompt"),
			getAskResponse: vi.fn(() => ({
				response: undefined,
				text: undefined,
				images: undefined,
			})),
			clearAskResponse: vi.fn(),
			setAskResponse: vi.fn(),
			setAutoApprovalTimeout: vi.fn(() => ({}) as any),
			cancelAutoApprovalTimeout: vi.fn(),
			saveClineMessages: vi.fn(),
			saveApiMessagesForHandler: vi.fn(),
			saveTaskMessagesForHandler: vi.fn(),
			getGlobalStoragePath: vi.fn(() => "/test/storage"),
			getTaskMode: vi.fn(async () => "code"),
			getTaskApiConfigName: vi.fn(async () => "default"),
			waitForTaskApiConfig: vi.fn(async () => {}),
			getInitialStatus: vi.fn(() => "active"),
			emitTokenUsageForHandler: vi.fn(),
			updateApiConfiguration: vi.fn(),
			debouncedEmitTokenUsage: vi.fn(),
		} as any

		// Mock Provider
		mockProviderDeref = {
			postStateToWebviewWithoutTaskHistory: vi.fn(),
			postMessageToWebview: vi.fn(),
			getState: vi.fn(async () => ({
				mode: "code",
				apiConfiguration: {},
			})),
			setMode: vi.fn(),
			setProviderProfile: vi.fn(),
			updateTaskHistory: vi.fn(),
		}

		mockProvider = new WeakRef(mockProviderDeref)

		// Create MessageHandler
		messageHandler = new MessageHandler(mockTask as Task, mockProvider)
	})

	afterEach(() => {
		vi.clearAllMocks()
		// Reset task state between tests
		if (mockTask) {
			mockTask.clineMessages = []
			mockTask.lastMessageTs = undefined
			mockTask.apiConversationHistory = []
			mockTask.userMessageContent = []
			mockTask.assistantMessageSavedToHistory = false
		}
	})

	describe("ask", () => {
		it("should handle ask requests successfully", async () => {
			// Setup
			mockTask.clineMessages = []
			mockTask.lastMessageTs = undefined
			
			// Mock getAskResponse to return a response when called
			const getAskResponseMock = vi.fn(() => ({
				response: "messageResponse" as const,
				text: "test response",
				images: undefined,
			}))
			mockTask.getAskResponse = getAskResponseMock as any

			// Mock pWaitFor to resolve immediately
			vi.doMock("p-wait-for", () => ({
				default: vi.fn((conditionFn) => Promise.resolve(conditionFn())),
			}))

			// Execute with timeout
			const result = await Promise.race([
				messageHandler.ask("tool", "test question"),
				new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
			]) as any

			// Verify
			expect(result).toBeDefined()
			expect(result.response).toBe("messageResponse")
			expect(result.text).toBe("test response")
			expect(mockTask.clineMessages?.length).toBeGreaterThan(0)
			expect(mockTask.clineMessages?.[0]?.type).toBe("ask")
			expect(mockTask.clineMessages?.[0]?.ask).toBe("tool")
		}, 10000)

		it("should throw AskIgnoredError for new partial messages", async () => {
			// Setup - clear messages and reset lastMessageTs
			mockTask.clineMessages = []
			mockTask.lastMessageTs = undefined
			
			// Execute - first call should create new partial
			const result1 = messageHandler.ask("tool", "test", true)
			await expect(result1).rejects.toThrow(AskIgnoredError)
			await expect(result1).rejects.toThrow("new partial")
		})

		it("should throw AskIgnoredError for updating existing partial", async () => {
			// Setup - create initial partial message
			mockTask.clineMessages = []
			mockTask.lastMessageTs = undefined
			await expect(messageHandler.ask("tool", "test", true)).rejects.toThrow(AskIgnoredError)

			// Execute - update partial with same type
			await expect(messageHandler.ask("tool", "test updated", true)).rejects.toThrow(AskIgnoredError)
			await expect(messageHandler.ask("tool", "test updated", true)).rejects.toThrow("updating existing partial")
		})

		it("should complete partial message", async () => {
			// Setup - create partial message
			mockTask.clineMessages = []
			await expect(messageHandler.ask("tool", "test", true)).rejects.toThrow(AskIgnoredError)
			const partialTs = mockTask.lastMessageTs

			// Setup - set response mock
			mockTask.getAskResponse = vi.fn(() => ({
				response: "messageResponse" as const,
				text: "completed",
				images: undefined,
			})) as any
			
			// Execute - complete partial with timeout
			const result = await Promise.race([
				messageHandler.ask("tool", "test completed", false),
				new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
			]) as any

			// Verify
			expect(result.response).toBe("messageResponse")
			expect(mockTask.lastMessageTs).toBe(partialTs) // Timestamp should not change
		}, 10000)

		it("should throw error if task is aborted", async () => {
			// Setup
			mockTask.abort = true

			// Execute & Verify
			await expect(messageHandler.ask("tool", "test")).rejects.toThrow("aborted")
		})

		it("should handle auto-approval", async () => {
			// Setup - mock auto-approval
			vi.doMock("../../auto-approval", () => ({
				checkAutoApproval: vi.fn().mockResolvedValue({
					decision: "approve",
				}),
			}))

			mockTask.getAskResponse = vi.fn(() => ({
				response: "messageResponse" as const,
				text: "auto-approved",
				images: undefined,
			})) as any

			// Execute
			const result = await messageHandler.ask("tool", "test") as any

			// Verify
			expect(result.response).toBe("messageResponse")
		})
	})

	describe("say", () => {
		it("should send messages successfully", async () => {
			// Execute
			await messageHandler.say("text", { text: "test message" })

			// Verify
			expect(mockTask.clineMessages?.length).toBe(1)
			expect(mockTask.clineMessages?.[0]?.type).toBe("say")
			expect(mockTask.clineMessages?.[0]?.say).toBe("text")
			expect(mockTask.clineMessages?.[0]?.text).toBe("test message")
		})

		it("should handle partial messages", async () => {
			// Execute - create partial
			await messageHandler.say("text", { text: "partial", partial: true })

			// Verify
			expect(mockTask.clineMessages?.[0]?.partial).toBe(true)
			expect(mockTask.clineMessages?.[0]?.text).toBe("partial")

			// Execute - complete partial
			await messageHandler.say("text", { text: "completed", partial: false })

			// Verify
			expect(mockTask.clineMessages?.[0]?.partial).toBe(false)
			expect(mockTask.clineMessages?.[0]?.text).toBe("completed")
		})

		it("should handle non-interactive messages", async () => {
			// Setup
			const initialLastMessageTs = mockTask.lastMessageTs

			// Execute
			await messageHandler.say("text", { text: "non-interactive", isNonInteractive: true })

			// Verify - lastMessageTs should not change for non-interactive messages
			expect(mockTask.lastMessageTs).toBe(initialLastMessageTs)
		})

		it("should throw error if task is aborted", async () => {
			// Setup
			mockTask.abort = true

			// Execute & Verify
			await expect(messageHandler.say("text", { text: "test" })).rejects.toThrow("aborted")
		})
	})

	describe("handleWebviewAskResponse", () => {
		it("should handle messageResponse", () => {
			// Execute
			messageHandler.handleWebviewAskResponse("messageResponse", "response text", [])

			// Verify
			expect(mockTask.setAskResponse).toHaveBeenCalledWith("messageResponse", "response text", [])
			expect(mockTask.checkpointSave).toHaveBeenCalledWith(false, true)
		})

		it("should handle yesButtonClicked", () => {
			// Setup
			const mockClineMessages = [
				{ type: "ask" as const, ask: "tool" as ClineAsk, ts: Date.now(), isAnswered: false },
			]
			mockTask.clineMessages = mockClineMessages as ClineMessage[]

			// Execute
			messageHandler.handleWebviewAskResponse("yesButtonClicked", "yes", [])

			// Verify
			expect(mockTask.setAskResponse).toHaveBeenCalledWith("yesButtonClicked", "yes", [])
			expect(mockClineMessages[0]?.isAnswered).toBe(true)
		})

		it("should cancel auto-approval timeout", () => {
			// Setup
			const timeoutRef = setTimeout(() => {}, 1000)
			mockTask.cancelAutoApprovalTimeout = vi.fn()

			// Execute
			messageHandler.handleWebviewAskResponse("messageResponse", "test")

			// Verify
			expect(mockTask.cancelAutoApprovalTimeout).toHaveBeenCalled()
			clearTimeout(timeoutRef)
		})
	})

	describe("approveAsk", () => {
		it("should approve ask with yesButtonClicked", () => {
			// Execute
			messageHandler.approveAsk({ text: "approved", images: [] })

			// Verify
			expect(mockTask.setAskResponse).toHaveBeenCalledWith("yesButtonClicked", "approved", [])
		})
	})

	describe("denyAsk", () => {
		it("should deny ask with noButtonClicked", () => {
			// Execute
			messageHandler.denyAsk({ text: "denied", images: [] })

			// Verify
			expect(mockTask.setAskResponse).toHaveBeenCalledWith("noButtonClicked", "denied", [])
		})
	})

	describe("supersedePendingAsk", () => {
		it("should update lastMessageTs", () => {
			// Execute
			messageHandler.supersedePendingAsk()

			// Verify
			expect(mockTask.lastMessageTs).toBeDefined()
			expect(mockTask.lastMessageTs).toBeGreaterThan(0)
		})
	})

	describe("cancelAutoApprovalTimeout", () => {
		it("should cancel timeout if exists", () => {
			// Setup
			mockTask.cancelAutoApprovalTimeout = vi.fn()

			// Execute
			messageHandler.cancelAutoApprovalTimeout()

			// Verify
			expect(mockTask.cancelAutoApprovalTimeout).toHaveBeenCalled()
		})

		it("should do nothing if no timeout", () => {
			// Execute - should not throw
			expect(() => messageHandler.cancelAutoApprovalTimeout()).not.toThrow()
		})
	})

	describe("addToApiConversationHistory", () => {
		it("should add assistant message", async () => {
			// Setup
			const message = {
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Assistant response" }],
			}

			// Execute
			await messageHandler.addToApiConversationHistory(message)

			// Verify
			expect(mockTask.apiConversationHistory?.length).toBe(1)
			expect(mockTask.apiConversationHistory?.[0]?.role).toBe("assistant")
			expect(mockTask.saveApiMessagesForHandler).toHaveBeenCalled()
		})

		it("should add user message", async () => {
			// Setup
			const message = {
				role: "user" as const,
				content: [{ type: "text" as const, text: "User message" }],
			}

			// Execute
			await messageHandler.addToApiConversationHistory(message)

			// Verify
			expect(mockTask.apiConversationHistory?.length).toBe(1)
			expect(mockTask.apiConversationHistory?.[0]?.role).toBe("user")
		})

		it("should handle reasoning in assistant message", async () => {
			// Setup
			const message = {
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Response" }],
			}

			// Execute
			await messageHandler.addToApiConversationHistory(message, "reasoning text")

			// Verify
			expect(mockTask.apiConversationHistory?.length).toBe(1)
			// The message should have reasoning block added
		})
	})

	describe("overwriteApiConversationHistory", () => {
		it("should overwrite history", async () => {
			// Setup
			const newHistory = [
				{ role: "user" as const, content: "test", ts: Date.now() },
			] as any

			// Execute
			await messageHandler.overwriteApiConversationHistory(newHistory)

			// Verify
			expect(mockTask.apiConversationHistory).toEqual(newHistory)
			expect(mockTask.saveApiMessagesForHandler).toHaveBeenCalled()
		})
	})

	describe("saveApiConversationHistory", () => {
		it("should save history successfully", async () => {
			// Setup
			mockTask.apiConversationHistory = [
				{ role: "user" as const, content: "test", ts: Date.now() },
			] as any

			// Execute
			const result = await messageHandler.saveApiConversationHistory()

			// Verify
			expect(result).toBe(true)
			expect(mockTask.saveApiMessagesForHandler).toHaveBeenCalled()
		})

		it("should handle save errors", async () => {
			// Setup
			mockTask.saveApiMessagesForHandler = vi.fn().mockRejectedValue(new Error("Save failed"))

			// Execute
			const result = await messageHandler.saveApiConversationHistory()

			// Verify
			expect(result).toBe(false)
		})
	})

	describe("retrySaveApiConversationHistory", () => {
		it("should retry and succeed", async () => {
			// Setup
			let attempt = 0
			mockTask.saveApiMessagesForHandler = vi.fn().mockImplementation(async () => {
				attempt++
				if (attempt < 2) {
					throw new Error("Failed")
				}
				return Promise.resolve()
			})

			// Execute
			const result = await messageHandler.retrySaveApiConversationHistory()

			// Verify
			expect(result).toBe(true)
			expect(attempt).toBe(2)
		})

		it("should fail after all retries", async () => {
			// Setup
			mockTask.saveApiMessagesForHandler = vi.fn().mockRejectedValue(new Error("Always fails"))

			// Execute
			const result = await messageHandler.retrySaveApiConversationHistory()

			// Verify
			expect(result).toBe(false)
		})
	})

	describe("flushPendingToolResultsToHistory", () => {
		it("should return true if no pending content", async () => {
			// Setup
			mockTask.userMessageContent = []

			// Execute
			const result = await messageHandler.flushPendingToolResultsToHistory()

			// Verify
			expect(result).toBe(true)
		})

		it("should flush pending results", async () => {
			// Setup
			mockTask.userMessageContent = [
				{ type: "tool_result" as const, tool_use_id: "test-id", content: "result" },
			] as any
			mockTask.assistantMessageSavedToHistory = true

			// Execute
			const result = await messageHandler.flushPendingToolResultsToHistory()

			// Verify
			expect(result).toBe(true)
			expect(mockTask.userMessageContent?.length).toBe(0)
		})

		it("should return false if aborted", async () => {
			// Setup
			mockTask.userMessageContent = [{ type: "tool_result" as const, tool_use_id: "test-id", content: "result" }] as any
			mockTask.abort = true

			// Execute
			const result = await messageHandler.flushPendingToolResultsToHistory()

			// Verify
			expect(result).toBe(false)
		})
	})

	describe("addToClineMessages", () => {
		it("should add message to clineMessages", async () => {
			// Setup
			const message: ClineMessage = {
				type: "say",
				say: "text" as ClineSay,
				ts: Date.now(),
				text: "test",
			}

			// Execute
			await messageHandler.addToClineMessages(message)

			// Verify
			expect(mockTask.clineMessages?.length).toBe(1)
			expect(mockTask.clineMessages?.[0]).toEqual(message)
			expect(mockTask.emit).toHaveBeenCalledWith("message", { action: "created", message })
		})
	})

	describe("overwriteClineMessages", () => {
		it("should overwrite clineMessages", async () => {
			// Setup
			const newMessages: ClineMessage[] = [
				{ type: "say", say: "text" as ClineSay, ts: Date.now(), text: "test" },
			]

			// Execute
			await messageHandler.overwriteClineMessages(newMessages)

			// Verify
			expect(mockTask.clineMessages).toEqual(newMessages)
		})
	})

	describe("updateClineMessage", () => {
		it("should update message", async () => {
			// Setup
			const message: ClineMessage = {
				type: "say",
				say: "text" as ClineSay,
				ts: Date.now(),
				text: "updated",
			}

			// Execute
			await messageHandler.updateClineMessage(message)

			// Verify
			expect(mockProviderDeref.postMessageToWebview).toHaveBeenCalledWith({
				type: "messageUpdated",
				clineMessage: message,
			})
			expect(mockTask.emit).toHaveBeenCalledWith("message", { action: "updated", message })
		})
	})

	describe("findMessageByTimestamp", () => {
		it("should find message by timestamp", () => {
			// Setup
			const ts = Date.now()
			mockTask.clineMessages = [
				{ type: "say", say: "text" as ClineSay, ts: ts - 1000, text: "old" },
				{ type: "say", say: "text" as ClineSay, ts: ts, text: "target" },
				{ type: "say", say: "text" as ClineSay, ts: ts + 1000, text: "new" },
			]

			// Execute
			const result = messageHandler.findMessageByTimestamp(ts)

			// Verify
			expect(result).toBeDefined()
			expect(result?.text).toBe("target")
		})

		it("should return undefined if not found", () => {
			// Setup
			mockTask.clineMessages = []

			// Execute
			const result = messageHandler.findMessageByTimestamp(Date.now())

			// Verify
			expect(result).toBeUndefined()
		})
	})

	describe("submitUserMessage", () => {
		it("should submit user message", async () => {
			// Execute
			await messageHandler.submitUserMessage("test message")

			// Verify
			expect(mockTask.emit).toHaveBeenCalledWith("taskUserMessage", mockTask.taskId)
			expect(mockTask.setAskResponse).toHaveBeenCalledWith("messageResponse", "test message", [])
		})

		it("should handle mode change", async () => {
			// Execute
			await messageHandler.submitUserMessage("test", [], "architect")

			// Verify
			expect(mockProviderDeref.setMode).toHaveBeenCalledWith("architect")
		})

		it("should handle provider profile change", async () => {
			// Setup
			mockProviderDeref.getState = vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "openai" },
			})

			// Execute
			await messageHandler.submitUserMessage("test", [], undefined, "openai-profile")

			// Verify
			expect(mockProviderDeref.setProviderProfile).toHaveBeenCalledWith("openai-profile")
			expect(mockTask.updateApiConfiguration).toHaveBeenCalled()
		})

		it("should ignore empty messages", async () => {
			// Execute
			await messageHandler.submitUserMessage("   ", [])

			// Verify
			expect(mockTask.emit).not.toHaveBeenCalled()
		})

		it("should handle provider reference lost", async () => {
			// Setup - create a temporary object and let it be garbage collected
			let tempProvider: any = { getState: vi.fn() }
			mockProvider = new WeakRef(tempProvider)
			messageHandler = new MessageHandler(mockTask as Task, mockProvider)
			
			// Clear the reference to simulate provider being lost
			tempProvider = null as any

			// Execute - should not throw
			await expect(messageHandler.submitUserMessage("test")).resolves.not.toThrow()
		})
	})
})