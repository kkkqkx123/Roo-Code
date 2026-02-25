/**
 * StreamPostProcessor Callbacks
 *
 * Defines the callback interface for StreamPostProcessor to interact with Task.
 * This allows StreamPostProcessor to access Task state and methods without direct coupling.
 */

import type { ClineMessage, ClineApiReqInfo, ExtensionState, ModelInfo, ProviderSettings } from "@coder/types"
import type { StreamProcessorEvent } from "./StreamProcessorEvents"
import type { SharedCallbacks } from "./SharedCallbacks"

/**
 * Usage data update
 */
export interface UsageDataUpdate {
	inputTokens: number
	outputTokens: number
	totalCost: number
}

/**
 * Stack item for retry logic
 */
export interface StackItem {
	userContent: any[]
	includeFileDetails: boolean
	retryAttempt?: number
	userMessageWasRemoved?: boolean
}

/**
 * StreamPostProcessor callbacks
 *
 * These callbacks allow StreamPostProcessor to interact with Task without direct coupling.
 * Extends SharedCallbacks to avoid duplication.
 */
export interface StreamPostProcessorCallbacks extends SharedCallbacks {
	// ===== Lifecycle Callbacks =====

	/**
	 * Called when stream processing is complete
	 */
	onStreamComplete(): Promise<void>

	/**
	 * Called when stream is aborted
	 */
	onAbort(): Promise<void>

	/**
	 * Emit an event to Task
	 */
	emitEvent(event: StreamProcessorEvent): void | Promise<void>

	// ===== State Access Callbacks =====

	/**
	 * Get the full conversation content for token counting
	 */
	getFullConversationContent(): Promise<any[]>

	/**
	 * Get the reasoning message
	 */
	getReasoningMessage(): Promise<any | undefined>

	/**
	 * Find the last reasoning message index
	 */
	findLastReasoningMessageIndex(): Promise<number>

	/**
	 * Get partial blocks from assistant message content
	 */
	getPartialBlocks(): Promise<any[]>

	/**
	 * Get the streaming tool call index for a tool call ID
	 */
	getStreamingToolCallIndex(toolCallId: string): Promise<number | undefined>

	/**
	 * Get assistant message content at index (异步版本)
	 */
	getAssistantMessageContent(index: number): Promise<any>

	/**
	 * Get user message content
	 */
	getUserMessageContent(): Promise<any[]>

	/**
	 * Get current user content for retry
	 */
	getCurrentUserContent(): Promise<any[]>

	/**
	 * Get current stack item
	 */
	getCurrentStackItem(): Promise<StackItem | undefined>

	/**
	 * Get the current state
	 */
	getState(): Promise<ExtensionState | undefined>

	/**
	 * Check if task is paused
	 */
	isPaused(): Promise<boolean>

	/**
	 * Check if task was aborted
	 */
	wasAborted(): Promise<boolean>

	// ===== State Update Callbacks =====

	/**
	 * Update usage data
	 */
	updateUsageData(data: UsageDataUpdate): Promise<void>

	/**
	 * Update assistant message content at index
	 */
	updateAssistantMessageContent(index: number, content: any): Promise<void>

	/**
	 * Remove streaming tool call index
	 */
	removeStreamingToolCallIndex(toolCallId: string): Promise<void>

	/**
	 * Set assistant message saved to history flag
	 */
	setAssistantMessageSavedToHistory(saved: boolean): Promise<void>

	/**
	 * Push to user message content
	 */
	pushToUserMessageContent(content: any): Promise<void>

	/**
	 * Push to stack
	 */
	pushToStack(item: StackItem): Promise<void>

	/**
	 * Increment consecutive no tool use count
	 */
	incrementConsecutiveNoToolUseCount(): Promise<number>

	/**
	 * Increment consecutive no assistant messages count
	 */
	incrementConsecutiveNoAssistantMessagesCount(): Promise<number>

	/**
	 * Increment consecutive mistake count
	 */
	incrementConsecutiveMistakeCount(): Promise<void>

	/**
	 * Reset consecutive no assistant messages count
	 */
	resetConsecutiveNoAssistantMessagesCount(): Promise<void>

	/**
	 * Reset consecutive no tool use count
	 */
	resetConsecutiveNoToolUseCount(): Promise<void>

	// ===== Action Callbacks =====

	/**
	 * Count tokens for content
	 */
	countTokens(content: any[]): Promise<number>

	/**
	 * Log a message
	 */
	log(message: string): Promise<void>

	/**
	 * Post state to webview
	 */
	postStateToWebview(): Promise<void>

	/**
	 * Present assistant message
	 */
	presentAssistantMessage(): Promise<void>

	/**
	 * Ask the user a question
	 */
	ask(type: string, question: string): Promise<{ response: string }>

	/**
	 * Add to API conversation history
	 */
	addToApiConversationHistory(message: any, reasoningMessage?: any): Promise<void>

	/**
	 * Remove last user message from history
	 */
	removeLastUserMessageFromHistory(): Promise<void>

	/**
	 * Push tool result to user content
	 */
	pushToolResultToUserContent(result: any): Promise<void>

	/**
	 * Wait for user message content to be ready
	 */
	waitForUserMessageContentReady(): Promise<void>

	/**
	 * Backoff and announce
	 */
	backoffAndAnnounce(retryAttempt: number, error: Error): Promise<void>

	/**
	 * Get translation
	 */
	getTranslation(key: string): Promise<string>
}