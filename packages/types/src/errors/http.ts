/**
 * HTTP Error Classes
 *
 * Error classes for HTTP-related errors. These errors are used across
 * all network services including API providers and vector databases.
 */

import { BaseError } from "./base.js"

/**
 * Base error class for HTTP errors.
 * These errors represent HTTP response status codes and provide
 * consistent error handling across all network services.
 */
export abstract class HttpError extends BaseError {
	constructor(
		message: string,
		public readonly statusCode: number,
		public readonly requestId?: string,
		public readonly originalError?: Error,
		code?: string
	) {
		super(message, code || "HTTP_ERROR", {
			statusCode,
			requestId,
			originalError,
		})
	}
}

/**
 * Error thrown when authentication fails (HTTP 401).
 * Usually indicates an invalid or expired API key.
 */
export class Http401Error extends HttpError {
	constructor(
		message: string = "Authentication failed. Please check your credentials.",
		requestId?: string,
		originalError?: Error
	) {
		super(message, 401, requestId, originalError, "HTTP_401_ERROR")
	}
}

/**
 * Error thrown when access is denied (HTTP 403).
 * The API key may not have permission to access the requested resource.
 */
export class Http403Error extends HttpError {
	constructor(
		message: string = "Access denied. You don't have permission to access this resource.",
		requestId?: string,
		originalError?: Error
	) {
		super(message, 403, requestId, originalError, "HTTP_403_ERROR")
	}
}

/**
 * Error thrown when the requested resource is not found (HTTP 404).
 * Usually indicates an invalid model ID, endpoint, or collection.
 */
export class Http404Error extends HttpError {
	constructor(
		message: string = "The requested resource was not found.",
		requestId?: string,
		originalError?: Error
	) {
		super(message, 404, requestId, originalError, "HTTP_404_ERROR")
	}
}

/**
 * Error thrown when the request is invalid (HTTP 400).
 * Usually indicates a problem with the request parameters.
 */
export class Http400Error extends HttpError {
	constructor(
		message: string = "The request was invalid.",
		requestId?: string,
		originalError?: Error
	) {
		super(message, 400, requestId, originalError, "HTTP_400_ERROR")
	}
}

/**
 * Error thrown when the request cannot be processed due to semantic errors (HTTP 422).
 * Usually indicates a validation error in the request body.
 */
export class Http422Error extends HttpError {
	constructor(
		message: string = "The request was well-formed but contains semantic errors.",
		requestId?: string,
		originalError?: Error
	) {
		super(message, 422, requestId, originalError, "HTTP_422_ERROR")
	}
}

/**
 * Error thrown when rate limit is exceeded (HTTP 429).
 * Contains retry-after information for backoff calculation.
 */
export class Http429Error extends HttpError {
	constructor(
		message: string = "Rate limit exceeded. Please try again later.",
		public readonly retryAfter?: number,
		requestId?: string,
		originalError?: Error
	) {
		super(message, 429, requestId, originalError, "HTTP_429_ERROR")
		this.retryAfter = retryAfter
	}
}

/**
 * Error thrown when a request times out (HTTP 408).
 * The request was sent but no response was received within the timeout period.
 */
export class Http408Error extends HttpError {
	constructor(
		message: string = "The request timed out.",
		requestId?: string,
		originalError?: Error
	) {
		super(message, 408, requestId, originalError, "HTTP_408_ERROR")
	}
}

/**
 * Error thrown when the server returns an error (HTTP 5xx).
 * These are usually transient and can be retried.
 */
export class Http5xxError extends HttpError {
	constructor(
		message: string = "The server encountered an error.",
		statusCode: number = 500,
		requestId?: string,
		originalError?: Error
	) {
		super(message, statusCode, requestId, originalError, "HTTP_5XX_ERROR")
	}
}

/**
 * Error thrown when there's a network connection issue.
 * No HTTP response was received from the server.
 */
export class HttpConnectionError extends HttpError {
	constructor(
		message: string = "Failed to connect to the server.",
		originalError?: Error
	) {
		super(message, 0, undefined, originalError, "HTTP_CONNECTION_ERROR")
	}
}

/**
 * Type guard to check if an error is an HTTP error
 */
export function isHttpError(error: unknown): error is HttpError {
	return error instanceof HttpError
}

/**
 * Get HTTP status code from an error if available
 */
export function getHttpStatusCode(error: unknown): number | undefined {
	if (error instanceof HttpError) {
		return error.statusCode
	}
	if (error instanceof Error) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (error as any).status
	}
	return undefined
}

/**
 * Get request ID from an error if available
 */
export function getRequestId(error: unknown): string | undefined {
	if (error instanceof HttpError) {
		return error.requestId
	}
	if (error instanceof Error) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (error as any).requestId
	}
	return undefined
}
