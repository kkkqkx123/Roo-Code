/**
 * Streaming Module Types
 * 
 * This file contains all core types and interfaces for the streaming processing system.
 * These types are used across all streaming modules to ensure type safety and consistency.
 */

import type { AssistantMessageContent } from "../../assistant-message/types"
import type Anthropic from "@anthropic-ai/sdk"
import type { ModelInfo } from "../../../shared/api"

// ============================================================================
// Stream Chunk Types
// ============================================================================

/**
 * Represents a chunk of data from the streaming API response
 */
export interface StreamChunk {
	type: "reasoning" | "usage" | "grounding" | "tool_call_partial" | "tool_call" | "text"
	[key: string]: any
}

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
// Grounding Types
// ============================================================================

/**
 * Grounding source reference
 */
export interface GroundingSource {
	url: string
	[key: string]: any
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Cline message type used in the conversation history
 */
export interface ClineMessage {
	type: string
	say?: string
	content?: string
	partial?: boolean
	[key: string]: any
}

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
 * Token usage statistics
 */
export interface TokenUsage {
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
	assistantMessageContent: AssistantMessageContent[]
	userMessageContent: Anthropic.Messages.ContentBlockParam[]
	groundingSources: GroundingSource[]
	tokens: TokenUsage
	didUseTool: boolean
	didRejectTool: boolean
	aborted: boolean
	abortReason?: string
}

// ============================================================================
// Error Handling Types
// ============================================================================

/**
 * Result of error handling operation
 */
export interface ErrorHandlingResult {
	shouldRetry: boolean
	retryDelay?: number
	abortReason?: string
	errorMessage?: string
}

/**
 * Streaming retry error type
 */
export class StreamingRetryError extends Error {
	constructor(public retryDelay: number) {
		super("Stream processing failed, will retry")
		this.name = "StreamingRetryError"
	}
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for streaming processor
 */
export interface StreamingProcessorConfig {
	taskId: string
	api: ApiHandler
	diffViewProvider: DiffViewProvider
	onSay: (type: string, content: string, ...args: any[]) => Promise<void>
	onUpdateMessage: (message: ClineMessage) => Promise<void>
	onSaveMessages: () => Promise<void>
	onAddToHistory: (message: ApiMessage, reasoning?: string) => Promise<void>
	onPresentAssistant: () => void
}

/**
 * API handler interface
 */
export interface ApiHandler {
	getModel(): { id: string; info: ModelInfo }
	countTokens(content: any[]): Promise<number>
	[key: string]: any
}

/**
 * Diff view provider interface
 */
export interface DiffViewProvider {
	isEditing: boolean
	reset(): Promise<void>
	revertChanges(): Promise<void>
}

// ============================================================================
// Handler Context Types
// ============================================================================

/**
 * Context passed to chunk handlers
 */
export interface ChunkHandlerContext {
	stateManager: StreamingStateManager
	tokenManager: StreamingTokenManager
	config: StreamingProcessorConfig
}

// ============================================================================
// Forward Declarations (to be implemented)
// ============================================================================

/**
 * Streaming state manager interface
 * Implemented in StreamingStateManager.ts
 */
export interface StreamingStateManager {
	// State management
	reset(): void
	cleanup(): void

	// Message state
	getAssistantMessage(): string
	setAssistantMessage(message: string): void
	appendAssistantMessage(text: string): void

	getReasoningMessage(): string
	setReasoningMessage(message: string): void
	appendReasoningMessage(text: string): void

	getAssistantMessageContent(): AssistantMessageContent[]
	addAssistantContentBlock(block: AssistantMessageContent): void
	updateAssistantContentBlock(index: number, block: AssistantMessageContent): void

	getUserMessageContent(): Anthropic.Messages.ContentBlockParam[]

	// Tool call tracking
	addToolCallIndex(toolCallId: string, index: number): void
	getToolCallIndex(toolCallId: string): number | undefined
	removeToolCallIndex(toolCallId: string): void

	// State flags
	setStreaming(streaming: boolean): void
	isStreamingActive(): boolean

	setDidRejectTool(rejected: boolean): void
	didRejectTool: boolean

	setDidAlreadyUseTool(used: boolean): void
	didAlreadyUseTool: boolean
	didUseTool(): boolean

	// Grounding
	getGroundingSources(): GroundingSource[]
	addGroundingSources(sources: GroundingSource[]): void

	// Abort control
	setAbortController(controller?: AbortController): void
	getAbortController(): AbortController | undefined
	setAborted(aborted: boolean, reason?: string): void
	isAborted(): boolean
	getAbortReason(): string | undefined
	shouldAbort(): boolean

	// Partial blocks
	completePartialBlocks(): void
	completeReasoningMessage(clineMessages: ClineMessage[], updateClineMessage: (message: ClineMessage) => Promise<void>): Promise<void>

	// Model info
	setCachedModel(model?: { id: string; info: ModelInfo }): void
	getCachedModel(): { id: string; info: ModelInfo } | undefined

	// History save
	setAssistantMessageSavedToHistory(saved: boolean): void
	isAssistantMessageSavedToHistory(): boolean

	// User message content
	setUserMessageContentReady(ready: boolean): void
	isUserMessageContentReady(): boolean
}

/**
 * Streaming token manager interface
 * Implemented in StreamingTokenManager.ts
 */
export interface StreamingTokenManager {
	reset(): void

	// Token counting
	addReasoningTokens(text: string): void
	addTextTokens(text: string): void
	addToolCallTokens(id: string, name: string, args: string): void
	addApiUsage(
		inputTokens: number,
		outputTokens: number,
		cacheWriteTokens: number,
		cacheReadTokens: number,
		totalCost: number
	): void

	// Token retrieval
	getTokens(): TokenUsage
	getTokenBreakdown(): TokenBreakdown

	// Background collection
	collectBackgroundUsage(): Promise<void>

	// Tiktoken fallback
	checkTiktokenFallback(): Promise<void>
	hasValidApiUsage(): boolean
}

/**
 * Chunk handler interface
 * Implemented in handlers/ChunkHandler.ts
 */
export interface ChunkHandler {
	handle(chunk: StreamChunk): Promise<void>
}
