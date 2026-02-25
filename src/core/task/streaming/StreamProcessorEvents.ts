/**
 * StreamProcessor Events
 * 
 * Defines all events emitted by StreamProcessor during the streaming lifecycle.
 * These events allow components like StreamPostProcessor to react to streaming state changes.
 */

import type { ApiStreamChunk } from "../../../api/transform/stream"
import type { ClineApiReqInfo } from "@coder/types"

/**
 * Event types emitted by StreamProcessor
 */
export type StreamProcessorEventType =
	| "streamStart"
	| "chunkReceived"
	| "chunkProcessed"
	| "streamComplete"
	| "streamError"
	| "tokenFallback"
	| "toolCallFinalized"
	| "partialBlocksCompleted"
	| "reasoningCompleted"
	| "assistantMessageSaved"
	| "contentReady"
	| "noContentError"
	| "retryRequested"

/**
 * Base event structure
 */
export interface BaseStreamEvent {
	type: StreamProcessorEventType
	timestamp: number
}

/**
 * Stream start event
 */
export interface StreamStartEvent extends BaseStreamEvent {
	type: "streamStart"
}

/**
 * Chunk received event
 */
export interface ChunkReceivedEvent extends BaseStreamEvent {
	type: "chunkReceived"
	chunk: ApiStreamChunk
}

/**
 * Chunk processed event
 */
export interface ChunkProcessedEvent extends BaseStreamEvent {
	type: "chunkProcessed"
	chunkType: string
	success: boolean
}

/**
 * Stream complete event
 * Contains all processing results from the stream
 */
export interface StreamCompleteEvent extends BaseStreamEvent {
	type: "streamComplete"
	result: StreamProcessingResult
}

/**
 * Stream error event
 */
export interface StreamErrorEvent extends BaseStreamEvent {
	type: "streamError"
	error: Error
	cancelReason?: string
}

/**
 * Token fallback event
 * Emitted when API didn't provide valid usage data and tiktoken fallback is used
 */
export interface TokenFallbackEvent extends BaseStreamEvent {
	type: "tokenFallback"
	tokenBreakdown: {
		text: number
		reasoning: number
		toolCalls: number
	}
	inputTokens: number
	outputTokens: number
	totalCost: number
}

/**
 * Tool call finalized event
 * Emitted when a streaming tool call is finalized
 */
export interface ToolCallFinalizedEvent extends BaseStreamEvent {
	type: "toolCallFinalized"
	toolCallId: string
	success: boolean
}

/**
 * Partial blocks completed event
 * Emitted when all partial blocks are marked as complete
 */
export interface PartialBlocksCompletedEvent extends BaseStreamEvent {
	type: "partialBlocksCompleted"
	count: number
}

/**
 * Reasoning completed event
 * Emitted when the reasoning message is completed
 */
export interface ReasoningCompletedEvent extends BaseStreamEvent {
	type: "reasoningCompleted"
	messageIndex: number
}

/**
 * Assistant message saved event
 * Emitted when the assistant message is saved to API history
 */
export interface AssistantMessageSavedEvent extends BaseStreamEvent {
	type: "assistantMessageSaved"
	hasTextContent: boolean
	hasToolUses: boolean
	contentLength: number
}

/**
 * Content ready event
 * Emitted when content is ready for processing
 */
export interface ContentReadyEvent extends BaseStreamEvent {
	type: "contentReady"
	hasTextContent: boolean
	hasToolUses: boolean
}

/**
 * No content error event
 * Emitted when the stream produced no assistant messages
 */
export interface NoContentErrorEvent extends BaseStreamEvent {
	type: "noContentError"
	consecutiveFailures: number
}

/**
 * Retry requested event
 * Emitted when a retry is requested
 */
export interface RetryRequestedEvent extends BaseStreamEvent {
	type: "retryRequested"
	reason: string
	retryAttempt: number
	autoRetry: boolean
}

/**
 * Stream processing result
 * Contains all data collected during stream processing
 */
export interface StreamProcessingResult {
	// Token usage
	hasApiUsageData: boolean
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number

	// Content
	hasTextContent: boolean
	hasToolUses: boolean
	assistantMessage: string[]
	assistantMessageContent: any[]
	pendingGroundingSources: any[]
	reasoningMessage?: any

	// State
	didCompleteReadingStream: boolean
	wasAborted: boolean
	wasAbandoned: boolean

	// Token counter data (for fallback)
	tokenCounterData?: {
		totalTokens: number
		breakdown: {
			text: number
			reasoning: number
			toolCalls: number
		}
	}

	// API request info
	apiReqIndex: number
	apiReqInfo?: ClineApiReqInfo
}

/**
 * Union type of all stream processor events
 */
export type StreamProcessorEvent =
	| StreamStartEvent
	| ChunkReceivedEvent
	| ChunkProcessedEvent
	| StreamCompleteEvent
	| StreamErrorEvent
	| TokenFallbackEvent
	| ToolCallFinalizedEvent
	| PartialBlocksCompletedEvent
	| ReasoningCompletedEvent
	| AssistantMessageSavedEvent
	| ContentReadyEvent
	| NoContentErrorEvent
	| RetryRequestedEvent

/**
 * Event listener type
 */
export type StreamEventListener = (event: StreamProcessorEvent) => void | Promise<void>

/**
 * Event emitter interface
 */
export interface StreamEventEmitter {
	on(eventType: StreamProcessorEventType, listener: StreamEventListener): void
	off(eventType: StreamProcessorEventType, listener: StreamEventListener): void
	emit(event: StreamProcessorEvent): void | Promise<void>
	removeAllListeners(eventType?: StreamProcessorEventType): void
}