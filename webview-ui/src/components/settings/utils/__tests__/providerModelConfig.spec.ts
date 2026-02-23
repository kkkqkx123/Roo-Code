import {
	PROVIDER_SERVICE_CONFIG,
	PROVIDER_DEFAULT_MODEL_IDS,
	getProviderServiceConfig,
	getDefaultModelIdForProvider,
	getStaticModelsForProvider,
	isStaticModelProvider,
	PROVIDERS_WITH_CUSTOM_MODEL_UI,
	shouldUseGenericModelPicker,
} from "../providerModelConfig"

describe("providerModelConfig", () => {
	describe("PROVIDER_SERVICE_CONFIG", () => {
		it("contains service config for anthropic", () => {
			expect(PROVIDER_SERVICE_CONFIG.anthropic).toEqual({
				serviceName: "Anthropic",
				serviceUrl: "https://console.anthropic.com",
			})
		})

	})

	describe("getProviderServiceConfig", () => {
		it("returns correct config for known provider", () => {
			const config = getProviderServiceConfig("gemini")
			expect(config.serviceName).toBe("Google Gemini")
			expect(config.serviceUrl).toBe("https://ai.google.dev")
		})

		it("returns fallback config for unknown provider", () => {
			const config = getProviderServiceConfig("unknown-provider" as any)
			expect(config.serviceName).toBe("unknown-provider")
			expect(config.serviceUrl).toBe("")
		})
	})

	describe("PROVIDER_DEFAULT_MODEL_IDS", () => {
		it("contains default model IDs for static providers", () => {
			expect(PROVIDER_DEFAULT_MODEL_IDS.anthropic).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS.gemini).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS["openai-native"]).toBeDefined()
		})
	})

	describe("getDefaultModelIdForProvider", () => {
		it("returns default model ID for known provider", () => {
			const defaultId = getDefaultModelIdForProvider("anthropic")
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns empty string for unknown provider", () => {
			const defaultId = getDefaultModelIdForProvider("unknown" as any)
			expect(defaultId).toBe("")
		})
	})

	describe("getStaticModelsForProvider", () => {
		it("returns models for anthropic provider", () => {
			const models = getStaticModelsForProvider("anthropic")
			expect(Object.keys(models).length).toBeGreaterThan(0)
		})

		it("returns empty object for providers without static models", () => {
			const models = getStaticModelsForProvider("openai")
			expect(Object.keys(models).length).toBe(0)
		})
	})

	describe("isStaticModelProvider", () => {
		it("returns true for providers with static models", () => {
			expect(isStaticModelProvider("anthropic")).toBe(true)
			expect(isStaticModelProvider("gemini")).toBe(true)
			expect(isStaticModelProvider("openai-native")).toBe(true)
		})

		it("returns false for providers without static models", () => {
			expect(isStaticModelProvider("openai")).toBe(false)
		})
	})

	describe("PROVIDERS_WITH_CUSTOM_MODEL_UI", () => {
		it("includes providers that have their own model selection UI", () => {
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("openai")
		})

		it("does not include static providers using generic picker", () => {
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("anthropic")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("gemini")
		})
	})

	describe("shouldUseGenericModelPicker", () => {
		it("returns true for static providers without custom UI", () => {
			expect(shouldUseGenericModelPicker("anthropic")).toBe(true)
			expect(shouldUseGenericModelPicker("gemini")).toBe(true)
		})

		it("returns false for providers with custom model UI", () => {
			expect(shouldUseGenericModelPicker("openai")).toBe(false)
		})

		it("returns false for providers without static models", () => {
			expect(shouldUseGenericModelPicker("openai")).toBe(false)
		})
	})
})
