/**
 * Tool Call Handler
 * 
 * Handles tool call chunks from the streaming API.
 * Supports both partial (streaming) and complete tool calls.
 * Manages incremental updates of tool call parameters.
 */

import { NativeToolCallParser } from "../../../assistant-message/NativeToolCallParser"
import { BaseChunkHandler } from "./ChunkHandler"
import type { ChunkHandlerContext, StreamChunk, ToolCallEvent } from "../types"
import type { ToolName } from "../../../../shared/tools"

export class ToolCallHandler extends BaseChunkHandler {
	/**
	 * Handle tool call stream chunks
	 */
	async handle(chunk: StreamChunk): Promise<void> {
		if (chunk.type === "tool_call_partial") {
			await this.handleToolCallPartial(chunk)
		} else if (chunk.type === "tool_call") {
			await this.handleToolCall(chunk)
		}
	}

	/**
	 * Handle partial tool call chunks (streaming)
	 */
	private async handleToolCallPartial(chunk: StreamChunk): Promise<void> {
		if (chunk.type !== "tool_call_partial") {
			return
		}

		const events = NativeToolCallParser.processRawChunk({
			index: chunk.index,
			id: chunk.id,
			name: chunk.name,
			arguments: chunk.arguments,
		})

		for (const event of events) {
			switch (event.type) {
				case "tool_call_start":
					await this.handleToolCallStart(event)
					break
				case "tool_call_delta":
					await this.handleToolCallDelta(event)
					break
				case "tool_call_end":
					await this.handleToolCallEnd(event)
					break
			}
		}
	}

	/**
	 * Handle tool_call_start event
	 */
	private async handleToolCallStart(event: Extract<ToolCallEvent, { type: "tool_call_start" }>): Promise<void> {
		// Prevent duplicate tool call start events
		if (this.stateManager.getToolCallIndex(event.id) !== undefined) {
			console.warn(
				`[Task#${this.config.taskId}] Ignoring duplicate tool_call_start for ID: ${event.id} (tool: ${event.name})`
			)
			return
		}

		// Initialize streaming tool call
		NativeToolCallParser.startStreamingToolCall(event.id, event.name as ToolName)

		// Track tool call tokens
		this.tokenManager.addToolCallTokens(event.id, event.name, "")

		// Complete previous text block
		this.completePreviousTextBlock()

		// Record tool call index
		const toolUseIndex = this.stateManager.getAssistantMessageContent().length
		this.stateManager.addToolCallIndex(event.id, toolUseIndex)

		// Create partial tool use
		const partialToolUse: any = {
			type: "tool_use",
			name: event.name,
			params: {},
			partial: true,
		}
		partialToolUse.id = event.id

		this.stateManager.addAssistantContentBlock(partialToolUse)

		// Present assistant message
		this.config.onPresentAssistant()
	}

	/**
	 * Handle tool_call_delta event
	 */
	private async handleToolCallDelta(event: Extract<ToolCallEvent, { type: "tool_call_delta" }>): Promise<void> {
		const partialToolUse = NativeToolCallParser.processStreamingChunk(event.id, event.delta)

		if (!partialToolUse) {
			return
		}

		const toolUseIndex = this.stateManager.getToolCallIndex(event.id)

		if (toolUseIndex === undefined) {
			return
		}

		;(partialToolUse as any).id = event.id
		this.stateManager.updateAssistantContentBlock(toolUseIndex, partialToolUse)

		// Update tool call token count
		if (partialToolUse.name) {
			this.tokenManager.addToolCallTokens(
				event.id,
				partialToolUse.name,
				JSON.stringify(partialToolUse.params || {})
			)
		}

		// Present assistant message
		this.config.onPresentAssistant()
	}

	/**
	 * Handle tool_call_end event
	 */
	private async handleToolCallEnd(event: Extract<ToolCallEvent, { type: "tool_call_end" }>): Promise<void> {
		const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
		const toolUseIndex = this.stateManager.getToolCallIndex(event.id)

		if (finalToolUse) {
			;(finalToolUse as any).id = event.id

			if (toolUseIndex !== undefined) {
				this.stateManager.updateAssistantContentBlock(toolUseIndex, finalToolUse)
			}

			this.stateManager.removeToolCallIndex(event.id)
		} else if (toolUseIndex !== undefined) {
			// JSON format error or missing parameters
			const existingToolUse = this.stateManager.getAssistantMessageContent()[toolUseIndex]

			if (existingToolUse && existingToolUse.type === "tool_use") {
				existingToolUse.partial = false
				;(existingToolUse as any).id = event.id
			}

			this.stateManager.removeToolCallIndex(event.id)
		}

		// Present assistant message
		this.config.onPresentAssistant()
	}

	/**
	 * Handle complete tool call chunks (non-streaming, backward compatibility)
	 */
	private async handleToolCall(chunk: StreamChunk): Promise<void> {
		if (chunk.type !== "tool_call") {
			return
		}

		// Backward compatibility: handle complete tool calls
		const toolUse = NativeToolCallParser.parseToolCall({
			id: chunk.id,
			name: chunk.name as ToolName,
			arguments: chunk.arguments,
		})

		if (!toolUse) {
			console.error(`Failed to parse tool call for task ${this.config.taskId}:`, chunk)
			return
		}

		;(toolUse as any).id = chunk.id
		this.stateManager.addAssistantContentBlock(toolUse)

		// Present assistant message
		this.config.onPresentAssistant()
	}

	/**
	 * Complete the previous text block if it exists
	 */
	private completePreviousTextBlock(): void {
		const lastBlock = this.stateManager.getAssistantMessageContent().at(-1)

		if (lastBlock?.type === "text" && lastBlock.partial) {
			lastBlock.partial = false
		}
	}

	/**
	 * Finalize a specific tool call (called when stream ends without explicit end event)
	 */
	async finalizeToolCall(toolCallId: string): Promise<void> {
		await this.handleToolCallEnd({ type: "tool_call_end", id: toolCallId })
	}
}
