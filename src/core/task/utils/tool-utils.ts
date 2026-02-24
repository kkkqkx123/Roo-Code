import type { Anthropic } from "@anthropic-ai/sdk"
import type { ToolUse, McpToolUse } from "../../../shared/tools"
import type { AssistantMessageContent } from "../../assistant-message"
import { sanitizeToolUseId } from "../../../utils/tool-id"

/**
 * Check if the assistant message content contains any tool uses.
 *
 * @param assistantMessageContent - The assistant message content blocks
 * @returns true if there are tool_use or mcp_tool_use blocks
 */
export function hasToolUses(assistantMessageContent: AssistantMessageContent[]): boolean {
	return assistantMessageContent.some((block) => block.type === "tool_use" || block.type === "mcp_tool_use")
}

/**
 * Build assistant content for API request from assistant message content.
 * Handles both regular ToolUse and McpToolUse types, with deduplication of tool_use IDs.
 *
 * @param assistantMessage - The text message from the assistant
 * @param assistantMessageContent - The assistant message content blocks
 * @param taskId - The task ID for logging purposes
 * @returns Array of text and tool_use blocks for the API request
 */
export function buildAssistantContent(
	assistantMessage: string,
	assistantMessageContent: AssistantMessageContent[],
	taskId: string,
): Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> {
	const assistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = []

	// Add text content if present
	if (assistantMessage) {
		assistantContent.push({
			type: "text" as const,
			text: assistantMessage,
		})
	}

	// Add tool_use blocks with their IDs for native protocol
	// This handles both regular ToolUse and McpToolUse types
	// IMPORTANT: Track seen IDs to prevent duplicates in the API request.
	// Duplicate tool_use IDs cause Anthropic API 400 errors:
	// "tool_use ids must be unique"
	const seenToolUseIds = new Set<string>()
	const toolUseBlocks = assistantMessageContent.filter(
		(block) => block.type === "tool_use" || block.type === "mcp_tool_use",
	)

	for (const block of toolUseBlocks) {
		if (block.type === "mcp_tool_use") {
			// McpToolUse already has the original tool name (e.g., "mcp_serverName_toolName")
			// The arguments are the raw tool arguments (matching the simplified schema)
			const mcpBlock = block as McpToolUse
			if (mcpBlock.id) {
				const sanitizedId = sanitizeToolUseId(mcpBlock.id)
				// Pre-flight deduplication: Skip if we've already added this ID
				if (seenToolUseIds.has(sanitizedId)) {
					console.warn(
						`[Task#${taskId}] Pre-flight deduplication: Skipping duplicate MCP tool_use ID: ${sanitizedId} (tool: ${mcpBlock.name})`,
					)
					continue
				}
				seenToolUseIds.add(sanitizedId)
				assistantContent.push({
					type: "tool_use" as const,
					id: sanitizedId,
					name: mcpBlock.name, // Original dynamic name
					input: mcpBlock.arguments, // Direct tool arguments
				})
			}
		} else {
			// Regular ToolUse
			const toolUse = block as ToolUse
			const toolCallId = toolUse.id
			if (toolCallId) {
				const sanitizedId = sanitizeToolUseId(toolCallId)
				// Pre-flight deduplication: Skip if we've already added this ID
				if (seenToolUseIds.has(sanitizedId)) {
					console.warn(
						`[Task#${taskId}] Pre-flight deduplication: Skipping duplicate tool_use ID: ${sanitizedId} (tool: ${toolUse.name})`,
					)
					continue
				}
				seenToolUseIds.add(sanitizedId)
				// nativeArgs is already in the correct API format for all tools
				const input = toolUse.nativeArgs || toolUse.params

				// Use originalName (alias) if present for API history consistency.
				// When tool aliases are used (e.g., "edit_file" -> "search_and_replace" -> "edit" (current canonical name)),
				// we want the alias name in the conversation history to match what the model
				// was told the tool was named, preventing confusion in multi-turn conversations.
				const toolNameForHistory = toolUse.originalName ?? toolUse.name

				assistantContent.push({
					type: "tool_use" as const,
					id: sanitizedId,
					name: toolNameForHistory,
					input,
				})
			}
		}
	}

	return assistantContent
}

/**
 * Enforce new_task isolation: if new_task is called alongside other tools,
 * truncate any tools that come after it and return error tool results.
 * This prevents orphaned tools when delegation disposes the parent task.
 *
 * @param assistantContent - The assistant content array to process
 * @param assistantMessageContent - The execution array to truncate
 * @returns Object containing:
 *   - truncatedAssistantContent: The truncated assistant content array
 *   - truncatedAssistantMessageContent: The truncated execution array
 *   - errorToolResults: Array of error tool_result blocks for truncated tools
 */
export function enforceNewTaskIsolation(
	assistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam>,
	assistantMessageContent: AssistantMessageContent[],
): {
	truncatedAssistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam>
	truncatedAssistantMessageContent: AssistantMessageContent[]
	errorToolResults: Anthropic.ToolResultBlockParam[]
} {
	const newTaskIndex = assistantContent.findIndex(
		(block) => block.type === "tool_use" && block.name === "new_task",
	)

	// If new_task is not found or is already the last tool, no action needed
	if (newTaskIndex === -1 || newTaskIndex === assistantContent.length - 1) {
		return {
			truncatedAssistantContent: assistantContent,
			truncatedAssistantMessageContent: assistantMessageContent,
			errorToolResults: [],
		}
	}

	// new_task found but not last - truncate subsequent tools
	const truncatedTools = assistantContent.slice(newTaskIndex + 1)
	const truncatedAssistantContent = assistantContent.slice(0, newTaskIndex + 1)

	// ALSO truncate the execution array (assistantMessageContent) to prevent
	// tools after new_task from being executed.
	// Find new_task index in assistantMessageContent (may differ from assistantContent
	// due to text blocks being structured differently).
	const executionNewTaskIndex = assistantMessageContent.findIndex(
		(block) => block.type === "tool_use" && block.name === "new_task",
	)
	const truncatedAssistantMessageContent =
		executionNewTaskIndex !== -1
			? assistantMessageContent.slice(0, executionNewTaskIndex + 1)
			: assistantMessageContent

	// Pre-inject error tool_results for truncated tools
	const errorToolResults: Anthropic.ToolResultBlockParam[] = []
	for (const tool of truncatedTools) {
		if (tool.type === "tool_use" && (tool as Anthropic.ToolUseBlockParam).id) {
			errorToolResults.push({
				type: "tool_result",
				tool_use_id: (tool as Anthropic.ToolUseBlockParam).id,
				content:
					"This tool was not executed because new_task was called in the same message turn. The new_task tool must be the last tool in a message.",
				is_error: true,
			})
		}
	}

	return {
		truncatedAssistantContent,
		truncatedAssistantMessageContent,
		errorToolResults,
	}
}