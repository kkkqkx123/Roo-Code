// npx vitest utils/__tests__/streaming-token-counter.spec.ts

import { describe, it, expect, beforeEach } from "vitest"
import { StreamingTokenCounter } from "../tiktoken"

describe("StreamingTokenCounter", () => {
	let counter: StreamingTokenCounter

	beforeEach(() => {
		counter = new StreamingTokenCounter()
	})

	describe("addText", () => {
		it("should return 0 for empty text", () => {
			const result = counter.addText("")
			expect(result).toBe(0)
			expect(counter.getTotalTokens()).toBe(0)
		})

		it("should count tokens for a single text addition", () => {
			const text = "Hello, world!"
			const result = counter.addText(text)
			expect(result).toBeGreaterThan(0)
			expect(counter.getTotalTokens()).toBe(result)
		})

		it("should incrementally count tokens for multiple additions", () => {
			const text1 = "Hello"
			const text2 = ", "
			const text3 = "world!"

			const tokens1 = counter.addText(text1)
			const tokens2 = counter.addText(text2)
			const tokens3 = counter.addText(text3)

			expect(tokens1).toBeGreaterThan(0)
			expect(tokens2).toBeGreaterThan(0)
			expect(tokens3).toBeGreaterThan(0)

			const total = counter.getTotalTokens()
			expect(total).toBe(tokens1 + tokens2 + tokens3)
		})
	})

	describe("addReasoning", () => {
		it("should return 0 for empty reasoning text", () => {
			const result = counter.addReasoning("")
			expect(result).toBe(0)
			expect(counter.getTotalTokens()).toBe(0)
		})

		it("should count tokens for reasoning content", () => {
			const text = "Let me think about this..."
			const result = counter.addReasoning(text)
			expect(result).toBeGreaterThan(0)
			expect(counter.getTotalTokens()).toBe(result)
		})

		it("should accumulate reasoning tokens separately from text", () => {
			counter.addText("Hello")
			const textTokens = counter.getTotalTokens()

			counter.addReasoning("Thinking...")
			const totalTokens = counter.getTotalTokens()

			expect(totalTokens).toBeGreaterThan(textTokens)
		})
	})

	describe("addToolCall", () => {
		it("should count tokens for tool calls", () => {
			const result = counter.addToolCall("read_file", '{"path": "test.txt"}')
			expect(result).toBeGreaterThan(0)
			expect(counter.getTotalTokens()).toBe(result)
		})

		it("should return 0 for empty tool name", () => {
			const result = counter.addToolCall("", '{"path": "test.txt"}')
			expect(result).toBe(0)
			expect(counter.getTotalTokens()).toBe(0)
		})

		it("should update tokens when tool args are streamed", () => {
			// Initial tool call with empty args
			const initialTokens = counter.addToolCall("write_file", "")
			expect(initialTokens).toBeGreaterThan(0)

			// Update with partial args
			const partialTokens = counter.addToolCall("write_file", '{"path":')
			expect(partialTokens).not.toBe(0)

			// Update with complete args
			const finalTokens = counter.addToolCall("write_file", '{"path": "test.txt", "content": "hello"}')
			expect(finalTokens).not.toBe(0)

			// Total should reflect the final state
			const breakdown = counter.getTokenBreakdown()
			expect(breakdown.toolCalls).toBeGreaterThan(0)
		})

		it("should handle multiple different tool calls", () => {
			const tokens1 = counter.addToolCall("read_file", '{"path": "a.txt"}')
			const tokens2 = counter.addToolCall("write_file", '{"path": "b.txt"}')

			const breakdown = counter.getTokenBreakdown()
			expect(breakdown.toolCalls).toBeGreaterThan(tokens1)
			expect(breakdown.total).toBe(tokens1 + tokens2)
		})
	})

	describe("getTokenBreakdown", () => {
		it("should return correct breakdown for mixed content", () => {
			counter.addText("Hello world")
			counter.addReasoning("Let me think...")
			counter.addToolCall("read_file", '{"path": "test.txt"}')

			const breakdown = counter.getTokenBreakdown()

			expect(breakdown.text).toBeGreaterThan(0)
			expect(breakdown.reasoning).toBeGreaterThan(0)
			expect(breakdown.toolCalls).toBeGreaterThan(0)
			expect(breakdown.total).toBe(breakdown.text + breakdown.reasoning + breakdown.toolCalls)
		})

		it("should return zeros for empty counter", () => {
			const breakdown = counter.getTokenBreakdown()

			expect(breakdown.text).toBe(0)
			expect(breakdown.reasoning).toBe(0)
			expect(breakdown.toolCalls).toBe(0)
			expect(breakdown.total).toBe(0)
		})
	})

	describe("reset", () => {
		it("should reset all counters", () => {
			counter.addText("Hello")
			counter.addReasoning("Thinking...")
			counter.addToolCall("read_file", '{"path": "test.txt"}')

			expect(counter.getTotalTokens()).toBeGreaterThan(0)

			counter.reset()

			const breakdown = counter.getTokenBreakdown()
			expect(breakdown.text).toBe(0)
			expect(breakdown.reasoning).toBe(0)
			expect(breakdown.toolCalls).toBe(0)
			expect(breakdown.total).toBe(0)
		})

		it("should allow reuse after reset", () => {
			counter.addText("First text")
			counter.reset()

			counter.addText("Second text")
			const breakdown = counter.getTokenBreakdown()

			expect(breakdown.text).toBeGreaterThan(0)
			expect(breakdown.reasoning).toBe(0)
			expect(breakdown.toolCalls).toBe(0)
		})
	})

	describe("integration", () => {
		it("should simulate a realistic streaming conversation", () => {
			// Simulate streaming text response
			const textChunks = ["Hello", " ", "there", "! ", "How ", "can ", "I ", "help?"]
			textChunks.forEach((chunk) => counter.addText(chunk))

			// Simulate reasoning
			counter.addReasoning("The user is asking for help...")

			// Simulate tool call streaming
			counter.addToolCall("search", "") // Start
			counter.addToolCall("search", '{"query":') // Partial
			counter.addToolCall("search", '{"query": "test"}') // Complete

			const breakdown = counter.getTokenBreakdown()

			// All categories should have tokens
			expect(breakdown.text).toBeGreaterThan(0)
			expect(breakdown.reasoning).toBeGreaterThan(0)
			expect(breakdown.toolCalls).toBeGreaterThan(0)

			// Total should be sum of all
			expect(breakdown.total).toBe(breakdown.text + breakdown.reasoning + breakdown.toolCalls)
		})

		it("should handle large text efficiently", () => {
			const largeText = "a".repeat(10000)
			const result = counter.addText(largeText)
			expect(result).toBeGreaterThan(0)
			expect(counter.getTotalTokens()).toBe(result)
		})
	})
})
