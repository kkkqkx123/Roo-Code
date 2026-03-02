import { Anthropic } from "@anthropic-ai/sdk"

import type {
	ClineAsk,
	ToolProgressStatus,
	ToolGroup,
	ToolName,
	GenerateImageParams,
	ToolUse,
	McpToolUse,
} from "@coder/types"

export type { ToolName }

// ─── Core Types ────────────────────────────────────────────────────────────────

/**
 * Tool response type - can be a simple string or an array of text/image blocks.
 */
export type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

/**
 * Callback type for asking user approval before executing a tool.
 */
export type AskApproval = (
	type: ClineAsk,
	partialMessage?: string,
	progressStatus?: ToolProgressStatus,
	forceApproval?: boolean,
) => Promise<boolean>

/**
 * Callback type for handling errors that occur during tool execution.
 */
export type HandleError = (action: string, error: Error) => Promise<void>

/**
 * Callback type for pushing tool results to the output.
 */
export type PushToolResult = (content: ToolResponse) => void

// ─── Tool Use Interfaces ────────────────────────────────────────────────────────

/**
 * Generic ToolUse interface that provides proper typing for both protocols.
 *
 * @template TName - The specific tool name, which determines the nativeArgs type
 *
 * @deprecated Import from `@coder/types` instead.
 */
export type { ToolUse } from "@coder/types"
export type { McpToolUse } from "@coder/types"

// ─── Tool Group Configuration ────────────────────────────────────────────────────

/**
 * Configuration for a tool group.
 */
export type ToolGroupConfig = {
	tools: readonly string[]
	alwaysAvailable?: boolean // Whether this group is always available and shouldn't show in prompts view
	customTools?: readonly string[] // Opt-in only tools - only available when explicitly included via model's includedTools
}

/**
 * Define available tool groups.
 */
export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
	read: {
		tools: ["read_file", "search_files", "list_files", "codebase_search"],
	},
	edit: {
		tools: ["apply_diff", "write_to_file", "generate_image", "apply_patch"],
		customTools: ["edit", "search_replace", "edit_file"],
	},
	command: {
		tools: ["execute_command", "read_command_output"],
	},
	mcp: {
		tools: ["use_mcp_tool", "access_mcp_resource"],
	},
	modes: {
		tools: ["switch_mode", "new_task"],
		alwaysAvailable: true,
	},
}

/**
 * Tools that are always available to all modes.
 */
export const ALWAYS_AVAILABLE_TOOLS: ToolName[] = [
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"update_todo_list",
	"run_slash_command",
	"skill",
] as const

/**
 * Central registry of tool aliases.
 * Maps alias name -> canonical tool name.
 *
 * This allows models to use alternative names for tools (e.g., "edit_file" instead of "apply_diff").
 * When a model calls a tool by its alias, the system resolves it to the canonical name for execution,
 * but preserves the alias in API conversation history for consistency.
 *
 * To add a new alias, simply add an entry here. No other files need to be modified.
 */
export const TOOL_ALIASES: Record<string, ToolName> = {
	write_file: "write_to_file",
	search_and_replace: "edit",
} as const

// ─── Diff Handling Types ─────────────────────────────────────────────────────────

/**
 * Diff handling types.
 *
 * @deprecated Import from `@coder/core/diff` instead.
 * This type is kept for backward compatibility and will be removed in a future version.
 *
 * Migration guide:
 * 1. Replace import: `import type { DiffResult } from "@coder/shared/tools"`
 * 2. With: `import type { DiffResult } from "@coder/core/diff"`
 */
export type {
	DiffResult,
	DiffItem,
	DiffStrategy,
} from "../core/diff/types"
