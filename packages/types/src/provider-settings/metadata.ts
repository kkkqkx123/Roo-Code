import { ProviderName } from "./types.js"

/**
 * MODELS_BY_PROVIDER
 *
 * Removed hardcoded model lists. All providers now support custom model configuration
 * just like OpenAI Compatible endpoints. Users must provide model ID and optionally
 * model info through their configuration.
 */

export const MODELS_BY_PROVIDER: Record<ProviderName, { id: ProviderName; label: string; models: string[] }> = {
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		models: [], // No hardcoded models - users provide custom model IDs
	},
	gemini: {
		id: "gemini",
		label: "Google Gemini",
		models: [], // No hardcoded models - users provide custom model IDs
	},
	"openai-native": {
		id: "openai-native",
		label: "OpenAI",
		models: [], // No hardcoded models - users provide custom model IDs
	},
	openai: {
		id: "openai",
		label: "OpenAI Compatible",
		models: [],
	},
}
