import { z } from "zod"
import type OpenAI from "openai"

import { createOpenAITool } from "./base"

// ─── Schema Definitions ────────────────────────────────────────────────────────

/**
 * Schema for get_workspace_diagnostics tool parameters.
 */
export const GetWorkspaceDiagnosticsParamsSchema = z.object({
	targets: z
		.array(z.string())
		.optional()
		.describe("File paths, folder paths, or glob patterns to get diagnostics for. If not provided, gets diagnostics for entire workspace"),
	severity: z
		.array(z.enum(["error", "warning", "information", "hint"]))
		.optional()
		.describe("Diagnostic severities to include. Default: ['error', 'warning']"),
	sources: z
		.array(z.string())
		.optional()
		.describe("Diagnostic sources to filter by (e.g., 'typescript', 'eslint')"),
	codes: z
		.array(z.union([z.string(), z.number()]))
		.optional()
		.describe("Diagnostic codes to filter by (e.g., 'TS2532', 'no-unused-vars')"),
	maxResults: z
		.number()
		.optional()
		.describe("Maximum number of diagnostic results to return. Default: 100"),
	includeRelatedInformation: z
		.boolean()
		.optional()
		.describe("Whether to include related diagnostic information. Default: false"),
	includeTags: z
		.boolean()
		.optional()
		.describe("Whether to include diagnostic tags. Default: false"),
	sortBy: z
		.enum(["severity", "file", "line", "source"])
		.optional()
		.describe("Sort order for results. Default: 'severity'"),
	summaryOnly: z
		.boolean()
		.optional()
		.describe("Whether to return only summary information. Default: false"),
})

// ─── Type Exports ──────────────────────────────────────────────────────────────

export type GetWorkspaceDiagnosticsParams = z.infer<typeof GetWorkspaceDiagnosticsParamsSchema>

// ─── Tool Creation ──────────────────────────────────────────────────────────────

const GET_WORKSPACE_DIAGNOSTICS_DESCRIPTION = `Query diagnostic information for specific files, folders, or the entire workspace. Returns detailed diagnostic data including severity, source, code, and location information.

Parameters:
- targets: (optional) File paths, folder paths, or glob patterns to get diagnostics for. If not provided, gets diagnostics for entire workspace
- severity: (optional) Diagnostic severities to include. Default: ['error', 'warning']
- sources: (optional) Diagnostic sources to filter by (e.g., 'typescript', 'eslint')
- codes: (optional) Diagnostic codes to filter by (e.g., 'TS2532', 'no-unused-vars')
- maxResults: (optional) Maximum number of diagnostic results to return. Default: 100
- includeRelatedInformation: (optional) Whether to include related diagnostic information. Default: false
- includeTags: (optional) Whether to include diagnostic tags. Default: false
- sortBy: (optional) Sort order for results. Default: 'severity'
- summaryOnly: (optional) Whether to return only summary information. Default: false

Example: Get all errors and warnings in src directory
{ "targets": ["src/"], "severity": ["error", "warning"], "maxResults": 50 }

Example: Get diagnostics for a specific file with full details
{ "targets": ["src/utils/helper.ts"], "includeRelatedInformation": true, "includeTags": true }

Example: Get summary only for entire workspace
{ "summaryOnly": true }

Example: Filter by specific diagnostic source
{ "sources": ["typescript"], "maxResults": 20 }`

/**
 * Creates the get_workspace_diagnostics tool definition.
 *
 * @returns Native tool definition for get_workspace_diagnostics
 */
export function createGetWorkspaceDiagnosticsTool(): OpenAI.Chat.ChatCompletionTool {
	return createOpenAITool({
		name: "get_workspace_diagnostics",
		description: GET_WORKSPACE_DIAGNOSTICS_DESCRIPTION,
		schema: GetWorkspaceDiagnosticsParamsSchema,
		strict: true,
	})
}

/**
 * Default get_workspace_diagnostics tool definition.
 */
export const getWorkspaceDiagnosticsTool = createGetWorkspaceDiagnosticsTool()
