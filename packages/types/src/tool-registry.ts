/**
 * Tool registry types
 *
 * This module contains types related to tool registration and management.
 */

import type {
	ReadFileParams,
	WriteToFileParams,
	ExecuteCommandParams,
	ReadCommandOutputParams,
	ApplyDiffParams,
	EditParams,
	SearchReplaceParams,
	EditFileParams,
	ApplyPatchParams,
	ListFilesParams,
	NewTaskParams,
	AskFollowupQuestionParams,
	AttemptCompletionParams,
	CodebaseSearchParams,
	UpdateTodoListParams,
	AccessMcpResourceParams,
	UseMcpToolParams,
	RunSlashCommandParams,
	SkillParams,
	SwitchModeParams,
	SearchFilesParams,
	GenerateImageParams,
} from "./tool-params.js"

/**
 * Map of tool names to their parameter types.
 * This can be used for type-safe parameter access.
 */
export interface ToolParamsMap {
	read_file: ReadFileParams
	write_to_file: WriteToFileParams
	execute_command: ExecuteCommandParams
	read_command_output: ReadCommandOutputParams
	ask_followup_question: AskFollowupQuestionParams
	attempt_completion: AttemptCompletionParams
	codebase_search: CodebaseSearchParams
	list_files: ListFilesParams
	search_files: SearchFilesParams
	apply_diff: ApplyDiffParams
	edit: EditParams
	search_replace: SearchReplaceParams
	edit_file: EditFileParams
	apply_patch: ApplyPatchParams
	update_todo_list: UpdateTodoListParams
	access_mcp_resource: AccessMcpResourceParams
	use_mcp_tool: UseMcpToolParams
	run_slash_command: RunSlashCommandParams
	skill: SkillParams
	switch_mode: SwitchModeParams
	new_task: NewTaskParams
	generate_image: GenerateImageParams
}
