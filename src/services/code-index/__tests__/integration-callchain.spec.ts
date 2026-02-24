// npx vitest run services/code-index/__tests__/integration-callchain.spec.ts
// Integration test: Verify the complete call chain from webviewMessageHandler -> Manager -> Orchestrator

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { CodeIndexManager } from "../manager"
import { CodeIndexOrchestrator } from "../orchestrator"
import { CodeIndexConfigManager } from "../config-manager"
import { CodeIndexStateManager } from "../state-manager"
import type { ContextProxy } from "../../../core/config/ContextProxy"

// Mock vscode module
vi.mock("vscode", () => {
	const path = require("path")
	const testWorkspacePath = path.join(path.sep, "test", "workspace")
	
	class MockEventEmitter<T> {
		private listeners: ((e: T) => any)[] = []
		event = vi.fn((callback: (e: T) => any) => {
			this.listeners.push(callback)
			return {
				dispose: vi.fn(() => {
					const index = this.listeners.indexOf(callback)
					if (index > -1) {
						this.listeners.splice(index, 1)
					}
				}),
			}
		})
		fire = (event: T) => {
			this.listeners.forEach((listener) => listener(event))
		}
		dispose = vi.fn(() => {
			this.listeners = []
		})
	}
	
	return {
		EventEmitter: MockEventEmitter,
		window: {
			activeTextEditor: null,
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: testWorkspacePath, toString: () => `file://${testWorkspacePath}` },
					name: "test",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn().mockReturnValue({
				onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				dispose: vi.fn(),
			}),
			getWorkspaceFolder: vi.fn(),
		},
		RelativePattern: vi.fn().mockImplementation((base: string, pattern: string) => ({ base, pattern })),
		Uri: {
			file: (p: string) => ({
				fsPath: p,
				scheme: "file",
				authority: "",
				path: p,
				toString: (_skipEncoding?: boolean) => `file://${p}`,
			}),
		},
	}
})

// Mock CodeIndexStateManager
vi.mock("../state-manager", () => ({
	CodeIndexStateManager: vi.fn().mockImplementation(() => {
		let state = "Standby"
		return {
			get state() {
				return state
			},
			set state(value: string) {
				state = value
			},
			setSystemState: vi.fn().mockImplementation((newState: string, _msg: string) => {
				state = newState
			}),
			getCurrentStatus: vi.fn().mockReturnValue({
				systemStatus: "Standby",
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "blocks",
			}),
			reportFileQueueProgress: vi.fn(),
			reportBlockIndexingProgress: vi.fn(),
			onProgressUpdate: vi.fn(),
			dispose: vi.fn(),
		}
	}),
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: any) => {
		if (key === "embeddings:orchestrator.indexingRequiresWorkspace") {
			return "Indexing requires a workspace folder to be open."
		}
		if (key === "embeddings:orchestrator.indexingStopped") {
			return "Indexing stopped"
		}
		if (key === "embeddings:orchestrator.failedDuringInitialScan" && params?.errorMessage) {
			return `Failed during initial scan: ${params.errorMessage}`
		}
		return key
	},
}))

// Mock fs/promises for RooIgnoreController
vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockRejectedValue(new Error("File not found")),
	},
}))

// Mock file utils
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
}))

// Mock path utils
vi.mock("../../../utils/path", () => {
	const testPath = require("path")
	const testWorkspacePath = testPath.join(testPath.sep, "test", "workspace")
	return {
		getWorkspacePath: vi.fn(() => testWorkspacePath),
	}
})

describe("Code Index Integration Tests - Call Chain Verification", () => {
	const workspacePath = "/test/workspace"

	let mockContext: any
	let mockContextProxy: ContextProxy
	let mockConfigManager: any
	let mockOrchestrator: any
	let mockSearchService: any
	let mockCacheManager: any
	let mockVectorStore: any
	let mockScanner: any
	let mockFileWatcher: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Clear all manager instances
		CodeIndexManager.disposeAll()

		// Mock VSCode extension context
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
			workspaceState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
			},
			extensionPath: "/mock/extension",
		}

		// Mock ContextProxy
		mockContextProxy = {
			getGlobalState: vi.fn((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://localhost:6333",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexOpenAiNativeApiKey: "test-key",
					}
				}
				return undefined
			}),
		} as any as ContextProxy

		// Create mock service instances
		mockVectorStore = {
			initialize: vi.fn().mockResolvedValue(false),
			collectionExists: vi.fn().mockResolvedValue(true),
			hasIndexedData: vi.fn().mockResolvedValue(true),
			markIndexingIncomplete: vi.fn().mockResolvedValue(undefined),
			markIndexingComplete: vi.fn().mockResolvedValue(undefined),
			clearCollection: vi.fn().mockResolvedValue(undefined),
			setCollectionConfigFromEstimation: vi.fn().mockResolvedValue(undefined),
		}

		mockScanner = {
			scanDirectory: vi.fn().mockResolvedValue({
				stats: { filesScanned: 0, blocksIndexed: 0 },
			}),
		}

		mockFileWatcher = {
			initialize: vi.fn().mockResolvedValue(undefined),
			onDidStartBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onBatchProgressUpdate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidFinishBatchProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			dispose: vi.fn(),
		}

		mockCacheManager = {
			clearCacheFile: vi.fn().mockResolvedValue(undefined),
			flush: vi.fn().mockResolvedValue(undefined),
		}

		mockConfigManager = {
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			isConfigured: vi.fn().mockReturnValue(true),
			loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: false }),
		}

		mockSearchService = {
			search: vi.fn(),
		}

		// Create orchestrator mock with mutable state
		let orchestratorState = "Standby"
		mockOrchestrator = {
			get state() {
				return orchestratorState
			},
			set state(value: string) {
				orchestratorState = value
			},
			startIndexing: vi.fn().mockResolvedValue(undefined),
			stopIndexing: vi.fn(),
			stopWatcher: vi.fn(),
		}
	})

	afterEach(() => {
		CodeIndexManager.disposeAll()
	})

	describe("Manager -> Orchestrator Call Chain", () => {
		it("should successfully call orchestrator.startIndexing from manager.startIndexing", async () => {
			// Arrange: Create manager with mocked dependencies
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!

			// Inject mock dependencies directly
			;(manager as any)._configManager = mockConfigManager
			;(manager as any)._orchestrator = mockOrchestrator
			;(manager as any)._searchService = mockSearchService
			;(manager as any)._cacheManager = mockCacheManager

			// Mock isWorkspaceEnabled to return true
			Object.defineProperty(manager, "isWorkspaceEnabled", {
				get: () => true,
				configurable: true,
			})

			// Act: Call startIndexing
			await manager.startIndexing()

			// Assert: Verify the call chain
			expect(mockOrchestrator.startIndexing).toHaveBeenCalledTimes(1)
			expect(mockOrchestrator.startIndexing).toHaveBeenCalledWith(false)
		})

		it("should NOT call orchestrator when feature is disabled", async () => {
			// Arrange: Disable feature
			mockConfigManager.isFeatureEnabled = false

			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			;(manager as any)._configManager = mockConfigManager
			;(manager as any)._orchestrator = mockOrchestrator
			;(manager as any)._searchService = mockSearchService
			;(manager as any)._cacheManager = mockCacheManager

			// Act
			await manager.startIndexing()

			// Assert: Orchestrator should NOT be called
			expect(mockOrchestrator.startIndexing).not.toHaveBeenCalled()
		})

		it("should NOT call orchestrator when workspace is disabled", async () => {
			// Arrange: Disable workspace indexing
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			;(manager as any)._configManager = mockConfigManager
			;(manager as any)._orchestrator = mockOrchestrator
			;(manager as any)._searchService = mockSearchService
			;(manager as any)._cacheManager = mockCacheManager

			// Mock isWorkspaceEnabled to return false
			Object.defineProperty(manager, "isWorkspaceEnabled", {
				get: () => false,
				configurable: true,
			})

			// Act
			await manager.startIndexing()

			// Assert: Orchestrator should NOT be called
			expect(mockOrchestrator.startIndexing).not.toHaveBeenCalled()
		})

		it("should pass isRetryAfterError=true when in Error state", async () => {
			// Arrange: Create manager and set up mocks
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			;(manager as any)._configManager = mockConfigManager
			;(manager as any)._orchestrator = mockOrchestrator
			;(manager as any)._searchService = mockSearchService
			;(manager as any)._cacheManager = mockCacheManager

			// Mock isWorkspaceEnabled to return true
			Object.defineProperty(manager, "isWorkspaceEnabled", {
				get: () => true,
				configurable: true,
			})

			// Mock getCurrentStatus to return Error state
			manager.getCurrentStatus = vi.fn().mockReturnValue({ systemStatus: "Error" })

			// Act
			await manager.startIndexing()

			// Assert: Should pass isRetryAfterError=true
			expect(mockOrchestrator.startIndexing).toHaveBeenCalledWith(true)
		})

		it("should call assertInitialized before calling orchestrator", async () => {
			// Arrange: Create manager without orchestrator
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			;(manager as any)._configManager = mockConfigManager
			;(manager as any)._orchestrator = undefined
			;(manager as any)._searchService = undefined
			;(manager as any)._cacheManager = undefined

			// Mock isWorkspaceEnabled to return true
			Object.defineProperty(manager, "isWorkspaceEnabled", {
				get: () => true,
				configurable: true,
			})

			// Act & Assert: Should throw when assertInitialized fails
			await expect(manager.startIndexing()).rejects.toThrow("CodeIndexManager not initialized")
		})
	})

	describe("Orchestrator Start Indexing Flow", () => {
		it("should reject when workspace is not available", async () => {
			// Arrange: Mock no workspace folders
			const vscode = await import("vscode")
			const originalWorkspaceFolders = vscode.workspace.workspaceFolders
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(undefined as any)

			// Create real state manager
			const realStateManager = new CodeIndexStateManager()

			const orchestrator = new CodeIndexOrchestrator(
				mockConfigManager,
				realStateManager,
				workspacePath,
				mockCacheManager,
				mockVectorStore,
				mockScanner,
				mockFileWatcher,
			)

			// Act
			await orchestrator.startIndexing()

			// Assert: State should be set to Error
			expect(realStateManager.setSystemState).toHaveBeenCalledWith(
				"Error",
				expect.stringContaining("workspace"),
			)

			// Restore
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(originalWorkspaceFolders)
		})

		it("should reject when not configured", async () => {
			// Arrange: Mock not configured
			mockConfigManager.isFeatureConfigured = false

			const realStateManager = new CodeIndexStateManager()

			const orchestrator = new CodeIndexOrchestrator(
				mockConfigManager,
				realStateManager,
				workspacePath,
				mockCacheManager,
				mockVectorStore,
				mockScanner,
				mockFileWatcher,
			)

			// Act
			await orchestrator.startIndexing()

			// Assert: State should be set to Standby with configuration message
			expect(realStateManager.setSystemState).toHaveBeenCalledWith(
				"Standby",
				expect.stringContaining("configuration"),
			)
		})

		it("should reject when already processing", async () => {
			// Arrange: Create orchestrator and set processing flag
			const realStateManager = new CodeIndexStateManager()

			const orchestrator = new CodeIndexOrchestrator(
				mockConfigManager,
				realStateManager,
				workspacePath,
				mockCacheManager,
				mockVectorStore,
				mockScanner,
				mockFileWatcher,
			)
			;(orchestrator as any)._isProcessing = true

			// Act
			await orchestrator.startIndexing()

			// Assert: Should not proceed
			expect(realStateManager.setSystemState).not.toHaveBeenCalledWith("Indexing", expect.anything())
		})

		it("should reject when state is not Standby, Error, or Indexed", async () => {
			// Arrange: Create orchestrator and set invalid state
			const realStateManager = new CodeIndexStateManager()
			// Set state to Indexing by calling setSystemState
			realStateManager.setSystemState("Indexing", "Test indexing")

			const orchestrator = new CodeIndexOrchestrator(
				mockConfigManager,
				realStateManager,
				workspacePath,
				mockCacheManager,
				mockVectorStore,
				mockScanner,
				mockFileWatcher,
			)

			// Act
			await orchestrator.startIndexing()

			// Assert: Should only be called once with "Indexing" state (during setup), not again
			// The first call is from setSystemState("Indexing", "Test indexing")
			// If startIndexing proceeds, it would call setSystemState again with different message
			const indexingCalls = (realStateManager.setSystemState as any).mock.calls.filter(
				(call: any) => call[0] === "Indexing" && call[1] === "Initializing services...",
			)
			expect(indexingCalls.length).toBe(0)
		})

		it("should set state to Indexing when all checks pass", async () => {
			// Arrange: All checks pass
			mockVectorStore.initialize.mockResolvedValue(false)
			mockVectorStore.hasIndexedData.mockResolvedValue(true)

			const realStateManager = new CodeIndexStateManager()

			const orchestrator = new CodeIndexOrchestrator(
				mockConfigManager,
				realStateManager,
				workspacePath,
				mockCacheManager,
				mockVectorStore,
				mockScanner,
				mockFileWatcher,
			)

			// Act
			await orchestrator.startIndexing()

			// Assert: State should be set to Indexing
			expect(realStateManager.setSystemState).toHaveBeenCalledWith("Indexing", "Initializing services...")
		})
	})

	describe("Full Integration: Simulated webviewMessageHandler flow", () => {
		it("should complete the full call chain when all conditions are met", async () => {
			// Simulate the flow from webviewMessageHandler:
			// 1. Get manager
			// 2. Set workspace enabled
			// 3. Initialize
			// 4. Check conditions
			// 5. Call startIndexing

			// Arrange: Create real manager with mocked dependencies
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!

			// Mock workspaceState to return true for isWorkspaceEnabled
			mockContext.workspaceState.get = vi.fn().mockReturnValue(true)

			// Mock initialize to set up config manager
			manager.initialize = vi.fn().mockImplementation(async (ctx: ContextProxy) => {
				;(manager as any)._configManager = mockConfigManager
				;(manager as any)._orchestrator = mockOrchestrator
				;(manager as any)._searchService = mockSearchService
				;(manager as any)._cacheManager = mockCacheManager
				return { requiresRestart: false }
			})

			// Act: Simulate webviewMessageHandler flow
			await manager.initialize(mockContextProxy)

			// Verify setup
			expect((manager as any)._configManager).toBeDefined()
			expect((manager as any)._orchestrator).toBeDefined()
			expect((manager as any)._cacheManager).toBeDefined()
			
			// Verify properties
			expect(manager.isFeatureEnabled).toBe(true)
			expect(manager.isFeatureConfigured).toBe(true)
			expect((manager as any)._orchestrator?.state).toBe("Standby")

			// Check conditions (as done in webviewMessageHandler)
			if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
				const currentState = (manager as any)._orchestrator?.state
				if (currentState === "Standby" || currentState === "Error") {
					await manager.startIndexing()
				}
			}

			// Assert: Verify full call chain completed
			expect(manager.initialize).toHaveBeenCalled()
			expect(mockOrchestrator.startIndexing).toHaveBeenCalledTimes(1)
		})

		it("should skip startIndexing when feature is not enabled", async () => {
			// Arrange: Feature disabled
			mockConfigManager.isFeatureEnabled = false

			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			manager.initialize = vi.fn().mockImplementation(async () => {
				;(manager as any)._configManager = mockConfigManager
				;(manager as any)._orchestrator = mockOrchestrator
				;(manager as any)._searchService = mockSearchService
				;(manager as any)._cacheManager = mockCacheManager
				return { requiresRestart: false }
			})

			// Act
			await manager.initialize(mockContextProxy)

			// Check conditions
			if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
				await manager.startIndexing()
			}

			// Assert: startIndexing should NOT be called
			expect(mockOrchestrator.startIndexing).not.toHaveBeenCalled()
		})

		it("should skip startIndexing when feature is not configured", async () => {
			// Arrange: Not configured
			mockConfigManager.isFeatureConfigured = false

			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			manager.initialize = vi.fn().mockImplementation(async () => {
				;(manager as any)._configManager = mockConfigManager
				;(manager as any)._orchestrator = mockOrchestrator
				;(manager as any)._searchService = mockSearchService
				;(manager as any)._cacheManager = mockCacheManager
				return { requiresRestart: false }
			})

			// Act
			await manager.initialize(mockContextProxy)

			// Check conditions
			if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
				await manager.startIndexing()
			}

			// Assert: startIndexing should NOT be called
			expect(mockOrchestrator.startIndexing).not.toHaveBeenCalled()
		})

		it("should skip startIndexing when state is not Standby or Error", async () => {
			// Arrange: Invalid state
			mockOrchestrator.state = "Indexing"

			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			manager.initialize = vi.fn().mockImplementation(async () => {
				;(manager as any)._configManager = mockConfigManager
				;(manager as any)._orchestrator = mockOrchestrator
				;(manager as any)._searchService = mockSearchService
				;(manager as any)._cacheManager = mockCacheManager
				return { requiresRestart: false }
			})

			// Act
			await manager.initialize(mockContextProxy)

			// Check conditions
			if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
				const currentState = (manager as any)._orchestrator?.state
				if (currentState === "Standby" || currentState === "Error") {
					await manager.startIndexing()
				}
			}

			// Assert: startIndexing should NOT be called
			expect(mockOrchestrator.startIndexing).not.toHaveBeenCalled()
		})
	})
})
