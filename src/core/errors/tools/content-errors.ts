/**
 * Tool content errors.
 * Errors that occur during content matching and search operations.
 */

import type { ToolName } from "@coder/types"
import type { LLMErrorPayload, LogEntry } from "./validation-errors.js"

/**
 * Sanitize parameters for logging.
 */
function sanitizeForLogging(params?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!params) return undefined
	
	const sensitiveKeys = ["key", "secret", "token", "password", "credential", "auth", "content"]
	
	const sanitized: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(params)) {
		const lowerKey = key.toLowerCase()
		if (sensitiveKeys.some(s => lowerKey.includes(s))) {
			sanitized[key] = "[REDACTED]"
		} else {
			sanitized[key] = value
		}
	}
	return sanitized
}

/**
 * Base class for content errors.
 */
export abstract class ContentError extends Error {
	constructor(
		message: string,
		public readonly toolName: ToolName,
		public readonly filePath?: string,
		public readonly suggestion?: string
	) {
		super(message)
		this.name = "ContentError"
	}

	toLLMMessage(): LLMErrorPayload {
		return {
			status: "error",
			type: "content_error",
			error_class: this.constructor.name,
			message: this.message,
			...(this.filePath && { path: this.filePath }),
			suggestion: this.suggestion,
		}
	}

	toLogEntry(params?: Record<string, unknown>): LogEntry {
		return {
			level: "warn",
			category: "content_matching",
			tool: this.toolName,
			error_type: this.constructor.name,
			path: this.filePath,
			message: this.message,
			params: sanitizeForLogging(params),
			timestamp: Date.now(),
		}
	}
}

/**
 * Content not found in file.
 */
export class ContentNotFoundError extends ContentError {
	constructor(
		toolName: ToolName,
		filePath: string,
		searchTerm: string
	) {
		super(
			`Content not found in ${filePath}: ${searchTerm.substring(0, 50)}${searchTerm.length > 50 ? "..." : ""}`,
			toolName,
			filePath,
			"Read the current file content with read_file to verify the exact text. " +
			"Ensure the search string matches exactly, including whitespace and indentation."
		)
		this.name = "ContentNotFoundError"
	}
}

/**
 * Content mismatch (found similar but not exact match).
 */
export class ContentMismatchError extends ContentError {
	constructor(
		toolName: ToolName,
		filePath: string,
		expected: string,
		found: string
	) {
		super(
			`Content mismatch in ${filePath}: expected text doesn't match actual content`,
			toolName,
			filePath,
			"Read the file to see the current content. " +
			"Update your search string to match the exact content, including all whitespace."
		)
		this.name = "ContentMismatchError"
	}
}

/**
 * Duplicate matches found (multiple occurrences of search string).
 */
export class DuplicateMatchError extends ContentError {
	constructor(
		toolName: ToolName,
		filePath: string,
		searchTerm: string,
		matchCount: number
	) {
		super(
			`Found ${matchCount} matches for the search string in ${filePath}`,
			toolName,
			filePath,
			"Use a more specific search string with additional context to make it unique, " +
			"or use replace_all: true if you intend to replace all occurrences."
		)
		this.name = "DuplicateMatchError"
	}
}

/**
 * No matches found for search operation.
 */
export class NoMatchFoundError extends ContentError {
	constructor(
		toolName: ToolName,
		filePath: string,
		searchTerm: string
	) {
		super(
			`No matches found for '${searchTerm.substring(0, 50)}${searchTerm.length > 50 ? "..." : ""}' in ${filePath}`,
			toolName,
			filePath,
			"Read the file content to verify the search string. " +
			"The text to search for must match exactly, character for character."
		)
		this.name = "NoMatchFoundError"
	}
}
