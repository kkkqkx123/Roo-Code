/**
 * Tool state errors.
 * Errors related to tool execution state and repetition detection.
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
 * Base class for state errors.
 */
export abstract class StateError extends Error {
	constructor(
		message: string,
		public readonly toolName: ToolName,
		public readonly suggestion?: string
	) {
		super(message)
		this.name = "StateError"
	}

	toLLMMessage(): LLMErrorPayload {
		return {
			status: "error",
			type: "state_error",
			error_class: this.constructor.name,
			message: this.message,
			suggestion: this.suggestion,
		}
	}

	toLogEntry(params?: Record<string, unknown>): LogEntry {
		return {
			level: "warn",
			category: "tool_state",
			tool: this.toolName,
			error_type: this.constructor.name,
			message: this.message,
			params: sanitizeForLogging(params),
			timestamp: Date.now(),
		}
	}
}

/**
 * Tool repetition detected (same tool called multiple times consecutively).
 */
export class ToolRepetitionError extends StateError {
	constructor(
		toolName: ToolName,
		count: number,
		windowSize?: number
	) {
		super(
			`Tool '${toolName}' called ${count} times consecutively without progress`,
			toolName,
			"You are repeating the same tool call without making progress. Consider: " +
			"1) Reading the file to understand current state, " +
			"2) Trying a different approach, " +
			"3) Asking for clarification if stuck." +
			(windowSize ? ` (Detected in last ${windowSize} messages)` : "")
		)
		this.name = "ToolRepetitionError"
	}
}

/**
 * Consecutive mistakes exceeded limit.
 */
export class ConsecutiveMistakeError extends StateError {
	constructor(
		toolName: ToolName,
		count: number,
		limit: number
	) {
		super(
			`Tool '${toolName}' failed ${count} times (limit: ${limit})`,
			toolName,
			"The tool has failed multiple times. Consider: " +
			"1) Reading the file to understand the current state, " +
			"2) Checking parameter values carefully, " +
			"3) Asking the user for clarification, " +
			"4) Trying a different approach to accomplish the task."
		)
		this.name = "ConsecutiveMistakeError"
	}
}

/**
 * Invalid tool state (tool called in wrong context).
 */
export class InvalidToolStateError extends StateError {
	constructor(
		toolName: ToolName,
		reason: string
	) {
		super(
			`Invalid state for tool '${toolName}': ${reason}`,
			toolName,
			"Ensure the tool is being called in the correct context. " +
			"Check the tool documentation for usage requirements."
		)
		this.name = "InvalidToolStateError"
	}
}
