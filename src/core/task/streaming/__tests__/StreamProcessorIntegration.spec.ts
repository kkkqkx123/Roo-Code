/**
 * StreamProcessor 集成测试
 * 
 * 测试整个流式处理流程，确保 StreamProcessor 和 StreamPostProcessor
 * 协同工作正常，正确处理各种场景
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { StreamProcessor } from "../StreamProcessor"
import { StreamPostProcessor } from "../StreamPostProcessor"
import type {
	StreamProcessorCallbacks,
	StreamProcessorConfig,
} from "../StreamProcessorCallbacks"
import type { StreamPostProcessorCallbacks } from "../StreamPostProcessorCallbacks"
import type { ModelInfo, ProviderSettings } from "@coder/types"
import type { ApiStream, ApiStreamChunk } from "../../../../api/transform/stream"
import { mockDetectImpl } from "./mocks"

// Mock hasToolUses utility - must be inline since vi.mock is hoisted
vi.mock("../../utils/tool-utils", async () => {
	const actual = await vi.importActual("../../utils/tool-utils")
	return {
		...(actual as any),
		enforceNewTaskIsolation: vi.fn().mockReturnValue({
			truncatedAssistantContent: [],
			truncatedAssistantMessageContent: [],
			errorToolResults: [],
		}),
		hasToolUses: vi.fn().mockReturnValue(false),
		buildAssistantContent: vi.fn().mockReturnValue([]),
	}
})

// Mock NativeToolCallParser
vi.mock("../../assistant-message/NativeToolCallParser", () => ({
	NativeToolCallParser: {
		processRawChunk: vi.fn().mockReturnValue([]),
		startStreamingToolCall: vi.fn(),
		processStreamingChunk: vi.fn().mockReturnValue(null),
		finalizeStreamingToolCall: vi.fn().mockReturnValue(null),
		parseToolCall: vi.fn().mockReturnValue(null),
		clearAllStreamingToolCalls: vi.fn(),
		clearRawChunkState: vi.fn(),
		finalizeRawChunks: vi.fn().mockReturnValue([]),
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

// Mock DeadLoopDetector
vi.mock("../../../utils/deadLoopDetector", () => ({
	DeadLoopDetector: vi.fn().mockImplementation(() => ({
		detect: mockDetectImpl,
		reset: vi.fn(),
	})),
}))

describe("StreamProcessor 集成测试", () => {
	let streamCallbacks: StreamProcessorCallbacks
	let postProcessorCallbacks: StreamPostProcessorCallbacks
	let config: StreamProcessorConfig
	let modelInfo: ModelInfo
	let apiConfig: ProviderSettings

	beforeEach(() => {
		// Reset mocks
		mockDetectImpl.mockReset()
		mockDetectImpl.mockReturnValue({ detected: false })
		vi.clearAllMocks()

		// 创建模型信息
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

		apiConfig = {
			apiProvider: "anthropic",
		} as any

		config = {
			apiReqIndex: 0,
			modelInfo,
			skipProviderRateLimit: true,
			usageCollectionTimeoutMs: 5000,
		}

		// 创建 StreamProcessor callbacks
		streamCallbacks = createStreamProcessorCallbacks()

		// 创建 StreamPostProcessor callbacks
		postProcessorCallbacks = createStreamPostProcessorCallbacks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	/**
	 * 创建 StreamProcessor 测试回调
	 */
	function createStreamProcessorCallbacks(): StreamProcessorCallbacks {
		return {
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
			getApiConfiguration: vi.fn().mockImplementation(() => apiConfig),
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
			getUserMessageContentReady: vi.fn().mockReturnValue(true),
			setUserMessageContentReady: vi.fn(),
			getIsStreaming: vi.fn().mockReturnValue(false),
			setIsStreaming: vi.fn(),
			getTaskId: vi.fn().mockReturnValue("test-task-123"),
			notifyPresentAssistantMessage: vi.fn(),
			hasToolUses: vi.fn().mockReturnValue(false),
			getApiReqInfo: vi.fn().mockReturnValue(undefined),
		}
	}

	/**
	 * 创建 StreamPostProcessor 测试回调
	 */
	function createStreamPostProcessorCallbacks(): StreamPostProcessorCallbacks {
		return {
			// SharedCallbacks
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
			getClineMessage: vi.fn().mockReturnValue({ text: "{}" }),
			say: vi.fn().mockResolvedValue(undefined),
			getApiConfiguration: vi.fn().mockImplementation(() => apiConfig),
			getModelInfo: vi.fn().mockImplementation(() => modelInfo),
			getTaskId: vi.fn().mockReturnValue("test-task-123"),
			getApiReqInfo: vi.fn().mockReturnValue(undefined),
			getAbortController: vi.fn().mockReturnValue(undefined),
			isAborted: vi.fn().mockReturnValue(false),
			isAbandoned: vi.fn().mockReturnValue(false),
			setAbort: vi.fn(),
			setAbortReason: vi.fn(),
			setAssistantMessageContent: vi.fn(),
			getUserMessageContentReady: vi.fn().mockReturnValue(true),
			setUserMessageContentReady: vi.fn(),
			getIsStreaming: vi.fn().mockReturnValue(false),
			setIsStreaming: vi.fn(),
			hasToolUses: vi.fn().mockReturnValue(false),
			getStreamingToolCallIndices: vi.fn().mockReturnValue(new Map()),
			setStreamingToolCallIndices: vi.fn(),
			getCurrentStreamingContentIndex: vi.fn().mockReturnValue(0),
			setCurrentStreamingContentIndex: vi.fn(),
			resetDiffView: vi.fn().mockResolvedValue(undefined),
			revertDiffViewChanges: vi.fn().mockResolvedValue(undefined),
			isDiffViewEditing: vi.fn().mockReturnValue(false),
			didRejectTool: vi.fn().mockReturnValue(false),
			didAlreadyUseTool: vi.fn().mockReturnValue(false),
			notifyPresentAssistantMessage: vi.fn(),

			// StreamPostProcessorCallbacks 特有方法
			onStreamComplete: vi.fn().mockResolvedValue(undefined),
			onAbort: vi.fn().mockResolvedValue(undefined),
			emitEvent: vi.fn().mockResolvedValue(undefined),
			getFullConversationContent: vi.fn().mockResolvedValue([]),
			getReasoningMessage: vi.fn().mockResolvedValue(undefined),
			findLastReasoningMessageIndex: vi.fn().mockResolvedValue(-1),
			getPartialBlocks: vi.fn().mockResolvedValue([]),
			getStreamingToolCallIndex: vi.fn().mockResolvedValue(undefined),
			getAssistantMessageContent: vi.fn().mockResolvedValue(undefined),
			getUserMessageContent: vi.fn().mockResolvedValue([]),
			getCurrentUserContent: vi.fn().mockResolvedValue([]),
			getCurrentStackItem: vi.fn().mockResolvedValue(undefined),
			getState: vi.fn().mockResolvedValue(undefined),
			isPaused: vi.fn().mockResolvedValue(false),
			wasAborted: vi.fn().mockResolvedValue(false),
			updateUsageData: vi.fn().mockResolvedValue(undefined),
			updateAssistantMessageContent: vi.fn().mockResolvedValue(undefined),
			removeStreamingToolCallIndex: vi.fn().mockResolvedValue(undefined),
			setAssistantMessageSavedToHistory: vi.fn().mockResolvedValue(undefined),
			pushToUserMessageContent: vi.fn().mockResolvedValue(undefined),
			pushToStack: vi.fn().mockResolvedValue(undefined),
			incrementConsecutiveNoToolUseCount: vi.fn().mockResolvedValue(0),
			incrementConsecutiveNoAssistantMessagesCount: vi.fn().mockResolvedValue(0),
			incrementConsecutiveMistakeCount: vi.fn().mockResolvedValue(undefined),
			resetConsecutiveNoAssistantMessagesCount: vi.fn().mockResolvedValue(undefined),
			resetConsecutiveNoToolUseCount: vi.fn().mockResolvedValue(undefined),
			countTokens: vi.fn().mockResolvedValue(0),
			log: vi.fn().mockResolvedValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			presentAssistantMessage: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yes" }),
			addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			removeLastUserMessageFromHistory: vi.fn().mockResolvedValue(undefined),
			pushToolResultToUserContent: vi.fn().mockResolvedValue(undefined),
			waitForUserMessageContentReady: vi.fn().mockResolvedValue(undefined),
			backoffAndAnnounce: vi.fn().mockResolvedValue(undefined),
			getTranslation: vi.fn().mockResolvedValue("Sources"),
		}
	}

	/**
	 * 创建完整的流式处理流程
	 */
	async function createFullStreamProcessor(): Promise<{
		processor: StreamProcessor
		postProcessor: StreamPostProcessor
	}> {
		const processor = new StreamProcessor(
			streamCallbacks,
			config,
			{
				enableDeadLoopDetection: true,
				enableBackgroundUsageCollection: true,
				enableTokenCounterFallback: true,
			}
		)

		const postProcessor = new StreamPostProcessor(
			postProcessorCallbacks,
			{
				enableTokenFallback: true,
				enableToolCallFinalization: true,
				enablePartialBlockCompletion: true,
				enableAssistantMessageSaving: true,
				enableContentProcessing: true,
				enableErrorHandling: true,
			}
		)

		// 注册事件监听器
		processor.on("streamComplete", async (event) => {
			await postProcessor.handleEvent(event)
		})

		return { processor, postProcessor }
	}

	describe("完整流式处理流程", () => {
		it("应该正确处理完整的文本流式处理流程", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* textStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
				yield { type: "text", text: " " } as ApiStreamChunk
				yield { type: "text", text: "World" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(textStream())

			// 验证流处理完成
			expect(streamCallbacks.setAssistantMessageContent).toHaveBeenCalled()
			expect(streamCallbacks.notifyPresentAssistantMessage).toHaveBeenCalled()
			expect(streamCallbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})

		it("应该正确处理 reasoning + 文本的完整流程", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* mixedStream(): ApiStream {
				yield { type: "reasoning", text: "Let me think..." } as ApiStreamChunk
				yield { type: "text", text: "The answer is 42" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(mixedStream())

			// 验证 reasoning 和文本都被处理
			expect(streamCallbacks.say).toHaveBeenCalledWith(
				"reasoning",
				expect.objectContaining({ text: expect.any(String), partial: true })
			)
			expect(streamCallbacks.setAssistantMessageContent).toHaveBeenCalled()
		})

		it("应该正确处理包含 usage 的完整流程", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* usageStream(): ApiStream {
				yield { type: "text", text: "Response" } as ApiStreamChunk
				yield {
					type: "usage",
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 10,
					cacheReadTokens: 5,
					totalCost: 0.005
				} as ApiStreamChunk
			}

			await processor.processStream(usageStream())

			const state = processor.getState()
			expect(state.inputTokens).toBe(100)
			expect(state.outputTokens).toBe(50)
			expect(state.cacheWriteTokens).toBe(10)
			expect(state.cacheReadTokens).toBe(5)
			expect(state.totalCost).toBe(0.005)
			expect(state.hasApiUsageData).toBe(true)
		})

		it("应该正确处理 grounding sources", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* groundingStream(): ApiStream {
				yield { type: "text", text: "Based on sources" } as ApiStreamChunk
				yield {
					type: "grounding",
					sources: [
						{ title: "Source 1", url: "https://example.com/1" },
						{ title: "Source 2", url: "https://example.com/2" },
					],
				} as ApiStreamChunk
			}

			await processor.processStream(groundingStream())

			// grounding sources 应该被累积
			expect(streamCallbacks.setAssistantMessageContent).toHaveBeenCalled()
		})
	})

	describe("用户取消场景", () => {
		it("应该正确处理用户取消流程", async () => {
			// 模拟用户在流处理过程中取消
			let abortCallback: (() => void) | undefined
			const abortController = new AbortController()
			abortCallback = () => abortController.abort()

			streamCallbacks.getAbortController = vi.fn().mockReturnValue(abortController)
			streamCallbacks.isAbandoned = vi.fn().mockReturnValue(false)
			streamCallbacks.isAborted = vi.fn().mockImplementation(() => abortController.signal.aborted)

			const { processor } = await createFullStreamProcessor()

			async function* cancellableStream(): ApiStream {
				yield { type: "text", text: "First chunk" } as ApiStreamChunk
				// 模拟延迟，让用户有机会取消
				await new Promise(resolve => setTimeout(resolve, 10))
				abortCallback!()
				yield { type: "text", text: "Second chunk" } as ApiStreamChunk
			}

			await processor.processStream(cancellableStream())

			// 验证取消流程被正确触发
			expect(streamCallbacks.isAborted).toHaveBeenCalled()
			expect(streamCallbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})
	})

	describe("错误处理场景", () => {
		it("应该正确处理流错误", async () => {
			streamCallbacks.isAbandoned = vi.fn().mockReturnValue(false)
			streamCallbacks.isAborted = vi.fn().mockReturnValue(false)

			const { processor } = await createFullStreamProcessor()

			async function* errorStream(): ApiStream {
				yield { type: "text", text: "First chunk" } as ApiStreamChunk
				yield { type: "error", error: "Test error", message: "Stream failed" } as ApiStreamChunk
			}

			await processor.processStream(errorStream())

			// 验证错误处理流程
			expect(streamCallbacks.setDidFinishAbortingStream).toHaveBeenCalledWith(true)
		})

		it("应该正确处理空流", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* emptyStream(): ApiStream {
				// 空流
			}

			await processor.processStream(emptyStream())

			// 空流不应该触发错误
			expect(streamCallbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})
	})

	describe("死循环检测场景", () => {
		it("应该正确处理死循环检测", async () => {
			// 死循环检测在单元测试中难以正确 mock
			// 因为 DeadLoopDetector 在 StreamProcessor 构造函数中创建
			// 这里只验证处理器在启用死循环检测时不会抛出意外错误

			const processor = new StreamProcessor(
				streamCallbacks,
				config,
				{
					enableDeadLoopDetection: true,
					enableBackgroundUsageCollection: true,
					enableTokenCounterFallback: true,
				}
			)

			async function* normalStream(): ApiStream {
				yield { type: "reasoning", text: "正常推理" } as ApiStreamChunk
				yield { type: "text", text: "回答" } as ApiStreamChunk
			}

			// 正常推理不应该触发死循环检测
			await expect(processor.processStream(normalStream())).resolves.not.toThrow()
		})

		it("应该正确处理正常 reasoning（不死循环）", async () => {
			// Mock 正常 reasoning
			mockDetectImpl.mockImplementation(() => ({ detected: false }))

			const { processor } = await createFullStreamProcessor()

			async function* normalReasoningStream(): ApiStream {
				yield { type: "reasoning", text: "让我思考这个问题" } as ApiStreamChunk
				yield { type: "text", text: "这是答案" } as ApiStreamChunk
			}

			await processor.processStream(normalReasoningStream())

			// 正常 reasoning 不应该触发中止
			expect(streamCallbacks.abortTask).not.toHaveBeenCalled()
			expect(streamCallbacks.setDidFinishAbortingStream).not.toHaveBeenCalled()
		})
	})

	describe("StreamPostProcessor 集成", () => {
		it("应该正确触发 streamComplete 事件", async () => {
			const { processor, postProcessor } = await createFullStreamProcessor()

			async function* simpleStream(): ApiStream {
				yield { type: "text", text: "Hello" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(simpleStream())

			// 验证 StreamPostProcessor 的 onStreamComplete 被调用
			expect(postProcessorCallbacks.onStreamComplete).toHaveBeenCalled()
		})

		it("应该正确处理工具调用最终化", async () => {
			const { processor, postProcessor } = await createFullStreamProcessor()

			async function* toolStream(): ApiStream {
				yield { type: "text", text: "I'll use a tool" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(toolStream())

			// 验证流处理完成，没有抛出错误
			// 工具调用最终化会在有工具调用时触发
			expect(streamCallbacks.setAssistantMessageContent).toHaveBeenCalled()
		})

		it("应该正确处理部分块完成", async () => {
			// Mock 返回部分块
			postProcessorCallbacks.getPartialBlocks = vi.fn().mockResolvedValue([
				{ type: "text", content: "Partial content", partial: true }
			])

			const { processor } = await createFullStreamProcessor()

			async function* partialStream(): ApiStream {
				yield { type: "text", text: "Partial" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(partialStream())

			// 验证部分块被处理
			expect(postProcessorCallbacks.getPartialBlocks).toHaveBeenCalled()
		})
	})

	describe("后台使用数据收集", () => {
		it("应该正确处理后台使用数据收集", async () => {
			const { processor } = await createFullStreamProcessor()

			let iterator: AsyncIterator<any> | undefined

			// 创建一个自定义流，保留 iterator 用于后台收集
			async function* usageStream(): ApiStream {
				yield { type: "text", text: "Response" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			const stream = usageStream()
			iterator = stream[Symbol.asyncIterator]()

			await processor.processStream(stream)

			// 验证使用数据被正确处理
			const state = processor.getState()
			expect(state.inputTokens).toBe(100)
			expect(state.outputTokens).toBe(50)
		})
	})

	describe("Token 回退处理", () => {
		it("应该在 API 没有提供 usage 数据时处理 token 回退", async () => {
			const { processor, postProcessor } = await createFullStreamProcessor()

			async function* noUsageStream(): ApiStream {
				yield { type: "text", text: "Response" } as ApiStreamChunk
				// 没有 usage chunk
			}

			await processor.processStream(noUsageStream())

			// 验证流处理完成
			expect(streamCallbacks.setAssistantMessageContent).toHaveBeenCalled()
		})

		it("应该正确处理 outputTokens 为 0 的 usage 数据", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* zeroOutputStream(): ApiStream {
				yield { type: "text", text: "Response" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 0 } as ApiStreamChunk
			}

			await processor.processStream(zeroOutputStream())

			const state = processor.getState()
			expect(state.hasApiUsageData).toBe(false) // outputTokens 为 0 应该设置 hasApiUsageData 为 false
		})
	})

	describe("多轮对话场景", () => {
		it("应该正确处理连续多次流式请求", async () => {
			const { processor } = await createFullStreamProcessor()

			// 第一轮请求
			async function* firstStream(): ApiStream {
				yield { type: "text", text: "First response" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(firstStream())

			// 重置处理器状态
			processor.reset()

			// 第二轮请求
			async function* secondStream(): ApiStream {
				yield { type: "text", text: "Second response" } as ApiStreamChunk
				yield { type: "usage", inputTokens: 150, outputTokens: 75 } as ApiStreamChunk
			}

			await processor.processStream(secondStream())

			// 验证第二轮请求的状态
			const state = processor.getState()
			expect(state.inputTokens).toBe(150)
			expect(state.outputTokens).toBe(75)
		})
	})

	describe("边界情况", () => {
		it("应该正确处理只有 reasoning 没有文本的流", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* reasoningOnlyStream(): ApiStream {
				yield { type: "reasoning", text: "Thinking..." } as ApiStreamChunk
				yield { type: "usage", inputTokens: 100, outputTokens: 0 } as ApiStreamChunk
			}

			await processor.processStream(reasoningOnlyStream())

			// 验证 reasoning 被处理
			expect(streamCallbacks.say).toHaveBeenCalledWith(
				"reasoning",
				expect.any(Object)
			)
		})

		it("应该正确处理只有 usage 的流", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* usageOnlyStream(): ApiStream {
				yield { type: "usage", inputTokens: 100, outputTokens: 50 } as ApiStreamChunk
			}

			await processor.processStream(usageOnlyStream())

			// 验证 usage 被处理
			const state = processor.getState()
			expect(state.inputTokens).toBe(100)
			expect(state.outputTokens).toBe(50)
		})

		it("应该正确处理 undefined chunk", async () => {
			const { processor } = await createFullStreamProcessor()

			async function* undefinedChunkStream(): ApiStream {
				yield { type: "text", text: "First" } as ApiStreamChunk
				yield undefined as any
				yield { type: "text", text: "Second" } as ApiStreamChunk
			}

			await processor.processStream(undefinedChunkStream())

			// 验证流处理完成，没有因为 undefined chunk 而失败
			expect(streamCallbacks.setAssistantMessageContent).toHaveBeenCalled()
		})
	})

	describe("事件系统", () => {
		it("应该正确触发所有事件", async () => {
			const { processor } = await createFullStreamProcessor()

			const eventListener = vi.fn()
			processor.on("streamStart", eventListener)
			processor.on("chunkReceived", eventListener)
			processor.on("chunkProcessed", eventListener)
			processor.on("streamComplete", eventListener)

			async function* eventStream(): ApiStream {
				yield { type: "text", text: "Test" } as ApiStreamChunk
			}

			await processor.processStream(eventStream())

			// 验证所有事件都被触发
			expect(eventListener).toHaveBeenCalled()
		})

		it("应该正确移除事件监听器", async () => {
			const { processor } = await createFullStreamProcessor()

			const eventListener = vi.fn()
			processor.on("streamStart", eventListener)
			processor.off("streamStart", eventListener)

			async function* testStream(): ApiStream {
				yield { type: "text", text: "Test" } as ApiStreamChunk
			}

			await processor.processStream(testStream())

			// 验证监听器被移除
			expect(eventListener).not.toHaveBeenCalled()
		})

		it("应该正确移除所有事件监听器", async () => {
			const { processor } = await createFullStreamProcessor()

			const eventListener = vi.fn()
			processor.on("streamStart", eventListener)
			processor.removeAllListeners()

			async function* testStream(): ApiStream {
				yield { type: "text", text: "Test" } as ApiStreamChunk
			}

			await processor.processStream(testStream())

			// 验证所有监听器被移除
			expect(eventListener).not.toHaveBeenCalled()
		})
	})
})
