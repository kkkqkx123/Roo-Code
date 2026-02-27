/**
 * Tool file operation errors.
 * Errors that occur during file operations (read, write, delete, etc.).
 */

import type { ToolName } from "@coder/types"
import type { LLMErrorPayload, LogEntry } from "./validation-errors.js"

/**
 * Sanitize parameters for logging (remove sensitive data).
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
 * Base class for file operation errors.
 */
export abstract class FileOperationError extends Error {
	constructor(
		message: string,
		public readonly toolName: ToolName,
		public readonly filePath: string,
		public readonly suggestion?: string
	) {
		super(message)
		this.name = "FileOperationError"
	}

	toLLMMessage(): LLMErrorPayload {
		return {
			status: "error",
			type: "file_operation_error",
			error_class: this.constructor.name,
			message: this.message,
			path: this.filePath,
			suggestion: this.suggestion,
		}
	}

	toLogEntry(params?: Record<string, unknown>): LogEntry {
		return {
			level: "error",
			category: "file_operation",
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
 * File not found.
 */
export class FileNotFoundToolError extends FileOperationError {
	constructor(toolName: ToolName, filePath: string) {
		super(
			`File not found: ${filePath}`,
			toolName,
			filePath,
			"Verify the file path exists using list_files or search_files before attempting operations. " +
			"Check if the path is relative to the workspace directory."
		)
		this.name = "FileNotFoundToolError"
	}
}

/**
 * File already exists (for write operations that expect new files).
 */
export class FileAlreadyExistsError extends FileOperationError {
	constructor(toolName: ToolName, filePath: string) {
		super(
			`File already exists: ${filePath}`,
			toolName,
			filePath,
			"Use edit_file, apply_diff, or edit tool to modify existing files. " +
			"Or choose a different file path for new file creation."
		)
		this.name = "FileAlreadyExistsError"
	}
}

/**
 * Directory not found.
 */
export class DirectoryNotFoundToolError extends FileOperationError {
	constructor(toolName: ToolName, dirPath: string) {
		super(
			`Directory not found: ${dirPath}`,
			toolName,
			dirPath,
			"Verify the directory path exists using list_files. " +
			"Consider creating the directory first if needed."
		)
		this.name = "DirectoryNotFoundToolError"
	}
}

/**
 * Permission denied (including .rooignore violations).
 */
export class PermissionDeniedToolError extends FileOperationError {
	constructor(
		toolName: ToolName,
		filePath: string,
		reason: "rooignore" | "write_protected" | "system_permission"
	) {
		const suggestions = {
			rooignore:
				"This file is restricted by .rooignore. Options: " +
				"1) Ask the user to update .rooignore, " +
				"2) Work with alternative files, " +
				"3) Request user approval for this specific operation.",
			write_protected:
				"File is write-protected. Request user approval or choose a different file.",
			system_permission:
				"System permission denied. Check file permissions or choose a different file.",
		}

		super(
			`Access denied: ${filePath} (${reason})`,
			toolName,
			filePath,
			suggestions[reason]
		)
		this.name = "PermissionDeniedToolError"
	}
}

/**
 * RooIgnore violation error.
 */
export class RooIgnoreViolationError extends FileOperationError {
	constructor(toolName: ToolName, filePath: string) {
		super(
			`Path is restricted by .rooignore: ${filePath}`,
			toolName,
			filePath,
			"This file is restricted by .rooignore. Options: " +
			"1) Ask the user to update .rooignore, " +
			"2) Work with alternative files, " +
			"3) Request user approval for this specific operation."
		)
		this.name = "RooIgnoreViolationError"
	}
}

/**
 * Directory creation failed.
 */
export class DirectoryCreationError extends FileOperationError {
	constructor(toolName: ToolName, dirPath: string, reason: string) {
		super(
			`Failed to create directory: ${dirPath}`,
			toolName,
			dirPath,
			"Ensure parent directory exists and you have write permission. " +
			"Verify the file path is within the workspace directory."
		)
		this.name = "DirectoryCreationError"
		this.message = `${this.message}\nReason: ${reason}`
	}
}

/**
 * Binary file error - cannot read/parse binary content.
 */
export class BinaryFileError extends FileOperationError {
	constructor(toolName: ToolName, filePath: string, format?: string) {
		super(
			`Cannot read binary file: ${filePath}${format ? ` (format: ${format})` : ""}`,
			toolName,
			filePath,
			"Binary files cannot be read as text. " +
			"For images, ensure the model supports vision capabilities. " +
			"For other binary formats, use appropriate extraction tools."
		)
		this.name = "BinaryFileError"
	}
}

/**
 * File too large to read in one operation.
 */
export class FileTooLargeError extends FileOperationError {
	constructor(toolName: ToolName, filePath: string, size: number, maxSize: number) {
		super(
			`File too large: ${filePath} (${size} bytes exceeds ${maxSize} bytes limit)`,
			toolName,
			filePath,
			"Read the file in chunks using offset/limit parameters, " +
			"or ask the user to increase the file size limit."
		)
		this.name = "FileTooLargeError"
	}
}
