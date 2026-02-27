import {
	type ProviderName,
	type ModelInfo,
} from "@coder/types"

/**
 * MODELS_BY_PROVIDER
 *
 * Removed hardcoded model lists. All providers now support custom model configuration
 * just like OpenAI Compatible endpoints. Users must provide model ID and optionally
 * model info through their configuration.
 */
export const MODELS_BY_PROVIDER: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	// No hardcoded models - users provide custom model configuration
}

export const PROVIDERS = [
	{ value: "anthropic", label: "Anthropic", proxy: false },
	{ value: "gemini", label: "Google Gemini", proxy: false },
	{ value: "openai-native", label: "OpenAI", proxy: false },
	{ value: "openai", label: "OpenAI Compatible", proxy: true },
].sort((a, b) => a.label.localeCompare(b.label))
