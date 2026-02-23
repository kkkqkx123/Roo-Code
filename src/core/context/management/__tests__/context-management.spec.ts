// cd src && npx vitest run core/context/management/__tests__/context-management.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@coder/types"

import { BaseProvider } from "../../../../api/providers/base-provider"
import { ApiMessage } from "../../../task-persistence/apiMessages"

import {
	TOKEN_BUFFER_PERCENTAGE,
	estimateTokenCount,
	truncateConversation,
	manageContext,
	willManageContext,
} from "../index"
import { expect } from "vitest"

// Create a mock ApiHandler for testing
class MockApiHandler extends BaseProvider {
	createMessage(): any {
		// Mock implementation for testing - returns an async iterable stream
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield { type: "text", text: "Mock summary content" }
				yield { type: "usage", inputTokens: 100, outputTokens: 50 }
			},
		}
		return mockStream
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				contextWindow: 100000,
				maxTokens: 50000,
				supportsPromptCache: true,
				supportsImages: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Test model",
			},
		}
	}
}

// Create a singleton instance for tests
const mockApiHandler = new MockApiHandler()
const taskId = "test-task-id"

describe("Context Management", () => {
	/**
	 * Tests for the truncateConversation function
	 */
	describe("truncateConversation", () => {
		it("should retain the first message", () => {
			const messages: ApiMessage[] = [
				{ role: "user" as const, content: "First message" },
				{ role: "assistant" as const, content: "Second message" },
				{ role: "user" as const, content: "Third message" },
			]

			const result = truncateConversation(messages, 0.5, taskId)

			// With 2 messages after the first, 0.5 fraction means remove 1 message
			// But 1 is odd, so it rounds down to 0 (to make it even)
			// No truncation happens, so no marker is inserted
			expect(result.messages.length).toBe(3) // Original messages unchanged
			expect(result.messagesRemoved).toBe(0)
			expect(result.messages[0]).toEqual(messages[0])
			expect(result.messages[1]).toEqual(messages[1])
			expect(result.messages[2]).toEqual(messages[2])
		})

		it("should remove the specified fraction of messages (rounded to even number)", () => {
			const messages: ApiMessage[] = [
				{ role: "user" as const, content: "First message" },
				{ role: "assistant" as const, content: "Second message" },
				{ role: "user" as const, content: "Third message" },
				{ role: "assistant" as const, content: "Fourth message" },
				{ role: "user" as const, content: "Fifth message" },
			]

			// 4 messages excluding first, 0.5 fraction = 2 messages to remove
			// 2 is already even, so no rounding needed
			const result = truncateConversation(messages, 0.5, taskId)

			// Should have all original messages + truncation marker
			expect(result.messages.length).toBe(6) // 5 original + 1 marker
			expect(result.messagesRemoved).toBe(2)
			expect(result.messages[0]).toEqual(messages[0])

			// Messages at indices 1 and 2 from original should be tagged
			expect(result.messages[1]!.truncationParent).toBe(result.truncationId)
			expect(result.messages[2]!.truncationParent).toBe(result.truncationId)

			// Marker should be at index 3 (at the boundary, after truncated messages)
			expect(result.messages[3]!.isTruncationMarker).toBe(true)
			expect(result.messages[3]!.role).toBe("user")

			// Messages at indices 3 and 4 from original should NOT be tagged (now at indices 4 and 5)
			expect(result.messages[4]!.truncationParent).toBeUndefined()
			expect(result.messages[5]!.truncationParent).toBeUndefined()
		})

		it("should round to an even number of messages to remove", () => {
			const messages: ApiMessage[] = [
				{ role: "user" as const, content: "First message" },
				{ role: "assistant" as const, content: "Second message" },
				{ role: "user" as const, content: "Third message" },
				{ role: "assistant" as const, content: "Fourth message" },
				{ role: "user" as const, content: "Fifth message" },
				{ role: "assistant" as const, content: "Sixth message" },
				{ role: "user" as const, content: "Seventh message" },
			]

			// 6 messages excluding first, 0.3 fraction = 1.8 messages to remove
			// 1.8 rounds down to 1, then to 0 to make it even
			const result = truncateConversation(messages, 0.3, taskId)

			expect(result.messagesRemoved).toBe(0) // No messages removed
			// When nothing is truncated, no marker is inserted
			expect(result.messages.length).toBe(7) // Original messages unchanged
		})

		it("should handle edge case with fracToRemove = 0", () => {
			const messages: ApiMessage[] = [
				{ role: "user" as const, content: "First message" },
				{ role: "assistant" as const, content: "Second message" },
				{ role: "user" as const, content: "Third message" },
			]

			const result = truncateConversation(messages, 0, taskId)

			expect(result.messagesRemoved).toBe(0)
			// When nothing is truncated, no marker is inserted
			expect(result.messages.length).toBe(3) // Original messages unchanged
		})

		it("should handle edge case with fracToRemove = 1", () => {
			const messages: ApiMessage[] = [
				{ role: "user" as const, content: "First message" },
				{ role: "assistant" as const, content: "Second message" },
				{ role: "user" as const, content: "Third message" },
				{ role: "assistant" as const, content: "Fourth message" },
			]

			// 3 messages excluding first, 1.0 fraction = 3 messages to remove
			// But 3 is odd, so it rounds down to 2 to make it even
			const result = truncateConversation(messages, 1, taskId)

			expect(result.messagesRemoved).toBe(2)
			// Should have all original messages + truncation marker
			expect(result.messages.length).toBe(5) // 4 original + 1 marker
			expect(result.messages[0]).toEqual(messages[0])

			// Messages at indices 1 and 2 should be tagged
			expect(result.messages[1]!.truncationParent).toBe(result.truncationId)
			expect(result.messages[2]!.truncationParent).toBe(result.truncationId)

			// Marker should be at index 3 (at the boundary)
			expect(result.messages[3]!.isTruncationMarker).toBe(true)
			expect(result.messages[3]!.role).toBe("user")

			// Last message should NOT be tagged (now at index 4)
			expect(result.messages[4]!.truncationParent).toBeUndefined()
		})
	})

	/**
	 * Tests for the estimateTokenCount function
	 */
	describe("estimateTokenCount", () => {
		it("should return 0 for empty or undefined content", async () => {
			expect(await estimateTokenCount([], mockApiHandler)).toBe(0)
			// @ts-ignore - Testing with undefined
			expect(await estimateTokenCount(undefined, mockApiHandler)).toBe(0)
		})

		it("should estimate tokens for text blocks", async () => {
			const content: Array<Anthropic.Messages.ContentBlockParam> = [
				{ type: "text", text: "This is a text block with 36 characters" },
			]

			// With tiktoken, the exact token count may differ from character-based estimation
			// Instead of expecting an exact number, we verify it's a reasonable positive number
			const result = await estimateTokenCount(content, mockApiHandler)
			expect(result).toBeGreaterThan(0)

			// We can also verify that longer text results in more tokens
			const longerContent: Array<Anthropic.Messages.ContentBlockParam> = [
				{
					type: "text",
					text: "This is a longer text block with significantly more characters to encode into tokens",
				},
			]
			const longerResult = await estimateTokenCount(longerContent, mockApiHandler)
			expect(longerResult).toBeGreaterThan(result)
		})

		it("should estimate tokens for image blocks based on data size", async () => {
			// Small image
			const smallImage: Array<Anthropic.Messages.ContentBlockParam> = [
				{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "small_dummy_data" } },
			]
			// Larger image with more data
			const largerImage: Array<Anthropic.Messages.ContentBlockParam> = [
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "X".repeat(1000) } },
			]

			// Verify the token count scales with the size of the image data
			const smallImageTokens = await estimateTokenCount(smallImage, mockApiHandler)
			const largerImageTokens = await estimateTokenCount(largerImage, mockApiHandler)

			// Small image should have some tokens
			expect(smallImageTokens).toBeGreaterThan(0)

			// Larger image should have proportionally more tokens
			expect(largerImageTokens).toBeGreaterThan(smallImageTokens)

			// Verify the larger image calculation matches our formula including the 50% fudge factor
			expect(largerImageTokens).toBe(48)
		})

		it("should estimate tokens for mixed content blocks", async () => {
			const content: Array<Anthropic.Messages.ContentBlockParam> = [
				{ type: "text", text: "A text block with 30 characters" },
				{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "dummy_data" } },
				{ type: "text", text: "Another text with 24 chars" },
			]

			// We know image tokens calculation should be consistent
			const imageTokens = Math.ceil(Math.sqrt("dummy_data".length)) * 1.5

			// With tiktoken, we can't predict exact text token counts,
			// but we can verify the total is greater than just the image tokens
			const result = await estimateTokenCount(content, mockApiHandler)
			expect(result).toBeGreaterThan(imageTokens)

			// Also test against a version with only the image to verify text adds tokens
			const imageOnlyContent: Array<Anthropic.Messages.ContentBlockParam> = [
				{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "dummy_data" } },
			]
			const imageOnlyResult = await estimateTokenCount(imageOnlyContent, mockApiHandler)
			expect(result).toBeGreaterThan(imageOnlyResult)
		})

		it("should handle empty text blocks", async () => {
			const content: Array<Anthropic.Messages.ContentBlockParam> = [{ type: "text", text: "" }]
			const result = await estimateTokenCount(content, mockApiHandler)
			expect(result).toBeGreaterThanOrEqual(0)
		})
	})

	describe("willManageContext", () => {
		it("should return true when context percent exceeds threshold", () => {
			const result = willManageContext({
				totalTokens: 60000,
				contextWindow: 100000, // 60% of context window
				maxTokens: 30000,
				autoCondenseContext: true,
				autoCondenseContextPercent: 50, // 50% threshold
				profileThresholds: {},
				currentProfileId: "default",
				lastMessageTokens: 0,
			})
			expect(result).toBe(true)
		})

		it("should return false when context percent is below threshold", () => {
			const result = willManageContext({
				totalTokens: 40000,
				contextWindow: 100000, // 40% of context window
				maxTokens: 30000,
				autoCondenseContext: true,
				autoCondenseContextPercent: 50, // 50% threshold
				profileThresholds: {},
				currentProfileId: "default",
				lastMessageTokens: 0,
			})
			expect(result).toBe(false)
		})

		it("should return true when tokens exceed allowedTokens even if autoCondenseContext is false", () => {
			// allowedTokens = contextWindow * (1 - 0.1) - reservedTokens = 100000 * 0.9 - 30000 = 60000
			const result = willManageContext({
				totalTokens: 60001, // Exceeds allowedTokens
				contextWindow: 100000,
				maxTokens: 30000,
				autoCondenseContext: false, // Even with auto-condense disabled
				autoCondenseContextPercent: 50,
				profileThresholds: {},
				currentProfileId: "default",
				lastMessageTokens: 0,
			})
			expect(result).toBe(true)
		})

		it("should return false when autoCondenseContext is false and tokens are below allowedTokens", () => {
			// allowedTokens = contextWindow * (1 - 0.1) - reservedTokens = 100000 * 0.9 - 30000 = 60000
			const result = willManageContext({
				totalTokens: 59999, // Below allowedTokens
				contextWindow: 100000,
				maxTokens: 30000,
				autoCondenseContext: false,
				autoCondenseContextPercent: 50, // This shouldn't matter since autoCondenseContext is false
				profileThresholds: {},
				currentProfileId: "default",
				lastMessageTokens: 0,
			})
			expect(result).toBe(false)
		})

		it("should use profile-specific threshold when available", () => {
			const result = willManageContext({
				totalTokens: 55000,
				contextWindow: 100000, // 55% of context window
				maxTokens: 30000,
				autoCondenseContext: true,
				autoCondenseContextPercent: 80, // Global threshold 80%
				profileThresholds: { "test-profile": 50 }, // Profile threshold 50%
				currentProfileId: "test-profile",
				lastMessageTokens: 0,
			})
			// Should trigger because 55% > 50% (profile threshold)
			expect(result).toBe(true)
		})

		it("should fall back to global threshold when profile threshold is -1", () => {
			const result = willManageContext({
				totalTokens: 55000,
				contextWindow: 100000, // 55% of context window
				maxTokens: 30000,
				autoCondenseContext: true,
				autoCondenseContextPercent: 80, // Global threshold 80%
				profileThresholds: { "test-profile": -1 }, // Profile uses global
				currentProfileId: "test-profile",
				lastMessageTokens: 0,
			})
			// Should NOT trigger because 55% < 80% (global threshold)
			expect(result).toBe(false)
		})

		it("should include lastMessageTokens in the calculation", () => {
			// Without lastMessageTokens: 49000 tokens = 49%
			// With lastMessageTokens: 49000 + 2000 = 51000 tokens = 51%
			const resultWithoutLastMessage = willManageContext({
				totalTokens: 49000,
				contextWindow: 100000,
				maxTokens: 30000,
				autoCondenseContext: true,
				autoCondenseContextPercent: 50, // 50% threshold
				profileThresholds: {},
				currentProfileId: "default",
				lastMessageTokens: 0,
			})
			expect(resultWithoutLastMessage).toBe(false)

			const resultWithLastMessage = willManageContext({
				totalTokens: 49000,
				contextWindow: 100000,
				maxTokens: 30000,
				autoCondenseContext: true,
				autoCondenseContextPercent: 50, // 50% threshold
				profileThresholds: {},
				currentProfileId: "default",
				lastMessageTokens: 2000, // Pushes total to 51%
			})
			expect(resultWithLastMessage).toBe(true)
		})
	})
})
