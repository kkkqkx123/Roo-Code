/**
 * StreamProcessor 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { StreamProcessor } from "../StreamProcessor"
import type {
	StreamProcessorCallbacks,
	StreamProcessorConfig,
} from "../StreamProcessorCallbacks"
import type { ModelInfo } from "@coder/types"
import type { ApiStream, ApiStreamChunk } from "../../../../api/transform/stream"
import { mockDetectImpl } from "./mocks"

// Mock NativeToolCallParser
vi.mock("../../assistant-message/NativeToolCallParser", () => ({
	NativeToolCallParser: {
		processRawChunk: vi.fn(),
		startStreamingToolCall: vi.fn(),
		processStreamingChunk: vi.fn(),
		finalizeStreamingToolCall: vi.fn(),
		parseToolCall: vi.fn(),
		clearAllStreamingToolCalls: vi.fn(),
		clearRawChunkState: vi.fn(),
	},
}))

// Mock StreamingTokenCounter
vi.mock("../../../utils/tiktoken", () => ({
	StreamingTokenCounter: vi.fn().mockImplementation(() => ({
		addText: vi.fn().mockReturnValue(5),
		addReasoning: vi.fn().mockReturnValue(3),
		addToolCall: vi.fn().mockReturnValue(2),
		getTotalTokens: vi.fn().mockReturnValue(10),
		getTokenBreakdown: vi.fn().mockReturnValue({
			text: 5,
			reasoning: 3,
			toolCalls: 2,
			total: 10,
		}),
		reset: vi.fn(),
	})),
}))

// Mock DeadLoopDetector using shared mock from mocks.ts
vi.mock("../../../utils/deadLoopDetector", () => ({
	DeadLoopDetector: vi.fn().mockImplementation(() => ({
		detect: mockDetectImpl,
		reset: vi.fn(),
	})),
}))

describe("StreamProcessor", () => {
	let callbacks: StreamProcessorCallbacks
	let config: StreamProcessorConfig
	let modelInfo: ModelInfo

	beforeEach(() => {
		// Reset mock completely and set default return value
		mockDetectImpl.mockReset()
		mockDetectImpl.mockReturnValue({ detected: false })

		// Create fresh mock callbacks
		callbacks = {
			updateApiReqMessage: vi.fn().mockResolvedValue(undefined),
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
			say: vi.fn().mockResolvedValue(undefined),
			abortStream: vi.fn().mockResolvedValue(undefined),
			abortTask: vi.fn().mockResolvedValue(undefined),
			resetDiffView: vi.fn().mockResolvedValue(undefined),
			revertDiffViewChanges: vi.fn().mockResolvedValue(undefined),
			isDiffViewEditing: vi.fn().mockReturnValue(false),
			getLastClineMessage: vi.fn().mockReturnValue(undefined),
			getClineMessage: vi.fn().mockReturnValue({ text: "{}" }),
			getModelInfo: vi.fn().mockImplementation(() => modelInfo),
			getApiConfiguration: vi.fn().mockReturnValue({
				apiProvider: "anthropic",
			}),
			getAbortController: vi.fn().mockReturnValue(undefined),
			isAborted: vi.fn().mockReturnValue(false),
			isAbandoned: vi.fn().mockReturnValue(false),
			didRejectTool: vi.fn().mockReturnValue(false),
			didAlreadyUseTool: vi.fn().mockReturnValue(false),
			setAbort: vi.fn(),
			setAbortReason: vi.fn(),
			setDidFinishAbortingStream: vi.fn(),
			getAssistantMessageContent: vi.fn().mockReturnValue([]),
			setAssistantMessageContent: vi.fn(),
			getStreamingToolCallIndices: vi.fn().mockReturnValue(new Map()),
			setStreamingToolCallIndices: vi.fn(),
			getCurrentStreamingContentIndex: vi.fn().mockReturnValue(0),
			setCurrentStreamingContentIndex: vi.fn(),
			getUserMessageContentReady: vi.fn().mockReturnValue(false),
			setUserMessageContentReady: vi.fn(),
			getIsStreaming: vi.fn().mockReturnValue(false),
			setIsStreaming: vi.fn(),
			getTaskId: vi.fn().mockReturnValue("test-task-123"),
			notifyPresentAssistantMessage: vi.fn(),
			hasToolUses: vi.fn().mockReturnValue(false),
			getApiReqInfo: vi.fn().mockReturnValue(undefined),
		}

		// 创建配置
		modelInfo = {
			id: "claude-3-5-sonnet",
			info: {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsPromptCache: true,
				supportsImages: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			},
		} as any

		config = {
			apiReqIndex: 0,
			modelInfo,
			skipProviderRateLimit: true,
			usageCollectionTimeoutMs: 5000,
		}

		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("构造函数", () => {
		it("应该正确初始化 StreamProcessor", () => {
			const processor = new StreamProcessor(callbacks, config)

			expect(processor).toBeDefined()
			expect(processor.getState()).toEqual({
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: undefined,
				hasApiUsageData: false,
			})
		})

		it("应该使用默认选项", () => {
			const processor = new StreamProcessor(callbacks, config)

			expect(processor).toBeDefined()
		})

		it("应该接受自定义选项", () => {
			const options = {
				enableDeadLoopDetection: false,
				enableBackgroundUsageCollection: false,
				enableTokenCounterFallback: false,
			}
			const processor = new StreamProcessor(callbacks, config, options)

			expect(processor).toBeDefined()
		})
	})

	describe("处理文本 chunk", () => {
		it("应该正确处理文本 chunk", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* textStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
				yield { type: "text", text: " world" } as ApiStreamChunk
			}

			await processor.processStream(textStream())

			// 文本 chunk 不会调用 say，只会更新 assistant message content
			expect(callbacks.setAssistantMessageContent).toHaveBeenCalled()
			expect(callbacks.notifyPresentAssistantMessage).toHaveBeenCalled()
		})
	})

	describe("处理 reasoning chunk", () => {
		it("应该正确处理 reasoning chunk", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* reasoningStream(): ApiStream {
				yield { type: "reasoning", text: "Thinking..." } as ApiStreamChunk
			}

			await processor.processStream(reasoningStream())

			expect(callbacks.say).toHaveBeenCalledWith("reasoning", "Thinking...", undefined, true)
		})

		it("应该格式化 reasoning 消息中的标题", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* reasoningStream(): ApiStream {
				yield { type: "reasoning", text: "End of sentence.**Title Here**" } as ApiStreamChunk
			}

			await processor.processStream(reasoningStream())

			expect(callbacks.say).toHaveBeenCalledWith(
				"reasoning",
				"End of sentence.\n\n**Title Here**",
				undefined,
				true,
			)
		})
	})

	describe("处理 usage chunk", () => {
		it("应该正确累积 usage 数据", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* usageStream(): ApiStream {
				yield { type: "usage", inputTokens: 100, outputTokens: 50, cacheWriteTokens: 10, cacheReadTokens: 5 } as ApiStreamChunk
				yield { type: "usage", inputTokens: 50, outputTokens: 25, cacheWriteTokens: 5, cacheReadTokens: 2 } as ApiStreamChunk
			}

			await processor.processStream(usageStream())

			const state = processor.getState()
			expect(state.inputTokens).toBe(150)
			expect(state.outputTokens).toBe(75)
			expect(state.cacheWriteTokens).toBe(15)
			expect(state.cacheReadTokens).toBe(7)
		})

		it("应该正确设置 hasApiUsageData 标志", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* usageStream(): ApiStream {
				yield { type: "usage", inputTokens: 100, outputTokens: 0 } as ApiStreamChunk
			}

			await processor.processStream(usageStream())

			const state = processor.getState()
			expect(state.hasApiUsageData).toBe(false)
		})
	})

	describe("处理 grounding chunk", () => {
		it("应该正确处理 grounding chunk", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* groundingStream(): ApiStream {
				yield {
					type: "grounding",
					sources: [
						{ title: "Source 1", url: "https://example.com/1" },
						{ title: "Source 2", url: "https://example.com/2" },
					],
				} as ApiStreamChunk
			}

			await processor.processStream(groundingStream())

			// grounding chunk 应该被处理但不触发 say
			expect(callbacks.say).not.toHaveBeenCalled()
		})
	})

	describe("中止处理", () => {
		it("应该在用户取消时中止流", async () => {
			callbacks.isAborted = vi.fn().mockReturnValue(true)
			callbacks.isAbandoned = vi.fn().mockReturnValue(false)
			const processor = new StreamProcessor(callbacks, config)

			async function* abortStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
			}

			await processor.processStream(abortStream())

			// 检查是否调用了 isAborted 和 isAbandoned
			expect(callbacks.isAborted).toHaveBeenCalled()
			expect(callbacks.isAbandoned).toHaveBeenCalled()
			// abortStream 是私有方法，不会直接调用 callbacks.abortStream
			// 但应该调用 setDidFinishAbortingStream
			expect(callbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})

		it("应该在流失败时中止流", async () => {
			callbacks.isAbandoned = vi.fn().mockReturnValue(false)
			const processor = new StreamProcessor(callbacks, config)

			async function* errorStream(): ApiStream {
				yield { type: "error", error: "Test error", message: "Stream failed" } as ApiStreamChunk
			}

			await processor.processStream(errorStream())

			// error chunk 应该触发内部 abortStream，最终调用 setDidFinishAbortingStream
			expect(callbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})
	})

	describe("状态管理", () => {
		it("应该正确返回状态", () => {
			const processor = new StreamProcessor(callbacks, config)

			const state = processor.getState()

			expect(state).toEqual({
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: undefined,
				hasApiUsageData: false,
			})
		})

		it("应该正确重置状态", async () => {
			const processor = new StreamProcessor(callbacks, config)

			async function* testStream(): ApiStream {
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(testStream())

			processor.reset()

			const state = processor.getState()
			expect(state.inputTokens).toBe(0)
			expect(state.outputTokens).toBe(0)
		})
	})

	describe("工具拒绝", () => {
		it("应该在工具被拒绝时中断流", async () => {
			callbacks.didRejectTool = vi.fn().mockReturnValue(true)
			const processor = new StreamProcessor(callbacks, config)

			async function* toolRejectStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
			}

			await processor.processStream(toolRejectStream())

			// 流应该被中断，但不会调用 abortStream
			expect(callbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})
	})

	describe("工具使用", () => {
		it("应该在已使用工具时中断流", async () => {
			callbacks.didAlreadyUseTool = vi.fn().mockReturnValue(true)
			const processor = new StreamProcessor(callbacks, config)

			async function* toolUsedStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
			}

			await processor.processStream(toolUsedStream())

			// 流应该被中断，但不会调用 abortStream
			expect(callbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})
	})

	describe("错误处理", () => {
		it("应该处理流错误", async () => {
			callbacks.isAbandoned = vi.fn().mockReturnValue(false)
			callbacks.isAborted = vi.fn().mockReturnValue(false)
			const processor = new StreamProcessor(callbacks, config)

			async function* errorStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
				throw new Error("Stream error")
			}

			await processor.processStream(errorStream())

			// 应该调用 setDidFinishAbortingStream
			expect(callbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})

		it("应该在非放弃状态下处理错误", async () => {
			callbacks.isAbandoned = vi.fn().mockReturnValue(false)
			callbacks.isAborted = vi.fn().mockReturnValue(false)
			const processor = new StreamProcessor(callbacks, config)

			async function* errorStream(): ApiStream {
				throw new Error("Stream error")
			}

			await processor.processStream(errorStream())

			// 应该调用 setDidFinishAbortingStream
			expect(callbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})

		it("应该在放弃状态下不处理错误", async () => {
			callbacks.isAbandoned = vi.fn().mockReturnValue(true)
			const processor = new StreamProcessor(callbacks, config)

			async function* errorStream(): ApiStream {
				throw new Error("Stream error")
			}

			await processor.processStream(errorStream())

			// 放弃状态下不应该调用 setDidFinishAbortingStream
			expect(callbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})
	})

	describe("中止控制器", () => {
		it("应该使用中止控制器取消请求", async () => {
			const abortController = new AbortController()
			callbacks.getAbortController = vi.fn().mockReturnValue(abortController)
			callbacks.isAbandoned = vi.fn().mockReturnValue(false)
			callbacks.isAborted = vi.fn().mockReturnValue(false)

			const processor = new StreamProcessor(callbacks, config)

			async function* abortableStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
				// 模拟延迟
				await new Promise((resolve) => setTimeout(resolve, 100))
				yield { type: "text", text: " world" } as ApiStreamChunk
			}

			// 立即中止
			abortController.abort()

			await processor.processStream(abortableStream())

			// 应该因为中止而提前结束，并调用 setDidFinishAbortingStream
			expect(callbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})
	})

	describe("配置选项", () => {
		it("应该禁用死循环检测", async () => {
			const options = { enableDeadLoopDetection: false }
			const processor = new StreamProcessor(callbacks, config, options)

			async function* reasoningStream(): ApiStream {
				yield { type: "reasoning", text: "Thinking..." } as ApiStreamChunk
			}

			await processor.processStream(reasoningStream())

			// 死循环检测被禁用，应该不会调用 abortTask
			expect(callbacks.abortTask).not.toHaveBeenCalled()
		})

		it("应该禁用后台使用数据收集", async () => {
			const options = { enableBackgroundUsageCollection: false }
			const processor = new StreamProcessor(callbacks, config, options)

			async function* usageStream(): ApiStream {
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(usageStream())

			// 后台收集被禁用，updateApiReqMessage 不会在后台调用
			// 流处理完成时也不会调用，因为没有文本内容
			expect(callbacks.updateApiReqMessage).not.toHaveBeenCalled()
		})
	})

	describe("死循环检测", () => {
		it("应该在检测到死循环时中止流", async () => {
			// Mock dead loop detection to trigger - use mockImplementation to override beforeEach
			mockDetectImpl.mockImplementation(() => ({
				detected: true,
				type: "shortSequenceLoop",
				details: '检测到短序列循环：重复单元 "思考"',
			}))

			const processor = new StreamProcessor(callbacks, config)

			async function* deadLoopStream(): ApiStream {
				yield { type: "reasoning", text: "思考思考思考思考" } as ApiStreamChunk
				// This chunk should never be reached due to dead loop detection
				yield { type: "text", text: "More text" } as ApiStreamChunk
			}

			// processStream will not throw, but will trigger abort flow
			await processor.processStream(deadLoopStream())

			// Verify abort flow was triggered
			// say 应该被调用，包含错误消息
			expect(callbacks.say).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("检测到死循环"),
			)
			expect(callbacks.setAbort).toHaveBeenCalledWith(true)
			expect(callbacks.setAbortReason).toHaveBeenCalledWith("streaming_failed")
			expect(callbacks.abortTask).toHaveBeenCalled()
			expect(callbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})

		it("应该在死循环检测被禁用时不触发中止", async () => {
			// Even with detection returning true, disabled option should prevent abort
			mockDetectImpl.mockImplementation(() => ({
				detected: true,
				type: "shortSequenceLoop",
				details: "检测到短序列循环",
			}))

			const options = { enableDeadLoopDetection: false }
			const processor = new StreamProcessor(callbacks, config, options)

			async function* reasoningStream(): ApiStream {
				yield { type: "reasoning", text: "思考思考思考思考" } as ApiStreamChunk
			}

			await processor.processStream(reasoningStream())

			// Should not abort when detection is disabled
			expect(callbacks.abortTask).not.toHaveBeenCalled()
			expect(callbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})

		it("应该继续处理未检测到死循环的 reasoning", async () => {
			// Normal reasoning should not trigger abort
			mockDetectImpl.mockImplementation(() => ({ detected: false }))

			const processor = new StreamProcessor(callbacks, config)

			async function* reasoningStream(): ApiStream {
				yield { type: "reasoning", text: "让我思考这个问题" } as ApiStreamChunk
				yield { type: "text", text: "这是答案" } as ApiStreamChunk
			}

			await processor.processStream(reasoningStream())

			// Should not abort for normal reasoning
			expect(callbacks.abortTask).not.toHaveBeenCalled()
			expect(callbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
			expect(callbacks.say).toHaveBeenCalledWith("reasoning", expect.any(String), undefined, true)
		})
	})
})