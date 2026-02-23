export * from "./anthropic.js"
export * from "./gemini.js"
export * from "./openai.js"

import { anthropicDefaultModelId } from "./anthropic.js"
import { geminiDefaultModelId } from "./gemini.js"
import { openAiNativeDefaultModelId } from "./openai.js"

// Import the ProviderName type from provider-settings to avoid duplication
import type { ProviderName } from "../provider-settings.js"

/**
 * Get the default model ID for a given provider.
 * This function returns only the provider's default model ID, without considering user configuration.
 * Used as a fallback when provider models are still loading.
 */
export function getProviderDefaultModelId(
	provider: ProviderName,
	_options: { isChina?: boolean } = { isChina: false },
): string {
	switch (provider) {
		case "gemini":
			return geminiDefaultModelId
		case "openai-native":
			return openAiNativeDefaultModelId
		case "openai":
			return "" // OpenAI provider uses custom model configuration
		case "anthropic":
		default:
			return anthropicDefaultModelId
	}
}
