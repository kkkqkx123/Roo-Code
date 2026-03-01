import { z } from "zod"
import type OpenAI from "openai"

import { createOpenAITool } from "./base"

// ─── Schema Definitions ────────────────────────────────────────────────────────

/**
 * Schema for access_mcp_resource tool parameters.
 */
export const AccessMcpResourceParamsSchema = z.object({
	server_name: z
		.string()
		.describe("The name of the MCP server providing the resource"),
	uri: z
		.string()
		.describe("The URI identifying the specific resource to access"),
})

// ─── Type Exports ──────────────────────────────────────────────────────────────

export type AccessMcpResourceParams = z.infer<typeof AccessMcpResourceParamsSchema>

// ─── Tool Creation ──────────────────────────────────────────────────────────────

const ACCESS_MCP_RESOURCE_DESCRIPTION = `Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.

Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access

Example: Accessing a weather resource
{ "server_name": "weather-server", "uri": "weather://san-francisco/current" }

Example: Accessing a file resource from an MCP server
{ "server_name": "filesystem-server", "uri": "file:///path/to/data.json" }`

/**
 * Creates the access_mcp_resource tool definition.
 *
 * @returns Native tool definition for access_mcp_resource
 */
export function createAccessMcpResourceTool(): OpenAI.Chat.ChatCompletionTool {
	return createOpenAITool({
		name: "access_mcp_resource",
		description: ACCESS_MCP_RESOURCE_DESCRIPTION,
		schema: AccessMcpResourceParamsSchema,
		strict: true,
	})
}

/**
 * Default access_mcp_resource tool definition.
 */
export const accessMcpResourceTool = createAccessMcpResourceTool()
