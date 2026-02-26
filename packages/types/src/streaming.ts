/**
 * Streaming Module Types
 *
 * This file contains core types and interfaces for the streaming processing system.
 * These types are used across all streaming modules to ensure type safety and consistency.
 */

import type { StreamingErrorType } from "./errors.js"

// ============================================================================
// Grounding Types
// ============================================================================

/**
 * Grounding source reference
 */
export interface StreamingGroundingSource {
	title: string
	url: string
	snippet?: string
	[key: string]: any
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * API message for conversation history
 */
export interface ApiMessage {
	role: "user" | "assistant"
	content: any
	reasoning?: string
}

// ============================================================================
// Token Management Types
// ============================================================================

/**
 * Token usage statistics for streaming
 * Note: This is different from the TokenUsage in message.ts which is for overall task usage
 */
export interface StreamingTokenUsage {
	input: number
	output: number
	cacheWrite: number
	cacheRead: number
	totalCost: number
}

/**
 * Token breakdown by type
 */
export interface TokenBreakdown {
	text: number
	reasoning: number
	toolCalls: number
}

// ============================================================================
// Streaming Result Types
// ============================================================================

/**
 * Complete result of streaming processing
 */
export interface StreamingResult {
	assistantMessage: string
	reasoningMessage: string
	assistantMessageContent: any[]
	userMessageContent: any[]
	groundingSources: StreamingGroundingSource[]
	tokens: StreamingTokenUsage
	didUseTool: boolean
	didRejectTool: boolean
	aborted: boolean
	abortReason?: string
	error: StreamingErrorType | null
}
