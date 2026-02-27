/**
 * API Provider Error Classes
 *
 * Error classes for API provider operations. These errors extend HTTP errors
 * with provider-specific context information.
 */

import { HttpError } from "./http.js"

/**
 * Base class for API provider errors.
 * These errors are thrown by API providers (Anthropic, OpenAI, Gemini, etc.)
 * and provide structured error information for consistent handling.
 */
export class ApiProviderError extends HttpError {
	constructor(
		message: string,
		public readonly providerName: string,
		statusCode?: number,
		requestId?: string,
		originalError?: Error,
		code?: string
	) {
		super(
			message,
			statusCode || 0,
			requestId,
			originalError,
			code || "API_PROVIDER_ERROR"
		)
	}
}

/**
 * Error thrown when authentication fails (HTTP 401).
 * Usually indicates an invalid or expired API key.
 */
export class AuthenticationError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 401, requestId, originalError, "AUTHENTICATION_ERROR")
	}
}

/**
 * Error thrown when rate limit is exceeded (HTTP 429).
 * Contains retry-after information for backoff calculation.
 */
export class RateLimitError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		public readonly retryAfter?: number,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 429, requestId, originalError, "RATE_LIMIT_ERROR")
	}
}

/**
 * Error thrown when the server returns an error (HTTP 5xx).
 * These are usually transient and can be retried.
 */
export class ServerError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		statusCode: number,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, statusCode, requestId, originalError, "SERVER_ERROR")
	}
}

/**
 * Error thrown when there's a network connection issue.
 * No HTTP response was received from the server.
 */
export class ConnectionError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		originalError?: Error
	) {
		super(message, providerName, undefined, undefined, originalError, "CONNECTION_ERROR")
	}
}

/**
 * Error thrown when a request times out.
 * The request was sent but no response was received within the timeout period.
 */
export class RequestTimeoutError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 408, requestId, originalError, "REQUEST_TIMEOUT_ERROR")
	}
}

/**
 * Error thrown when the request is invalid (HTTP 400).
 * Usually indicates a problem with the request parameters.
 */
export class BadRequestError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 400, requestId, originalError, "BAD_REQUEST_ERROR")
	}
}

/**
 * Error thrown when access is denied (HTTP 403).
 * The API key may not have permission to access the requested resource.
 */
export class PermissionDeniedError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 403, requestId, originalError, "PERMISSION_DENIED_ERROR")
	}
}

/**
 * Error thrown when the requested resource is not found (HTTP 404).
 * Usually indicates an invalid model ID or endpoint.
 */
export class NotFoundError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 404, requestId, originalError, "NOT_FOUND_ERROR")
	}
}

/**
 * Error thrown when the request cannot be processed (HTTP 422).
 * Usually indicates a validation error in the request body.
 */
export class UnprocessableEntityError extends ApiProviderError {
	constructor(
		providerName: string,
		message: string,
		requestId?: string,
		originalError?: Error
	) {
		super(message, providerName, 422, requestId, originalError, "UNPROCESSABLE_ENTITY_ERROR")
	}
}

/**
 * Union type for all API provider errors
 */
export type ApiProviderErrorType =
	| ApiProviderError
	| AuthenticationError
	| RateLimitError
	| ServerError
	| ConnectionError
	| RequestTimeoutError
	| BadRequestError
	| PermissionDeniedError
	| NotFoundError
	| UnprocessableEntityError

/**
 * Type guard to check if an error is an API provider error
 */
export function isApiProviderError(error: unknown): error is ApiProviderError {
	return error instanceof ApiProviderError
}
