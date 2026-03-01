// npx vitest run src/core/task/streaming/__tests__/InputTokenEstimator.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { InputTokenEstimator, createInputTokenEstimator } from "../InputTokenEstimator"
import type { ApiHandler } from "../types"

// Mock ApiHandler
const createMockApiHandler = (): ApiHandler => {
	return {
		getModel: () => ({
			id: "test-model",
			info: {
				inputPrice: 0.01,
				outputPrice: 0.03,
			},
		}),
		countTokens: vi.fn().mockImplementation(async (content: any[]) => {
			// Simple mock: count characters / 4
			const text = JSON.stringify(content)
			return Math.ceil(text.length / 4)
		}),
	} as unknown as ApiHandler
}

describe("InputTokenEstimator", () => {
	let estimator: InputTokenEstimator
	let mockApiHandler: ApiHandler

	beforeEach(() => {
		mockApiHandler = createMockApiHandler()
		estimator = new InputTokenEstimator(mockApiHandler)
	})

	describe("estimate", () => {
		it("should estimate tokens for all input components", async () => {
			const result = await estimator.estimate({
				systemPrompt: "You are a helpful assistant.",
				conversationHistory: [
					{ role: "user", content: [{ type: "text", text: "Hello" }] },
					{ role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
				],
				tools: [{ name: "read_file", description: "Read a file" }],
			})

			expect(result.totalTokens).toBeGreaterThan(0)
			expect(result.breakdown.systemPrompt).toBeGreaterThan(0)
			expect(result.breakdown.conversationHistory).toBeGreaterThan(0)
			expect(result.breakdown.tools).toBeGreaterThan(0)
		})

		it("should handle empty input", async () => {
			const result = await estimator.estimate({})

			expect(result.totalTokens).toBe(0)
			expect(result.breakdown.systemPrompt).toBe(0)
			expect(result.breakdown.conversationHistory).toBe(0)
			expect(result.breakdown.tools).toBe(0)
		})

		it("should handle only system prompt", async () => {
			const result = await estimator.estimate({
				systemPrompt: "You are a helpful assistant.",
			})

			expect(result.totalTokens).toBeGreaterThan(0)
			expect(result.breakdown.systemPrompt).toBeGreaterThan(0)
			expect(result.breakdown.conversationHistory).toBe(0)
			expect(result.breakdown.tools).toBe(0)
		})

		it("should handle conversation history with string content", async () => {
			const result = await estimator.estimate({
				conversationHistory: [
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi there!" },
				],
			})

			expect(result.totalTokens).toBeGreaterThan(0)
			expect(result.breakdown.conversationHistory).toBeGreaterThan(0)
		})

		it("should handle conversation history with array content", async () => {
			const result = await estimator.estimate({
				conversationHistory: [
					{ role: "user", content: [{ type: "text", text: "Hello" }] },
				],
			})

			expect(result.totalTokens).toBeGreaterThan(0)
			expect(result.breakdown.conversationHistory).toBeGreaterThan(0)
		})
	})

	describe("estimateSystemPrompt", () => {
		it("should estimate tokens for system prompt only", async () => {
			const tokens = await estimator.estimateSystemPrompt("You are a helpful assistant.")

			expect(tokens).toBeGreaterThan(0)
		})

		it("should return 0 for empty system prompt", async () => {
			const tokens = await estimator.estimateSystemPrompt("")

			expect(tokens).toBe(0)
		})
	})

	describe("estimateConversationHistory", () => {
		it("should estimate tokens for conversation history", async () => {
			const tokens = await estimator.estimateConversationHistory([
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
				{ role: "assistant", content: [{ type: "text", text: "Hi!" }] },
			])

			expect(tokens).toBeGreaterThan(0)
		})

		it("should return 0 for empty history", async () => {
			const tokens = await estimator.estimateConversationHistory([])

			expect(tokens).toBe(0)
		})
	})

	describe("estimateTools", () => {
		it("should estimate tokens for tool definitions", async () => {
			const tokens = await estimator.estimateTools([
				{ name: "read_file", description: "Read a file" },
				{ name: "write_file", description: "Write a file" },
			])

			expect(tokens).toBeGreaterThan(0)
		})

		it("should return 0 for empty tools", async () => {
			const tokens = await estimator.estimateTools([])

			expect(tokens).toBe(0)
		})
	})

	describe("fallback estimation", () => {
		it("should use character-based fallback when countTokens throws", async () => {
			const errorHandler = {
				...createMockApiHandler(),
				countTokens: vi.fn().mockRejectedValue(new Error("Token counting failed")),
			} as unknown as ApiHandler

			const fallbackEstimator = new InputTokenEstimator(errorHandler)

			const result = await fallbackEstimator.estimate({
				systemPrompt: "You are a helpful assistant.",
			})

			// Should still return a result using fallback
			expect(result.totalTokens).toBeGreaterThan(0)
		})
	})

	describe("factory function", () => {
		it("should create estimator using factory function", () => {
			const factoryEstimator = createInputTokenEstimator(mockApiHandler)

			expect(factoryEstimator).toBeInstanceOf(InputTokenEstimator)
		})
	})
})
