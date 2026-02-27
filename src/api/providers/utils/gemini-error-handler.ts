/**
 * Gemini-specific error handler
 * Handles Google GenAI SDK errors and converts them to standardized ApiProviderError types
 *
 * This utility converts Gemini SDK errors into standardized ApiProviderError types:
 * - Recognizes error status codes for precise error categorization
 * - Extracts error details from the SDK error object
 * - Provides user-friendly messages for common error scenarios
 * - Preserves original error for debugging
 */

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
 * Gemini API error interface based on SDK error structure
 */
interface GeminiApiError extends Error {
	status?: number
	statusCode?: number
	details?: Array<{
		"@type": string
		reason?: string
		message?: string
	}>
	error?: {
		code?: number
		message?: string
		status?: string
	}
}

/**
 * Handles Gemini SDK errors with SDK-specific error type recognition.
 * Converts SDK-specific errors into standardized ApiProviderError types.
 *
 * @param error - The error to handle
 * @param providerName - The name of the provider (default: "Gemini")
 * @param options - Optional configuration including request ID for debugging
 * @returns A standardized ApiProviderError with preserved metadata
 *
 * @example
 * try {
 *   await client.models.generateContent(...)
 * } catch (error) {
 *   throw handleGeminiError(error, "Gemini", { requestId: "req_123" })
 * }
 */
export function handleGeminiError(
	error: unknown,
	providerName: string = "Gemini",
	options?: {
		/** Custom message prefix (default: "completion") */
		messagePrefix?: string
		/** Request ID for debugging and support */
		requestId?: string
	},
): Error {
	const requestId = options?.requestId

	// Handle Gemini API errors
	if (error instanceof Error) {
		const geminiError = error as GeminiApiError
		const statusCode = geminiError.status || geminiError.statusCode || geminiError.error?.code
		const errorMessage = geminiError.message || geminiError.error?.message || "Unknown error"

		console.error(`[${providerName}] API Error:`, {
			status: statusCode,
			message: errorMessage,
			name: geminiError.name,
			requestId,
		})

		// If we have a status code, convert to appropriate ApiProviderError
		if (statusCode !== undefined) {
			switch (statusCode) {
				case 400:
					return new BadRequestError(
						providerName,
						`${errorMessage}. Please check your request parameters.`,
						requestId,
						geminiError,
					)

				case 401:
					return new AuthenticationError(
						providerName,
						`${errorMessage}. Please check your API key.`,
						requestId,
						geminiError,
					)

				case 403:
					return new PermissionDeniedError(
						providerName,
						`${errorMessage}. Your API key may not have access to this resource or the API may not be enabled.`,
						requestId,
						geminiError,
					)

				case 404:
					return new NotFoundError(
						providerName,
						`${errorMessage}. Please check the model ID or endpoint.`,
						requestId,
						geminiError,
					)

				case 429: {
					// Try to extract retry information from error details
					let retryAfter: number | undefined
					if (geminiError.details) {
						for (const detail of geminiError.details) {
							if (detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && detail.reason) {
								// Parse retry delay if available (usually in seconds)
								const match = detail.reason.match(/(\d+)s/)
								if (match && match[1]) {
									retryAfter = parseInt(match[1], 10)
								}
							}
						}
					}

					return new RateLimitError(
						providerName,
						`${errorMessage}. Please slow down your requests.`,
						retryAfter,
						requestId,
						geminiError,
					)
				}

				case 500:
				case 502:
				case 503:
				case 504:
					return new ServerError(
						providerName,
						`${errorMessage}. Please try again later.`,
						statusCode,
						requestId,
						geminiError,
					)

				case 408:
					return new RequestTimeoutError(
						providerName,
						`${errorMessage}. Please try again or increase the timeout.`,
						requestId,
						geminiError,
					)

				default:
					// For unknown status codes, use generic ApiProviderError
					return new ApiProviderError(
						`${providerName} API error (${statusCode}): ${errorMessage}`,
						providerName,
						statusCode,
						requestId,
						geminiError,
					)
			}
		}

		// Handle connection errors (network issues)
		if (
			geminiError.name === "NetworkError" ||
			geminiError.name === "TypeError" ||
			errorMessage.includes("network") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("ENOTFOUND") ||
			errorMessage.includes("ETIMEDOUT")
		) {
			console.error(`[${providerName}] Connection Error:`, errorMessage)

			return new ConnectionError(
				providerName,
				`${errorMessage}. Please check your network connection.`,
				geminiError,
			)
		}

		// Handle timeout errors
		if (
			geminiError.name === "TimeoutError" ||
			errorMessage.includes("timeout") ||
			errorMessage.includes("timed out")
		) {
			console.error(`[${providerName}] Timeout Error:`, errorMessage)

			return new RequestTimeoutError(
				providerName,
				`${errorMessage}. Please try again or increase the timeout.`,
				requestId,
				geminiError,
			)
		}

		// For other error types, wrap in generic ApiProviderError
		console.error(`[${providerName}] Unknown Error:`, errorMessage)

		return new ApiProviderError(
			`${providerName} error: ${errorMessage}`,
			providerName,
			undefined,
			requestId,
			geminiError,
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
