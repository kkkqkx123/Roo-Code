// npx vitest run src/core/task/streaming/__tests__/StreamingTokenManager.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { StreamingTokenManager } from "../StreamingTokenManager"
import type { ApiHandler } from "../types"

// Mock ApiHandler
const createMockApiHandler = (): ApiHandler => {
	return {
		getModel: () => ({
			id: "test-model",
			info: {
				inputPrice: 0.01,
				outputPrice: 0.03,
				cacheWritesPrice: 0.0125,
				cacheReadsPrice: 0.004,
			},
		}),
		countTokens: vi.fn().mockResolvedValue(1000),
	} as unknown as ApiHandler
}

describe("StreamingTokenManager", () => {
	let tokenManager: StreamingTokenManager
	let mockApiHandler: ApiHandler

	beforeEach(() => {
		mockApiHandler = createMockApiHandler()
		tokenManager = new StreamingTokenManager(mockApiHandler)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("token accumulation", () => {
		it("should accumulate input tokens from multiple usage chunks", () => {
			tokenManager.addApiUsage(100, 50, 0, 0, 0)
			tokenManager.addApiUsage(200, 100, 0, 0, 0)

			const tokens = tokenManager.getTokens()

			// Should accumulate: 100 + 200 = 300
			expect(tokens.input).toBe(300)
			expect(tokens.output).toBe(150)
		})

		it("should accumulate cache tokens separately", () => {
			tokenManager.addApiUsage(100, 50, 500, 200, 0)
			tokenManager.addApiUsage(100, 50, 300, 100, 0)

			const tokens = tokenManager.getTokens()

			expect(tokens.cacheWrite).toBe(800) // 500 + 300
			expect(tokens.cacheRead).toBe(300) // 200 + 100
		})

		it("should track if API provided valid usage data", () => {
			// Initially no valid usage data
			expect(tokenManager.hasValidApiUsage()).toBe(false)

			// Add usage with outputTokens = 0 (not valid)
			tokenManager.addApiUsage(100, 0, 0, 0, 0)
			expect(tokenManager.hasValidApiUsage()).toBe(false)

			// Add usage with outputTokens > 0 (valid)
			tokenManager.addApiUsage(100, 50, 0, 0, 0)
			expect(tokenManager.hasValidApiUsage()).toBe(true)
		})
	})

	describe("tiktoken fallback", () => {
		it("should trigger fallback when API provides no usage data", async () => {
			// Add some text tokens via tiktoken counter
			tokenManager.addTextTokens("Hello world")
			tokenManager.addReasoningTokens("Thinking...")

			// Set API conversation history for input estimation
			tokenManager.setApiConversationHistory([
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
				{ role: "assistant", content: [{ type: "text", text: "Hi there" }] },
			])

			// No API usage data added, so fallback should trigger
			await tokenManager.checkTiktokenFallback()

			const tokens = tokenManager.getTokens()

			// Should have estimated tokens from tiktoken
			expect(tokens.output).toBeGreaterThan(0)
			expect(mockApiHandler.countTokens).toHaveBeenCalled()
		})

		it("should NOT trigger fallback when API provides valid usage data", async () => {
			// Add valid API usage data
			tokenManager.addApiUsage(1000, 500, 0, 0, 0.05)

			// Also add some text tokens (should be ignored)
			tokenManager.addTextTokens("Hello world")

			await tokenManager.checkTiktokenFallback()

			const tokens = tokenManager.getTokens()

			// Should use API data, not tiktoken
			expect(tokens.input).toBe(1000)
			expect(tokens.output).toBe(500)
			expect(mockApiHandler.countTokens).not.toHaveBeenCalled()
		})

		it("should trigger fallback when API returns zero tokens but tiktoken has data", async () => {
			// Add usage with zero tokens (some APIs do this)
			tokenManager.addApiUsage(0, 0, 0, 0, 0)

			// Add text tokens via tiktoken
			tokenManager.addTextTokens("This is a response")

			tokenManager.setApiConversationHistory([
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
			])

			await tokenManager.checkTiktokenFallback()

			const tokens = tokenManager.getTokens()

			// Should have estimated tokens from tiktoken
			expect(tokens.output).toBeGreaterThan(0)
		})

		it("should NOT trigger fallback when both API and tiktoken have no data", async () => {
			// No API usage, no tiktoken data
			await tokenManager.checkTiktokenFallback()

			const tokens = tokenManager.getTokens()

			expect(tokens.input).toBe(0)
			expect(tokens.output).toBe(0)
		})
	})

	describe("reset functionality", () => {
		it("should reset all token counts", () => {
			tokenManager.addApiUsage(100, 50, 500, 200, 0.01)
			tokenManager.addTextTokens("Hello")

			tokenManager.reset()

			const tokens = tokenManager.getTokens()

			expect(tokens.input).toBe(0)
			expect(tokens.output).toBe(0)
			expect(tokens.cacheWrite).toBe(0)
			expect(tokens.cacheRead).toBe(0)
			expect(tokens.totalCost).toBe(0)
			expect(tokenManager.hasValidApiUsage()).toBe(false)
		})
	})

	describe("token breakdown", () => {
		it("should provide token breakdown by category", () => {
			tokenManager.addTextTokens("Hello")
			tokenManager.addReasoningTokens("Thinking")
			tokenManager.addToolCallTokens("tool-1", "read_file", '{"path": "/test"}')

			const breakdown = tokenManager.getTokenBreakdown()

			expect(breakdown.text).toBeGreaterThan(0)
			expect(breakdown.reasoning).toBeGreaterThan(0)
			expect(breakdown.toolCalls).toBeGreaterThan(0)
		})
	})

	describe("edge cases", () => {
		it("should handle empty API conversation history for tiktoken fallback", async () => {
			tokenManager.addTextTokens("Response")
			tokenManager.setApiConversationHistory([])

			await tokenManager.checkTiktokenFallback()

			// Should not throw, should handle gracefully
			const tokens = tokenManager.getTokens()
			expect(tokens.output).toBeGreaterThanOrEqual(0)
		})

		it("should handle multiple consecutive fallback checks", async () => {
			tokenManager.addTextTokens("First response")
			tokenManager.setApiConversationHistory([
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
			])

			await tokenManager.checkTiktokenFallback()
			const firstTokens = tokenManager.getTokens()

			// Second check should not double-count
			await tokenManager.checkTiktokenFallback()
			const secondTokens = tokenManager.getTokens()

			// Tokens should be the same (not accumulated)
			expect(firstTokens.output).toBe(secondTokens.output)
		})
	})
})
