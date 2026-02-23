// npx vitest run src/api/transform/__tests__/reasoning.spec.ts

import type { ModelInfo, ProviderSettings, ReasoningEffortWithMinimal } from "@coder/types"

import {
	getAnthropicReasoning,
	getOpenAiReasoning,
	getGeminiReasoning,
	GetModelReasoningOptions,
	AnthropicReasoningParams,
	OpenAiReasoningParams,
	GeminiReasoningParams,
	GeminiThinkingLevel,
} from "../reasoning"
import { expect } from "vitest"

describe("reasoning.ts", () => {
	const baseModel: ModelInfo = {
		contextWindow: 16000,
		supportsPromptCache: true,
	}

	const baseSettings: ProviderSettings = {}

	const baseOptions: GetModelReasoningOptions = {
		model: baseModel,
		reasoningBudget: 1000,
		reasoningEffort: "medium",
		settings: baseSettings,
	}

	describe("getAnthropicReasoning", () => {
		it("should return reasoning budget params when model has requiredReasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const options = { ...baseOptions, model: modelWithRequired }
			const result = getAnthropicReasoning(options)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 1000,
			})
		})

		it("should return reasoning budget params when model supports reasoning budget and setting is enabled", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const settingsWithEnabled: ProviderSettings = {
				enableReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEnabled,
			}

			const result = getAnthropicReasoning(options)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 1000,
			})
		})

		it("should return undefined when model has no reasoning budget capability", () => {
			const result = getAnthropicReasoning(baseOptions)
			expect(result).toBeUndefined()
		})

		it("should return undefined when supportsReasoningBudget is true but enableReasoningEffort is false", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const settingsWithDisabled: ProviderSettings = {
				enableReasoningEffort: false,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithDisabled,
			}

			const result = getAnthropicReasoning(options)

			expect(result).toBeUndefined()
		})

		it("should handle undefined reasoningBudget with non-null assertion", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithoutBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: undefined,
			}

			const result = getAnthropicReasoning(optionsWithoutBudget)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: undefined,
			})
		})

		it("should handle zero reasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithZeroBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: 0,
			}

			const result = getAnthropicReasoning(optionsWithZeroBudget)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 0,
			})
		})

		it("should handle large reasoningBudget values", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithLargeBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: 100000,
			}

			const result = getAnthropicReasoning(optionsWithLargeBudget)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 100000,
			})
		})

		it("should not be affected by reasoningEffort parameter", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithEffort = {
				...baseOptions,
				model: modelWithRequired,
				reasoningEffort: "high" as const,
			}

			const result = getAnthropicReasoning(optionsWithEffort)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 1000,
			})
		})

		it("should ignore reasoning effort capabilities for Anthropic", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "high",
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "medium",
			}

			const options = {
				...baseOptions,
				model: modelWithEffort,
				settings: settingsWithEffort,
			}

			const result = getAnthropicReasoning(options)

			expect(result).toBeUndefined()
		})
	})

	describe("getOpenAiReasoning", () => {
		it("should return reasoning effort params when model supports reasoning effort and has effort in settings", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "high",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEffort,
				reasoningEffort: "high" as const,
			}

			const result = getOpenAiReasoning(options)

			expect(result).toEqual({ reasoning_effort: "high" })
		})

		it("should return reasoning effort params when model has reasoningEffort property", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const options = { ...baseOptions, model: modelWithEffort }
			const result = getOpenAiReasoning(options)

			expect(result).toEqual({ reasoning_effort: "medium" })
		})

		it("should return undefined when model has no reasoning effort capability", () => {
			const result = getOpenAiReasoning(baseOptions)
			expect(result).toBeUndefined()
		})

		it("should return undefined when supportsReasoningEffort is true but no effort is specified", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: {},
				reasoningEffort: undefined,
			}

			const result = getOpenAiReasoning(options)

			expect(result).toBeUndefined()
		})

		it("should handle undefined reasoningEffort", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const optionsWithoutEffort = {
				...baseOptions,
				model: modelWithEffort,
				reasoningEffort: undefined,
			}

			const result = getOpenAiReasoning(optionsWithoutEffort)

			expect(result).toBeUndefined()
		})

		it("should handle all reasoning effort values", () => {
			const efforts: Array<"low" | "medium" | "high"> = ["low", "medium", "high"]

			efforts.forEach((effort) => {
				const modelWithEffort: ModelInfo = {
					...baseModel,
					reasoningEffort: effort,
				}

				const options = { ...baseOptions, model: modelWithEffort, reasoningEffort: effort }
				const result = getOpenAiReasoning(options)
				expect(result).toEqual({ reasoning_effort: effort })
			})
		})

		it("should not be affected by reasoningBudget parameter", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const optionsWithBudget = {
				...baseOptions,
				model: modelWithEffort,
				reasoningBudget: 5000,
			}

			const result = getOpenAiReasoning(optionsWithBudget)

			expect(result).toEqual({ reasoning_effort: "medium" })
		})

		it("should ignore reasoning budget capabilities for OpenAI", () => {
			const modelWithBudget: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
			}

			const settingsWithEnabled: ProviderSettings = {
				enableReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithBudget,
				settings: settingsWithEnabled,
			}

			const result = getOpenAiReasoning(options)

			expect(result).toBeUndefined()
		})
	})

	describe("Gemini reasoning (effort models)", () => {
		it("should return thinkingLevel when effort is set to low or high and budget is not used", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				// Effort-only reasoning model (no budget fields)
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				enableReasoningEffort: true,
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 2048,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined

			// Budget should not be used for effort-only models
			expect(result).toEqual({ thinkingLevel: "high", includeThoughts: true })
		})

		it("should still return thinkingLevel when enableReasoningEffort is false but effort is explicitly set", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				// Effort-only reasoning model
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				// Even with this flag false, an explicit effort selection should win
				enableReasoningEffort: false,
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 2048,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "high", includeThoughts: true })
		})

		it("should return thinkingLevel for minimal effort", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "high",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "minimal",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "minimal",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "minimal", includeThoughts: true })
		})

		it("should return thinkingLevel for medium effort", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "medium",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "medium",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "medium", includeThoughts: true })
		})

		it("should handle all four Gemini thinking levels", () => {
			const levels: GeminiThinkingLevel[] = ["minimal", "low", "medium", "high"]

			levels.forEach((level) => {
				const geminiModel: ModelInfo = {
					...baseModel,
					supportsReasoningEffort: [
						"minimal",
						"low",
						"medium",
						"high",
					] as ModelInfo["supportsReasoningEffort"],
					reasoningEffort: "low",
				}

				const settings: ProviderSettings = {
					apiProvider: "gemini",
					reasoningEffort: level,
				}

				const options: GetModelReasoningOptions = {
					model: geminiModel,
					reasoningBudget: undefined,
					reasoningEffort: level,
					settings,
				}

				const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
				expect(result).toEqual({ thinkingLevel: level, includeThoughts: true })
			})
		})

		it("should return undefined for disable effort", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "disable",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "disable",
				settings,
			}

			const result = getGeminiReasoning(options)
			expect(result).toBeUndefined()
		})

		it("should return undefined for none effort (invalid for Gemini)", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "none",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "none",
				settings,
			}

			const result = getGeminiReasoning(options)
			// "none" is not a valid GeminiThinkingLevel, so no fallback — returns undefined
			expect(result).toBeUndefined()
		})

		it("should use thinkingBudget for budget-based models", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				enableReasoningEffort: true,
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 4096,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingBudget: 4096, includeThoughts: true })
		})

		it("should prioritize budget over effort when model has requiredReasoningBudget", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				enableReasoningEffort: true,
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 8192,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			// Budget should take precedence
			expect(result).toEqual({ thinkingBudget: 8192, includeThoughts: true })
		})

		it("should fall back to model default effort when settings.reasoningEffort is undefined", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "medium",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: undefined,
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "medium", includeThoughts: true })
		})

		it("should fall back to model default when settings effort is not in supportsReasoningEffort array", () => {
			// Simulates gemini-3-pro-preview which only supports ["low", "high"]
			// but user has reasoningEffort: "medium" from a different model
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "medium",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "medium",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			// "medium" is not in ["low", "high"], so falls back to model.reasoningEffort "low"
			expect(result).toEqual({ thinkingLevel: "low", includeThoughts: true })
		})

		it("should return undefined when unsupported effort and model default is also invalid", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				// No reasoningEffort default set
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "medium",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "medium",
				settings,
			}

			const result = getGeminiReasoning(options)
			// "medium" is not in ["low", "high"], fallback is undefined → returns undefined
			expect(result).toBeUndefined()
		})

		it("should pass through effort that IS in the supportsReasoningEffort array", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			// "high" IS in ["low", "high"], so it should be used directly
			expect(result).toEqual({ thinkingLevel: "high", includeThoughts: true })
		})

		it("should skip validation when supportsReasoningEffort is boolean (not array)", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "medium",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "medium",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			// boolean supportsReasoningEffort should not trigger array validation
			expect(result).toEqual({ thinkingLevel: "medium", includeThoughts: true })
		})

		it("should fall back to model default when settings has 'minimal' but model only supports ['low', 'high']", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "minimal",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "minimal",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			// "minimal" is not in ["low", "high"], falls back to "low"
			expect(result).toEqual({ thinkingLevel: "low", includeThoughts: true })
		})
	})
})
