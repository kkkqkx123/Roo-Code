/**
 * TerminalRegistry Integration Tests
 *
 * These tests directly use VSCode API (via mocks) to verify terminal reuse functionality.
 * They test the complete flow including:
 * - Terminal creation and registration
 * - Directory change support
 * - cd command parsing
 * - Terminal reuse with different directory relationships
 */

import * as vscode from "vscode"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { TerminalRegistry } from "../TerminalRegistry"
import { arePathsEqual, parseCdCommand, getPathRelation } from "../../../utils/path"

// Mock VSCode API
vi.mock("vscode", () => ({
	window: {
		createTerminal: vi.fn(),
		onDidCloseTerminal: vi.fn(),
		onDidStartTerminalShellExecution: vi.fn(),
		onDidEndTerminalShellExecution: vi.fn(),
	},
	Uri: {
		file: (path: string) => ({ fsPath: path }),
	},
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test-workspace",
				index: 0,
			},
		],
	},
	ThemeIcon: class ThemeIcon {
		constructor(public id: string) {}
	},
}))

describe("TerminalRegistry Integration Tests", () => {
	let mockTerminal: vscode.Terminal

	beforeEach(() => {
		// Reset TerminalRegistry state completely
		TerminalRegistry.cleanup()
		// Manually reset static properties that cleanup() doesn't clear
		;(TerminalRegistry as any).terminals = []
		;(TerminalRegistry as any).nextTerminalId = 1

		// Clear all mocks
		vi.clearAllMocks()

		// Create mock VSCode terminal
		mockTerminal = {
			name: "Test Terminal",
			processId: Promise.resolve(12345),
			sendText: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
			exitStatus: undefined,
			creationOptions: {},
			state: { isInteractedWith: false },
		} as any

		// Mock createTerminal to return our mock terminal
		vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal)
	})

	afterEach(() => {
		TerminalRegistry.cleanup()
		vi.clearAllMocks()
	})

	describe("Terminal Creation and Registration", () => {
		it("should create and register a terminal", () => {
			const terminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")

			expect(terminal).toBeDefined()
			expect(terminal.provider).toBe("vscode")
			expect(terminal.initialCwd).toBe("/test/workspace")
			expect(terminal.id).toBeGreaterThan(0)
		})

		it("should create multiple terminals with unique IDs", () => {
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			const terminal2 = TerminalRegistry.createTerminal("/test/workspace", "vscode")

			expect(terminal1.id).not.toBe(terminal2.id)
		})

		it("should track all registered terminals", () => {
			TerminalRegistry.createTerminal("/test/workspace", "vscode")
			TerminalRegistry.createTerminal("/test/other", "vscode")

			const terminals = TerminalRegistry.getTerminals(false)
			expect(terminals.length).toBe(2)
		})
	})

	describe("Terminal Reuse with Exact Directory Match", () => {
		it("should reuse terminal when requesting same directory", async () => {
			// Create first terminal
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"

			// Request terminal for same directory
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")

			// Should reuse the same terminal
			expect(terminal1.id).toBe(terminal2.id)
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)
		})

		it("should create new terminal when requesting different directory", async () => {
			// Create first terminal
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"

			// Request terminal for different directory
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/other", "task-1", "vscode")

			// Should create new terminal
			expect(terminal1.id).not.toBe(terminal2.id)
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2)
		})
	})

	describe("Terminal Reuse with Directory Change Support", () => {
		it("should reuse terminal when current directory is parent of target", async () => {
			// Create terminal in parent directory
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"

			// Mock the terminal's current working directory
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Request terminal for child directory
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/workspace/src", "task-1", "vscode")

			// Should reuse the same terminal (can cd into child)
			expect(terminal1.id).toBe(terminal2.id)
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)
		})

		it("should reuse terminal when current directory is child of target", async () => {
			// Create terminal in child directory
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace/src", "vscode")
			terminal1.taskId = "task-1"

			// Mock the terminal's current working directory
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace/src")

			// Request terminal for parent directory
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")

			// Should reuse the same terminal (can cd to parent)
			expect(terminal1.id).toBe(terminal2.id)
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)
		})

		it("should not reuse terminal for unrelated paths", async () => {
			// Create terminal in one directory
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"

			// Mock the terminal's current working directory
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Request terminal for completely different directory
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/other/project", "task-1", "vscode")

			// Should create new terminal
			expect(terminal1.id).not.toBe(terminal2.id)
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2)
		})
	})

	describe("Task-Bound Terminal Priority", () => {
		it("should prefer task-bound terminal over background terminal", async () => {
			// Create background terminal
			const backgroundTerminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			vi.spyOn(backgroundTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Create task-bound terminal
			const taskTerminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			taskTerminal.taskId = "task-1"
			vi.spyOn(taskTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Request terminal for same task
			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")

			// Should return task-bound terminal
			expect(terminal.id).toBe(taskTerminal.id)
			expect(terminal.id).not.toBe(backgroundTerminal.id)
		})

		it("should prefer exact match over directory change for task-bound terminal", async () => {
			// Create task-bound terminal in parent directory
			const parentTerminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			parentTerminal.taskId = "task-1"
			vi.spyOn(parentTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Create task-bound terminal in exact directory
			const exactTerminal = TerminalRegistry.createTerminal("/test/workspace/src", "vscode")
			exactTerminal.taskId = "task-1"
			vi.spyOn(exactTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace/src")

			// Request terminal for exact directory
			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/workspace/src", "task-1", "vscode")

			// Should return exact match terminal
			expect(terminal.id).toBe(exactTerminal.id)
			expect(terminal.id).not.toBe(parentTerminal.id)
		})
	})

	describe("Directory Change Counting", () => {
		it("should track directory changes", () => {
			const terminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")

			expect(terminal.directoryChangeCount).toBe(0)

			terminal.incrementDirectoryChangeCount()
			expect(terminal.directoryChangeCount).toBe(1)

			terminal.incrementDirectoryChangeCount()
			expect(terminal.directoryChangeCount).toBe(2)
		})

		it("should allow reuse when directory change count is below threshold", () => {
			const terminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")

			for (let i = 0; i < 4; i++) {
				terminal.incrementDirectoryChangeCount()
			}

			expect(terminal.shouldReuseForDirectoryChange()).toBe(true)
		})

		it("should not allow reuse when directory change count exceeds threshold", () => {
			const terminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")

			for (let i = 0; i < 5; i++) {
				terminal.incrementDirectoryChangeCount()
			}

			expect(terminal.shouldReuseForDirectoryChange()).toBe(false)
		})
	})

	describe("cd Command Parsing", () => {
		it("should parse simple cd command", () => {
			const result = parseCdCommand("cd /test/path", "/current/dir")
			expect(result).toBe("/test/path")
		})

		it("should parse cd with relative path", () => {
			const result = parseCdCommand("cd src", "/test/workspace")
			// On Windows, path.resolve returns Windows format
			const expected = process.platform === "win32" ? "E:\\test\\workspace\\src" : "/test/workspace/src"
			expect(result).toBe(expected)
		})

		it("should parse cd with parent directory", () => {
			const result = parseCdCommand("cd ..", "/test/workspace/src")
			// On Windows, path.resolve returns Windows format
			const expected = process.platform === "win32" ? "E:\\test\\workspace" : "/test/workspace"
			expect(result).toBe(expected)
		})

		it("should parse cd with nested relative path", () => {
			const result = parseCdCommand("cd ../other", "/test/workspace/src")
			// On Windows, path.resolve returns Windows format
			const expected = process.platform === "win32" ? "E:\\test\\workspace\\other" : "/test/other"
			expect(result).toBe(expected)
		})

		it("should return undefined for non-cd command", () => {
			const result = parseCdCommand("ls -la", "/test/workspace")
			expect(result).toBeUndefined()
		})

		it("should return undefined for cd with dash", () => {
			const result = parseCdCommand("cd -", "/test/workspace")
			expect(result).toBeUndefined()
		})

		it("should handle cd with spaces in path", () => {
			const result = parseCdCommand('cd "/test/path with spaces"', "/test/workspace")
			// Absolute paths are returned as-is (not resolved)
			expect(result).toBe("/test/path with spaces")
		})

		it("should be case insensitive for cd", () => {
			const result1 = parseCdCommand("CD /test/path", "/current/dir")
			const result2 = parseCdCommand("Cd /test/path", "/current/dir")
			expect(result1).toBe("/test/path")
			expect(result2).toBe("/test/path")
		})
	})

	describe("Path Relation Analysis", () => {
		it("should identify same paths", () => {
			const relation = getPathRelation("/test/workspace", "/test/workspace")
			expect(relation).toBe("same")
		})

		it("should identify parent-child relationship", () => {
			const relation = getPathRelation("/test/workspace", "/test/workspace/src")
			expect(relation).toBe("parent")
		})

		it("should identify child-parent relationship", () => {
			const relation = getPathRelation("/test/workspace/src", "/test/workspace")
			expect(relation).toBe("child")
		})

		it("should identify unrelated paths", () => {
			const relation = getPathRelation("/test/workspace", "/other/project")
			expect(relation).toBe("unrelated")
		})
	})

	describe("Terminal Cleanup", () => {
		it("should release terminals for a specific task", () => {
			// Create terminals for different tasks
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"

			const terminal2 = TerminalRegistry.createTerminal("/test/other", "vscode")
			terminal2.taskId = "task-2"

			const terminal3 = TerminalRegistry.createTerminal("/test/third", "vscode")
			terminal3.taskId = "task-1"

			// Release terminals for task-1
			TerminalRegistry.releaseTerminalsForTask("task-1")

			// Only task-2 terminal should remain (task-1 terminals should have taskId set to undefined)
			const remainingTerminals = TerminalRegistry.getTerminals(false)
			const task2Terminals = remainingTerminals.filter((t) => t.taskId === "task-2")
			expect(task2Terminals.length).toBe(1)
			expect(task2Terminals[0].taskId).toBe("task-2")
		})

		it("should cleanup all terminals", () => {
			TerminalRegistry.createTerminal("/test/workspace", "vscode")
			TerminalRegistry.createTerminal("/test/other", "vscode")

			// cleanup() doesn't clear terminals array, so we need to manually clear it
			TerminalRegistry.cleanup()
			;(TerminalRegistry as any).terminals = []

			const terminals = TerminalRegistry.getTerminals(false)
			expect(terminals.length).toBe(0)
		})
	})

	describe("Terminal Busy State", () => {
		it("should not reuse busy terminal", async () => {
			// Create terminal and mark as busy
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"
			terminal1.busy = true
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Request terminal for same directory
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")

			// Should create new terminal because first one is busy
			expect(terminal1.id).not.toBe(terminal2.id)
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2)
		})

		it("should reuse terminal after it becomes available", async () => {
			// Create terminal
			const terminal1 = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			terminal1.taskId = "task-1"
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Mark as busy
			terminal1.busy = true

			// Request terminal - should create new one
			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")
			expect(terminal1.id).not.toBe(terminal2.id)

			// Mark first terminal as available
			terminal1.busy = false

			// Request terminal again - should reuse first one
			const terminal3 = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")
			expect(terminal3.id).toBe(terminal1.id)
		})
	})

	describe("Terminal Provider Selection", () => {
		it("should create vscode provider terminal", () => {
			const terminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			expect(terminal.provider).toBe("vscode")
		})

		it("should create execa provider terminal", () => {
			const terminal = TerminalRegistry.createTerminal("/test/workspace", "execa")
			expect(terminal.provider).toBe("execa")
		})

		it("should not reuse terminal with different provider", async () => {
			// Create vscode terminal
			const vscodeTerminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			vi.spyOn(vscodeTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Request execa terminal for same directory
			const execaTerminal = await TerminalRegistry.getOrCreateTerminal("/test/workspace", undefined, "execa")

			// Should create new terminal with different provider
			expect(vscodeTerminal.id).not.toBe(execaTerminal.id)
			expect(execaTerminal.provider).toBe("execa")
		})
	})

	describe("Background Terminals", () => {
		it("should return background terminals", () => {
			// Create background terminal (no taskId)
			const backgroundTerminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			vi.spyOn(backgroundTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Create task-bound terminal
			const taskTerminal = TerminalRegistry.createTerminal("/test/other", "vscode")
			taskTerminal.taskId = "task-1"
			vi.spyOn(taskTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/other")

			// Get background terminals
			const backgroundTerminals = TerminalRegistry.getBackgroundTerminals(false)

			expect(backgroundTerminals.length).toBe(1)
			expect(backgroundTerminals[0].id).toBe(backgroundTerminal.id)
		})

		it("should reuse background terminal when no task-bound terminal available", async () => {
			// Create background terminal
			const backgroundTerminal = TerminalRegistry.createTerminal("/test/workspace", "vscode")
			vi.spyOn(backgroundTerminal, "getCurrentWorkingDirectory").mockReturnValue("/test/workspace")

			// Request terminal for new task
			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "vscode")

			// Should reuse background terminal
			expect(terminal.id).toBe(backgroundTerminal.id)
			expect(terminal.taskId).toBe("task-1")
		})
	})

	describe("Path Equality", () => {
		it("should handle different path separators", () => {
			const result = arePathsEqual("/test/workspace", "/test\\workspace")
			expect(result).toBe(true)
		})

		it("should normalize paths with ../", () => {
			const result = arePathsEqual("/test/workspace/src/../", "/test/workspace")
			expect(result).toBe(true)
		})

		it("should handle trailing slashes", () => {
			const result = arePathsEqual("/test/workspace/", "/test/workspace")
			expect(result).toBe(true)
		})
	})
})