/**
 * Unified tool error handling helper.
 * Provides consistent error handling across all tools with structured error types.
 */

import type { ToolName } from "@coder/types"

import type { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import {
	type ToolError,
	type LogEntry,
	ValidationError,
} from "../errors/tools/index.js"

/**
 * Callbacks needed for error handling (subset of ToolCallbacks).
 */
interface ErrorHandlingCallbacks {
	pushToolResult: (result: string) => void
}

/**
 * Handle tool errors with consistent structured logging and LLM messaging.
 *
 * This function ensures all tool errors are:
 * 1. Logged with structured data for telemetry/analysis
 * 2. Reported to LLM with actionable guidance
 * 3. Handled uniformly across all tools
 *
 * @param error - The error that occurred (can be ToolError instance or generic Error)
 * @param toolName - Name of the tool that encountered the error
 * @param task - Task instance for recording errors
 * @param callbacks - Callbacks for pushing results
 * @param params - Optional parameters for logging context (will be sanitized)
 */
export async function handleToolError(
	error: unknown,
	toolName: ToolName,
	task: Task,
	callbacks: ErrorHandlingCallbacks,
	params?: Record<string, unknown>,
): Promise<void> {
	if (isToolError(error)) {
		// Structured error - use its methods for consistent handling
		task.recordToolError(toolName, error.toLogEntry(params))
		callbacks.pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
	} else {
		// Generic error - create a basic log entry
		const errorMessage = error instanceof Error ? error.message : String(error)
		const logEntry: LogEntry = {
			level: "error",
			category: "tool_execution",
			tool: toolName,
			error_type: "GenericError",
			message: errorMessage,
			params: sanitizeForLogging(params),
			timestamp: Date.now(),
		}
		if (error instanceof Error && error.stack) {
			logEntry.stack = error.stack
		}
		task.recordToolError(toolName, logEntry)
		callbacks.pushToolResult(formatResponse.toolError(errorMessage))
	}
}

/**
 * Type guard to check if error is a ToolError instance.
 */
function isToolError(error: unknown): error is ToolError {
	return error instanceof ValidationError || (
		error instanceof Error &&
		typeof (error as ToolError).toLLMMessage === "function" &&
		typeof (error as ToolError).toLogEntry === "function"
	)
}

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
 * Create a structured log entry for unexpected errors.
 * Useful for catch blocks that don't have a specific ToolError type.
 */
export function createErrorLogEntry(
	toolName: ToolName,
	error: unknown,
	params?: Record<string, unknown>,
): LogEntry {
	const errorMessage = error instanceof Error ? error.message : String(error)
	const entry: LogEntry = {
		level: "error",
		category: "tool_execution",
		tool: toolName,
		error_type: error instanceof Error ? error.constructor.name : "UnknownError",
		message: errorMessage,
		params: sanitizeForLogging(params),
		timestamp: Date.now(),
	}
	if (error instanceof Error && error.stack) {
		entry.stack = error.stack
	}
	return entry
}
