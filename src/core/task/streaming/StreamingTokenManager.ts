/**
 * Streaming Token Manager
 * 
 * Manages token counting, cost calculation, and tiktoken fallback for streaming responses.
 * Integrates with StreamingTokenCounter for accurate token estimation.
 * 
 * Refactored to use InputTokenEstimator for unified token estimation logic.
 */

import { StreamingTokenCounter } from "../../../utils/tiktoken"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../../shared/cost"
import { InputTokenEstimator, type InputTokenEstimationResult } from "./InputTokenEstimator"
import type { ApiHandler, TokenBreakdown, TokenUsage } from "./types"

/**
 * API protocol type for cost calculation
 */
export type ApiProtocol = "anthropic" | "openai"

/**
 * Configuration for StreamingTokenManager
 */
export interface StreamingTokenManagerConfig {
	/** API handler for token counting */
	api: ApiHandler
	/** API protocol for cost calculation (default: "anthropic") */
	apiProtocol?: ApiProtocol
}

export class StreamingTokenManager {
	private api: ApiHandler
	private apiProtocol: ApiProtocol
	private tokenCounter: StreamingTokenCounter
	private inputTokenEstimator: InputTokenEstimator
	private tokens: TokenUsage
	private hasApiUsageData: boolean
	private collectedInBackground: boolean
	private apiConversationHistory: any[] // Will be set from Task context
	private systemPrompt: string // System prompt for token estimation
	private tools: any[] // Tool definitions for token estimation

	// Background collection timeout (5 seconds)
	private static readonly USAGE_COLLECTION_TIMEOUT_MS = 5000

	/**
	 * Create a new StreamingTokenManager
	 * 
	 * @param config - Configuration object or ApiHandler (for backward compatibility)
	 */
	constructor(config: StreamingTokenManagerConfig | ApiHandler) {
		// Handle both new config object and legacy ApiHandler parameter
		if ("getModel" in config && "countTokens" in config) {
			// Legacy: config is an ApiHandler
			this.api = config as ApiHandler
			this.apiProtocol = "anthropic"
		} else {
			// New: config is a StreamingTokenManagerConfig
			this.api = (config as StreamingTokenManagerConfig).api
			this.apiProtocol = (config as StreamingTokenManagerConfig).apiProtocol ?? "anthropic"
		}

		this.tokenCounter = new StreamingTokenCounter()
		this.inputTokenEstimator = new InputTokenEstimator(this.api)
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
		this.systemPrompt = ""
		this.tools = []
	}

	/**
	 * Set the API conversation history for tiktoken fallback
	 */
	setApiConversationHistory(history: any[]): void {
		this.apiConversationHistory = history
	}

	/**
	 * Set the system prompt for token estimation
	 */
	setSystemPrompt(systemPrompt: string): void {
		this.systemPrompt = systemPrompt
	}

	/**
	 * Set the tool definitions for token estimation
	 * Tools are part of the input tokens sent to the API
	 */
	setTools(tools: any[]): void {
		this.tools = tools || []
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
		this.tools = []
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

		// Consider API provided valid usage data when either input or output tokens are > 0
		// This handles cases where:
		// 1. API returns inputTokens > 0 but outputTokens = 0 (e.g., thinking models at start)
		// 2. API returns outputTokens > 0 (normal streaming completion)
		if (inputTokens > 0 || outputTokens > 0) {
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

	/**
	 * Get the input token estimator instance
	 * Can be used for advanced token estimation scenarios
	 */
	getInputTokenEstimator(): InputTokenEstimator {
		return this.inputTokenEstimator
	}

	/**
	 * Get detailed input token estimation with breakdown
	 * Useful for debugging and analysis
	 */
	async getInputTokenEstimation(): Promise<InputTokenEstimationResult> {
		return this.inputTokenEstimator.estimate({
			systemPrompt: this.systemPrompt,
			conversationHistory: this.apiConversationHistory,
			tools: this.tools,
		})
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
	}

	// ============================================================================
	// Tiktoken Fallback
	// ============================================================================

	/**
	 * Check if tiktoken fallback is needed and apply it
	 * 
	 * IMPORTANT: API-provided token counts always take precedence over tiktoken estimates.
	 * Tiktoken fallback is ONLY used when API provides no valid usage data at all.
	 */
	async checkTiktokenFallback(): Promise<void> {
		const estimatedOutputTokens = this.tokenCounter.getTotalTokens()
		
		// Only apply fallback if:
		// 1. API did NOT provide any valid usage data (both input and output are 0)
		// 2. We have estimated output tokens from tiktoken
		// 
		// If API provided ANY token data (input OR output), we trust it completely
		// and do NOT use tiktoken estimates, as they may be inaccurate.
		const needsFallback = !this.hasApiUsageData && 
			this.tokens.input === 0 && 
			this.tokens.output === 0 && 
			estimatedOutputTokens > 0

		if (needsFallback) {
			await this.applyTiktokenFallback()
		}
	}

	/**
	 * Apply tiktoken fallback when API doesn't provide valid usage data
	 * 
	 * This is only called when API provided NO token data at all.
	 * We use tiktoken to estimate both input and output tokens.
	 */
	private async applyTiktokenFallback(): Promise<void> {
		console.log(
			"[StreamingTokenManager#applyTiktokenFallback] " +
				"reason=no_api_usage_data | " +
				`estimatedOutput=${this.tokenCounter.getTotalTokens()}`
		)

		const estimatedOutputTokens = this.tokenCounter.getTotalTokens()

		if (estimatedOutputTokens > 0) {
			// Use InputTokenEstimator for unified token estimation
			const estimationResult = await this.inputTokenEstimator.estimate({
				systemPrompt: this.systemPrompt,
				conversationHistory: this.apiConversationHistory,
				tools: this.tools,
			})
			
			const inputTokensEstimate = estimationResult.totalTokens
			const oldInput = this.tokens.input
			const oldOutput = this.tokens.output

			// Set token counts (only when API didn't provide any)
			this.tokens.input = inputTokensEstimate
			this.tokens.output = estimatedOutputTokens

			// Recalculate cost
			await this.recalculateCost()

			console.log(
				"[StreamingTokenManager#applyTiktokenFallback#after] " +
					`new{input:${this.tokens.input},output:${this.tokens.output},cost:${this.tokens.totalCost.toFixed(6)}} | ` +
					`old{input:${oldInput},output:${oldOutput}} | ` +
					`breakdown{system:${estimationResult.breakdown.systemPrompt},history:${estimationResult.breakdown.conversationHistory},tools:${estimationResult.breakdown.tools}}`
			)
		}
	}

	/**
	 * Recalculate cost using current token counts
	 */
	private async recalculateCost(): Promise<void> {
		try {
			const model = this.api.getModel()
			const modelInfo = model.info

			let costResult
			if (this.apiProtocol === "anthropic") {
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
