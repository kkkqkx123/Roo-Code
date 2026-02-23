// npx vitest run src/integrations/terminal/__tests__/TerminalRegistry.spec.ts

import * as vscode from "vscode"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"
import { vi, describe, beforeEach, it, expect } from "vitest"

const PAGER = process.platform === "win32" ? "" : "cat"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("TerminalRegistry", () => {
	let mockCreateTerminal: any

	beforeEach(() => {
		mockCreateTerminal = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
			(...args: any[]) =>
				({
					exitStatus: undefined,
					name: "Coder",
					processId: Promise.resolve(123),
					creationOptions: {},
					state: {
						isInteractedWith: true,
						shell: { id: "test-shell", executable: "/bin/bash", args: [] },
					},
					dispose: vi.fn(),
					hide: vi.fn(),
					show: vi.fn(),
					sendText: vi.fn(),
					shellIntegration: {
						executeCommand: vi.fn(),
					},
				}) as any,
		)
	})

	describe("createTerminal", () => {
		it("creates terminal with PAGER set appropriately for platform", () => {
			TerminalRegistry.createTerminal("/test/path", "vscode")

			expect(mockCreateTerminal).toHaveBeenCalledWith({
				cwd: "/test/path",
				name: "Coder",
				iconPath: expect.any(Object),
				env: {
					PAGER,
					VTE_VERSION: "0",
					PROMPT_EOL_MARK: "",
				},
			})
		})

		it("adds PROMPT_COMMAND when Terminal.getCommandDelay() > 0", () => {
			// Set command delay to 50ms for this test
			const originalDelay = Terminal.getCommandDelay()
			Terminal.setCommandDelay(50)

			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Coder",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						PROMPT_COMMAND: "sleep 0.05",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
					},
				})
			} finally {
				// Restore original delay
				Terminal.setCommandDelay(originalDelay)
			}
		})

		it("adds Oh My Zsh integration env var when enabled", () => {
			Terminal.setTerminalZshOhMy(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Coder",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						ITERM_SHELL_INTEGRATION_INSTALLED: "Yes",
					},
				})
			} finally {
				Terminal.setTerminalZshOhMy(false)
			}
		})

		it("adds Powerlevel10k integration env var when enabled", () => {
			Terminal.setTerminalZshP10k(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Coder",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						POWERLEVEL9K_TERM_SHELL_INTEGRATION: "true",
					},
				})
			} finally {
				Terminal.setTerminalZshP10k(false)
			}
		})
	})

	describe("getOrCreateTerminal with directory change support", () => {
		let terminal1: Terminal
		let terminal2: Terminal

		beforeEach(() => {
			// Clear any existing terminals
			TerminalRegistry["terminals"] = []

			// Create real Terminal instances
			terminal1 = TerminalRegistry.createTerminal("/test/project", "vscode") as Terminal
			terminal2 = TerminalRegistry.createTerminal("/test/project", "vscode") as Terminal
		})

		it("should reuse terminal with exact directory match", async () => {
			terminal1.taskId = "task-1"
			terminal1.busy = false

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/project", "task-1", "vscode")

			expect(terminal.id).toBe(terminal1.id)
		})

		it("should reuse terminal when current directory is parent of target", async () => {
			terminal1.taskId = "task-1"
			terminal1.busy = false
			// Mock the current working directory to be parent
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test")

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/project", "task-1", "vscode")

			expect(terminal.id).toBe(terminal1.id)
		})

		it("should reuse terminal when current directory is child of target", async () => {
			terminal1.taskId = "task-1"
			terminal1.busy = false
			// Mock the current working directory to be child
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/project/src")

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/project", "task-1", "vscode")

			expect(terminal.id).toBe(terminal1.id)
		})

		it("should not reuse terminal for unrelated paths", async () => {
			terminal1.taskId = "task-1"
			terminal1.busy = false
			// Mock the current working directory to be unrelated
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/other/project")

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/project", "task-1", "vscode")

			// Should create a new terminal since paths are unrelated
			expect(terminal.id).not.toBe(terminal1.id)
			expect(terminal.id).toBeGreaterThan(terminal1.id)
		})

		it("should prefer task-bound terminal over background terminal", async () => {
			terminal1.taskId = "task-1"
			terminal1.busy = false
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/project")

			terminal2.taskId = undefined
			terminal2.busy = false
			vi.spyOn(terminal2, "getCurrentWorkingDirectory").mockReturnValue("/test/project")

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/project", "task-1", "vscode")

			expect(terminal.id).toBe(terminal1.id)
		})

		it("should prefer exact match over directory change", async () => {
			terminal1.taskId = "task-1"
			terminal1.busy = false
			vi.spyOn(terminal1, "getCurrentWorkingDirectory").mockReturnValue("/test/project")

			terminal2.taskId = "task-1"
			terminal2.busy = false
			vi.spyOn(terminal2, "getCurrentWorkingDirectory").mockReturnValue("/test")

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/project", "task-1", "vscode")

			// Should prefer exact match
			expect(terminal.id).toBe(terminal1.id)
		})
	})
})
