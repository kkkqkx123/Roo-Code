/**
 * Streaming State Manager
 * 
 * Manages all state related to streaming processing.
 * This includes message content, tool call tracking, abort control, and various flags.
 */

import type {
	AssistantMessageContent,
	ApiMessage,
	ClineMessage,
	GroundingSource,
	ModelInfo,
	StreamingErrorType,
} from "./types"
import type Anthropic from "@anthropic-ai/sdk"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"

export class StreamingStateManager {
	// ============================================================================
	// Streaming Control Flags
	// ============================================================================

	private isStreaming: boolean = false
	private currentStreamingContentIndex: number = 0
	private currentStreamingDidCheckpoint: boolean = false
	private didCompleteReadingStream: boolean = false

	// ============================================================================
	// Message Content Storage
	// ============================================================================

	private assistantMessage: string = ""
	private reasoningMessage: string = ""
	private assistantMessageContent: AssistantMessageContent[] = []
	private userMessageContent: Anthropic.Messages.ContentBlockParam[] = []
	private userMessageContentReady: boolean = false

	// ============================================================================
	// Tool Call State
	// ============================================================================

	private streamingToolCallIndices: Map<string, number> = new Map()
	public didRejectTool: boolean = false
	public didAlreadyUseTool: boolean = false
	private didToolFailInCurrentTurn: boolean = false

	// ============================================================================
	// History Save State
	// ============================================================================

	private assistantMessageSavedToHistory: boolean = false

	// ============================================================================
	// Grounding Sources
	// ============================================================================

	private groundingSources: GroundingSource[] = []

	// ============================================================================
	// Abort Control
	// ============================================================================

	private abortController?: AbortController
	private aborted: boolean = false
	private abortReason?: string

	// ============================================================================
	// Error State
	// ============================================================================

	private error: StreamingErrorType | null = null

	// ============================================================================
	// Model Info Cache
	// ============================================================================

	private cachedModel?: { id: string; info: ModelInfo }

	// ============================================================================
	// Public API - State Management
	// ============================================================================

	/**
	 * Reset all streaming state to initial values
	 */
	reset(): void {
		this.isStreaming = false
		this.currentStreamingContentIndex = 0
		this.currentStreamingDidCheckpoint = false
		this.didCompleteReadingStream = false
		this.assistantMessage = ""
		this.reasoningMessage = ""
		this.assistantMessageContent = []
		this.userMessageContent = []
		this.userMessageContentReady = false
		this.didRejectTool = false
		this.didAlreadyUseTool = false
		this.didToolFailInCurrentTurn = false
		this.assistantMessageSavedToHistory = false
		this.streamingToolCallIndices.clear()
		this.groundingSources = []
		this.aborted = false
		this.abortReason = undefined
		this.cachedModel = undefined
		this.error = null

		// Clear NativeToolCallParser's streaming state
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	}

	/**
	 * Cleanup resources after streaming completes
	 */
	cleanup(): void {
		this.setStreaming(false)
		this.setAbortController(undefined)
	}

	// ============================================================================
	// Public API - Message State
	// ============================================================================

	/**
	 * Get the assistant message
	 */
	getAssistantMessage(): string {
		return this.assistantMessage
	}

	/**
	 * Set the assistant message
	 */
	setAssistantMessage(message: string): void {
		this.assistantMessage = message
	}

	/**
	 * Append text to the assistant message
	 */
	appendAssistantMessage(text: string): void {
		this.assistantMessage += text
	}

	/**
	 * Get the reasoning message
	 */
	getReasoningMessage(): string {
		return this.reasoningMessage
	}

	/**
	 * Set the reasoning message
	 */
	setReasoningMessage(message: string): void {
		this.reasoningMessage = message
	}

	/**
	 * Append text to the reasoning message
	 */
	appendReasoningMessage(text: string): void {
		this.reasoningMessage += text
	}

	/**
	 * Get the assistant message content blocks
	 */
	getAssistantMessageContent(): AssistantMessageContent[] {
		return this.assistantMessageContent
	}

	/**
	 * Add a content block to the assistant message
	 */
	addAssistantContentBlock(block: AssistantMessageContent): void {
		this.assistantMessageContent.push(block)
		this.userMessageContentReady = false
	}

	/**
	 * Update a content block at the specified index
	 */
	updateAssistantContentBlock(index: number, block: AssistantMessageContent): void {
		if (index >= 0 && index < this.assistantMessageContent.length) {
			this.assistantMessageContent[index] = block
			this.userMessageContentReady = false
		}
	}

	/**
	 * Get the user message content blocks
	 */
	getUserMessageContent(): Anthropic.Messages.ContentBlockParam[] {
		return this.userMessageContent
	}

	/**
	 * Set the user message content blocks
	 */
	setUserMessageContent(content: Anthropic.Messages.ContentBlockParam[]): void {
		this.userMessageContent = content
	}

	// ============================================================================
	// Public API - Tool Call Tracking
	// ============================================================================

	/**
	 * Add a tool call index mapping
	 */
	addToolCallIndex(toolCallId: string, index: number): void {
		this.streamingToolCallIndices.set(toolCallId, index)
	}

	/**
	 * Get the index of a tool call
	 */
	getToolCallIndex(toolCallId: string): number | undefined {
		return this.streamingToolCallIndices.get(toolCallId)
	}

	/**
	 * Remove a tool call index mapping
	 */
	removeToolCallIndex(toolCallId: string): void {
		this.streamingToolCallIndices.delete(toolCallId)
		this.userMessageContentReady = false
	}

	// ============================================================================
	// Public API - State Flags
	// ============================================================================

	/**
	 * Set the streaming flag
	 */
	setStreaming(streaming: boolean): void {
		this.isStreaming = streaming
	}

	/**
	 * Check if streaming is currently active
	 */
	isStreamingActive(): boolean {
		return this.isStreaming
	}

	/**
	 * Set the did reject tool flag
	 */
	setDidRejectTool(rejected: boolean): void {
		this.didRejectTool = rejected
	}

	/**
	 * Set the did already use tool flag
	 */
	setDidAlreadyUseTool(used: boolean): void {
		this.didAlreadyUseTool = used
	}

	/**
	 * Check if any tools were used in the current response
	 */
	didUseTool(): boolean {
		return this.assistantMessageContent.some(
			(block) => block.type === "tool_use" || block.type === "mcp_tool_use"
		)
	}

	/**
	 * Set the tool fail flag for the current turn
	 */
	setDidToolFailInCurrentTurn(failed: boolean): void {
		this.didToolFailInCurrentTurn = failed
	}

	/**
	 * Check if a tool failed in the current turn
	 */
	hasToolFailedInCurrentTurn(): boolean {
		return this.didToolFailInCurrentTurn
	}

	// ============================================================================
	// Public API - Grounding
	// ============================================================================

	/**
	 * Get all grounding sources
	 */
	getGroundingSources(): GroundingSource[] {
		return this.groundingSources
	}

	/**
	 * Add grounding sources
	 */
	addGroundingSources(sources: GroundingSource[]): void {
		this.groundingSources.push(...sources)
	}

	/**
	 * Clear all grounding sources
	 */
	clearGroundingSources(): void {
		this.groundingSources = []
	}

	// ============================================================================
	// Public API - Abort Control
	// ============================================================================

	/**
	 * Set the abort controller
	 */
	setAbortController(controller?: AbortController): void {
		this.abortController = controller
	}

	/**
	 * Get the abort controller
	 */
	getAbortController(): AbortController | undefined {
		return this.abortController
	}

	/**
	 * Set the aborted flag and reason
	 */
	setAborted(aborted: boolean, reason?: string): void {
		this.aborted = aborted
		this.abortReason = reason
	}

	/**
	 * Check if streaming was aborted
	 */
	isAborted(): boolean {
		return this.aborted
	}

	/**
	 * Get the abort reason
	 */
	getAbortReason(): string | undefined {
		return this.abortReason
	}

	/**
	 * Check if streaming should abort
	 */
	shouldAbort(): boolean {
		return this.aborted
	}

	// ============================================================================
	// Public API - Error State
	// ============================================================================

	/**
	 * Set the error state
	 */
	setError(error: StreamingErrorType | null): void {
		this.error = error
	}

	/**
	 * Get the error state
	 */
	getError(): StreamingErrorType | null {
		return this.error
	}

	/**
	 * Check if there was an error
	 */
	hasError(): boolean {
		return this.error !== null
	}

	// ============================================================================
	// Public API - Partial Blocks
	// ============================================================================

	/**
	 * Mark all partial blocks as complete
	 */
	completePartialBlocks(): void {
		const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
		partialBlocks.forEach((block) => (block.partial = false))
	}

	/**
	 * Complete the reasoning message
	 * This needs access to clineMessages and updateClineMessage from Task
	 */
	async completeReasoningMessage(
		clineMessages: ClineMessage[],
		updateClineMessage: (message: ClineMessage) => Promise<void>
	): Promise<void> {
		if (this.reasoningMessage) {
			const lastReasoningIndex = this.findLastIndex(
				clineMessages,
				(m) => m.type === "say" && m.say === "reasoning"
			)

			if (lastReasoningIndex !== -1) {
				const msg = clineMessages[lastReasoningIndex]
				if (msg && msg.partial) {
					msg.partial = false
					await updateClineMessage(msg)
				}
			}
		}
	}

	/**
	 * Helper method to find last index matching a predicate
	 */
	private findLastIndex<T>(array: T[], predicate: (item: T) => boolean): number {
		for (let i = array.length - 1; i >= 0; i--) {
			if (predicate(array[i])) {
				return i
			}
		}
		return -1
	}

	// ============================================================================
	// Public API - Model Info
	// ============================================================================

	/**
	 * Set the cached model information
	 */
	setCachedModel(model?: { id: string; info: ModelInfo }): void {
		this.cachedModel = model
	}

	/**
	 * Get the cached model information
	 */
	getCachedModel(): { id: string; info: ModelInfo } | undefined {
		return this.cachedModel
	}

	// ============================================================================
	// Public API - History Save
	// ============================================================================

	/**
	 * Set the assistant message saved to history flag
	 */
	setAssistantMessageSavedToHistory(saved: boolean): void {
		this.assistantMessageSavedToHistory = saved
	}

	/**
	 * Check if the assistant message was saved to history
	 */
	isAssistantMessageSavedToHistory(): boolean {
		return this.assistantMessageSavedToHistory
	}

	// ============================================================================
	// Public API - User Message Content
	// ============================================================================

	/**
	 * Set the user message content ready flag
	 */
	setUserMessageContentReady(ready: boolean): void {
		this.userMessageContentReady = ready
	}

	/**
	 * Check if the user message content is ready
	 */
	isUserMessageContentReady(): boolean {
		return this.userMessageContentReady
	}

	// ============================================================================
	// Public API - Additional Getters
	// ============================================================================

	/**
	 * Get the current streaming content index
	 */
	getCurrentStreamingContentIndex(): number {
		return this.currentStreamingContentIndex
	}

	/**
	 * Set the current streaming content index
	 */
	setCurrentStreamingContentIndex(index: number): void {
		this.currentStreamingContentIndex = index
	}

	/**
	 * Get the current streaming checkpoint flag
	 */
	getCurrentStreamingDidCheckpoint(): boolean {
		return this.currentStreamingDidCheckpoint
	}

	/**
	 * Set the current streaming checkpoint flag
	 */
	setCurrentStreamingDidCheckpoint(checkpoint: boolean): void {
		this.currentStreamingDidCheckpoint = checkpoint
	}

	/**
	 * Check if reading the stream is complete
	 */
	isDidCompleteReadingStream(): boolean {
		return this.didCompleteReadingStream
	}

	/**
	 * Set the did complete reading stream flag
	 */
	setDidCompleteReadingStream(complete: boolean): void {
		this.didCompleteReadingStream = complete
	}
}
