/**
 * Error extractor utilities for consistent error handling across the application.
 * This module provides functions to extract, format, and categorize errors.
 */

import {
	AuthenticationError,
	RateLimitError,
	ServerError,
	ConnectionError,
	UserInterruptError,
	ToolInterruptError,
	Http401Error,
	Http403Error,
	Http429Error,
	Http5xxError,
	HttpConnectionError,
	ApiProviderError,
} from "./index.js";

/**
 * Categories of errors for consistent handling
 */
export const ErrorCategory = {
	AUTHENTICATION: "authentication",
	RATE_LIMIT: "rate_limit",
	SERVER: "server",
	CONNECTION: "connection",
	CANCELLATION: "cancellation",
	OTHER: "other",
} as const;

export type ErrorCategoryType = typeof ErrorCategory[keyof typeof ErrorCategory];

/**
 * Extracted error information structure
 */
export interface ExtractedErrorInfo {
	category: ErrorCategoryType;
	isRetryable: boolean;
	retryDelay: number;
	message: string;
	originalError: unknown;
	/** Request ID for debugging and support */
	requestId?: string;
	/** Provider name (e.g., "Anthropic", "OpenAI") */
	providerName?: string;
	/** HTTP status code */
	status?: number;
	/** Retry-after delay in seconds for rate limit errors */
	retryAfter?: number;
}

/**
 * Extract comprehensive error information from any error object
 */
export function extractErrorInfo(error: unknown): ExtractedErrorInfo {
	const category = categorizeError(error);
	const isRetryable = isErrorRetryable(error);
	const retryDelay = getErrorRetryDelay(error);
	const message = formatErrorForDisplay(error);

	// Extract provider-specific metadata
	let requestId: string | undefined;
	let providerName: string | undefined;
	let status: number | undefined;
	let retryAfter: number | undefined;

	// Check if it's an ApiProviderError with rich metadata
	if (error instanceof ApiProviderError) {
		requestId = error.requestId;
		providerName = error.providerName;
		status = error.statusCode;

		// Extract retryAfter from RateLimitError
		if (error instanceof RateLimitError) {
			retryAfter = error.retryAfter;
		}
	} else if (error instanceof Error) {
		// Extract from generic Error objects that might have these properties attached
		const anyErr = error as any;
		requestId = anyErr.requestId;
		providerName = anyErr.providerName;
		status = anyErr.status || anyErr.statusCode;
		retryAfter = anyErr.retryAfter;
	}

	return {
		category,
		isRetryable,
		retryDelay,
		message,
		originalError: error,
		requestId,
		providerName,
		status,
		retryAfter,
	};
}

/**
 * Format error for user display (concise and user-friendly)
 */
export function formatErrorForDisplay(error: unknown): string {
	if (error instanceof Error) {
		return error.message || "An unknown error occurred";
	}
	if (typeof error === "string") {
		return error;
	}
	return "An unknown error occurred";
}

/**
 * Format error for logging (detailed with stack trace if available)
 */
export function formatErrorForLog(error: unknown): string {
	if (error instanceof Error) {
		return error.stack || error.message || "Unknown error";
	}
	if (typeof error === "string") {
		return error;
	}
	return JSON.stringify(error);
}

/**
 * Categorize error into predefined categories
 */
export function categorizeError(error: unknown): ErrorCategoryType {
	if (isAuthenticationError(error)) {
		return ErrorCategory.AUTHENTICATION;
	}
	if (isRateLimitError(error)) {
		return ErrorCategory.RATE_LIMIT;
	}
	if (isServerError(error)) {
		return ErrorCategory.SERVER;
	}
	if (isConnectionError(error)) {
		return ErrorCategory.CONNECTION;
	}
	if (isUserCancellation(error)) {
		return ErrorCategory.CANCELLATION;
	}
	return ErrorCategory.OTHER;
}

/**
 * Check if error is retryable
 */
export function isErrorRetryable(error: unknown): boolean {
	return isRateLimitError(error) || isServerError(error) || isConnectionError(error);
}

/**
 * Get appropriate retry delay based on error type
 */
export function getErrorRetryDelay(error: unknown): number {
	if (isRateLimitError(error)) {
		// Default 60 seconds for rate limiting
		return 60000;
	}
	if (isServerError(error)) {
		// Exponential backoff starting at 5 seconds
		return 5000;
	}
	if (isConnectionError(error)) {
		// Short retry for connection issues
		return 2000;
	}
	return 0;
}

/**
 * Check if error is an authentication error
 */
export function isAuthenticationError(error: unknown): boolean {
	return (
		error instanceof AuthenticationError ||
		error instanceof Http401Error ||
		error instanceof Http403Error
	);
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
	return error instanceof RateLimitError || error instanceof Http429Error;
}

/**
 * Check if error is a server error
 */
export function isServerError(error: unknown): boolean {
	return error instanceof ServerError || error instanceof Http5xxError;
}

/**
 * Check if error is a connection error
 */
export function isConnectionError(error: unknown): boolean {
	return error instanceof ConnectionError || error instanceof HttpConnectionError;
}

/**
 * Check if error is a user cancellation
 */
export function isUserCancellation(error: unknown): boolean {
	return error instanceof UserInterruptError || error instanceof ToolInterruptError;
}