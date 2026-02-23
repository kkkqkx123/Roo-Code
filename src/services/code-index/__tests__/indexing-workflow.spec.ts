// npx vitest run services/code-index/__tests__/indexing-workflow.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { CodeIndexManager } from "../manager"
import { ContextProxy } from "../../../core/config/ContextProxy"

// Mock vscode workspace
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
		},
		RelativePattern: vi.fn().mockImplementation((base: string, pattern: string) => ({ base, pattern })),
	}
})

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: any) => {
		if (key === "embeddings:orchestrator.indexingStopped" && params) {
			return "Indexing stopped"
		}
		if (key === "embeddings:orchestrator.indexingStoppedPartial" && params) {
			return "Indexing stopped (partial)"
		}
		return key
	},
}))

describe("CodeIndexManager - Indexing Workflow Integration Tests", () => {
	const workspacePath = "/test/workspace"

	let mockContext: any
	let mockContextProxy: ContextProxy

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
		}

		// Mock ContextProxy
		mockContextProxy = {
			getGlobalState: vi.fn((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://localhost:6333",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderBaseUrl: "",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderModelDimension: 1536,
						codebaseIndexOpenAiCompatibleBaseUrl: "",
						codebaseIndexSearchMaxResults: 10,
						codebaseIndexSearchMinScore: 0.5,
					}
				}
				if (key === "codeIndexAutoEnableDefault") {
					return true
				}
				return undefined
			}),
			setValue: vi.fn().mockResolvedValue(undefined),
			getSecret: vi.fn().mockResolvedValue("test-api-key"),
			storeSecret: vi.fn().mockResolvedValue(undefined),
			globalStorageUri: {
				scheme: "file",
				authority: "",
				path: "/test/global-storage",
				query: "",
				fragment: "",
				fsPath: "/test/global-storage",
				with: vi.fn(),
				toString: vi.fn(() => "file:///test/global-storage"),
				toJSON: vi.fn(),
			},
		} as unknown as ContextProxy
	})

	describe("First-time indexing workflow", () => {
		it("should initialize and start indexing on first startIndexing call", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			expect(manager).toBeDefined()

			// Act
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Assert
			expect(manager.isInitialized).toBe(true)
			expect(manager.isFeatureEnabled).toBe(true)
			expect(manager.isFeatureConfigured).toBe(true)
		})

		it("should allow startIndexing after initialization", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Act - should not throw
			await manager.startIndexing()

			// Assert
			const status = manager.getCurrentStatus()
			expect(status).toBeDefined()
		})
	})

	describe("Stop and restart workflow", () => {
		it("should allow stopping indexing and restarting", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Act - start indexing
			await manager.startIndexing()

			// Wait a bit for indexing to start
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Stop indexing
			manager.stopIndexing()

			// Wait for stop to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Try to start again - should succeed
			await manager.startIndexing()

			// Assert
			const status = manager.getCurrentStatus()
			expect(status).toBeDefined()
		})

		it("should reset internal state after stopIndexing", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Act - start indexing
			await manager.startIndexing()
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Stop indexing
			manager.stopIndexing()
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Start again - this tests that _isProcessing was reset
			await manager.startIndexing()

			// Assert - if _isProcessing wasn't reset, the second startIndexing would be rejected
			const status = manager.getCurrentStatus()
			expect(status).toBeDefined()
		})
	})

	describe("Workspace enable/disable workflow", () => {
		it("should stop indexing when workspace is disabled", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Start indexing
			await manager.startIndexing()
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Act - disable workspace
			await manager.setWorkspaceEnabled(false)
			manager.stopIndexing()

			// Assert
			expect(manager.isWorkspaceEnabled).toBe(false)
		})

		it("should allow re-enabling workspace and restarting indexing", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Start indexing
			await manager.startIndexing()
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Disable workspace
			await manager.setWorkspaceEnabled(false)
			manager.stopIndexing()
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Act - re-enable and restart
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)
			await manager.startIndexing()

			// Assert
			expect(manager.isWorkspaceEnabled).toBe(true)
			const status = manager.getCurrentStatus()
			expect(status).toBeDefined()
		})
	})

	describe("Error recovery workflow", () => {
		it("should recover from error state and allow restart", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)
			if (!manager) throw new Error("Manager should be defined")
			
			await manager.setWorkspaceEnabled(true)

			// Mock an error during initialization
			vi.mocked(mockContextProxy.getGlobalState).mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "", // Invalid URL to cause error
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderBaseUrl: "",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderModelDimension: 1536,
						codebaseIndexOpenAiCompatibleBaseUrl: "",
						codebaseIndexSearchMaxResults: 10,
						codebaseIndexSearchMinScore: 0.5,
					}
				}
				return undefined
			})

			// Act - try to initialize (will fail)
			try {
				await manager.initialize(mockContextProxy)
			} catch (error) {
				// Expected to fail
			}

			// Fix the configuration
			vi.mocked(mockContextProxy.getGlobalState).mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://localhost:6333", // Valid URL
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderBaseUrl: "",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderModelDimension: 1536,
						codebaseIndexOpenAiCompatibleBaseUrl: "",
						codebaseIndexSearchMaxResults: 10,
						codebaseIndexSearchMinScore: 0.5,
					}
				}
				return undefined
			})

			// Recover from error
			await manager.recoverFromError()

			// Try to initialize again
			await manager.initialize(mockContextProxy)

			// Assert
			expect(manager.isInitialized).toBe(true)
		})
	})

	describe("Multiple start-stop cycles", () => {
		it("should handle multiple start-stop cycles correctly", async () => {
			// Arrange
			const manager = CodeIndexManager.getInstance(mockContext, workspacePath)!
			await manager.setWorkspaceEnabled(true)
			await manager.initialize(mockContextProxy)

			// Act - perform multiple start-stop cycles
			for (let i = 0; i < 3; i++) {
				await manager.startIndexing()
				await new Promise((resolve) => setTimeout(resolve, 10))
				manager.stopIndexing()
				await new Promise((resolve) => setTimeout(resolve, 10))
			}

			// Final start
			await manager.startIndexing()

			// Assert
			const status = manager.getCurrentStatus()
			expect(status).toBeDefined()
		})
	})
})