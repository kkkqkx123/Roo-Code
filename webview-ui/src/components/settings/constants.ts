import {
	type ProviderName,
	type ModelInfo,
	anthropicModels,
	geminiModels,
	openAiNativeModels,
} from "@coder/types"

export const MODELS_BY_PROVIDER: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	anthropic: anthropicModels,
	gemini: geminiModels,
	"openai-native": openAiNativeModels,
}

export const PROVIDERS = [
	{ value: "anthropic", label: "Anthropic", proxy: false },
	{ value: "gemini", label: "Google Gemini", proxy: false },
	{ value: "openai-native", label: "OpenAI", proxy: false },
	{ value: "openai", label: "OpenAI Compatible", proxy: true },
].sort((a, b) => a.label.localeCompare(b.label))
