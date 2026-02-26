import { describe, it, expect, beforeEach, vi } from "vitest"
import { MetricsService } from "../MetricsService"
import type { ClineMessage } from "@coder/types"

describe("MetricsService", () => {
	let metricsService: MetricsService
	const taskId = "test-task-id"

	beforeEach(() => {
		metricsService = new MetricsService(taskId, () => {})
	})

	describe("combineMessages", () => {
		it("should combine messages correctly", () => {
			const messages: ClineMessage[] = [
				{
					type: "say",
					say: "text",
					text: "hello",
					ts: 1,
				},
				{
					type: "say",
					say: "text",
					text: "world",
					ts: 2,
				},
			]

			const combined = metricsService.combineMessages(messages)
			expect(Array.isArray(combined)).toBe(true)
			expect(combined.length).toBeGreaterThan(0)
		})

		it("should handle empty messages array", () => {
			const combined = metricsService.combineMessages([])
			expect(Array.isArray(combined)).toBe(true)
		})
	})

	describe("recordToolUsage", () => {
		it("should initialize tool usage on first record", () => {
			metricsService.recordToolUsage("edit_file")
			const usage = metricsService.getToolUsage()

			expect(usage.edit_file).toBeDefined()
			expect(usage.edit_file?.attempts).toBe(1)
			expect(usage.edit_file?.failures).toBe(0)
		})

		it("should increment attempts count", () => {
			metricsService.recordToolUsage("edit_file")
			metricsService.recordToolUsage("edit_file")
			const usage = metricsService.getToolUsage()

			expect(usage.edit_file?.attempts).toBe(2)
		})

		it("should track multiple different tools", () => {
			metricsService.recordToolUsage("edit_file")
			metricsService.recordToolUsage("execute_command")

			const usage = metricsService.getToolUsage()
			expect(usage.edit_file?.attempts).toBe(1)
			expect(usage.execute_command?.attempts).toBe(1)
		})
	})

	describe("recordToolError", () => {
		it("should initialize tool usage on first error", () => {
			metricsService.recordToolError("edit_file")
			const usage = metricsService.getToolUsage()

			expect(usage.edit_file).toBeDefined()
			expect(usage.edit_file?.failures).toBe(1)
			expect(usage.edit_file?.attempts).toBe(0)
		})

		it("should increment failures count", () => {
			metricsService.recordToolError("edit_file")
			metricsService.recordToolError("edit_file")
			const usage = metricsService.getToolUsage()

			expect(usage.edit_file?.failures).toBe(2)
		})

		it("should emit toolFailed event when error message provided", () => {
			const toolFailedSpy = vi.fn()
			metricsService.on("toolFailed", toolFailedSpy)

			metricsService.recordToolError("edit_file", "permission denied")

			expect(toolFailedSpy).toHaveBeenCalledOnce()
			expect(toolFailedSpy).toHaveBeenCalledWith(taskId, "edit_file", "permission denied")
		})

		it("should not emit event when error message not provided", () => {
			const toolFailedSpy = vi.fn()
			metricsService.on("toolFailed", toolFailedSpy)

			metricsService.recordToolError("edit_file")

			expect(toolFailedSpy).not.toHaveBeenCalled()
		})

		it("should emit event with correct task ID", () => {
			const metricsService2 = new MetricsService("another-task", () => {})
			const toolFailedSpy = vi.fn()
			metricsService2.on("toolFailed", toolFailedSpy)

			metricsService2.recordToolError("edit_file", "error")

			expect(toolFailedSpy).toHaveBeenCalledWith("another-task", expect.any(String), expect.any(String))
		})
	})

	describe("getToolUsage", () => {
		it("should return a copy of tool usage", () => {
			metricsService.recordToolUsage("edit_file")
			const usage1 = metricsService.getToolUsage()
			const usage2 = metricsService.getToolUsage()

			expect(usage1).toEqual(usage2)
			expect(usage1).not.toBe(usage2) // Should be different objects
		})

		it("should not allow modification of internal state via returned copy", () => {
			metricsService.recordToolUsage("edit_file")
			const usage = metricsService.getToolUsage()

			// Try to modify the returned object
			if (usage.edit_file) {
				usage.edit_file.attempts = 999
			}

			// Internal state should not change
			const actualUsage = metricsService.getToolUsage()
			expect(actualUsage.edit_file?.attempts).toBe(1)
		})

		it("should return empty object when no tools recorded", () => {
			const usage = metricsService.getToolUsage()
			expect(Object.keys(usage).length).toBe(0)
		})
	})

	describe("resetToolUsage", () => {
		it("should reset all tool usage data", () => {
			metricsService.recordToolUsage("edit_file")
			metricsService.recordToolUsage("execute_command")
			metricsService.recordToolError("edit_file")

			metricsService.resetToolUsage()

			const usage = metricsService.getToolUsage()
			expect(Object.keys(usage).length).toBe(0)
		})

		it("should allow recording again after reset", () => {
			metricsService.recordToolUsage("edit_file")
			metricsService.resetToolUsage()
			metricsService.recordToolUsage("edit_file")

			const usage = metricsService.getToolUsage()
			expect(usage.edit_file?.attempts).toBe(1)
		})
	})

	describe("setToolUsage", () => {
		it("should update tool usage from external state", () => {
			const externalUsage = {
				edit_file: { attempts: 5, failures: 2 },
				execute_command: { attempts: 3, failures: 0 },
			}

			metricsService.setToolUsage(externalUsage)

			const usage = metricsService.getToolUsage()
			expect(usage.edit_file?.attempts).toBe(5)
			expect(usage.edit_file?.failures).toBe(2)
			expect(usage.execute_command?.attempts).toBe(3)
		})

		it("should replace existing usage data", () => {
			metricsService.recordToolUsage("edit_file")
			metricsService.recordToolUsage("read_file")

			const newUsage = {
				execute_command: { attempts: 1, failures: 0 },
			}

			metricsService.setToolUsage(newUsage)

			const usage = metricsService.getToolUsage()
			expect(usage.edit_file).toBeUndefined()
			expect(usage.read_file).toBeUndefined()
			expect(usage.execute_command?.attempts).toBe(1)
		})
	})

	describe("getTokenUsage", () => {
		it("should return token usage object", () => {
			const messages: ClineMessage[] = [
				{
					type: "say",
					say: "text",
					text: "test",
					ts: 1,
				},
			]

			const tokenUsage = metricsService.getTokenUsage(messages)

			expect(tokenUsage).toBeDefined()
			expect(typeof tokenUsage.totalTokensIn).toBe("number")
			expect(typeof tokenUsage.totalTokensOut).toBe("number")
			expect(typeof tokenUsage.totalCost).toBe("number")
			expect(typeof tokenUsage.contextTokens).toBe("number")
		})

		it("should handle empty messages array", () => {
			const tokenUsage = metricsService.getTokenUsage([])

			expect(tokenUsage).toBeDefined()
			expect(tokenUsage.totalTokensIn).toBe(0)
			expect(tokenUsage.totalTokensOut).toBe(0)
		})
	})

	describe("Combined workflow", () => {
		it("should track multiple operations in realistic scenario", () => {
			// Simulate a typical task workflow
			metricsService.recordToolUsage("read_file")
			metricsService.recordToolUsage("edit_file")
			metricsService.recordToolError("edit_file", "syntax error")
			metricsService.recordToolUsage("edit_file")
			metricsService.recordToolUsage("execute_command")

			const usage = metricsService.getToolUsage()

			expect(usage.read_file?.attempts).toBe(1)
			expect(usage.edit_file?.attempts).toBe(2)
			expect(usage.edit_file?.failures).toBe(1)
			expect(usage.execute_command?.attempts).toBe(1)
		})

		it("should emit multiple failure events", () => {
			const toolFailedSpy = vi.fn()
			metricsService.on("toolFailed", toolFailedSpy)

			metricsService.recordToolError("edit_file", "error 1")
			metricsService.recordToolError("execute_command", "error 2")

			expect(toolFailedSpy).toHaveBeenCalledTimes(2)
			expect(toolFailedSpy.mock.calls[0]).toEqual([taskId, "edit_file", "error 1"])
			expect(toolFailedSpy.mock.calls[1]).toEqual([taskId, "execute_command", "error 2"])
		})
	})
})
