import { z } from "zod"
import type OpenAI from "openai"

import { createOpenAITool } from "./base"

// ─── Schema Definitions ────────────────────────────────────────────────────────

/**
 * Schema for update_todo_list tool parameters.
 */
export const UpdateTodoListParamsSchema = z.object({
	todos: z
		.string()
		.describe(
			"Full markdown checklist in execution order, using [ ] for pending, [x] for completed, and [-] for in progress",
		),
})

// ─── Type Exports ──────────────────────────────────────────────────────────────

export type UpdateTodoListParams = z.infer<typeof UpdateTodoListParamsSchema>

// ─── Tool Creation ──────────────────────────────────────────────────────────────

const UPDATE_TODO_LIST_DESCRIPTION = `Replace the entire TODO list with an updated checklist reflecting the current state. Always provide the full list; the system will overwrite the previous one. This tool is designed for step-by-step task tracking, allowing you to confirm completion of each step before updating, update multiple task statuses at once (e.g., mark one as completed and start the next), and dynamically add new todos discovered during long or complex tasks.

Checklist Format:
- Use a single-level markdown checklist (no nesting or subtasks)
- List todos in the intended execution order
- Status options: [ ] (pending), [x] (completed), [-] (in progress)

Core Principles:
- Before updating, always confirm which todos have been completed
- You may update multiple statuses in a single update
- Add new actionable items as they're discovered
- Only mark a task as completed when fully accomplished
- Keep all unfinished tasks unless explicitly instructed to remove

Example: Initial task list
{ "todos": "[x] Analyze requirements\\n[x] Design architecture\\n[-] Implement core logic\\n[ ] Write tests\\n[ ] Update documentation" }

Example: After completing implementation
{ "todos": "[x] Analyze requirements\\n[x] Design architecture\\n[x] Implement core logic\\n[-] Write tests\\n[ ] Update documentation\\n[ ] Add performance benchmarks" }

When to Use:
- Task involves multiple steps or requires ongoing tracking
- Need to update status of several todos at once
- New actionable items are discovered during execution
- Task is complex and benefits from stepwise progress tracking

When NOT to Use:
- Only a single, trivial task
- Task can be completed in one or two simple steps
- Request is purely conversational or informational`

/**
 * Creates the update_todo_list tool definition.
 *
 * @returns Native tool definition for update_todo_list
 */
export function createUpdateTodoListTool(): OpenAI.Chat.ChatCompletionTool {
	return createOpenAITool({
		name: "update_todo_list",
		description: UPDATE_TODO_LIST_DESCRIPTION,
		schema: UpdateTodoListParamsSchema,
		strict: true,
	})
}

/**
 * Default update_todo_list tool definition.
 */
export const updateTodoListTool = createUpdateTodoListTool()
