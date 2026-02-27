/**
 * Streaming Module Types
 *
 * This file contains all core types and interfaces for the streaming processing system.
 * These types are used across all streaming modules to ensure type safety and consistency.
 *
 * Note: Many types have been migrated to packages/types/src for better reusability.
 * This file now re-exports those types and contains only streaming-specific types
 * that are tightly coupled to the streaming implementation.
 *
 * IMPORTANT: When re-exporting from @coder/types, use 'export' for classes and values,
 * and 'export type' for type-only exports. This ensures both TypeScript type checking
 * and runtime bundling work correctly.
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { AssistantMessageContent } from "../../assistant-message/types"
import type { ModelInfo, ClineMessage, ExtractedErrorInfo } from "@coder/types"
import { ApiMessage, StreamChunk, StreamingErrorType, TokenBreakdown } from "@coder/types"
import { GroundingSource, TokenUsage } from "."

// ============================================================================
// Re-exported Types and Values from @coder/types
// ============================================================================

// Error types - use 'export' for classes (both type and value), 'export type' for type-only
export type {
	BaseError,
	StreamingError,
	StreamingErrorType,
	ErrorHandlingResult,
} from "@coder/types"

export {
	InvalidStreamError,
	ChunkHandlerError,
	StreamAbortedError,
	ToolCallError,
	TokenError,
	UserInterruptError,
	ToolInterruptError,
	StreamProviderError,
	StreamTimeoutError,
	StateError,
	StreamingRetryError,
} from "@coder/types"

// Streaming event types - all are type-only
export type {
	StreamChunk,
	ToolCallStartEvent,
	ToolCallDeltaEvent,
	ToolCallEndEvent,
	ToolCallEvent,
} from "@coder/types"

// Streaming core types - all are type-only, with aliases for backward compatibility
export type {
  ApiMessage,
  StreamingTokenUsage as TokenUsage,
  TokenBreakdown,
  StreamingGroundingSource as GroundingSource,
  ModelInfo,
} from "@coder/types"

// Re-export types from local and external modules
export type { AssistantMessageContent } from "../../assistant-message/types"
export type { ClineMessage } from "@coder/types"

// ============================================================================
// Streaming Result Types (Module-specific)
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
	error: StreamingErrorType | null
	/**
	 * Extracted error information for easier consumption by Task layer.
	 * This is populated when error is not null.
	 */
	extractedErrorInfo?: ExtractedErrorInfo
}

// ============================================================================
// Configuration Types (Module-specific)
// ============================================================================

/**
 * Configuration for streaming processor
 */
export interface StreamingProcessorConfig {
	taskId: string
	api: ApiHandler
	diffViewProvider: DiffViewProvider
	onSay: (type: string, text?: string, images?: string[], partial?: boolean) => Promise<void>
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
// Handler Context Types (Module-specific)
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

	// Error state
	setError(error: StreamingErrorType | null): void
	getError(): StreamingErrorType | null
	hasError(): boolean

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
