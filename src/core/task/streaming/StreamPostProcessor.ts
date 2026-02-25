/**
 * StreamPostProcessor
 * 
 * Handles post-processing logic after stream completion.
 * This includes:
 * - Token fallback estimation when API doesn't provide usage data
 * - Finalizing streaming tool calls
 * - Completing partial blocks
 * - Saving messages to history
 * - Handling content processing
 * - Error handling and retry logic
 * 
 * This component listens to StreamProcessor events and executes the appropriate
 * post-processing logic through callbacks.
 */

import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { getModelId, getApiProtocol } from "@coder/types"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../../shared/cost"
import { findLastIndex } from "../../../shared/array"
import { formatResponse } from "../../prompts/responses"
import { hasToolUses, buildAssistantContent, enforceNewTaskIsolation } from "../utils/tool-utils"
import type { StreamProcessorEvent, StreamProcessingResult } from "./StreamProcessorEvents"
import type { StreamPostProcessorCallbacks } from "./StreamPostProcessorCallbacks"
import type { StreamingTokenCounter } from "../../../utils/tiktoken"

/**
 * StreamPostProcessor configuration
 */
export interface StreamPostProcessorConfig {
	/** Enable token fallback estimation */
	enableTokenFallback?: boolean
	/** Enable tool call finalization */
	enableToolCallFinalization?: boolean
	/** Enable partial block completion */
	enablePartialBlockCompletion?: boolean
	/** Enable assistant message saving */
	enableAssistantMessageSaving?: boolean
	/** Enable content processing */
	enableContentProcessing?: boolean
	/** Enable error handling */
	enableErrorHandling?: boolean
}

/**
 * StreamPostProcessor state
 */
export interface StreamPostProcessorState {
	/** Whether post-processing is active */
	isActive: boolean
	/** Last stream processing result */
	lastResult?: StreamProcessingResult
	/** Number of consecutive no-content failures */
	consecutiveNoContentFailures: number
}

/**
 * StreamPostProcessor
 * 
 * Handles all post-processing logic after stream completion
 */
export class StreamPostProcessor {
	private callbacks: StreamPostProcessorCallbacks
	private config: Required<StreamPostProcessorConfig>
	private state: StreamPostProcessorState

	constructor(callbacks: StreamPostProcessorCallbacks, config: StreamPostProcessorConfig = {}) {
		this.callbacks = callbacks
		this.config = {
			enableTokenFallback: config.enableTokenFallback ?? true,
			enableToolCallFinalization: config.enableToolCallFinalization ?? true,
			enablePartialBlockCompletion: config.enablePartialBlockCompletion ?? true,
			enableAssistantMessageSaving: config.enableAssistantMessageSaving ?? true,
			enableContentProcessing: config.enableContentProcessing ?? true,
			enableErrorHandling: config.enableErrorHandling ?? true,
		}
		this.state = {
			isActive: false,
			consecutiveNoContentFailures: 0,
		}
	}

	/**
	 * Handle a stream processor event
	 */
	async handleEvent(event: StreamProcessorEvent): Promise<void> {
		switch (event.type) {
			case "streamComplete":
				await this.handleStreamComplete(event)
				break
			case "tokenFallback":
				await this.handleTokenFallback(event)
				break
			case "toolCallFinalized":
				await this.handleToolCallFinalized(event)
				break
			case "partialBlocksCompleted":
				await this.handlePartialBlocksCompleted(event)
				break
			case "reasoningCompleted":
				await this.handleReasoningCompleted(event)
				break
			case "assistantMessageSaved":
				await this.handleAssistantMessageSaved(event)
				break
			case "contentReady":
				await this.handleContentReady(event)
				break
			case "noContentError":
				await this.handleNoContentError(event)
				break
			case "retryRequested":
				await this.handleRetryRequested(event)
				break
		}
	}

	/**
	 * Handle stream complete event
	 */
	private async handleStreamComplete(event: StreamProcessorEvent & { type: "streamComplete" }): Promise<void> {
		const result = event.result
		this.state.lastResult = result
		this.state.isActive = true

		// Check for abort
		if (result.wasAborted || result.wasAbandoned) {
			await this.callbacks.onAbort()
			return
		}

		// Mark stream as complete
		await this.callbacks.onStreamComplete()

		// Execute post-processing steps in the correct order
		if (this.config.enableTokenFallback) {
			await this.executeTokenFallback(result)
		}

		if (this.config.enableToolCallFinalization) {
			await this.finalizeToolCalls()
		}

		if (this.config.enablePartialBlockCompletion) {
			await this.completePartialBlocks()
		}

		if (this.config.enableAssistantMessageSaving) {
			await this.saveAssistantMessage(result)
		}

		if (this.config.enableContentProcessing) {
			// processContent will handle waiting for userMessageContentReady
			// and pushing to stack for the next iteration
			await this.processContent(result)
		}

		this.state.isActive = false
	}

	/**
	 * Execute token fallback estimation
	 */
	private async executeTokenFallback(result: StreamProcessingResult): Promise<void> {
		if (!result.tokenCounterData) {
			return
		}

		const { hasApiUsageData, inputTokens, outputTokens, tokenCounterData } = result
		const isApiUsageInvalid = !hasApiUsageData || (inputTokens === 0 && outputTokens === 0)

		if (isApiUsageInvalid && tokenCounterData.totalTokens > 0) {
			const { breakdown, totalTokens } = tokenCounterData

			await this.callbacks.log(
				`API did not provide valid usage data. Using tiktoken fallback for token estimation.`,
			)
			await this.callbacks.log(
				`Token breakdown - Text: ${breakdown.text}, Reasoning: ${breakdown.reasoning}, Tool Calls: ${breakdown.toolCalls}`,
			)

			if (totalTokens > 0) {
				// Calculate input tokens using tiktoken on the full conversation history
				const fullConversationContent = await this.callbacks.getFullConversationContent()
				const inputTokensEstimate = await this.callbacks.countTokens(fullConversationContent)

				// Calculate cost based on estimated tokens
				const modelInfo = await this.callbacks.getModelInfo()
				const apiConfig = await this.callbacks.getApiConfiguration()
				const modelId = getModelId(apiConfig)
				const apiProvider = apiConfig.apiProvider
				const apiProtocol = getApiProtocol(apiProvider, modelId)

				const costResult =
					apiProtocol === "anthropic"
						? calculateApiCostAnthropic(
								modelInfo,
								inputTokensEstimate,
								totalTokens,
								result.cacheWriteTokens,
								result.cacheReadTokens,
							)
						: calculateApiCostOpenAI(
								modelInfo,
								inputTokensEstimate,
								totalTokens,
								result.cacheWriteTokens,
								result.cacheReadTokens,
							)

				// Update usage data
				await this.callbacks.updateUsageData({
					inputTokens: inputTokensEstimate,
					outputTokens: totalTokens,
					totalCost: costResult.totalCost,
				})

				await this.callbacks.log(
					`Fallback estimation complete: input=${inputTokensEstimate}, output=${totalTokens} (text=${breakdown.text}, reasoning=${breakdown.reasoning}, tools=${breakdown.toolCalls})`,
				)
			}
		}
	}

	/**
	 * Finalize streaming tool calls
	 */
	private async finalizeToolCalls(): Promise<void> {
		const finalizeEvents = NativeToolCallParser.finalizeRawChunks()

		for (const event of finalizeEvents) {
			if (event.type === "tool_call_end") {
				const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
				const toolUseIndex = await this.callbacks.getStreamingToolCallIndex(event.id)

				if (finalToolUse) {
					// Store the tool call ID
					;(finalToolUse as any).id = event.id

					// Replace partial with final
					if (toolUseIndex !== undefined) {
						await this.callbacks.updateAssistantMessageContent(toolUseIndex, finalToolUse)
					}

					// Clean up tracking
					await this.callbacks.removeStreamingToolCallIndex(event.id)

					// Mark that we have new content to process
					await this.callbacks.setUserMessageContentReady(false)

					// Present the finalized tool call
					await this.callbacks.presentAssistantMessage()

					await this.callbacks.emitEvent({
						type: "toolCallFinalized",
						timestamp: Date.now(),
						toolCallId: event.id,
						success: true,
					})
				} else if (toolUseIndex !== undefined) {
					// finalizeStreamingToolCall returned null (malformed JSON or missing args)
					const existingToolUse = await this.callbacks.getAssistantMessageContent(toolUseIndex)
					if (existingToolUse && existingToolUse.type === "tool_use") {
						existingToolUse.partial = false
						;(existingToolUse as any).id = event.id
						await this.callbacks.updateAssistantMessageContent(toolUseIndex, existingToolUse)
					}

					// Clean up tracking
					await this.callbacks.removeStreamingToolCallIndex(event.id)

					// Mark that we have new content to process
					await this.callbacks.setUserMessageContentReady(false)

					// Present the tool call - validation will handle missing params
					await this.callbacks.presentAssistantMessage()

					await this.callbacks.emitEvent({
						type: "toolCallFinalized",
						timestamp: Date.now(),
						toolCallId: event.id,
						success: false,
					})
				}
			}
		}
	}

	/**
	 * Complete partial blocks
	 */
	private async completePartialBlocks(): Promise<void> {
		const partialBlocks = await this.callbacks.getPartialBlocks()

		// Mark all partial blocks as complete
		for (const block of partialBlocks) {
			block.partial = false
		}

		await this.callbacks.emitEvent({
			type: "partialBlocksCompleted",
			timestamp: Date.now(),
			count: partialBlocks.length,
		})
	}

	/**
	 * Complete reasoning message
	 */
	private async completeReasoningMessage(): Promise<void> {
		const reasoningMessage = await this.callbacks.getReasoningMessage()
		if (!reasoningMessage) {
			return
		}

		const lastReasoningIndex = await this.callbacks.findLastReasoningMessageIndex()
		if (lastReasoningIndex === -1) {
			return
		}

		const msg = await this.callbacks.getClineMessage(lastReasoningIndex)
		if (msg && msg.partial) {
			msg.partial = false
			await this.callbacks.updateClineMessage(msg)
		}

		await this.callbacks.emitEvent({
			type: "reasoningCompleted",
			timestamp: Date.now(),
			messageIndex: lastReasoningIndex,
		})
	}

	/**
	 * Save assistant message to history
	 */
	private async saveAssistantMessage(result: StreamProcessingResult): Promise<void> {
		// Complete reasoning message if it exists
		await this.completeReasoningMessage()

		// Save messages
		await this.callbacks.saveClineMessages()
		await this.callbacks.postStateToWebview()

		// Check if we have any content to process
		const hasTextContent = result.assistantMessage.length > 0
		const hasToolUsesInContent = hasToolUses(result.assistantMessageContent)

		if (hasTextContent || hasToolUsesInContent) {
			// Reset counter when we get a successful response with content
			await this.callbacks.resetConsecutiveNoAssistantMessagesCount()

			// Display grounding sources to the user if they exist
			if (result.pendingGroundingSources.length > 0) {
				await this.displayGroundingSources(result.pendingGroundingSources)
			}

			// Build the assistant message content array
			let assistantContent = buildAssistantContent(
				result.assistantMessage.join(""),
				result.assistantMessageContent,
				await this.callbacks.getTaskId(),
			)

			// Safety check: buildAssistantContent may return undefined in test environments
			if (assistantContent) {
				// Enforce new_task isolation
				const isolationResult = enforceNewTaskIsolation(assistantContent, result.assistantMessageContent)
				// Safety check: enforceNewTaskIsolation may return undefined in test environments
				if (isolationResult) {
					assistantContent = isolationResult.truncatedAssistantContent

					// Update assistant message content
					await this.callbacks.setAssistantMessageContent(isolationResult.truncatedAssistantMessageContent)

					// Pre-inject error tool_results for truncated tools
					for (const errorResult of isolationResult.errorToolResults) {
						await this.callbacks.pushToolResultToUserContent(errorResult)
					}
				}

				// Save assistant message BEFORE executing tools
				await this.callbacks.addToApiConversationHistory(
					{ role: "assistant", content: assistantContent },
					result.reasoningMessage || undefined,
				)
				await this.callbacks.setAssistantMessageSavedToHistory(true)

				await this.callbacks.emitEvent({
					type: "assistantMessageSaved",
					timestamp: Date.now(),
					hasTextContent,
					hasToolUses: hasToolUsesInContent,
					contentLength: Array.isArray(assistantContent) ? assistantContent.length : 0,
				})
			}
		}
	}

	/**
	 * Display grounding sources
	 */
	private async displayGroundingSources(sources: any[]): Promise<void> {
		const citationLinks = sources.map((source: { url: any }, i: number) => `[${i + 1}](${source.url})`)
		const sourcesText = `${await this.callbacks.getTranslation("common:gemini.sources")} ${citationLinks.join(", ")}`

		await this.callbacks.say("text", {
			text: sourcesText,
			partial: false,
			isNonInteractive: true,
		})
	}

	/**
	 * Process content
	 */
	private async processContent(result: StreamProcessingResult): Promise<void> {
		const hasTextContent = result.assistantMessage.length > 0
		const hasToolUsesInContent = hasToolUses(result.assistantMessageContent)

		// Present any partial blocks that were just completed
		const partialBlocks = await this.callbacks.getPartialBlocks()
		if (partialBlocks.length > 0) {
			await this.callbacks.presentAssistantMessage()
		}

		if (hasTextContent || hasToolUsesInContent) {
			await this.callbacks.emitEvent({
				type: "contentReady",
				timestamp: Date.now(),
				hasTextContent,
				hasToolUses: hasToolUsesInContent,
			})

			// Handle tool use or no tool use
			const didToolUse = hasToolUses(result.assistantMessageContent)

			if (!didToolUse) {
				await this.handleNoToolUse()
			} else {
				await this.callbacks.resetConsecutiveNoToolUseCount()
			}

			// CRITICAL: Wait for userMessageContentReady before pushing to stack
			// This mirrors the old code: await pWaitFor(() => this.userMessageContentReady)
			// presentAssistantMessage executes tools and sets userMessageContentReady to true
			// when all tool results are collected.
			await this.callbacks.waitForUserMessageContentReady()

			// Push to stack if there's content OR if we're paused waiting for a subtask
			// This triggers the next iteration of the request loop
			const userMessageContent = await this.callbacks.getUserMessageContent()
			const isPaused = await this.callbacks.isPaused()

			if (userMessageContent.length > 0 || isPaused) {
				await this.callbacks.pushToStack({
					userContent: [...userMessageContent],
					includeFileDetails: false,
				})
			}
		} else {
			// No content - handle error
			this.state.consecutiveNoContentFailures++
			await this.handleNoContent(result)
		}
	}

	/**
	 * Handle no tool use
	 */
	private async handleNoToolUse(): Promise<void> {
		// Increment consecutive no-tool-use counter
		const count = await this.callbacks.incrementConsecutiveNoToolUseCount()

		// Only show error and count toward mistake limit after 2 consecutive failures
		if (count >= 2) {
			await this.callbacks.say("error", { text: "MODEL_NO_TOOLS_USED" })
			await this.callbacks.incrementConsecutiveMistakeCount()
		}

		// Add no tools used message
		await this.callbacks.pushToUserMessageContent({
			type: "text",
			text: formatResponse.noToolsUsed(),
		})
	}

	/**
	 * Handle no content error
	 */
	private async handleNoContent(result: StreamProcessingResult): Promise<void> {
		// Increment consecutive no-assistant-messages counter
		const count = await this.callbacks.incrementConsecutiveNoAssistantMessagesCount()

		// Only show error after 2 consecutive failures
		if (count >= 2) {
			await this.callbacks.say("error", { text: "MODEL_NO_ASSISTANT_MESSAGES" })
		}

		await this.callbacks.emitEvent({
			type: "noContentError",
			timestamp: Date.now(),
			consecutiveFailures: count,
		})

		// Remove the last user message that we added earlier
		await this.callbacks.removeLastUserMessageFromHistory()

		// Check if we should auto-retry or prompt the user
		const state = await this.callbacks.getState()
		const currentUserContent = await this.callbacks.getCurrentUserContent()
		const currentItem = await this.callbacks.getCurrentStackItem()

		if (state?.autoApprovalEnabled) {
			// Auto-retry with backoff
			await this.callbacks.backoffAndAnnounce(
				currentItem?.retryAttempt ?? 0,
				new Error(
					"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
				),
			)

			// Check if task was aborted during the backoff
			const wasAborted = await this.callbacks.wasAborted()
			if (wasAborted) {
				return
			}

			// Push the same content back onto the stack to retry
			await this.callbacks.pushToStack({
				userContent: currentUserContent,
				includeFileDetails: false,
				retryAttempt: (currentItem?.retryAttempt ?? 0) + 1,
				userMessageWasRemoved: true,
			})

			await this.callbacks.emitEvent({
				type: "retryRequested",
				timestamp: Date.now(),
				reason: "No assistant messages",
				retryAttempt: (currentItem?.retryAttempt ?? 0) + 1,
				autoRetry: true,
			})
		} else {
			// Prompt the user for retry decision
			const { response } = await this.callbacks.ask(
				"api_req_failed",
				"The model returned no assistant messages. This may indicate an issue with the API or the model's output.",
			)

			if (response === "yesButtonClicked") {
				await this.callbacks.say("api_req_retried")

				// Push the same content back to retry
				await this.callbacks.pushToStack({
					userContent: currentUserContent,
					includeFileDetails: false,
					retryAttempt: (currentItem?.retryAttempt ?? 0) + 1,
				})

				await this.callbacks.emitEvent({
					type: "retryRequested",
					timestamp: Date.now(),
					reason: "User approved retry",
					retryAttempt: (currentItem?.retryAttempt ?? 0) + 1,
					autoRetry: false,
				})
			} else {
				// User declined to retry - re-add the user message we removed
				await this.callbacks.addToApiConversationHistory({
					role: "user",
					content: currentUserContent,
				})

				await this.callbacks.say("error", {
					text: "Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
				})

				await this.callbacks.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: "Failure: I did not provide a response." }],
				})
			}
		}
	}

	/**
	 * Handle token fallback event
	 */
	private async handleTokenFallback(event: StreamProcessorEvent & { type: "tokenFallback" }): Promise<void> {
		// Token fallback is handled in executeTokenFallback
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle tool call finalized event
	 */
	private async handleToolCallFinalized(event: StreamProcessorEvent & { type: "toolCallFinalized" }): Promise<void> {
		// Tool call finalization is handled in finalizeToolCalls
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle partial blocks completed event
	 */
	private async handlePartialBlocksCompleted(event: StreamProcessorEvent & { type: "partialBlocksCompleted" }): Promise<void> {
		// Partial block completion is handled in completePartialBlocks
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle reasoning completed event
	 */
	private async handleReasoningCompleted(event: StreamProcessorEvent & { type: "reasoningCompleted" }): Promise<void> {
		// Reasoning completion is handled in completeReasoningMessage
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle assistant message saved event
	 */
	private async handleAssistantMessageSaved(event: StreamProcessorEvent & { type: "assistantMessageSaved" }): Promise<void> {
		// Assistant message saving is handled in saveAssistantMessage
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle content ready event
	 */
	private async handleContentReady(event: StreamProcessorEvent & { type: "contentReady" }): Promise<void> {
		// Content processing is handled in processContent
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle no content error event
	 */
	private async handleNoContentError(event: StreamProcessorEvent & { type: "noContentError" }): Promise<void> {
		// No content error is handled in handleNoContent
		// This event is for logging/monitoring purposes
	}

	/**
	 * Handle retry requested event
	 */
	private async handleRetryRequested(event: StreamProcessorEvent & { type: "retryRequested" }): Promise<void> {
		// Retry logic is handled in handleNoContent
		// This event is for logging/monitoring purposes
	}

	/**
	 * Reset state
	 */
	reset(): void {
		this.state.isActive = false
		this.state.lastResult = undefined
		this.state.consecutiveNoContentFailures = 0
	}

	/**
	 * Get current state
	 */
	getState(): StreamPostProcessorState {
		return { ...this.state }
	}
}