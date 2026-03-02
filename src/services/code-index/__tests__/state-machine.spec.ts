import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { CodeIndexStateMachine } from "../state-machine"
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

describe("CodeIndexStateMachine", () => {
	let stateMachine: CodeIndexStateMachine

	beforeEach(() => {
		stateMachine = new CodeIndexStateMachine()
	})

	afterEach(() => {
		stateMachine.dispose()
	})

	describe("initialization", () => {
		it("should initialize with Standby state", () => {
			expect(stateMachine.getState()).toBe("Standby")
		})

		it("should have valid transitions from Standby state", () => {
			const validTransitions = stateMachine.getValidTransitions()
			expect(validTransitions).toContain("Indexing")
			expect(validTransitions).toContain("Migrating")
			expect(validTransitions).toContain("Error")
		})
	})

	describe("validateTransition", () => {
		it("should validate valid transitions", () => {
			expect(stateMachine.validateTransition("Standby", "Indexing")).toBe(true)
			expect(stateMachine.validateTransition("Standby", "Migrating")).toBe(true)
			expect(stateMachine.validateTransition("Standby", "Error")).toBe(true)
		})

		it("should reject invalid transitions", () => {
			expect(stateMachine.validateTransition("Standby", "Indexed")).toBe(false)
			expect(stateMachine.validateTransition("Standby", "Stopping")).toBe(false)
		})

		it("should validate all valid transitions from each state", () => {
			// From Indexing
			expect(stateMachine.validateTransition("Indexing", "Indexed")).toBe(true)
			expect(stateMachine.validateTransition("Indexing", "Stopping")).toBe(true)
			expect(stateMachine.validateTransition("Indexing", "Error")).toBe(true)

			// From Migrating
			expect(stateMachine.validateTransition("Migrating", "Indexed")).toBe(true)
			expect(stateMachine.validateTransition("Migrating", "Stopping")).toBe(true)
			expect(stateMachine.validateTransition("Migrating", "Error")).toBe(true)

			// From Indexed
			expect(stateMachine.validateTransition("Indexed", "Indexing")).toBe(true)
			expect(stateMachine.validateTransition("Indexed", "Migrating")).toBe(true)
			expect(stateMachine.validateTransition("Indexed", "Standby")).toBe(true)

			// From Stopping
			expect(stateMachine.validateTransition("Stopping", "Standby")).toBe(true)
			expect(stateMachine.validateTransition("Stopping", "Indexing")).toBe(false)

			// From Error
			expect(stateMachine.validateTransition("Error", "Standby")).toBe(true)
			expect(stateMachine.validateTransition("Error", "Indexing")).toBe(true)
			expect(stateMachine.validateTransition("Error", "Migrating")).toBe(true)
		})
	})

	describe("transition", () => {
		it("should successfully transition to a valid state", () => {
			const result = stateMachine.transition("Indexing")
			expect(result).toBe(true)
			expect(stateMachine.getState()).toBe("Indexing")
		})

		it("should fail to transition to an invalid state", () => {
			const result = stateMachine.transition("Indexed")
			expect(result).toBe(false)
			expect(stateMachine.getState()).toBe("Standby")
		})

		it("should emit state change event on successful transition", () => {
			const listener = vi.fn()
			stateMachine.onStateChange(listener)

			stateMachine.transition("Indexing")
			expect(listener).toHaveBeenCalledWith({
				oldState: "Standby",
				newState: "Indexing",
				message: undefined,
			})
		})

		it("should include message in state change event", () => {
			const listener = vi.fn()
			stateMachine.onStateChange(listener)

			stateMachine.transition("Indexing", "Starting indexing process")
			expect(listener).toHaveBeenCalledWith({
				oldState: "Standby",
				newState: "Indexing",
				message: "Starting indexing process",
			})
		})

		it("should not emit event on failed transition", () => {
			const listener = vi.fn()
			stateMachine.onStateChange(listener)

			stateMachine.transition("Indexed") // Invalid transition
			expect(listener).not.toHaveBeenCalled()
		})

		it("should handle multiple sequential transitions", () => {
			expect(stateMachine.transition("Indexing")).toBe(true)
			expect(stateMachine.getState()).toBe("Indexing")

			expect(stateMachine.transition("Indexed")).toBe(true)
			expect(stateMachine.getState()).toBe("Indexed")

			expect(stateMachine.transition("Indexing")).toBe(true)
			expect(stateMachine.getState()).toBe("Indexing")

			expect(stateMachine.transition("Error")).toBe(true)
			expect(stateMachine.getState()).toBe("Error")
		})

		it("should allow recovery from error state", () => {
			// From Standby -> Error
			stateMachine.transition("Error")
			expect(stateMachine.getState()).toBe("Error")

			// From Error -> Standby
			expect(stateMachine.transition("Standby")).toBe(true)
			expect(stateMachine.getState()).toBe("Standby")

			// From Standby -> Indexing (recovery)
			expect(stateMachine.transition("Indexing")).toBe(true)
			expect(stateMachine.getState()).toBe("Indexing")
		})
	})

	describe("getState", () => {
		it("should return current state", () => {
			expect(stateMachine.getState()).toBe("Standby")

			stateMachine.transition("Indexing")
			expect(stateMachine.getState()).toBe("Indexing")

			stateMachine.transition("Indexed")
			expect(stateMachine.getState()).toBe("Indexed")
		})
	})

	describe("getValidTransitions", () => {
		it("should return valid transitions from Standby", () => {
			const valid = stateMachine.getValidTransitions()
			expect(new Set(valid)).toEqual(new Set(["Indexing", "Migrating", "Error"]))
		})

		it("should return valid transitions from Indexing", () => {
			stateMachine.transition("Indexing")
			const valid = stateMachine.getValidTransitions()
			expect(new Set(valid)).toEqual(new Set(["Indexed", "Stopping", "Error"]))
		})

		it("should return valid transitions from Indexed", () => {
			stateMachine.transition("Indexing")
			stateMachine.transition("Indexed")
			const valid = stateMachine.getValidTransitions()
			expect(new Set(valid)).toEqual(new Set(["Indexing", "Migrating", "Standby"]))
		})

		it("should return valid transitions from Migrating", () => {
			stateMachine.transition("Migrating")
			const valid = stateMachine.getValidTransitions()
			expect(new Set(valid)).toEqual(new Set(["Indexed", "Stopping", "Error"]))
		})

		it("should return valid transitions from Stopping", () => {
			stateMachine.transition("Indexing")
			stateMachine.transition("Stopping")
			const valid = stateMachine.getValidTransitions()
			expect(valid).toEqual(["Standby"])
		})

		it("should return valid transitions from Error", () => {
			stateMachine.transition("Error")
			const valid = stateMachine.getValidTransitions()
			expect(new Set(valid)).toEqual(new Set(["Standby", "Indexing", "Migrating"]))
		})
	})

	describe("event handling", () => {
		it("should notify multiple listeners of state change", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			stateMachine.onStateChange(listener1)
			stateMachine.onStateChange(listener2)

			stateMachine.transition("Indexing")

			expect(listener1).toHaveBeenCalledTimes(1)
			expect(listener2).toHaveBeenCalledTimes(1)
		})

		it("should dispose of event listeners", () => {
			const listener = vi.fn()
			stateMachine.onStateChange(listener)

			stateMachine.transition("Indexing")
			expect(listener).toHaveBeenCalledTimes(1)

			stateMachine.dispose()

			// After disposal, no new events should fire
			const result = stateMachine.transition("Indexed")
			// Note: The transition itself might still work, but listeners shouldn't fire
			expect(listener).toHaveBeenCalledTimes(1) // Still only once
		})
	})

	describe("edge cases", () => {
		it("should handle self-loops where applicable", () => {
			// Most states shouldn't allow self-loops
			expect(stateMachine.validateTransition("Standby", "Standby")).toBe(false)
		})

		it("should prevent invalid state transitions in a sequence", () => {
			stateMachine.transition("Indexing")
			expect(stateMachine.getState()).toBe("Indexing")

			// Try to go directly from Indexing to Standby (invalid)
			expect(stateMachine.transition("Standby")).toBe(false)
			expect(stateMachine.getState()).toBe("Indexing")

			// Valid path: Indexing -> Indexed -> Standby
			expect(stateMachine.transition("Indexed")).toBe(true)
			expect(stateMachine.transition("Standby")).toBe(true)
			expect(stateMachine.getState()).toBe("Standby")
		})

		it("should maintain state consistency through complex transitions", () => {
			const transitions: IndexingState[] = [
				"Indexing",
				"Indexed",
				"Migrating",
				"Indexed",
				"Standby",
				"Indexing",
				"Stopping",
				"Standby",
				"Error",
				"Indexing",
				"Indexed",
			]

			for (const targetState of transitions) {
				const result = stateMachine.transition(targetState)
				expect(result).toBe(true)
				expect(stateMachine.getState()).toBe(targetState)
			}
		})
	})
})
