import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
	anthropicModels,
	geminiModels,
	openAiModelInfoSaneDefaults,
	openAiNativeModels,
	getProviderDefaultModelId,
} from "@coder/types"


export const useSelectedModel = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const activeProvider = provider

	const { id, info } =
		apiConfiguration && activeProvider
			? getSelectedModel({
				provider: activeProvider,
				apiConfiguration,
			})
			: { id: getProviderDefaultModelId(activeProvider ?? "anthropic"), info: undefined }

	return {
		provider,
		id,
		info,
		isLoading: false,
		isError: false,
	}
}

function getSelectedModel({
	provider,
	apiConfiguration,
}: {
	provider: ProviderName
	apiConfiguration: ProviderSettings
}): { id: string; info: ModelInfo | undefined } {
	// the `undefined` case are used to show the invalid selection to prevent
	// users from seeing the default model if their selection is invalid
	// this gives a better UX than showing the default model
	const defaultModelId = getProviderDefaultModelId(provider)
	switch (provider) {
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = geminiModels[id as keyof typeof geminiModels]
			return { id, info }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = openAiNativeModels[id as keyof typeof openAiNativeModels]
			return { id, info }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const customInfo = apiConfiguration?.openAiCustomModelInfo
			const info = customInfo ?? openAiModelInfoSaneDefaults
			return { id, info }
		}
		default: {
			provider satisfies "anthropic" | "gemini-cli" | "fake-ai"
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = anthropicModels[id as keyof typeof anthropicModels]

			// Apply 1M context beta tier pricing for supported Claude 4 models
			if (
				provider === "anthropic" &&
				(id === "claude-sonnet-4-20250514" ||
					id === "claude-sonnet-4-5" ||
					id === "claude-sonnet-4-6" ||
					id === "claude-opus-4-6") &&
				apiConfiguration.anthropicBeta1MContext &&
				baseInfo
			) {
				// Type assertion since supported Claude 4 models include 1M context pricing tiers.
				const modelWithTiers = baseInfo as typeof baseInfo & {
					tiers?: Array<{
						contextWindow: number
						inputPrice?: number
						outputPrice?: number
						cacheWritesPrice?: number
						cacheReadsPrice?: number
					}>
				}
				const tier = modelWithTiers.tiers?.[0]
				if (tier) {
					// Create a new ModelInfo object with updated values
					const info: ModelInfo = {
						...baseInfo,
						contextWindow: tier.contextWindow,
						inputPrice: tier.inputPrice ?? baseInfo.inputPrice,
						outputPrice: tier.outputPrice ?? baseInfo.outputPrice,
						cacheWritesPrice: tier.cacheWritesPrice ?? baseInfo.cacheWritesPrice,
						cacheReadsPrice: tier.cacheReadsPrice ?? baseInfo.cacheReadsPrice,
					}
					return { id, info }
				}
			}

			return { id, info: baseInfo }
		}
	}
}
