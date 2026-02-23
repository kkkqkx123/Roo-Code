// Mock i18next to return translation keys with interpolated values
vi.mock("i18next", () => ({
	default: {
		t: (key: string, options?: Record<string, string>) => {
			if (options) {
				let result = key
				Object.entries(options).forEach(([k, v]) => {
					result += ` ${k}=${v}`
				})
				return result
			}
			return key
		},
	},
}))

import { getModelValidationError, validateApiConfigurationExcludingModelErrors } from "../validate"
import type { ProviderSettings } from "@coder/types"

describe("Model Validation Functions", () => {
	describe("getModelValidationError", () => {
		it("returns error for missing required OpenAI fields", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "valid-model",
			}

			const result = getModelValidationError(config)
			expect(result).toBe("settings:validation.openAi")
		})

		it("returns error for missing OpenAI model ID", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "valid-key",
			}

			const result = getModelValidationError(config)
			expect(result).toBe("settings:validation.openAi")
		})

		it("returns undefined for valid OpenAI configuration", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "valid-key",
				openAiModelId: "valid-model",
			}

			const result = getModelValidationError(config)
			expect(result).toBeUndefined()
		})

		it("handles empty model IDs gracefully", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "valid-key",
				openAiModelId: "",
			}

			const result = getModelValidationError(config)
			expect(result).toBe("settings:validation.openAi")
		})

		it("handles undefined model IDs gracefully", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "valid-key",
				// openAiModelId is undefined
			}

			const result = getModelValidationError(config)
			expect(result).toBe("settings:validation.openAi")
		})
	})

	describe("validateApiConfigurationExcludingModelErrors", () => {
		it("returns undefined when configuration is valid", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "valid-key",
				openAiModelId: "valid-model",
			}

			const result = validateApiConfigurationExcludingModelErrors(config)
			expect(result).toBeUndefined()
		})

		it("returns error for missing required OpenAI fields", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "valid-model",
				// Missing openAiBaseUrl and openAiApiKey
			}

			const result = validateApiConfigurationExcludingModelErrors(config)
			expect(result).toBe("settings:validation.openAi")
		})

		it("excludes model-specific errors", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "valid-key",
				openAiModelId: "invalid-model", // This should be ignored
			}

			const result = validateApiConfigurationExcludingModelErrors(config)
			expect(result).toBeUndefined() // Should not return model validation error
		})
	})
})
