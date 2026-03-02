/**
 * Tool use types
 *
 * This module contains types related to tool invocation and usage.
 * Parameter names are dynamically derived from schema definitions.
 */

import type { ToolName } from "./tool.js"

/**
 * Dynamic parameter name type based on tool.
 * This type is derived from the schema definition for each tool.
 */
export type ToolParamName<TName extends ToolName = ToolName> =
	TName extends keyof import("./tool-registry.js").ToolParamsMap
		? keyof import("./tool-registry.js").ToolParamsMap[TName]
		: string

/**
 * Generic ToolUse interface.
 */
export interface ToolUse<TName extends ToolName = ToolName> {
	type: "tool_use"
	id?: string
	name: TName
	originalName?: string
	params: Partial<Record<ToolParamName<TName>, string>>
	partial: boolean
	nativeArgs?: unknown
	usedLegacyFormat?: boolean
}

/**
 * Represents a native MCP tool call.
 */
export interface McpToolUse {
	type: "mcp_tool_use"
	id?: string
	name: string
	serverName: string
	toolName: string
	arguments: Record<string, unknown>
	partial: boolean
}
