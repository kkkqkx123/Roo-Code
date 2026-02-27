/**
 * Tool validation errors.
 * Errors that occur before tool execution, during parameter validation.
 */

import type { ToolName } from "@coder/types"

/**
 * Interface for LLM error payload.
 * Used to format errors for LLM consumption with actionable guidance.
 */
export interface LLMErrorPayload {
	status: "error"
	type: string
	error_class?: string
	message: string
	suggestion?: string
	[key: string]: unknown
}

/**
 * Interface for log entries.
 * Used for telemetry and logging purposes.
 */
export interface LogEntry {
	level: "debug" | "info" | "warn" | "error" | "fatal"
	category: string
	tool?: string
	error_type?: string
	message: string
	timestamp: number
	[key: string]: unknown
}

/**
 * Sanitize parameters for logging (remove sensitive data).
 */
function sanitizeForLogging(params?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!params) return undefined
	
	// Keys that might contain sensitive data
	const sensitiveKeys = ["key", "secret", "token", "password", "credential", "auth"]
	
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
 * Base class for tool validation errors (pre-execution).
 * These errors occur before the tool actually runs.
 */
export abstract class ValidationError extends Error {
	constructor(
		message: string,
		public readonly toolName: ToolName,
		public readonly suggestion?: string
	) {
		super(message)
		this.name = "ValidationError"
	}

	/**
	 * Format error for LLM consumption.
	 * Includes actionable guidance.
	 */
	toLLMMessage(): LLMErrorPayload {
		return {
			status: "error",
			type: "validation_error",
			error_class: this.constructor.name,
			message: this.message,
			suggestion: this.suggestion,
		}
	}

	/**
	 * Format error for telemetry/logging.
	 * Includes tool name and parameters (sanitized).
	 */
	toLogEntry(params?: Record<string, unknown>): LogEntry {
		return {
			level: "warn",
			category: "tool_validation",
			tool: this.toolName,
			error_type: this.constructor.name,
			message: this.message,
			params: sanitizeForLogging(params),
			timestamp: Date.now(),
		}
	}
}

/**
 * Missing required parameter.
 */
export class MissingParameterError extends ValidationError {
	constructor(
		toolName: ToolName,
		paramName: string,
		example?: string
	) {
		super(
			`Missing required parameter: ${paramName}`,
			toolName,
			`Please provide the '${paramName}' parameter.${example ? ` Example: ${example}` : ""}`
		)
		this.name = "MissingParameterError"
	}
}

/**
 * Invalid parameter value.
 */
export class InvalidParameterError extends ValidationError {
	constructor(
		toolName: ToolName,
		paramName: string,
		value: unknown,
		reason: string
	) {
		super(
			`Invalid parameter '${paramName}': ${reason}`,
			toolName,
			`The value '${JSON.stringify(value)}' is invalid. ${reason}`
		)
		this.name = "InvalidParameterError"
	}
}

/**
 * Invalid tool name or unknown tool.
 */
export class InvalidToolError extends ValidationError {
	constructor(
		toolName: string,
		availableTools: string[]
	) {
		super(
			`Unknown tool: ${toolName}`,
			toolName as ToolName,
			availableTools.length > 0
				? `Use one of the available tools: ${availableTools.join(", ")}`
				: "Check the tool documentation for available tools"
		)
		this.name = "InvalidToolError"
	}
}
