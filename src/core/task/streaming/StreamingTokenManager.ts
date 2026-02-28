/**
 * Streaming Token Manager
 * 
 * Manages token counting, cost calculation, and tiktoken fallback for streaming responses.
 * Integrates with StreamingTokenCounter for accurate token estimation.
 */

import { StreamingTokenCounter } from "../../../utils/tiktoken"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../../shared/cost"
import type { ApiHandler, TokenBreakdown, TokenUsage } from "./types"

export class StreamingTokenManager {
	private api: ApiHandler
	private tokenCounter: StreamingTokenCounter
	private tokens: TokenUsage
	private hasApiUsageData: boolean
	private collectedInBackground: boolean
	private apiConversationHistory: any[] // Will be set from Task context

	// Background collection timeout (5 seconds)
	private static readonly USAGE_COLLECTION_TIMEOUT_MS = 5000

	constructor(api: ApiHandler) {
		this.api = api
		this.tokenCounter = new StreamingTokenCounter()
		this.tokens = {
			input: 0,
			output: 0,
			cacheWrite: 0,
			cacheRead: 0,
			totalCost: 0,
		}
		this.hasApiUsageData = false
		this.collectedInBackground = false
		this.apiConversationHistory = []
	}

	/**
	 * Set the API conversation history for tiktoken fallback
	 */
	setApiConversationHistory(history: any[]): void {
		this.apiConversationHistory = history
	}

	/**
	 * Reset all token counting state
	 */
	reset(): void {
		this.tokenCounter = new StreamingTokenCounter()
		this.tokens = {
			input: 0,
			output: 0,
			cacheWrite: 0,
			cacheRead: 0,
			totalCost: 0,
		}
		this.hasApiUsageData = false
		this.collectedInBackground = false
	}

	// ============================================================================
	// Token Counting Methods
	// ============================================================================

	/**
	 * Add reasoning tokens
	 */
	addReasoningTokens(text: string): void {
		this.tokenCounter.addReasoning(text)
	}

	/**
	 * Add text tokens
	 */
	addTextTokens(text: string): void {
		this.tokenCounter.addText(text)
	}

	/**
	 * Add tool call tokens
	 */
	addToolCallTokens(id: string, name: string, args: string): void {
		this.tokenCounter.addToolCall(id, name, args)
	}

	/**
	 * Add API usage data
	 */
	addApiUsage(
		inputTokens: number,
		outputTokens: number,
		cacheWriteTokens: number,
		cacheReadTokens: number,
		totalCost: number
	): void {
		this.tokens.input += inputTokens
		this.tokens.output += outputTokens
		this.tokens.cacheWrite += cacheWriteTokens
		this.tokens.cacheRead += cacheReadTokens
		this.tokens.totalCost = totalCost

		// Only when outputTokens > 0, we consider API provided valid usage data
		if (outputTokens > 0) {
			this.hasApiUsageData = true
		}
	}

	// ============================================================================
	// Token Retrieval Methods
	// ============================================================================

	/**
	 * Get current token usage
	 */
	getTokens(): TokenUsage {
		return { ...this.tokens }
	}

	/**
	 * Get token breakdown by category
	 */
	getTokenBreakdown(): TokenBreakdown {
		const breakdown = this.tokenCounter.getTokenBreakdown()
		return {
			text: breakdown.text,
			reasoning: breakdown.reasoning,
			toolCalls: breakdown.toolCalls,
		}
	}

	/**
	 * Check if API provided valid usage data
	 */
	hasValidApiUsage(): boolean {
		return this.hasApiUsageData
	}

	/**
	 * Get total estimated tokens from tiktoken
	 */
	getTotalEstimatedTokens(): number {
		return this.tokenCounter.getTotalTokens()
	}

	// ============================================================================
	// Background Token Collection
	// ============================================================================

	/**
	 * Collect token usage in background
	 * This is a simplified version - the full implementation would handle
	 * the async stream draining as described in the original Task.ts
	 */
	async collectBackgroundUsage(): Promise<void> {
		// Mark that background collection has been initiated
		this.collectedInBackground = true

		// Note: The actual background collection logic is complex and involves
		// continuing to read the stream after the main loop exits.
		// This would need to be integrated with the StreamingProcessor
		// For now, we mark it as initiated
	}

	// ============================================================================
	// Tiktoken Fallback
	// ============================================================================

	/**
	 * Check if tiktoken fallback is needed and apply it
	 */
	async checkTiktokenFallback(): Promise<void> {
		const estimatedTokens = this.tokenCounter.getTotalTokens()
		// Trigger fallback when:
		// 1. API didn't provide valid usage data (outputTokens was 0), OR
		// 2. Both input and output tokens are 0 but we have estimated tokens
		const isApiUsageInvalid = !this.hasApiUsageData ||
			(this.tokens.input === 0 && this.tokens.output === 0 && estimatedTokens > 0)

		if (isApiUsageInvalid && estimatedTokens > 0) {
			await this.applyTiktokenFallback()
		}
	}

	/**
	 * Apply tiktoken fallback when API doesn't provide valid usage data
	 */
	private async applyTiktokenFallback(): Promise<void> {
		console.log("[StreamingTokenManager] API did not provide valid usage data. Using tiktoken fallback.")

		const estimatedOutputTokens = this.tokenCounter.getTotalTokens()

		if (estimatedOutputTokens > 0) {
			// Use tiktoken to calculate input tokens
			const inputTokensEstimate = await this.estimateInputTokens()

			// Override token counts
			this.tokens.input = inputTokensEstimate
			this.tokens.output = estimatedOutputTokens

			// Recalculate cost
			await this.recalculateCost()
		}
	}

	/**
	 * Estimate input tokens using tiktoken
	 */
	private async estimateInputTokens(): Promise<number> {
		try {
			// Flatten the conversation history to get all content blocks
			const fullConversationContent = this.apiConversationHistory.flatMap((msg) =>
				Array.isArray(msg.content) ? msg.content : []
			)

			// Use the API's countTokens method if available
			if (this.api.countTokens) {
				return await this.api.countTokens(fullConversationContent)
			}

			// Fallback: estimate based on character count (rough approximation)
			const textContent = JSON.stringify(fullConversationContent)
			return Math.ceil(textContent.length / 4) // Approximate 4 chars per token
		} catch (error) {
			console.error("[StreamingTokenManager] Error estimating input tokens:", error)
			return 0
		}
	}

	/**
	 * Recalculate cost using current token counts
	 */
	private async recalculateCost(): Promise<void> {
		try {
			const model = this.api.getModel()
			const modelInfo = model.info

			// Determine API protocol (this would need to be passed in config)
			// For now, default to Anthropic
			const apiProtocol = "anthropic" // This should come from config

			let costResult
			if (apiProtocol === "anthropic") {
				costResult = calculateApiCostAnthropic(
					modelInfo,
					this.tokens.input,
					this.tokens.output,
					this.tokens.cacheWrite,
					this.tokens.cacheRead
				)
			} else {
				costResult = calculateApiCostOpenAI(
					modelInfo,
					this.tokens.input,
					this.tokens.output,
					this.tokens.cacheWrite,
					this.tokens.cacheRead
				)
			}

			this.tokens.totalCost = costResult.totalCost
		} catch (error) {
			console.error("[StreamingTokenManager] Error recalculating cost:", error)
		}
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	/**
	 * Check if background collection has been initiated
	 */
	isCollectedInBackground(): boolean {
		return this.collectedInBackground
	}

	/**
	 * Get the token counter instance (for advanced usage)
	 */
	getTokenCounter(): StreamingTokenCounter {
		return this.tokenCounter
	}
}
