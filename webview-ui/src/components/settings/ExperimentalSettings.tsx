import { HTMLAttributes } from "react"

import type { Experiments, ImageGenerationConfigEntry, ImageGenerationConfig } from "@coder/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@coder/experiments"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { ImageGenerationSettings } from "./ImageGenerationSettings"
import { CustomToolsSettings } from "./CustomToolsSettings"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	apiConfiguration?: any
	setApiConfigurationField?: any
	currentImageGenerationConfigName?: string
	listImageGenerationConfigMeta?: ImageGenerationConfigEntry[]
	imageGenerationApiKey?: string
	onSelectImageGenerationConfig?: (configName: string) => void
	onDeleteImageGenerationConfig?: (configName: string) => void
	onRenameImageGenerationConfig?: (oldName: string, newName: string) => void
	onUpsertImageGenerationConfig?: (configName: string) => void
	onUpdateImageGenerationConfig?: (config: Partial<ImageGenerationConfig>) => void
	onUpdateImageGenerationApiKey?: (apiKey: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	currentImageGenerationConfigName,
	listImageGenerationConfigMeta,
	imageGenerationApiKey,
	onSelectImageGenerationConfig,
	onDeleteImageGenerationConfig,
	onRenameImageGenerationConfig,
	onUpsertImageGenerationConfig,
	onUpdateImageGenerationConfig,
	onUpdateImageGenerationApiKey,
	className,
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.experimental")}</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter(([key]) => key in EXPERIMENT_IDS)
					.map((config) => {
						// Use the same translation key pattern as ExperimentalFeature
						const experimentKey = config[0]
						const label = t(`settings:experimental.${experimentKey}.name`)

						if (
							config[0] === "IMAGE_GENERATION" &&
							onSelectImageGenerationConfig &&
							onDeleteImageGenerationConfig &&
							onRenameImageGenerationConfig &&
							onUpsertImageGenerationConfig &&
							onUpdateImageGenerationConfig &&
							onUpdateImageGenerationApiKey
						) {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="experimental"
									label={label}>
									<ImageGenerationSettings
										enabled={experiments[EXPERIMENT_IDS.IMAGE_GENERATION] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.IMAGE_GENERATION, enabled)
										}
										currentImageGenerationConfigName={currentImageGenerationConfigName}
										listImageGenerationConfigMeta={listImageGenerationConfigMeta}
										imageGenerationApiKey={imageGenerationApiKey}
										onSelectConfig={onSelectImageGenerationConfig}
										onDeleteConfig={onDeleteImageGenerationConfig}
										onRenameConfig={onRenameImageGenerationConfig}
										onUpsertConfig={onUpsertImageGenerationConfig}
										onUpdateConfig={onUpdateImageGenerationConfig}
										onUpdateApiKey={onUpdateImageGenerationApiKey}
									/>
								</SearchableSetting>
							)
						}
						if (config[0] === "CUSTOM_TOOLS") {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="experimental"
									label={label}>
									<CustomToolsSettings
										enabled={experiments[EXPERIMENT_IDS.CUSTOM_TOOLS] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.CUSTOM_TOOLS, enabled)
										}
									/>
								</SearchableSetting>
							)
						}
						return (
							<SearchableSetting
								key={config[0]}
								settingId={`experimental-${config[0].toLowerCase()}`}
								section="experimental"
								label={label}>
								<ExperimentalFeature
									experimentKey={config[0]}
									enabled={
										experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false
									}
									onChange={(enabled) =>
										setExperimentEnabled(
											EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
											enabled,
										)
									}
								/>
							</SearchableSetting>
						)
					})}
			</Section>
		</div>
	)
}
