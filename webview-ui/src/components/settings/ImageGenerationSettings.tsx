import React from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import type { ImageGenerationConfigEntry, ImageGenerationConfig } from "@coder/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import ImageGenerationConfigManager from "./ImageGenerationConfigManager"
import ImageGenerationConfigEditor from "./ImageGenerationConfigEditor"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	currentImageGenerationConfigName?: string
	listImageGenerationConfigMeta?: ImageGenerationConfigEntry[]
	imageGenerationApiKey?: string
	onSelectConfig: (configName: string) => void
	onDeleteConfig: (configName: string) => void
	onRenameConfig: (oldName: string, newName: string) => void
	onUpsertConfig: (configName: string) => void
	onUpdateConfig: (config: Partial<ImageGenerationConfig>) => void
	onUpdateApiKey: (apiKey: string) => void
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	currentImageGenerationConfigName,
	listImageGenerationConfigMeta,
	imageGenerationApiKey,
	onSelectConfig,
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
	onUpdateConfig,
	onUpdateApiKey,
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// Get current config
	const currentConfig = listImageGenerationConfigMeta?.find((c) => c.name === currentImageGenerationConfigName)

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-sm text-muted-foreground mt-1">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="space-y-4 pl-4 border-l-2 border-border">
					{/* Config Manager */}
					<div>
						<h4 className="text-sm font-medium mb-2">{t("settings:imageGeneration.configurations")}</h4>
						<ImageGenerationConfigManager
							currentImageGenerationConfigName={currentImageGenerationConfigName}
							listImageGenerationConfigMeta={listImageGenerationConfigMeta}
							onSelectConfig={onSelectConfig}
							onDeleteConfig={onDeleteConfig}
							onRenameConfig={onRenameConfig}
							onUpsertConfig={onUpsertConfig}
						/>
					</div>

					{/* Config Editor */}
					{currentConfig && (
						<div>
							<h4 className="text-sm font-medium mb-2">{t("settings:imageGeneration.configuration")}</h4>
							<ImageGenerationConfigEditor
								config={currentConfig as ImageGenerationConfig}
								apiKey={imageGenerationApiKey}
								onUpdateConfig={onUpdateConfig}
								onUpdateApiKey={onUpdateApiKey}
							/>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
