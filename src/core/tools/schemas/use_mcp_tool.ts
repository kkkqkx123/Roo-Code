import { z } from "zod"
import type OpenAI from "openai"

import { createOpenAITool } from "./base"

// ─── Schema Definitions ────────────────────────────────────────────────────────

/**
 * Schema for use_mcp_tool tool parameters.
 */
export const UseMcpToolParamsSchema = z.object({
	server_name: z
		.string()
		.describe("The name of the MCP server providing the tool"),
	tool_name: z
		.string()
		.describe("The name of the tool to execute on the MCP server"),
	arguments: z
		.record(z.any())
		.optional()
		.describe("Optional arguments to pass to the MCP tool"),
})

// ─── Type Exports ──────────────────────────────────────────────────────────────

export type UseMcpToolParams = z.infer<typeof UseMcpToolParamsSchema>

// ─── Tool Creation ──────────────────────────────────────────────────────────────

const USE_MCP_TOOL_DESCRIPTION = `Call a tool provided by a connected MCP (Model Context Protocol) server. MCP servers extend the capabilities of the system by providing additional tools for specific tasks.

Parameters:
- server_name: (required) The name of the MCP server providing the tool
- tool_name: (required) The name of the tool to execute on the MCP server
- arguments: (optional) Optional arguments to pass to the MCP tool

Example: Calling a weather tool
{ "server_name": "weather-server", "tool_name": "get_current_weather", "arguments": { "location": "San Francisco" } }

Example: Calling a database tool
{ "server_name": "database-server", "tool_name": "query", "arguments": { "sql": "SELECT * FROM users LIMIT 10" } }

Note: MCP servers must be configured and connected before you can use their tools. Refer to the MCP server documentation for available tools and their required arguments.`

/**
 * Creates the use_mcp_tool tool definition.
 *
 * @returns Native tool definition for use_mcp_tool
 */
export function createUseMcpToolTool(): OpenAI.Chat.ChatCompletionTool {
	return createOpenAITool({
		name: "use_mcp_tool",
		description: USE_MCP_TOOL_DESCRIPTION,
		schema: UseMcpToolParamsSchema,
		strict: true,
	})
}

/**
 * Default use_mcp_tool tool definition.
 */
export const useMcpToolTool = createUseMcpToolTool()
