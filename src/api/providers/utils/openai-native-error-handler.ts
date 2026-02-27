/**
 * OpenAI Native-specific error handler
 * Leverages SDK error types for fine-grained error classification and messaging
 *
 * This utility converts OpenAI SDK errors into standardized ApiProviderError types:
 * - Recognizes OpenAI.APIError and its subclasses for precise error categorization
 * - Extracts request IDs from headers for debugging and support
 * - Provides user-friendly messages for common error scenarios
 * - Preserves original error for debugging
 */

import OpenAI from "openai"
import {
	ApiProviderError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	ConnectionError,
	RequestTimeoutError,
	BadRequestError,
	PermissionDeniedError,
	NotFoundError,
} from "@coder/types"

/**
 * Handles OpenAI SDK errors with SDK-specific error type recognition.
 * Converts SDK-specific errors into standardized ApiProviderError types.
 *
 * @param error - The error to handle
 * @param providerName - The name of the provider (default: "OpenAI")
 * @param options - Optional configuration including request ID for debugging
 * @returns A standardized ApiProviderError with preserved metadata
 *
 * @example
 * try {
 *   await client.chat.completions.create(...)
 * } catch (error) {
 *   throw handleOpenAiNativeError(error, "OpenAI", { requestId: "req_123" })
 * }
 */
export function handleOpenAiNativeError(
	error: unknown,
	providerName: string = "OpenAI",
	options?: {
		/** Custom message prefix (default: "completion") */
		messagePrefix?: string
		/** Request ID for debugging and support */
		requestId?: string
	},
): Error {
	const requestId = options?.requestId

	// Handle OpenAI API errors with status codes
	if (error instanceof OpenAI.APIError) {
		const apiError = error as typeof OpenAI.APIError.prototype
		const headerRequestId = apiError.requestID ?? undefined
		const effectiveRequestId = requestId || headerRequestId

		console.error(`[${providerName}] API Error (${apiError.name}):`, {
			status: apiError.status,
			message: apiError.message,
			headers: apiError.headers,
			requestId: effectiveRequestId,
		})

		// Convert to appropriate ApiProviderError subclass based on status code
		switch (apiError.status) {
			case 400:
				return new BadRequestError(
					providerName,
					`${apiError.message}. Please check your request parameters.`,
					effectiveRequestId,
					apiError,
				)

			case 401:
				return new AuthenticationError(
					providerName,
					`${apiError.message}. Please check your API key.`,
					effectiveRequestId,
					apiError,
				)

			case 403:
				return new PermissionDeniedError(
					providerName,
					`${apiError.message}. Your API key may not have access to this resource.`,
					effectiveRequestId,
					apiError,
				)

			case 404:
				return new NotFoundError(
					providerName,
					`${apiError.message}. Please check the model ID or endpoint.`,
					effectiveRequestId,
					apiError,
				)

			case 429: {
				// Try to extract retry-after from headers
				const retryAfterHeader = apiError.headers?.["retry-after"]
				const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader as string, 10) : undefined

				return new RateLimitError(
					providerName,
					`${apiError.message}. Please slow down your requests.`,
					isNaN(retryAfter as number) ? undefined : retryAfter,
					effectiveRequestId,
					apiError,
				)
			}

			case 500:
			case 502:
			case 503:
			case 504:
				return new ServerError(
					providerName,
					`${apiError.message}. Please try again later.`,
					apiError.status,
					effectiveRequestId,
					apiError,
				)

			default:
				// For unknown status codes, use generic ApiProviderError
				return new ApiProviderError(
					`${providerName} API error (${apiError.status}): ${apiError.message}`,
					providerName,
					apiError.status,
					effectiveRequestId,
					apiError,
				)
		}
	}

	// Handle connection errors (no HTTP response)
	if (error instanceof OpenAI.APIConnectionError) {
		console.error(`[${providerName}] Connection Error:`, error.message)

		return new ConnectionError(
			providerName,
			`${error.message}. Please check your network connection.`,
			error,
		)
	}

	// Handle timeout errors
	if (error instanceof OpenAI.APIConnectionTimeoutError) {
		console.error(`[${providerName}] Timeout Error:`, error.message)

		return new RequestTimeoutError(
			providerName,
			`${error.message}. Please try again or increase the timeout.`,
			requestId,
			error,
		)
	}

	// For other error types, wrap in generic ApiProviderError
	if (error instanceof Error) {
		console.error(`[${providerName}] Unknown Error:`, error.message)

		return new ApiProviderError(
			`${providerName} error: ${error.message}`,
			providerName,
			undefined,
			requestId,
			error,
		)
	}

	// For non-Error exceptions
	console.error(`[${providerName}] Non-Error exception:`, error)

	return new ApiProviderError(
		`${providerName} error: ${String(error)}`,
		providerName,
		undefined,
		requestId,
	)
}
