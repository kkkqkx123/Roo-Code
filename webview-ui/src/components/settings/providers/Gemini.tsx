import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings, ModelInfo } from "@coder/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Button, StandardTooltip } from "@src/components/ui"

import { inputEventTransform, noTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

const DEFAULT_MODEL_INFO: ModelInfo = {
	supportsTemperature: true,
}

type GeminiProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
	modelValidationError?: string
}

export const Gemini = ({ apiConfiguration, setApiConfigurationField, modelValidationError, simplifySettings }: GeminiProps) => {
	const { t } = useAppTranslation()

	const [googleGeminiBaseUrlSelected, setGoogleGeminiBaseUrlSelected] = useState(
		!!apiConfiguration?.googleGeminiBaseUrl,
	)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const handleInputChangeModelInfo = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.geminiApiKey || ""}
				type="password"
				onInput={handleInputChange("geminiApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.geminiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.geminiApiKey && (
				<VSCodeButtonLink href="https://ai.google.dev/" appearance="secondary">
					{t("settings:providers.getGeminiApiKey")}
				</VSCodeButtonLink>
			)}

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId=""
				models={null}
				modelIdKey="apiModelId"
				serviceName="Google Gemini"
				serviceUrl="https://ai.google.dev"
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>

			<div>
				<Checkbox
					data-testid="checkbox-custom-base-url"
					checked={googleGeminiBaseUrlSelected}
					onChange={(checked: boolean) => {
						setGoogleGeminiBaseUrlSelected(checked)
						if (!checked) {
							setApiConfigurationField("googleGeminiBaseUrl", "")
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{googleGeminiBaseUrlSelected && (
					<VSCodeTextField
						value={apiConfiguration?.googleGeminiBaseUrl || ""}
						type="url"
						onInput={handleInputChange("googleGeminiBaseUrl")}
						placeholder={t("settings:defaults.geminiUrl")}
						className="w-full mt-1"
					/>
				)}
			</div>

			<div className="flex flex-col gap-3">
				<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
					{t("settings:providers.customModel.capabilities")}
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.geminiCustomModelInfo?.maxTokens?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.geminiCustomModelInfo?.maxTokens

								if (!value) {
									return "var(--vscode-input-border)"
								}

								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChangeModelInfo("geminiCustomModelInfo", (e) => {
							const value = parseInt((e.target as HTMLInputElement).value)

							const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

							return {
								...currentValue,
								maxTokens: isNaN(value) ? undefined : value,
							}
						})}
						placeholder={t("settings:placeholders.numbers.maxTokens")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.maxTokens.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.maxTokens.description")}
					</div>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.geminiCustomModelInfo?.contextWindow?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.geminiCustomModelInfo?.contextWindow

								if (!value) {
									return "var(--vscode-input-border)"
								}

								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChangeModelInfo("geminiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseInt(value)

							const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

							return {
								...currentValue,
								contextWindow: parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.contextWindow")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.contextWindow.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.contextWindow.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<Checkbox
							checked={
								apiConfiguration?.geminiCustomModelInfo?.supportsImages ??
								false
							}
							onChange={handleInputChangeModelInfo("geminiCustomModelInfo", (checked) => {
								const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

								return {
									...currentValue,
									supportsImages: checked,
								}
							})}>
							<span className="font-medium">
								{t("settings:providers.customModel.imageSupport.label")}
							</span>
						</Checkbox>
						<StandardTooltip content={t("settings:providers.customModel.imageSupport.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.imageSupport.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<Checkbox
							checked={apiConfiguration?.geminiCustomModelInfo?.supportsPromptCache ?? false}
							onChange={handleInputChangeModelInfo("geminiCustomModelInfo", (checked) => {
								const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

								return {
									...currentValue,
									supportsPromptCache: checked,
								}
							})}>
							<span className="font-medium">{t("settings:providers.customModel.promptCache.label")}</span>
						</Checkbox>
						<StandardTooltip content={t("settings:providers.customModel.promptCache.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.promptCache.description")}
					</div>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.geminiCustomModelInfo?.inputPrice?.toString() ??

							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.geminiCustomModelInfo?.inputPrice

								if (!value && value !== 0) {
									return "var(--vscode-input-border)"
								}

								return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onChange={handleInputChangeModelInfo("geminiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)

							const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

							return {
								...currentValue,
								inputPrice: parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.inputPrice")}
						className="w-full">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.pricing.input.label")}
							</label>
							<StandardTooltip content={t("settings:providers.customModel.pricing.input.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</VSCodeTextField>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.geminiCustomModelInfo?.outputPrice?.toString() ||

							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.geminiCustomModelInfo?.outputPrice

								if (!value && value !== 0) {
									return "var(--vscode-input-border)"
								}

								return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onChange={handleInputChangeModelInfo("geminiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)

							const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

							return {
								...currentValue,
								outputPrice: parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.outputPrice")}
						className="w-full">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.pricing.output.label")}
							</label>
							<StandardTooltip content={t("settings:providers.customModel.pricing.output.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</VSCodeTextField>
				</div>

				{apiConfiguration?.geminiCustomModelInfo?.supportsPromptCache && (
					<>
						<div>
							<VSCodeTextField
								value={apiConfiguration?.geminiCustomModelInfo?.cacheReadsPrice?.toString() ?? "0"}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.geminiCustomModelInfo?.cacheReadsPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChangeModelInfo("geminiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

									return {
										...currentValue,
										cacheReadsPrice: isNaN(parsed) ? 0 : parsed,
									}
								})}
								placeholder={t("settings:placeholders.numbers.inputPrice")}
								className="w-full">
								<div className="flex items-center gap-1">
									<span className="font-medium">
										{t("settings:providers.customModel.pricing.cacheReads.label")}
									</span>
									<StandardTooltip
										content={t("settings:providers.customModel.pricing.cacheReads.description")}>
										<i
											className="codicon codicon-info text-vscode-descriptionForeground"
											style={{ fontSize: "12px" }}
										/>
									</StandardTooltip>
								</div>
							</VSCodeTextField>
						</div>
						<div>
							<VSCodeTextField
								value={apiConfiguration?.geminiCustomModelInfo?.cacheWritesPrice?.toString() ?? "0"}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.geminiCustomModelInfo?.cacheWritesPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChangeModelInfo("geminiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									const currentValue = apiConfiguration?.geminiCustomModelInfo || DEFAULT_MODEL_INFO

									return {
										...currentValue,
										cacheWritesPrice: isNaN(parsed) ? 0 : parsed,
									}
								})}
								placeholder={t("settings:placeholders.numbers.cacheWritePrice")}
								className="w-full">
								<div className="flex items-center gap-1">
									<label className="block font-medium mb-1">
										{t("settings:providers.customModel.pricing.cacheWrites.label")}
									</label>
									<StandardTooltip
										content={t("settings:providers.customModel.pricing.cacheWrites.description")}>
										<i
											className="codicon codicon-info text-vscode-descriptionForeground"
											style={{ fontSize: "12px" }}
										/>
									</StandardTooltip>
								</div>
							</VSCodeTextField>
						</div>
					</>
				)}

				<Button
					variant="secondary"
					onClick={() => setApiConfigurationField("geminiCustomModelInfo", undefined)}>
					{t("settings:providers.customModel.resetDefaults")}
				</Button>
			</div>
		</>
	)
}
