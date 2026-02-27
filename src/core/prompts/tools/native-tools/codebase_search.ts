import type OpenAI from "openai"

const CODEBASE_SEARCH_DESCRIPTION = `This tool uses semantic search to find relevant code based on meaning rather than just keywords. For precise search (like a certain function name), use regex_search (search_files tool) instead.

**IMPORTANT**: Always use simple query terms. Avoid using complex queries that contain multiple content. Queries MUST be in English (translate if needed).

**Batch Query Support**: You can provide multiple queries in a single call for complex searches. This is more efficient than multiple separate calls. Results are automatically deduplicated and results matching multiple queries get a score boost (+5% per additional match).

Parameters:
- queries: (required) Array of queries for batch search. Can be:
  - Array of strings: ["error handling", "exception handling"]
  - Array of objects: [{ "query": "error handling", "path": "src/utils" }]

Examples:

Single query:
{ "queries": ["authentication validation"] }

Batch query (simple):
{ "queries": ["error handling", "exception handling", "try catch"] }

Batch query with paths:
{
  "queries": [
    { "query": "error handling", "path": "src/utils" },
    { "query": "exception handling", "path": "src/api" }
  ]
}`

const QUERIES_PARAMETER_DESCRIPTION = `Array of queries for batch search. Can be array of strings or array of objects with "query" and optional "path" fields`

export default {
	type: "function",
	function: {
		name: "codebase_search",
		description: CODEBASE_SEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				queries: {
					type: "array",
					description: QUERIES_PARAMETER_DESCRIPTION,
					items: {
						oneOf: [
							{ type: "string" },
							{
								type: "object",
								properties: {
									query: { type: "string" },
									path: { type: "string" },
								},
								required: ["query"],
								additionalProperties: false,
							},
						],
					},
				},
			},
			required: ["queries"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
