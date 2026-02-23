import { describe, it, expect } from "vitest"
import { checkContextWindowExceededError } from "../error-handling"

describe("checkContextWindowExceededError", () => {
	// Test OpenAI errors
	it("should detect OpenAI context window error by error.code and message", () => {
		const error = {
			code: "400",
			message: "This model's maximum context length is 4096 tokens",
		}

		expect(checkContextWindowExceededError(error)).toBe(true)
	})

	it("should detect OpenAI token limit error", () => {
		const error = {
			code: "400",
			message: "Token limit exceeded",
		}

		expect(checkContextWindowExceededError(error)).toBe(true)
	})

	it("should not flag non-context errors", () => {
		const error = {
			code: "401",
			message: "Unauthorized",
		}

		expect(checkContextWindowExceededError(error)).toBe(false)
	})

	// Test OpenRouter errors
	it("should detect OpenRouter context length error", () => {
		const error = {
			status: 400,
			message: "context length exceeded",
		}

		expect(checkContextWindowExceededError(error)).toBe(true)
	})

	it("should detect OpenRouter maximum context error", () => {
		const error = {
			status: 400,
			message: "maximum context size",
		}

		expect(checkContextWindowExceededError(error)).toBe(true)
	})

	it("should detect OpenRouter tokens exceed error", () => {
		const error = {
			status: 400,
			message: "input tokens exceed maximum",
		}

		expect(checkContextWindowExceededError(error)).toBe(true)
	})

	it("should detect OpenRouter too many tokens error", () => {
		const error = {
			status: 400,
			message: "too many tokens provided",
		}

		expect(checkContextWindowExceededError(error)).toBe(true)
	})

	it("should not flag OpenRouter non-400 errors", () => {
		const error = {
			status: 500,
			message: "context length exceeded",
		}

		expect(checkContextWindowExceededError(error)).toBe(false)
	})

	// Test Anthropic errors
	it("should detect Anthropic context length error", () => {
		const response = {
			error: {
				error: {
					type: "invalid_request_error",
					code: "context_length_exceeded",
					message: "prompt is too long",
				},
			},
		}

		expect(checkContextWindowExceededError(response)).toBe(true)
	})

	it("should detect Anthropic maximum tokens error", () => {
		const response = {
			error: {
				error: {
					type: "invalid_request_error",
					message: "maximum context tokens exceeded",
				},
			},
		}

		expect(checkContextWindowExceededError(response)).toBe(true)
	})

	it("should detect Anthropic context too long error", () => {
		const response = {
			error: {
				error: {
					type: "invalid_request_error",
					message: "context is too long for this model",
				},
			},
		}

		expect(checkContextWindowExceededError(response)).toBe(true)
	})

	it("should detect Anthropic exceeds context error", () => {
		const response = {
			error: {
				error: {
					type: "invalid_request_error",
					message: "request exceeds context window",
				},
			},
		}

		expect(checkContextWindowExceededError(response)).toBe(true)
	})

	it("should detect Anthropic token limit error", () => {
		const response = {
			error: {
				error: {
					type: "invalid_request_error",
					message: "token limit reached",
				},
			},
		}

		expect(checkContextWindowExceededError(response)).toBe(true)
	})

	it("should not flag Anthropic non-context errors", () => {
		const response = {
			error: {
				error: {
					type: "invalid_request_error",
					message: "invalid API key",
				},
			},
		}

		expect(checkContextWindowExceededError(response)).toBe(false)
	})

	// Test edge cases
	it("should handle null/undefined gracefully", () => {
		expect(checkContextWindowExceededError(null)).toBe(false)
		expect(checkContextWindowExceededError(undefined)).toBe(false)
	})

	it("should handle string errors gracefully", () => {
		expect(checkContextWindowExceededError("context length exceeded")).toBe(false)
	})

	it("should handle malformed error objects", () => {
		const error = { nested: { deeply: { message: "context length exceeded" } } }

		expect(checkContextWindowExceededError(error)).toBe(false)
	})
})
