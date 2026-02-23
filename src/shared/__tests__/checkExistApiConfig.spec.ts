// npx vitest run src/shared/__tests__/checkExistApiConfig.spec.ts

import type { ProviderSettings } from "@coder/types"

import { checkExistKey } from "../checkExistApiConfig"

describe("checkExistKey", () => {
	it("should return false for undefined config", () => {
		expect(checkExistKey(undefined)).toBe(false)
	})

	it("should return false for empty config", () => {
		const config: ProviderSettings = {}
		expect(checkExistKey(config)).toBe(false)
	})

	it("should return true when one key is defined", () => {
		const config: ProviderSettings = {
			apiKey: "test-key",
		}
		expect(checkExistKey(config)).toBe(true)
	})

	it("should return true when multiple keys are defined", () => {
		const config: ProviderSettings = {
			apiKey: "test-key",
			openAiApiKey: "openai-key",
		}
		expect(checkExistKey(config)).toBe(true)
	})

	it("should return true when only non-key fields are undefined", () => {
		const config: ProviderSettings = {
			apiKey: "test-key",
			apiProvider: undefined,
			anthropicBaseUrl: undefined,
			modelMaxThinkingTokens: undefined,
		}
		expect(checkExistKey(config)).toBe(true)
	})

	it("should return false when all key fields are undefined", () => {
		const config: ProviderSettings = {
			apiKey: undefined,
			openAiApiKey: undefined,
			vertexProjectId: undefined,
			geminiApiKey: undefined,
			openAiNativeApiKey: undefined,
		}
		expect(checkExistKey(config)).toBe(false)
	})

	it("should return true when vertexProjectId is defined", () => {
		const config: ProviderSettings = {
			vertexProjectId: "test-project",
		}
		expect(checkExistKey(config)).toBe(true)
	})
})