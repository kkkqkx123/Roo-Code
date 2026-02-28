/**
 * Unit tests for error extractor utilities
 */

import { describe, it, expect } from "vitest"
import {
	extractErrorInfo,
	ErrorCategory,
} from "../extractor.js"
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
	UnprocessableEntityError,
} from "../api-provider.js"

describe("extractErrorInfo", () => {
	describe("ApiProviderError extraction", () => {
		it("should extract all properties from ApiProviderError", () => {
			const error = new ApiProviderError(
				"Test error message",
				"TestProvider",
				500,
				"req_123456",
				undefined,
				"TEST_CODE"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Test error message")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(500)
			expect(result.requestId).toBe("req_123456")
			expect(result.category).toBe(ErrorCategory.OTHER)
			expect(result.isRetryable).toBe(false)
		})

		it("should extract retryAfter from RateLimitError", () => {
			const error = new RateLimitError(
				"RateLimitProvider",
				"Rate limit exceeded",
				60,
				"req_789012",
				undefined
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Rate limit exceeded")
			expect(result.providerName).toBe("RateLimitProvider")
			expect(result.status).toBe(429)
			expect(result.requestId).toBe("req_789012")
			expect(result.retryAfter).toBe(60)
			expect(result.category).toBe(ErrorCategory.RATE_LIMIT)
			expect(result.isRetryable).toBe(true)
		})

		it("should handle AuthenticationError", () => {
			const error = new AuthenticationError(
				"TestProvider",
				"Invalid API key",
				"req_auth_123"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Invalid API key")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(401)
			expect(result.requestId).toBe("req_auth_123")
			expect(result.category).toBe(ErrorCategory.AUTHENTICATION)
			expect(result.isRetryable).toBe(false)
		})

		it("should handle ServerError", () => {
			const error = new ServerError(
				"TestProvider",
				"Internal server error",
				503,
				"req_server_456"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Internal server error")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(503)
			expect(result.requestId).toBe("req_server_456")
			expect(result.category).toBe(ErrorCategory.SERVER)
			expect(result.isRetryable).toBe(true)
		})

		it("should handle ConnectionError", () => {
			const error = new ConnectionError(
				"TestProvider",
				"Network connection failed"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Network connection failed")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(0)
			expect(result.category).toBe(ErrorCategory.CONNECTION)
			expect(result.isRetryable).toBe(true)
		})

		it("should handle RequestTimeoutError", () => {
			const error = new RequestTimeoutError(
				"TestProvider",
				"Request timed out",
				"req_timeout_789"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Request timed out")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(408)
			expect(result.requestId).toBe("req_timeout_789")
			expect(result.category).toBe(ErrorCategory.OTHER)
			expect(result.isRetryable).toBe(false)
		})

		it("should handle BadRequestError", () => {
			const error = new BadRequestError(
				"TestProvider",
				"Invalid request parameters",
				"req_bad_req_123"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Invalid request parameters")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(400)
			expect(result.requestId).toBe("req_bad_req_123")
			expect(result.category).toBe(ErrorCategory.OTHER)
			expect(result.isRetryable).toBe(false)
		})

		it("should handle PermissionDeniedError", () => {
			const error = new PermissionDeniedError(
				"TestProvider",
				"Access denied",
				"req_perm_456"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Access denied")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(403)
			expect(result.requestId).toBe("req_perm_456")
			expect(result.category).toBe(ErrorCategory.OTHER)
			expect(result.isRetryable).toBe(false)
		})

		it("should handle NotFoundError", () => {
			const error = new NotFoundError(
				"TestProvider",
				"Model not found",
				"req_not_found_789"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Model not found")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(404)
			expect(result.requestId).toBe("req_not_found_789")
			expect(result.category).toBe(ErrorCategory.OTHER)
			expect(result.isRetryable).toBe(false)
		})

		it("should handle UnprocessableEntityError", () => {
			const error = new UnprocessableEntityError(
				"TestProvider",
				"Validation error",
				"req_unprocessable_123"
			)

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Validation error")
			expect(result.providerName).toBe("TestProvider")
			expect(result.status).toBe(422)
			expect(result.requestId).toBe("req_unprocessable_123")
			expect(result.category).toBe(ErrorCategory.OTHER)
			expect(result.isRetryable).toBe(false)
		})
	})

	describe("Generic Error extraction", () => {
		it("should extract properties from generic Error with attached metadata", () => {
			const error = new Error("Generic error") as unknown as Record<string, unknown>
			error.providerName = "GenericProvider"
			error.status = 500
			error.requestId = "req_generic_123"
			error.retryAfter = 30

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Generic error")
			expect(result.providerName).toBe("GenericProvider")
			expect(result.status).toBe(500)
			expect(result.requestId).toBe("req_generic_123")
			expect(result.retryAfter).toBe(30)
		})

		it("should handle plain Error without metadata", () => {
			const error = new Error("Plain error")

			const result = extractErrorInfo(error)

			expect(result.message).toBe("Plain error")
			expect(result.providerName).toBeUndefined()
			expect(result.status).toBeUndefined()
			expect(result.requestId).toBeUndefined()
			expect(result.retryAfter).toBeUndefined()
			expect(result.category).toBe(ErrorCategory.OTHER)
		})

		it("should handle string error", () => {
			const error = "String error"

			const result = extractErrorInfo(error)

			expect(result.message).toBe("String error")
			expect(result.providerName).toBeUndefined()
			expect(result.status).toBeUndefined()
		})

		it("should handle null error", () => {
			const error = null

			const result = extractErrorInfo(error)

			expect(result.message).toBe("An unknown error occurred")
			expect(result.providerName).toBeUndefined()
			expect(result.status).toBeUndefined()
		})

		it("should handle undefined error", () => {
			const error = undefined

			const result = extractErrorInfo(error)

			expect(result.message).toBe("An unknown error occurred")
			expect(result.providerName).toBeUndefined()
			expect(result.status).toBeUndefined()
		})
	})

	describe("Retry delay calculation", () => {
		it("should return 60000ms for rate limit errors", () => {
			const error = new RateLimitError("Rate limit", "Rate limit exceeded", 60, "req_123")

			const result = extractErrorInfo(error)

			expect(result.retryDelay).toBe(60000)
		})

		it("should return 5000ms for server errors", () => {
			const error = new ServerError("Provider", "Server error", 500, "req_123")

			const result = extractErrorInfo(error)

			expect(result.retryDelay).toBe(5000)
		})

		it("should return 2000ms for connection errors", () => {
			const error = new ConnectionError("Provider", "Connection failed")

			const result = extractErrorInfo(error)

			expect(result.retryDelay).toBe(2000)
		})

		it("should return 0ms for non-retryable errors", () => {
			const error = new AuthenticationError("Provider", "Auth failed", "req_123")

			const result = extractErrorInfo(error)

			expect(result.retryDelay).toBe(0)
		})
	})

	describe("Original error preservation", () => {
		it("should preserve the original error object", () => {
			const error = new ApiProviderError("Test", "Provider", 500, "req_123")

			const result = extractErrorInfo(error)

			expect(result.originalError).toBe(error)
		})
	})
})
