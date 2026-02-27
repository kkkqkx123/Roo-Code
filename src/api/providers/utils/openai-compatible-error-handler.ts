/**
 * OpenAI Compatible error handler
 * Handles Vercel AI SDK errors and converts them to standardized ApiProviderError types
 *
 * This utility converts AI SDK errors into standardized ApiProviderError types:
 * - Handles errors from @ai-sdk/openai-compatible provider
 * - Extracts error details from various error formats
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
 * AI SDK error interface based on common error patterns
 */
interface AiSdkError extends Error {
	statusCode?: number
	status?: number
	statusText?: string
	response?: {
		status?: number
		statusText?: string
	}
	data?: {
		error?: {
			message?: string
			type?: string
			code?: string
		}
	}
}

/**
 * Handles OpenAI Compatible (AI SDK) errors.
 * Converts AI SDK errors into standardized ApiProviderError types.
 *
 * @param error - The error to handle
 * @param providerName - The name of the provider (default: "OpenAI Compatible")
 * @param options - Optional configuration including request ID for debugging
 * @returns A standardized ApiProviderError with preserved metadata
 *
 * @example
 * try {
 *   const result = await streamText(...)
 * } catch (error) {
 *   throw handleOpenAiCompatibleError(error, "OpenAI Compatible")
 * }
 */
export function handleOpenAiCompatibleError(
	error: unknown,
	providerName: string = "OpenAI Compatible",
	options?: {
		/** Custom message prefix (default: "completion") */
		messagePrefix?: string
		/** Request ID for debugging and support */
		requestId?: string
	},
): Error {
	const requestId = options?.requestId

	// Handle AI SDK errors
	if (error instanceof Error) {
		const aiSdkError = error as AiSdkError
		const statusCode = aiSdkError.statusCode || aiSdkError.status || aiSdkError.response?.status
		const errorMessage =
			aiSdkError.data?.error?.message || aiSdkError.message || "Unknown error"

		console.error(`[${providerName}] API Error:`, {
			status: statusCode,
			message: errorMessage,
			name: aiSdkError.name,
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
						aiSdkError,
					)

				case 401:
					return new AuthenticationError(
						providerName,
						`${errorMessage}. Please check your API key.`,
						requestId,
						aiSdkError,
					)

				case 403:
					return new PermissionDeniedError(
						providerName,
						`${errorMessage}. Your API key may not have access to this resource.`,
						requestId,
						aiSdkError,
					)

				case 404:
					return new NotFoundError(
						providerName,
						`${errorMessage}. Please check the model ID or endpoint.`,
						requestId,
						aiSdkError,
					)

				case 429: {
					// Try to extract retry-after from error data or headers
					let retryAfter: number | undefined
					// AI SDK may include retry info in various places
					const retryMatch = errorMessage.match(/retry.*?(\d+)/i)
					if (retryMatch && retryMatch[1]) {
						retryAfter = parseInt(retryMatch[1], 10)
					}

					return new RateLimitError(
						providerName,
						`${errorMessage}. Please slow down your requests.`,
						retryAfter,
						requestId ?? undefined,
						aiSdkError,
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
						aiSdkError,
					)

				case 408:
					return new RequestTimeoutError(
						providerName,
						`${errorMessage}. Please try again or increase the timeout.`,
						requestId,
						aiSdkError,
					)

				default:
					// For unknown status codes, use generic ApiProviderError
					return new ApiProviderError(
						`${providerName} API error (${statusCode}): ${errorMessage}`,
						providerName,
						statusCode,
						requestId,
						aiSdkError,
					)
			}
		}

		// Handle connection errors (network issues)
		if (
			aiSdkError.name === "NetworkError" ||
			aiSdkError.name === "TypeError" ||
			aiSdkError.name === "AbortError" ||
			errorMessage.includes("network") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("ENOTFOUND") ||
			errorMessage.includes("fetch failed")
		) {
			console.error(`[${providerName}] Connection Error:`, errorMessage)

			return new ConnectionError(
				providerName,
				`${errorMessage}. Please check your network connection.`,
				aiSdkError,
			)
		}

		// Handle timeout errors
		if (
			aiSdkError.name === "TimeoutError" ||
			errorMessage.includes("timeout") ||
			errorMessage.includes("timed out") ||
			errorMessage.includes("Timeout")
		) {
			console.error(`[${providerName}] Timeout Error:`, errorMessage)

			return new RequestTimeoutError(
				providerName,
				`${errorMessage}. Please try again or increase the timeout.`,
				requestId,
				aiSdkError,
			)
		}

		// Handle AI SDK specific error names
		if (aiSdkError.name === "InvalidResponseError" || aiSdkError.name === "NoOutputError") {
			return new ApiProviderError(
				`${providerName} response error: ${errorMessage}`,
				providerName,
				undefined,
				requestId,
				aiSdkError,
			)
		}

		// For other error types, wrap in generic ApiProviderError
		console.error(`[${providerName}] Unknown Error:`, errorMessage)

		return new ApiProviderError(
			`${providerName} error: ${errorMessage}`,
			providerName,
			undefined,
			requestId,
			aiSdkError,
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
