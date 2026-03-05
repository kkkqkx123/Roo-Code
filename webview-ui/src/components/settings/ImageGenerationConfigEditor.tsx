import { memo } from "react"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import type {
	ImageGenerationConfig,
	ImageGenerationProvider,
	ImageGenerationApiMethod,
} from "@coder/types"
import { DEFAULT_IMAGE_GENERATION_MODELS, getDefaultBaseUrl, getDefaultApiMethod } from "@coder/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Input } from "@/components/ui"

interface ImageGenerationConfigEditorProps {
	config?: ImageGenerationConfig
	apiKey?: string
	onUpdateConfig: (config: Partial<ImageGenerationConfig>) => void
	onUpdateApiKey: (apiKey: string) => void
}

const ImageGenerationConfigEditor = ({
	config,
	apiKey,
	onUpdateConfig,
	onUpdateApiKey,
}: ImageGenerationConfigEditorProps) => {
	const { t } = useAppTranslation()

	const handleProviderChange = (provider: ImageGenerationProvider) => {
		const defaultBaseUrl = getDefaultBaseUrl(provider)
		const defaultApiMethod = getDefaultApiMethod(provider)

		// Get first model for this provider
		const providerModels = DEFAULT_IMAGE_GENERATION_MODELS.filter((m) => m.provider === provider)
		const defaultModelId = providerModels[0]?.value || ""

		onUpdateConfig({
			provider,
			baseUrl: defaultBaseUrl,
			apiMethod: defaultApiMethod,
			modelId: defaultModelId,
		})
	}

	const handleModelChange = (modelId: string) => {
		const modelInfo = DEFAULT_IMAGE_GENERATION_MODELS.find((m) => m.value === modelId)
		if (modelInfo) {
			onUpdateConfig({
				modelId,
				apiMethod: modelInfo.apiMethod,
			})
		}
	}

	const handleApiKeyChange = (value: string) => {
		onUpdateApiKey(value)
	}

	const provider = config?.provider || "openai"
	const modelId = config?.modelId || ""
	const baseUrl = config?.baseUrl || getDefaultBaseUrl(provider) || ""
	const apiMethod = config?.apiMethod || getDefaultApiMethod(provider)

	// Get available models for current provider
	const availableModels = DEFAULT_IMAGE_GENERATION_MODELS.filter((m) => m.provider === provider)

	return (
		<div className="space-y-4">
			{/* Provider Selection */}
			<div>
				<label className="text-sm font-medium mb-2 block">
					{t("settings:imageGeneration.provider")}
				</label>
				<VSCodeDropdown
					value={provider}
					onChange={(e: any) => handleProviderChange(e.target.value as ImageGenerationProvider)}
					className="w-full"
				>
					<VSCodeOption value="openai">OpenAI</VSCodeOption>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="custom">{t("settings:imageGeneration.customProvider")}</VSCodeOption>
				</VSCodeDropdown>
			</div>

			{/* API Key */}
			<div>
				<label className="text-sm font-medium mb-2 block">
					{t("settings:imageGeneration.apiKey")}
				</label>
				<Input
					type="password"
					value={apiKey || ""}
					onChange={(e) => handleApiKeyChange(e.target.value)}
					placeholder={t("settings:imageGeneration.apiKeyPlaceholder")}
					className="w-full"
				/>
			</div>

			{/* Base URL (for custom provider) */}
			{provider === "custom" && (
				<div>
					<label className="text-sm font-medium mb-2 block">
						{t("settings:imageGeneration.baseUrl")}
					</label>
					<Input
						value={baseUrl}
						onChange={(e) => onUpdateConfig({ baseUrl: e.target.value })}
						placeholder="https://api.example.com/v1"
						className="w-full"
					/>
					<p className="text-xs text-muted-foreground mt-1">
						{t("settings:imageGeneration.baseUrlDescription")}
					</p>
				</div>
			)}

			{/* Model Selection */}
			<div>
				<label className="text-sm font-medium mb-2 block">
					{t("settings:imageGeneration.model")}
				</label>
				<VSCodeDropdown
					value={modelId}
					onChange={(e: any) => handleModelChange(e.target.value)}
					className="w-full"
				>
					{availableModels.map((model) => (
						<VSCodeOption key={model.value} value={model.value}>
							{model.label}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				{provider === "custom" && (
					<Input
						value={modelId}
						onChange={(e) => onUpdateConfig({ modelId: e.target.value })}
						placeholder={t("settings:imageGeneration.modelIdPlaceholder")}
						className="w-full mt-2"
					/>
				)}
			</div>

			{/* API Method */}
			<div>
				<label className="text-sm font-medium mb-2 block">
					{t("settings:imageGeneration.apiMethod")}
				</label>
				<VSCodeDropdown
					value={apiMethod}
					onChange={(e: any) => onUpdateConfig({ apiMethod: e.target.value as ImageGenerationApiMethod })}
					className="w-full"
				>
					<VSCodeOption value="images_api">Images API</VSCodeOption>
					<VSCodeOption value="chat_completions">Chat Completions</VSCodeOption>
				</VSCodeDropdown>
				<p className="text-xs text-muted-foreground mt-1">
					{t("settings:imageGeneration.apiMethodDescription")}
				</p>
			</div>
		</div>
	)
}

export default memo(ImageGenerationConfigEditor)
