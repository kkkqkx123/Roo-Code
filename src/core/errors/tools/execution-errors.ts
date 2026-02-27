/**
 * Tool execution errors.
 * Errors that occur during tool execution (command execution, diff application, etc.).
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
 * Base class for execution errors.
 */
export abstract class ExecutionError extends Error {
	constructor(
		message: string,
		public readonly toolName: ToolName,
		public readonly suggestion?: string,
		public readonly output?: string
	) {
		super(message)
		this.name = "ExecutionError"
	}

	toLLMMessage(): LLMErrorPayload {
		return {
			status: "error",
			type: "execution_error",
			error_class: this.constructor.name,
			message: this.message,
			suggestion: this.suggestion,
			...(this.output && { output: this.output }),
		}
	}

	toLogEntry(params?: Record<string, unknown>): LogEntry {
		return {
			level: "error",
			category: "tool_execution",
			tool: this.toolName,
			error_type: this.constructor.name,
			message: this.message,
			params: sanitizeForLogging(params),
			timestamp: Date.now(),
		}
	}
}

/**
 * Command execution timeout.
 */
export class CommandTimeoutError extends ExecutionError {
	constructor(
		toolName: ToolName,
		command: string,
		timeoutMs: number
	) {
		super(
			`Command timed out after ${timeoutMs}ms: ${command.substring(0, 100)}${command.length > 100 ? "..." : ""}`,
			toolName,
			"The command took too long to execute. Consider: " +
			"1) Breaking into smaller commands, " +
			"2) Using background execution, " +
			"3) Increasing timeout setting, " +
			"4) Checking for infinite loops or blocking operations.",
			undefined
		)
		this.name = "CommandTimeoutError"
	}
}

/**
 * Command execution failed (non-zero exit code).
 */
export class CommandFailedError extends ExecutionError {
	constructor(
		toolName: ToolName,
		command: string,
		exitCode: number,
		output?: string
	) {
		super(
			`Command failed with exit code ${exitCode}: ${command.substring(0, 100)}${command.length > 100 ? "..." : ""}`,
			toolName,
			"Inspect the command output and error message. " +
			"Verify the command syntax and that all required dependencies are installed. " +
			"Consider running the command manually to debug.",
			output
		)
		this.name = "CommandFailedError"
	}
}

/**
 * Diff apply failed.
 */
export class DiffApplyFailedError extends ExecutionError {
	constructor(
		toolName: ToolName,
		filePath: string,
		reason: string
	) {
		super(
			`Failed to apply diff to ${filePath}: ${reason}`,
			toolName,
			"Read the current file content with read_file, then use the correct " +
			"old_string that matches exactly (including whitespace and indentation). " +
			"Consider using smaller, more precise diff blocks.",
			undefined
		)
		this.name = "DiffApplyFailedError"
	}
}

/**
 * Shell integration error.
 */
export class ShellIntegrationError extends ExecutionError {
	constructor(
		toolName: ToolName,
		reason: string
	) {
		super(
			`Shell integration error: ${reason}`,
			toolName,
			"Shell integration is not available. The command will be executed using fallback mode. " +
			"Some features like working directory tracking may not work correctly.",
			undefined
		)
		this.name = "ShellIntegrationError"
	}
}

/**
 * Patch parse error.
 */
export class PatchParseError extends ExecutionError {
	constructor(
		toolName: ToolName,
		reason: string,
		lineNumber?: number
	) {
		super(
			`Failed to parse patch: ${reason}${lineNumber ? ` (line ${lineNumber})` : ""}`,
			toolName,
			"Check the patch format. Ensure it follows the expected format with " +
			"'*** Begin Patch', file headers, and '*** End Patch' markers.",
			undefined
		)
		this.name = "PatchParseError"
	}
}
