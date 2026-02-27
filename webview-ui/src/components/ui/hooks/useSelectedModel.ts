import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
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
			: { id: "", info: undefined }

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
	switch (provider) {
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? ""
			const info = apiConfiguration.undefined
			return { id, info }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? ""
			const info = apiConfiguration.undefined
			return { id, info }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const customInfo = apiConfiguration?.openAiCustomModelInfo
			const info = customInfo ?? undefined
			return { id, info }
		}
		default: {
			provider satisfies "anthropic" | "gemini-cli" | "fake-ai"
			const id = apiConfiguration.apiModelId ?? ""
			const info = apiConfiguration.undefined
			return { id, info }
		}
	}
}
