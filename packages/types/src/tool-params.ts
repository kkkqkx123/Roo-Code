/**
 * Tool parameter type definitions for native protocol
 */

// ─── Read Operations ────────────────────────────────────────────────────────

/**
 * Read mode for the read_file tool.
 * - "slice": Simple offset/limit reading (default)
 * - "indentation": Semantic block extraction based on code structure
 */
export type ReadFileMode = "slice" | "indentation"

/**
 * Indentation-mode configuration for the read_file tool.
 */
export interface IndentationParams {
	/** 1-based line number to anchor indentation extraction (defaults to offset) */
	anchor_line?: number
	/** Maximum indentation levels to include above anchor (0 = unlimited) */
	max_levels?: number
	/** Include sibling blocks at the same indentation level */
	include_siblings?: boolean
	/** Include file header (imports, comments at top) */
	include_header?: boolean
	/** Hard cap on lines returned for indentation mode */
	max_lines?: number
}

/**
 * Parameters for the read_file tool (new format).
 *
 * NOTE: This is the canonical, single-file-per-call shape.
 */
export interface ReadFileParams {
	/** Path to the file, relative to workspace */
	path: string
	/** Reading mode: "slice" (default) or "indentation" */
	mode?: ReadFileMode
	/** 1-based line number to start reading from (slice mode, default: 1) */
	offset?: number
	/** Maximum number of lines to read (default: 2000) */
	limit?: number
	/** Indentation-mode configuration (only used when mode === "indentation") */
	indentation?: IndentationParams
}

/**
 * Parameters for the codebase_search tool.
 */
export interface CodebaseSearchParams {
	queries: Array<string | { query: string; path?: string }>
}

/**
 * Parameters for the list_files tool.
 */
export interface ListFilesParams {
	path: string
	recursive?: boolean
}

/**
 * Parameters for the search_files tool.
 */
export interface SearchFilesParams {
	path: string
	regex: string
	file_pattern?: string | null
}

// ─── Write Operations ───────────────────────────────────────────────────────

/**
 * Parameters for the write_to_file tool.
 */
export interface WriteToFileParams {
	path: string
	content: string
}

/**
 * Parameters for the apply_diff tool.
 */
export interface ApplyDiffParams {
	path: string
	diff: string
}

/**
 * Parameters for the edit tool.
 */
export interface EditParams {
	file_path: string
	old_string: string
	new_string: string
	replace_all?: boolean
}

/**
 * Parameters for the search_replace tool.
 */
export interface SearchReplaceParams {
	file_path: string
	old_string: string
	new_string: string
}

/**
 * Parameters for the edit_file tool.
 */
export interface EditFileParams {
	file_path: string
	old_string: string
	new_string: string
	expected_replacements?: number
}

/**
 * Parameters for the apply_patch tool.
 */
export interface ApplyPatchParams {
	patch: string
}

// ─── Command Operations ───────────────────────────────────────────────────────

/**
 * Parameters for the execute_command tool.
 */
export interface ExecuteCommandParams {
	command: string
	cwd?: string | null
}

/**
 * Parameters for the read_command_output tool.
 */
export interface ReadCommandOutputParams {
	artifact_id: string
	search?: string
	offset?: number
	limit?: number
}

// ─── MCP Operations ─────────────────────────────────────────────────────────

/**
 * Parameters for the use_mcp_tool tool.
 */
export interface UseMcpToolParams {
	server_name: string
	tool_name: string
	arguments?: Record<string, unknown>
}

/**
 * Parameters for the access_mcp_resource tool.
 */
export interface AccessMcpResourceParams {
	server_name: string
	uri: string
}

// ─── Mode Operations ─────────────────────────────────────────────────────────

/**
 * Parameters for the ask_followup_question tool.
 */
export interface AskFollowupQuestionParams {
	question: string
	follow_up: Array<{ text: string; mode: string | null }>
}

/**
 * Parameters for the attempt_completion tool.
 */
export interface AttemptCompletionParams {
	result: string
	command?: string
}

/**
 * Parameters for the switch_mode tool.
 */
export interface SwitchModeParams {
	mode_slug: string
	reason: string
}

/**
 * Parameters for the new_task tool.
 */
export interface NewTaskParams {
	mode: string
	message: string
	todos?: string
}

/**
 * Parameters for the update_todo_list tool.
 */
export interface UpdateTodoListParams {
	todos: string
}

/**
 * Parameters for the run_slash_command tool.
 */
export interface RunSlashCommandParams {
	command: string
	args?: string | null
}

/**
 * Parameters for the skill tool.
 */
export interface SkillParams {
	skill: string
	args?: string | null
}

// ─── Image Operations ────────────────────────────────────────────────────────

/**
 * Parameters for the generate_image tool.
 */
export interface GenerateImageParams {
	prompt: string
	path: string
	image?: string
}

// ─── Legacy Format Types (Backward Compatibility) ─────────────────────────────

/**
 * Line range specification for legacy read_file format.
 * Represents a contiguous range of lines [start, end] (1-based, inclusive).
 */
export interface LineRange {
	start: number
	end: number
}

/**
 * File entry for legacy read_file format.
 * Supports reading multiple disjoint line ranges from a single file.
 */
export interface FileEntry {
	/** Path to the file, relative to workspace */
	path: string
	/** Optional list of line ranges to read (if omitted, reads entire file) */
	lineRanges?: LineRange[]
}

/**
 * Legacy parameters for the read_file tool (pre-refactor format).
 * Supports reading multiple files in a single call with optional line ranges.
 *
 * @deprecated Use ReadFileParams instead. This format is maintained for
 * backward compatibility with existing chat histories.
 */
export interface LegacyReadFileParams {
	/** Array of file entries to read */
	files: FileEntry[]
	/** Discriminant flag for type narrowing */
	_legacyFormat: true
}

/**
 * Union type for read_file tool parameters.
 * Supports both new single-file format and legacy multi-file format.
 */
export type ReadFileToolParams = ReadFileParams | LegacyReadFileParams

/**
 * Type guard to check if params are in legacy format.
 */
export function isLegacyReadFileParams(params: ReadFileToolParams): params is LegacyReadFileParams {
	return "_legacyFormat" in params && params._legacyFormat === true
}

/**
 * Coordinate type for image operations.
 */
export interface Coordinate {
	x: number
	y: number
}

/**
 * Size type for image operations.
 */
export interface Size {
	width: number
	height: number
}
