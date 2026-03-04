import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ModelInfo, ProviderSettings } from "@coder/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StandardTooltip, Button } from "@src/components/ui"

import { inputEventTransform, noTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

const DEFAULT_MODEL_INFO: ModelInfo = {
	supportsTemperature: true,
}

type OpenAIProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	selectedModelInfo?: ModelInfo
	simplifySettings?: boolean
	modelValidationError?: string
}

export const OpenAI = ({ apiConfiguration, setApiConfigurationField, selectedModelInfo, modelValidationError, simplifySettings }: OpenAIProps) => {
	const { t } = useAppTranslation()

	const [openAiNativeBaseUrlSelected, setOpenAiNativeBaseUrlSelected] = useState(
		!!apiConfiguration?.openAiNativeBaseUrl,
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
			<Checkbox
				checked={openAiNativeBaseUrlSelected}
				onChange={(checked: boolean) => {
					setOpenAiNativeBaseUrlSelected(checked)

					if (!checked) {
						setApiConfigurationField("openAiNativeBaseUrl", "")
					}
				}}>
				{t("settings:providers.useCustomBaseUrl")}
			</Checkbox>
			{openAiNativeBaseUrlSelected && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.openAiNativeBaseUrl || ""}
						type="url"
						onInput={handleInputChange("openAiNativeBaseUrl")}
						placeholder="https://api.openai.com/v1"
						className="w-full mt-1"
					/>
				</>
			)}
			<VSCodeTextField
				value={apiConfiguration?.openAiNativeApiKey || ""}
				type="password"
				onInput={handleInputChange("openAiNativeApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.openAiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openAiNativeApiKey && (
				<VSCodeButtonLink href="https://platform.openai.com/api-keys" appearance="secondary">
					{t("settings:providers.getOpenAiApiKey")}
				</VSCodeButtonLink>
			)}

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId=""
				models={null}
				modelIdKey="apiModelId"
				serviceName="OpenAI"
				serviceUrl="https://platform.openai.com"
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>

			{(() => {
				const allowedTiers = (selectedModelInfo?.tiers?.map((t) => t.name).filter(Boolean) || []).filter(
					(t) => t === "flex" || t === "priority",
				)
				if (allowedTiers.length === 0) return null

				return (
					<div className="flex flex-col gap-1 mt-2" data-testid="openai-service-tier">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">Service tier</label>
							<StandardTooltip content="For faster processing of API requests, try the priority processing service tier. For lower prices with higher latency, try the flex processing tier.">
								<i className="codicon codicon-info text-vscode-descriptionForeground text-xs" />
							</StandardTooltip>
						</div>

						<Select
							value={apiConfiguration.openAiNativeServiceTier || "default"}
							onValueChange={(value) =>
								setApiConfigurationField(
									"openAiNativeServiceTier",
									value as ProviderSettings["openAiNativeServiceTier"],
								)
							}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="default">Standard</SelectItem>
								{allowedTiers.includes("flex") && <SelectItem value="flex">Flex</SelectItem>}
								{allowedTiers.includes("priority") && (
									<SelectItem value="priority">Priority</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				)
			})()}

			<div className="flex flex-col gap-3">
				<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
					{t("settings:providers.customModel.capabilities")}
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.openAiCustomModelInfo?.maxTokens?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.maxTokens

								if (!value) {
									return "var(--vscode-input-border)"
								}

								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChangeModelInfo("openAiCustomModelInfo", (e) => {
							const value = parseInt((e.target as HTMLInputElement).value)

							const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
							apiConfiguration?.openAiCustomModelInfo?.contextWindow?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.contextWindow

								if (!value) {
									return "var(--vscode-input-border)"
								}

								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChangeModelInfo("openAiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseInt(value)

							const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
								apiConfiguration?.openAiCustomModelInfo?.supportsImages ??
								false
							}
							onChange={handleInputChangeModelInfo("openAiCustomModelInfo", (checked) => {
								const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
							checked={apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache ?? false}
							onChange={handleInputChangeModelInfo("openAiCustomModelInfo", (checked) => {
								const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
							apiConfiguration?.openAiCustomModelInfo?.inputPrice?.toString() ??

							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.inputPrice

								if (!value && value !== 0) {
									return "var(--vscode-input-border)"
								}

								return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onChange={handleInputChangeModelInfo("openAiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)

							const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
							apiConfiguration?.openAiCustomModelInfo?.outputPrice?.toString() ||

							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.outputPrice

								if (!value && value !== 0) {
									return "var(--vscode-input-border)"
								}

								return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onChange={handleInputChangeModelInfo("openAiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)

							const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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

				{apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache && (
					<>
						<div>
							<VSCodeTextField
								value={apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice?.toString() ?? "0"}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChangeModelInfo("openAiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
								value={apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice?.toString() ?? "0"}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChangeModelInfo("openAiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									const currentValue = apiConfiguration?.openAiCustomModelInfo || DEFAULT_MODEL_INFO

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
					onClick={() => setApiConfigurationField("openAiCustomModelInfo", undefined)}>
					{t("settings:providers.customModel.resetDefaults")}
				</Button>
			</div>
		</>
	)
}
