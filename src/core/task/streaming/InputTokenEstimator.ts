/**
 * Input Token Estimator
 * 
 * Unified module for estimating input tokens including:
 * - System prompt
 * - Conversation history
 * - Tool definitions
 * 
 * This module provides a centralized, reusable token estimation logic
 * that can be used by StreamingTokenManager, Task, and other components.
 */

import type { ApiHandler } from "./types"

/**
 * Input content for token estimation
 */
export interface InputTokenEstimationInput {
	/** System prompt string */
	systemPrompt?: string
	/** API conversation history messages */
	conversationHistory?: any[]
	/** Tool definitions array */
	tools?: any[]
}

/**
 * Result of token estimation
 */
export interface InputTokenEstimationResult {
	/** Total estimated input tokens */
	totalTokens: number
	/** Breakdown by component */
	breakdown: {
		systemPrompt: number
		conversationHistory: number
		tools: number
	}
}

/**
 * Input Token Estimator
 * 
 * Provides unified token estimation for API input components.
 * Uses the API's countTokens method when available, with fallback to character-based estimation.
 */
export class InputTokenEstimator {
	private api: ApiHandler

	/** Characters per token approximation for fallback estimation */
	private static readonly CHARS_PER_TOKEN = 4

	constructor(api: ApiHandler) {
		this.api = api
	}

	/**
	 * Estimate total input tokens for the given input components
	 * 
	 * @param input - Input components to estimate tokens for
	 * @returns Estimation result with total and breakdown
	 */
	async estimate(input: InputTokenEstimationInput): Promise<InputTokenEstimationResult> {
		const { systemPrompt, conversationHistory, tools } = input

		// Build content array for token counting
		const allContent: any[] = []

		// Add system prompt
		if (systemPrompt) {
			allContent.push({ type: "text", text: systemPrompt })
		}

		// Add conversation history content
		const conversationContent = this.flattenConversationHistory(conversationHistory)
		allContent.push(...conversationContent)

		// Add tool definitions
		if (tools && tools.length > 0) {
			const toolsText = JSON.stringify(tools)
			allContent.push({ type: "text", text: toolsText })
		}

		// Count tokens using API method or fallback
		const totalTokens = await this.countTokens(allContent)

		// Calculate breakdown for detailed analysis
		const breakdown = await this.calculateBreakdown(systemPrompt, conversationHistory, tools)

		return {
			totalTokens,
			breakdown,
		}
	}

	/**
	 * Estimate tokens for system prompt only
	 */
	async estimateSystemPrompt(systemPrompt: string): Promise<number> {
		if (!systemPrompt) {
			return 0
		}
		return await this.countTokens([{ type: "text", text: systemPrompt }])
	}

	/**
	 * Estimate tokens for conversation history only
	 */
	async estimateConversationHistory(conversationHistory: any[]): Promise<number> {
		if (!conversationHistory || conversationHistory.length === 0) {
			return 0
		}
		const content = this.flattenConversationHistory(conversationHistory)
		return await this.countTokens(content)
	}

	/**
	 * Estimate tokens for tool definitions only
	 */
	async estimateTools(tools: any[]): Promise<number> {
		if (!tools || tools.length === 0) {
			return 0
		}
		const toolsText = JSON.stringify(tools)
		return await this.countTokens([{ type: "text", text: toolsText }])
	}

	/**
	 * Flatten conversation history to extract content blocks
	 */
	private flattenConversationHistory(conversationHistory: any[] | undefined): any[] {
		if (!conversationHistory) {
			return []
		}

		return conversationHistory.flatMap((msg) => {
			if (Array.isArray(msg.content)) {
				return msg.content
			}
			// Handle string content
			if (typeof msg.content === "string" && msg.content) {
				return [{ type: "text", text: msg.content }]
			}
			return []
		})
	}

	/**
	 * Count tokens using API method or fallback to character-based estimation
	 */
	private async countTokens(content: any[]): Promise<number> {
		if (content.length === 0) {
			return 0
		}

		try {
			// Use API's countTokens method if available
			if (this.api.countTokens) {
				return await this.api.countTokens(content)
			}

			// Fallback: character-based estimation
			return this.estimateByCharCount(content)
		} catch (error) {
			console.error("[InputTokenEstimator] Error counting tokens:", error)
			// Return character-based estimate as fallback
			return this.estimateByCharCount(content)
		}
	}

	/**
	 * Estimate tokens based on character count
	 * Approximation: ~4 characters per token
	 */
	private estimateByCharCount(content: any[]): number {
		const textContent = JSON.stringify(content)
		return Math.ceil(textContent.length / InputTokenEstimator.CHARS_PER_TOKEN)
	}

	/**
	 * Calculate detailed breakdown of token counts by component
	 */
	private async calculateBreakdown(
		systemPrompt?: string,
		conversationHistory?: any[],
		tools?: any[]
	): Promise<{ systemPrompt: number; conversationHistory: number; tools: number }> {
		const [systemPromptTokens, historyTokens, toolsTokens] = await Promise.all([
			this.estimateSystemPrompt(systemPrompt || ""),
			this.estimateConversationHistory(conversationHistory || []),
			this.estimateTools(tools || []),
		])

		return {
			systemPrompt: systemPromptTokens,
			conversationHistory: historyTokens,
			tools: toolsTokens,
		}
	}
}

/**
 * Factory function to create an InputTokenEstimator
 */
export function createInputTokenEstimator(api: ApiHandler): InputTokenEstimator {
	return new InputTokenEstimator(api)
}
