// npx vitest core/task/__tests__/deadLoopDetector.integration.spec.ts

import * as vscode from "vscode"
import type { ProviderSettings, ModelInfo } from "@coder/types"
import { Task } from "../Task"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { EventEmitter } from "events"
import { vi, describe, beforeEach, afterEach, it, expect } from "vitest"

// Mock delay before any imports that might use it
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation((filePath) => {
			if (filePath.includes("ui_messages.json")) {
				return Promise.resolve("[]")
			}
			if (filePath.includes("api_conversation_history.json")) {
				return Promise.resolve("[]")
			}
			return Promise.resolve("[]")
		}),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockRejectedValue({ code: "ENOENT" }),
		readdir: vi.fn().mockResolvedValue([]),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve({ text: `processed: ${text}`, mode: undefined, contentBlocks: [] })
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../condense", async (importOriginal) => {
	const actual = (await importOriginal()) as any
	return {
		...actual,
		summarizeConversation: vi.fn().mockResolvedValue({
			messages: [{ role: "user", content: [{ type: "text", text: "continued" }], ts: Date.now() }],
			summary: "summary",
			cost: 0,
			newContextTokens: 1,
		}),
	}
})

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation((filePath) => {
		return filePath.includes("ui_messages.json") || filePath.includes("api_conversation_history.json")
	}),
}))

vi.mock("@coder/core", () => ({
	customToolRegistry: {
		getTools: vi.fn().mockReturnValue([]),
		hasTool: vi.fn().mockReturnValue(false),
		getTool: vi.fn().mockReturnValue(undefined),
	},
}))

// Mock ClineProvider
vi.mock("../../webview/ClineProvider", () => ({
	ClineProvider: vi.fn().mockImplementation(() => ({
		on: vi.fn(),
		off: vi.fn(),
		emit: vi.fn(),
		getContextProxy: vi.fn().mockReturnValue({
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				setValue: vi.fn().mockResolvedValue(undefined),
			},
			secretStorage: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
		}),
		getState: vi.fn().mockResolvedValue({
			apiConfiguration: {},
			mode: "code",
			modeApiConfigs: {},
		}),
		updateGlobalState: vi.fn().mockResolvedValue(undefined),
		log: vi.fn(),
		extensionContext: {
			storageUri: { fsPath: "/mock/storage/path" },
			globalStorageUri: { fsPath: "/mock/global/storage/path" },
			logUri: { fsPath: "/mock/log/path" },
			extensionUri: { fsPath: "/mock/extension/path" },
			extensionPath: "/mock/extension/path",
			asAbsolutePath: vi.fn(),
			subscriptions: [],
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			secretStorage: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
		},
	})),
}))

describe("DeadLoopDetector Integration", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings

	// Helper to create a mock streaming API response
	function createMockStream(chunks: ApiStreamChunk[]): AsyncGenerator<ApiStreamChunk> {
		let index = 0
		return (async function* generator() {
			for (const chunk of chunks) {
				yield chunk
			}
		})()
	}

	beforeEach(async () => {
		vi.clearAllMocks()

		mockProvider = {
			on: vi.fn(),
			off: vi.fn(),
			emit: vi.fn(),
			getContextProxy: vi.fn().mockReturnValue({
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
					setValue: vi.fn().mockResolvedValue(undefined),
				},
				secretStorage: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
			}),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: {},
				mode: "code",
				modeApiConfigs: {},
			}),
			updateGlobalState: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			getApi: vi.fn(),
			extensionContext: {
				storageUri: { fsPath: "/mock/storage/path" },
				globalStorageUri: { fsPath: "/mock/global/storage/path" },
				logUri: { fsPath: "/mock/log/path" },
				extensionUri: { fsPath: "/mock/extension/path" },
				extensionPath: "/mock/extension/path",
				asAbsolutePath: vi.fn(),
				subscriptions: [],
				workspaceState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				secretStorage: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
			},
		}

		mockApiConfig = {
			apiProvider: "openai",
			apiKey: "test-api-key",
			openAiModelId: "gpt-4",
			openAiBaseUrl: "https://api.openai.com/v1",
		}
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("短序列循环检测 (Short Sequence Loop Detection)", () => {
		it("应该检测到短序列循环并终止任务", async () => {
			// 创建包含短序列重复的 reasoning 文本（4 次重复的"思考"）
			const repeatingUnit = "思考"
			const repeatingText = repeatingUnit.repeat(50) // 50 次重复，远超阈值
			const baseText = "a".repeat(1800) // 填充到 2000 字符以触发检测
			const filler = "b".repeat(100)
			const fullReasoningText = baseText + repeatingText + filler

			// 将文本分割成 chunks 模拟流式传输
			const chunkSize = 100
			const chunks: ApiStreamChunk[] = []
			for (let i = 0; i < fullReasoningText.length; i += chunkSize) {
				chunks.push({
					type: "reasoning",
					text: fullReasoningText.slice(i, i + chunkSize),
				})
			}
			// 添加 usage chunk 结束流
			chunks.push({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			const mockStream = createMockStream(chunks)

			// Mock API 的 createMessage 方法返回我们的模拟流
			const mockModel = {
				id: "gpt-4",
				info: {
					maxTokens: 4096,
					contextWindow: 8192,
					supportsPromptCache: false,
					supportsImages: false,
				},
			}

			vi.spyOn(mockProvider, "getApi").mockReturnValue({
				createMessage: vi.fn().mockImplementation(async function* () {
					yield* mockStream
				}),
				getModel: vi.fn().mockReturnValue(mockModel),
				validateApi: vi.fn().mockResolvedValue({ valid: true }),
			} as any)

			// 创建 Task 实例
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableCheckpoints: false,
				task: "测试任务",
				images: [],
				startTask: false,
			})

			// 调用内部方法启动流式处理
			// 我们需要模拟 recursivelyMakeClineRequests 的调用
			const userContent = [{ type: "text" as const, text: "测试任务" }]

			// 捕获 abortTask 调用
			const abortTaskSpy = vi.spyOn(task, "abortTask").mockImplementation(async () => {
				task.abort = true
			})

			// 执行请求
			try {
				await (task as any).recursivelyMakeClineRequests(userContent, false)
			} catch (error) {
				// 期望因为 abort 而抛出错误
				expect((error as Error).message).toContain("aborted")
			}

			// 验证：abortTask 应该被调用
			expect(abortTaskSpy).toHaveBeenCalled()

			// 验证：应该显示错误消息
			const saySpy = vi.spyOn(task, "say")
			// 检查是否有 error 类型的消息
			const errorMessages = (task as any).clineMessages.filter(
				(msg: any) => msg.type === "say" && msg.say === "error"
			)
			expect(errorMessages.length).toBeGreaterThan(0)
			expect(errorMessages[0].text).toContain("死循环")
		})
	})

	describe("段落内容重复检测 (Paragraph Repetition Detection)", () => {
		it("应该检测到段落重复并终止任务", async () => {
			// 创建包含段落周期重复的文本
			// 检测器检测 2000-3000 字符范围，需要至少 6 个块的周期
			const baseText = "a".repeat(2000)
			// 创建重复的段落模式：2 个块形成周期
			const repeatingParagraph = "第一句。第二句。" // 分割后：["第一句", "第二句"]
			const repeatingText = repeatingParagraph.repeat(150) // 300 个块，远超过 6 块阈值
			const fullReasoningText = baseText + repeatingText

			const chunkSize = 100
			const chunks: ApiStreamChunk[] = []
			for (let i = 0; i < fullReasoningText.length; i += chunkSize) {
				chunks.push({
					type: "reasoning",
					text: fullReasoningText.slice(i, i + chunkSize),
				})
			}
			chunks.push({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			const mockStream = createMockStream(chunks)

			const mockModel = {
				id: "gpt-4",
				info: {
					maxTokens: 4096,
					contextWindow: 8192,
					supportsPromptCache: false,
					supportsImages: false,
				},
			}

			vi.spyOn(mockProvider, "getApi").mockReturnValue({
				createMessage: vi.fn().mockImplementation(async function* () {
					yield* mockStream
				}),
				getModel: vi.fn().mockReturnValue(mockModel),
				validateApi: vi.fn().mockResolvedValue({ valid: true }),
			} as any)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableCheckpoints: false,
				task: "测试段落重复检测",
				images: [],
				startTask: false,
			})

			const userContent = [{ type: "text" as const, text: "测试任务" }]
			const abortTaskSpy = vi.spyOn(task, "abortTask").mockImplementation(async () => {
				task.abort = true
			})

			try {
				await (task as any).recursivelyMakeClineRequests(userContent, false)
			} catch (error) {
				expect((error as Error).message).toContain("aborted")
			}

			// 验证 abortTask 被调用
			expect(abortTaskSpy).toHaveBeenCalled()

			// 验证显示了错误消息
			const errorMessages = (task as any).clineMessages.filter(
				(msg: any) => msg.type === "say" && msg.say === "error"
			)
			expect(errorMessages.length).toBeGreaterThan(0)
			expect(errorMessages[0].text).toContain("死循环")
		})
	})

	describe("有序列表重复检测 (Ordered List Repetition Detection)", () => {
		it("应该检测到有序列表重复并终止任务", async () => {
			// 创建包含有序列表周期重复的文本
			// 检测器检测 2000-3000 字符范围，需要至少 6 行的周期
			const baseText = "a".repeat(2000)
			// 创建重复的列表模式：2 行形成周期
			const repeatingList = "1. 第一项\n2. 第二项\n"
			const repeatingText = repeatingList.repeat(100) // 200 行，远超过 6 行阈值
			const fullReasoningText = baseText + repeatingText

			const chunkSize = 100
			const chunks: ApiStreamChunk[] = []
			for (let i = 0; i < fullReasoningText.length; i += chunkSize) {
				chunks.push({
					type: "reasoning",
					text: fullReasoningText.slice(i, i + chunkSize),
				})
			}
			chunks.push({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			const mockStream = createMockStream(chunks)

			const mockModel = {
				id: "gpt-4",
				info: {
					maxTokens: 4096,
					contextWindow: 8192,
					supportsPromptCache: false,
					supportsImages: false,
				},
			}

			vi.spyOn(mockProvider, "getApi").mockReturnValue({
				createMessage: vi.fn().mockImplementation(async function* () {
					yield* mockStream
				}),
				getModel: vi.fn().mockReturnValue(mockModel),
				validateApi: vi.fn().mockResolvedValue({ valid: true }),
			} as any)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableCheckpoints: false,
				task: "测试列表重复检测",
				images: [],
				startTask: false,
			})

			const userContent = [{ type: "text" as const, text: "测试任务" }]
			const abortTaskSpy = vi.spyOn(task, "abortTask").mockImplementation(async () => {
				task.abort = true
			})

			try {
				await (task as any).recursivelyMakeClineRequests(userContent, false)
			} catch (error) {
				expect((error as Error).message).toContain("aborted")
			}

			// 验证 abortTask 被调用
			expect(abortTaskSpy).toHaveBeenCalled()

			// 验证显示了错误消息
			const errorMessages = (task as any).clineMessages.filter(
				(msg: any) => msg.type === "say" && msg.say === "error"
			)
			expect(errorMessages.length).toBeGreaterThan(0)
			expect(errorMessages[0].text).toContain("死循环")
		})
	})

	describe("正常文本不应该触发死循环检测", () => {
		it("正常的 reasoning 文本不应该被误报", async () => {
			// 创建正常的、无重复的 reasoning 文本
			const normalReasoningText = `
让我分析一下这个问题。
首先，我需要考虑需求。
然后，我应该设计方案。
接下来，实现功能。
之后，编写测试。
最后，部署上线。

这是一个正常的思考过程，没有重复。
第一步：理解问题。
第二步：分析需求。
第三步：制定计划。
第四步：执行实施。
第五步：验证结果。

任务完成！
`.repeat(50) // 重复整个段落，但内容本身不是周期性的

			const chunkSize = 100
			const chunks: ApiStreamChunk[] = []
			for (let i = 0; i < normalReasoningText.length; i += chunkSize) {
				chunks.push({
					type: "reasoning",
					text: normalReasoningText.slice(i, i + chunkSize),
				})
			}
			chunks.push({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			const mockStream = createMockStream(chunks)

			const mockModel = {
				id: "gpt-4",
				info: {
					maxTokens: 4096,
					contextWindow: 8192,
					supportsPromptCache: false,
					supportsImages: false,
				},
			}

			vi.spyOn(mockProvider, "getApi").mockReturnValue({
				createMessage: vi.fn().mockImplementation(async function* () {
					yield* mockStream
				}),
				getModel: vi.fn().mockReturnValue(mockModel),
				validateApi: vi.fn().mockResolvedValue({ valid: true }),
			} as any)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableCheckpoints: false,
				task: "测试正常文本",
				images: [],
				startTask: false,
			})

			const userContent = [{ type: "text" as const, text: "测试任务" }]
			const abortTaskSpy = vi.spyOn(task, "abortTask")

			// 正常文本不应该触发 abort
			await (task as any).recursivelyMakeClineRequests(userContent, false)

			// 验证 abortTask 没有被调用
			expect(abortTaskSpy).not.toHaveBeenCalled()

			// 验证没有显示错误消息
			const errorMessages = (task as any).clineMessages.filter(
				(msg: any) => msg.type === "say" && msg.say === "error"
			)
			expect(errorMessages.length).toBe(0)
		})
	})

	describe("未达到检测阈值不应该触发", () => {
		it("文本长度未达到 2000 字符时不应该检测", async () => {
			// 创建短的重复文本（未达到 2000 字符阈值）
			const shortRepeatingText = "思考".repeat(50) // 只有 100 字符

			const chunkSize = 50
			const chunks: ApiStreamChunk[] = []
			for (let i = 0; i < shortRepeatingText.length; i += chunkSize) {
				chunks.push({
					type: "reasoning",
					text: shortRepeatingText.slice(i, i + chunkSize),
				})
			}
			chunks.push({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			const mockStream = createMockStream(chunks)

			const mockModel = {
				id: "gpt-4",
				info: {
					maxTokens: 4096,
					contextWindow: 8192,
					supportsPromptCache: false,
					supportsImages: false,
				},
			}

			vi.spyOn(mockProvider, "getApi").mockReturnValue({
				createMessage: vi.fn().mockImplementation(async function* () {
					yield* mockStream
				}),
				getModel: vi.fn().mockReturnValue(mockModel),
				validateApi: vi.fn().mockResolvedValue({ valid: true }),
			} as any)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableCheckpoints: false,
				task: "测试短文本",
				images: [],
				startTask: false,
			})

			const userContent = [{ type: "text" as const, text: "测试任务" }]
			const abortTaskSpy = vi.spyOn(task, "abortTask")

			await (task as any).recursivelyMakeClineRequests(userContent, false)

			// 验证 abortTask 没有被调用（因为未达到检测阈值）
			expect(abortTaskSpy).not.toHaveBeenCalled()
		})
	})
})
