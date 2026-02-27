import { TypicalProvider } from "./types.js"
import { ProviderSettings } from "./schemas.js"

/**
 * ModelIdKey
 */

export const modelIdKeys = [
	"apiModelId",
	"openAiModelId",
] as const satisfies readonly (keyof ProviderSettings)[]

export type ModelIdKey = (typeof modelIdKeys)[number]

export const getModelId = (settings: ProviderSettings): string | undefined => {
	const modelIdKey = modelIdKeys.find((key) => settings[key])
	return modelIdKey ? settings[modelIdKey] : undefined
}

export const modelIdKeysByProvider: Record<TypicalProvider, ModelIdKey> = {
	anthropic: "apiModelId",
	"openai-native": "openAiModelId",
	gemini: "apiModelId",
}
