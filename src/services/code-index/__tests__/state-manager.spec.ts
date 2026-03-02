import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { CodeIndexStateManager } from "../state-manager"
import type { IndexingState } from "../state-manager"

// Mock vscode module
vi.mock("vscode", () => ({
	EventEmitter: class {
		private listeners: Array<(data: unknown) => void> = []

		event = (listener: (data: unknown) => void) => {
			this.listeners.push(listener)
			return { dispose: () => {} }
		}

		fire(data: unknown) {
			this.listeners.forEach((listener) => listener(data))
		}

		dispose() {
			this.listeners = []
		}
	},
}))

describe("CodeIndexStateManager", () => {
	let stateManager: CodeIndexStateManager

	beforeEach(() => {
		stateManager = new CodeIndexStateManager()
	})

	afterEach(() => {
		stateManager.dispose()
	})

	describe("initialization", () => {
		it("should initialize with Standby state", () => {
			expect(stateManager.state).toBe("Standby")
		})

		it("should have default status message", () => {
			const status = stateManager.getCurrentStatus()
			expect(status.systemStatus).toBe("Standby")
			expect(status.message).toBe("")
			expect(status.processedItems).toBe(0)
			expect(status.totalItems).toBe(0)
			expect(status.currentItemUnit).toBe("blocks")
		})
	})

	describe("state property", () => {
		it("should return current state", () => {
			expect(stateManager.state).toBe("Standby")
		})
	})

	describe("getCurrentStatus", () => {
		it("should return current status object", () => {
			const status = stateManager.getCurrentStatus()
			expect(status).toEqual({
				systemStatus: "Standby",
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "blocks",
			})
		})

		it("should reflect state changes in status", () => {
			stateManager.setSystemState("Indexing", "Starting indexing")
			const status = stateManager.getCurrentStatus()
			expect(status.systemStatus).toBe("Indexing")
			expect(status.message).toBe("Starting indexing")
		})
	})

	describe("setSystemState", () => {
		it("should transition to valid state", () => {
			expect(stateManager.setSystemState("Indexing")).toBeUndefined()
			expect(stateManager.state).toBe("Indexing")
		})

		it("should update status message", () => {
			stateManager.setSystemState("Indexing", "Starting indexing")
			const status = stateManager.getCurrentStatus()
			expect(status.message).toBe("Starting indexing")
		})

		it("should emit progress update event", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.setSystemState("Indexing", "Starting")
			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith({
				systemStatus: "Indexing",
				message: "Starting",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "blocks",
			})
		})

		it("should reset progress counters when transitioning to non-indexing state", () => {
			// First, report some progress
			stateManager.reportBlockIndexingProgress(50, 100)
			expect(stateManager.getCurrentStatus().processedItems).toBe(50)
			expect(stateManager.getCurrentStatus().totalItems).toBe(100)

			// Transition to Indexed
			stateManager.setSystemState("Indexed")
			const status = stateManager.getCurrentStatus()
			expect(status.processedItems).toBe(0)
			expect(status.totalItems).toBe(0)
			expect(status.currentItemUnit).toBe("blocks")
		})

		it("should set default message for Standby state", () => {
			stateManager.setSystemState("Indexing")
			stateManager.setSystemState("Indexed")
			stateManager.setSystemState("Standby")

			const status = stateManager.getCurrentStatus()
			expect(status.message).toBe("Ready.")
		})

		it("should set default message for Indexed state", () => {
			stateManager.setSystemState("Indexing")
			stateManager.setSystemState("Indexed")

			const status = stateManager.getCurrentStatus()
			expect(status.message).toBe("Index up-to-date.")
		})

		it("should set default message for Error state", () => {
			stateManager.setSystemState("Error")

			const status = stateManager.getCurrentStatus()
			expect(status.message).toBe("An error occurred.")
		})

		it("should prevent invalid state transitions", () => {
			const result = stateManager.setSystemState("Indexed")
			// Invalid transition from Standby -> Indexed should not happen
			expect(stateManager.state).toBe("Standby")
		})
	})

	describe("reportBlockIndexingProgress", () => {
		it("should transition to Indexing state and update progress", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportBlockIndexingProgress(25, 100)

			expect(stateManager.state).toBe("Indexing")
			const status = stateManager.getCurrentStatus()
			expect(status.processedItems).toBe(25)
			expect(status.totalItems).toBe(100)
			expect(status.currentItemUnit).toBe("blocks")
			expect(status.message).toContain("25 / 100")
		})

		it("should emit progress update on change", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportBlockIndexingProgress(25, 100)
			expect(listener).toHaveBeenCalledTimes(1)

			stateManager.reportBlockIndexingProgress(50, 100)
			expect(listener).toHaveBeenCalledTimes(2)

			// Check that the progress was actually updated
			const status = stateManager.getCurrentStatus()
			expect(status.processedItems).toBe(50)
		})

		it("should not emit progress update if values unchanged", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportBlockIndexingProgress(25, 100)
			expect(listener).toHaveBeenCalledTimes(1)

			// Report the same progress again
			stateManager.reportBlockIndexingProgress(25, 100)
			expect(listener).toHaveBeenCalledTimes(1) // No additional call
		})

		it("should not reset progress when staying in Indexing state", () => {
			stateManager.reportBlockIndexingProgress(50, 100)
			const firstStatus = stateManager.getCurrentStatus()
			expect(firstStatus.processedItems).toBe(50)

			stateManager.reportBlockIndexingProgress(75, 100)
			const secondStatus = stateManager.getCurrentStatus()
			expect(secondStatus.processedItems).toBe(75)
		})

		it("should preserve Migrating state when reporting block progress", () => {
			stateManager.setSystemState("Migrating")
			stateManager.reportBlockIndexingProgress(50, 100)

			expect(stateManager.state).toBe("Migrating")
			const status = stateManager.getCurrentStatus()
			expect(status.processedItems).toBe(50)
			expect(status.totalItems).toBe(100)
		})

		it("should not update progress when in Stopping state", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportBlockIndexingProgress(25, 100)
			expect(stateManager.getCurrentStatus().processedItems).toBe(25)

			// Transition to Stopping (valid from Indexing which was set by reportBlockIndexingProgress)
			stateManager.setSystemState("Stopping")
			const beforeCount = listener.mock.calls.length

			stateManager.reportBlockIndexingProgress(50, 100)

			// Progress should not change
			expect(stateManager.getCurrentStatus().processedItems).toBe(25)
			// No new event should be fired
			expect(listener.mock.calls.length).toBe(beforeCount)
		})

		it("should handle sequential progress updates", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportBlockIndexingProgress(10, 100)
			stateManager.reportBlockIndexingProgress(20, 100)
			stateManager.reportBlockIndexingProgress(30, 100)

			expect(stateManager.getCurrentStatus().processedItems).toBe(30)
			expect(listener).toHaveBeenCalledTimes(3)
		})
	})

	describe("reportFileQueueProgress", () => {
		it("should transition to Indexing state and update file progress", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportFileQueueProgress(5, 20, "test.ts")

			expect(stateManager.state).toBe("Indexing")
			const status = stateManager.getCurrentStatus()
			expect(status.processedItems).toBe(5)
			expect(status.totalItems).toBe(20)
			expect(status.currentItemUnit).toBe("files")
			expect(status.message).toContain("5 / 20")
			expect(status.message).toContain("test.ts")
		})

		it("should emit progress update event", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportFileQueueProgress(5, 20)
			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("should preserve Migrating state when reporting file progress", () => {
			stateManager.setSystemState("Migrating")
			stateManager.reportFileQueueProgress(5, 20)

			expect(stateManager.state).toBe("Migrating")
			const status = stateManager.getCurrentStatus()
			expect(status.processedItems).toBe(5)
			expect(status.totalItems).toBe(20)
			expect(status.currentItemUnit).toBe("files")
		})

		it("should not update progress when in Stopping state", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportFileQueueProgress(5, 20)
			expect(stateManager.getCurrentStatus().processedItems).toBe(5)

			// Transition to Stopping (valid from Indexing which was set by reportFileQueueProgress)
			stateManager.setSystemState("Stopping")
			const beforeCount = listener.mock.calls.length

			stateManager.reportFileQueueProgress(10, 20)

			// Progress should not change
			expect(stateManager.getCurrentStatus().processedItems).toBe(5)
			// No new event should be fired
			expect(listener.mock.calls.length).toBe(beforeCount)
		})

		it("should display correct message when processing files", () => {
			stateManager.reportFileQueueProgress(5, 20, "file.ts")
			const status = stateManager.getCurrentStatus()
			expect(status.message).toContain("Processing")
			expect(status.message).toContain("5 / 20")
			expect(status.message).toContain("file.ts")
		})

		it("should display finished message when all files processed", () => {
			stateManager.reportFileQueueProgress(20, 20)
			const status = stateManager.getCurrentStatus()
			expect(status.message).toContain("Finished processing 20")
		})

		it("should handle empty file queue", () => {
			stateManager.reportFileQueueProgress(0, 0)
			const status = stateManager.getCurrentStatus()
			expect(status.message).toContain("File queue processed")
		})

		it("should switch itemUnit from blocks to files", () => {
			stateManager.reportBlockIndexingProgress(50, 100)
			expect(stateManager.getCurrentStatus().currentItemUnit).toBe("blocks")

			stateManager.reportFileQueueProgress(5, 20)
			expect(stateManager.getCurrentStatus().currentItemUnit).toBe("files")
		})

		it("should handle optional currentFileBasename", () => {
			stateManager.reportFileQueueProgress(5, 20)
			const statusWithoutName = stateManager.getCurrentStatus()
			expect(statusWithoutName.message).toContain("...")

			// Report with a new filename and different progress
			stateManager.reportFileQueueProgress(6, 20, "newFile.ts")
			const statusWithName = stateManager.getCurrentStatus()
			expect(statusWithName.message).toContain("newFile.ts")
		})

		it("should emit events only on progress change", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.reportFileQueueProgress(5, 20)
			expect(listener).toHaveBeenCalledTimes(1)

			stateManager.reportFileQueueProgress(5, 20) // Same progress
			expect(listener).toHaveBeenCalledTimes(1) // No new event

			stateManager.reportFileQueueProgress(6, 20) // Different progress
			expect(listener).toHaveBeenCalledTimes(2) // New event fired
		})
	})

	describe("dispose", () => {
		it("should dispose resources", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.setSystemState("Indexing")
			expect(listener).toHaveBeenCalledTimes(1)

			stateManager.dispose()

			// After disposal, new state changes should not trigger events
			// (though the state machine might still function)
		})
	})

	describe("integration scenarios", () => {
		it("should handle typical indexing workflow", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			// Start indexing
			stateManager.setSystemState("Indexing", "Starting indexing process")
			expect(stateManager.state).toBe("Indexing")

			// Report progress
			stateManager.reportBlockIndexingProgress(25, 100)
			stateManager.reportBlockIndexingProgress(50, 100)
			stateManager.reportBlockIndexingProgress(100, 100)

			// Complete indexing
			stateManager.setSystemState("Indexed")
			const finalStatus = stateManager.getCurrentStatus()
			expect(finalStatus.systemStatus).toBe("Indexed")
			expect(finalStatus.processedItems).toBe(0) // Reset after completion
		})

		it("should handle error recovery", () => {
			stateManager.setSystemState("Indexing")
			stateManager.reportBlockIndexingProgress(50, 100)

			// Hit an error
			stateManager.setSystemState("Error", "Connection lost")
			const errorStatus = stateManager.getCurrentStatus()
			expect(errorStatus.systemStatus).toBe("Error")
			expect(errorStatus.processedItems).toBe(0) // Reset

			// Recover
			stateManager.setSystemState("Indexing", "Retrying")
			expect(stateManager.state).toBe("Indexing")
		})

		it("should handle migration workflow", () => {
			stateManager.setSystemState("Migrating")
			stateManager.reportBlockIndexingProgress(50, 200)
			expect(stateManager.state).toBe("Migrating") // Should stay in Migrating

			stateManager.reportFileQueueProgress(10, 50)
			expect(stateManager.state).toBe("Migrating") // Should stay in Migrating

			stateManager.setSystemState("Indexed")
			expect(stateManager.state).toBe("Indexed")
		})

		it("should handle stopping workflow", () => {
			const listener = vi.fn()
			stateManager.onProgressUpdate(listener)

			stateManager.setSystemState("Indexing")
			stateManager.reportBlockIndexingProgress(50, 100)

			const callCountBeforeStop = listener.mock.calls.length

			// Request stop
			stateManager.setSystemState("Stopping")

			// Try to report progress (should be ignored)
			stateManager.reportBlockIndexingProgress(75, 100)

			// No new progress events should fire
			expect(listener.mock.calls.length).toBe(callCountBeforeStop + 1) // Only the Stopping state change

			// Transition to Standby
			stateManager.setSystemState("Standby")
			expect(stateManager.state).toBe("Standby")
		})
	})

	describe("message handling", () => {
		it("should preserve custom message when provided", () => {
			stateManager.setSystemState("Indexing", "Custom message")
			expect(stateManager.getCurrentStatus().message).toBe("Custom message")
		})

		it("should set default message when not provided", () => {
			// Need to transition through valid states to reach Indexed from Standby
			stateManager.setSystemState("Indexing")
			stateManager.setSystemState("Indexed")
			expect(stateManager.getCurrentStatus().message).toBe("Index up-to-date.")
		})

		it("should update message with progress reports", () => {
			stateManager.reportBlockIndexingProgress(25, 100)
			const status = stateManager.getCurrentStatus()
			expect(status.message).toMatch(/Indexed 25 \/ 100 blocks found/)
		})

		it("should handle undefined message correctly", () => {
			stateManager.setSystemState("Indexing")
			expect(stateManager.getCurrentStatus().message).toBe("")
		})
	})
})
