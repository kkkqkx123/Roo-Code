import type OpenAI from "openai"

const CODEBASE_SEARCH_DESCRIPTION = `This tool uses semantic search to find relevant code based on meaning rather than just keywords. For precise search(like a certain function name), use regex_search(search_files tool) instead.
**IMPORTANT**: Always use simple query terms. Avoid using complex queries that contain multiple content. Queries MUST be in English (translate if needed). For complex query, you can split it into multiple codebase_search calls, or only search the most important content.**
For example, If you need to search "user login and authentication validation", search "authentication validation" is usually enough. You can search other information in other codebase_search calls or read relevant files directly based on codebase_search results.


Parameters:
- query: (required) The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory). Leave empty for entire workspace.

Example: Searching for user login and authentication validation
{ "query": "authentication validation", "path": "src/auth" }

Example: Searching entire workspace for database connection pooling
{ "query": "database connection pooling", "path": null }`

const QUERY_PARAMETER_DESCRIPTION = `Meaning-based search query describing the information you need`

const PATH_PARAMETER_DESCRIPTION = `Optional subdirectory (relative to the workspace) to limit the search scope`

export default {
	type: "function",
	function: {
		name: "codebase_search",
		description: CODEBASE_SEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: QUERY_PARAMETER_DESCRIPTION,
				},
				path: {
					type: ["string", "null"],
					description: PATH_PARAMETER_DESCRIPTION,
				},
			},
			required: ["query", "path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
