/**
 * Streaming Module - Event Types
 *
 * This file contains all event types used in the streaming processing system.
 * These types represent different types of chunks and events that can occur
 * during streaming API responses.
 */

import type { StreamingGroundingSource } from "./types.js"

// ============================================================================
// Stream Chunk Types
// ============================================================================

/**
 * Represents a chunk of data from the streaming API response
 * This is a union type that accepts all stream chunk types
 */
export type StreamChunk =
	| { type: "reasoning"; text: string; signature?: string }
	| { type: "usage"; inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number; reasoningTokens?: number; totalCost?: number }
	| { type: "grounding"; sources: StreamingGroundingSource[] }
	| { type: "tool_call_partial"; index: number; id?: string; name?: string; arguments?: string }
	| { type: "tool_call"; id: string; name: string; arguments: string }
	| { type: "text"; text: string }
	| { type: "thinking_complete"; signature: string }
	| { type: "tool_call_start"; id: string; name: string }
	| { type: "tool_call_delta"; id: string; delta: string }
	| { type: "tool_call_end"; id: string }
	| { type: "error"; error: string; message: string }

// ============================================================================
// Tool Call Event Types
// ============================================================================

/**
 * Tool call start event
 */
export interface ToolCallStartEvent {
	type: "tool_call_start"
	id: string
	name: string
}

/**
 * Tool call delta event (incremental update)
 */
export interface ToolCallDeltaEvent {
	type: "tool_call_delta"
	id: string
	delta: string
}

/**
 * Tool call end event
 */
export interface ToolCallEndEvent {
	type: "tool_call_end"
	id: string
}

/**
 * Union type for all tool call events
 */
export type ToolCallEvent = ToolCallStartEvent | ToolCallDeltaEvent | ToolCallEndEvent

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a chunk is a tool call event
 */
export function isToolCallEvent(chunk: StreamChunk): chunk is ToolCallStartEvent | ToolCallDeltaEvent | ToolCallEndEvent {
	return chunk.type === "tool_call_start" || chunk.type === "tool_call_delta" || chunk.type === "tool_call_end"
}

/**
 * Check if a chunk is an error chunk
 */
export function isErrorChunk(chunk: StreamChunk): chunk is { type: "error"; error: string; message: string } {
	return chunk.type === "error"
}

/**
 * Check if a chunk is a usage chunk
 */
export function isUsageChunk(chunk: StreamChunk): chunk is { type: "usage"; inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number; reasoningTokens?: number; totalCost?: number } {
	return chunk.type === "usage"
}