import { memo, useEffect, useRef, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ImageGenerationConfigEntry, ImageGenerationProvider } from "@coder/types"
import { DEFAULT_IMAGE_GENERATION_MODELS, getDefaultBaseUrl, getDefaultApiMethod } from "@coder/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	Button,
	Input,
	Dialog,
	DialogContent,
	DialogTitle,
	StandardTooltip,
	SearchableSelect,
} from "@/components/ui"

interface ImageGenerationConfigManagerProps {
	currentImageGenerationConfigName?: string
	listImageGenerationConfigMeta?: ImageGenerationConfigEntry[]
	onSelectConfig: (configName: string) => void
	onDeleteConfig: (configName: string) => void
	onRenameConfig: (oldName: string, newName: string) => void
	onUpsertConfig: (configName: string) => void
}

const ImageGenerationConfigManager = ({
	currentImageGenerationConfigName = "",
	listImageGenerationConfigMeta = [],
	onSelectConfig,
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
}: ImageGenerationConfigManagerProps) => {
	const { t } = useAppTranslation()

	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newProfileName, setNewProfileName] = useState("")
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<any>(null)
	const newProfileInputRef = useRef<any>(null)

	const validateName = (name: string, isNewProfile: boolean): string | null => {
		const trimmed = name.trim()
		if (!trimmed) return t("settings:imageGeneration.nameEmpty")

		const nameExists = listImageGenerationConfigMeta?.some(
			(config) => config.name.toLowerCase() === trimmed.toLowerCase(),
		)

		// For new profiles, any existing name is invalid.
		if (isNewProfile && nameExists) {
			return t("settings:imageGeneration.nameExists")
		}

		// For rename, only block if trying to rename to a different existing profile.
		if (!isNewProfile && nameExists && trimmed.toLowerCase() !== currentImageGenerationConfigName?.toLowerCase()) {
			return t("settings:imageGeneration.nameExists")
		}

		return null
	}

	const resetCreateState = () => {
		setIsCreating(false)
		setNewProfileName("")
		setError(null)
	}

	const resetRenameState = () => {
		setIsRenaming(false)
		setInputValue("")
		setError(null)
	}

	// Focus input when entering rename mode.
	useEffect(() => {
		if (isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isRenaming])

	// Focus input when opening new dialog.
	useEffect(() => {
		if (isCreating) {
			const timeoutId = setTimeout(() => newProfileInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isCreating])

	// Reset state when current profile changes.
	const prevConfigNameRef = useRef(currentImageGenerationConfigName)
	useEffect(() => {
		if (prevConfigNameRef.current !== currentImageGenerationConfigName) {
			resetCreateState()
			resetRenameState()
			prevConfigNameRef.current = currentImageGenerationConfigName
		}
	}, [currentImageGenerationConfigName])

	const handleSelectConfig = (configName: string) => {
		if (!configName) return
		onSelectConfig(configName)
	}

	const handleAdd = () => {
		resetCreateState()
		setIsCreating(true)
	}

	const handleStartRename = () => {
		setIsRenaming(true)
		setInputValue(currentImageGenerationConfigName || "")
		setError(null)
	}

	const handleCancel = () => {
		resetRenameState()
	}

	const handleSave = () => {
		const trimmedValue = inputValue.trim()
		const error = validateName(trimmedValue, false)

		if (error) {
			setError(error)
			return
		}

		if (isRenaming && currentImageGenerationConfigName) {
			if (currentImageGenerationConfigName === trimmedValue) {
				resetRenameState()
				return
			}
			onRenameConfig(currentImageGenerationConfigName, trimmedValue)
		}

		resetRenameState()
	}

	const handleNewProfileSave = () => {
		const trimmedValue = newProfileName.trim()
		const error = validateName(trimmedValue, true)

		if (error) {
			setError(error)
			return
		}

		onUpsertConfig(trimmedValue)
		resetCreateState()
	}

	const handleDelete = () => {
		if (currentImageGenerationConfigName) {
			onDeleteConfig(currentImageGenerationConfigName)
		}
	}

	const configOptions =
		listImageGenerationConfigMeta?.map((config) => ({
			value: config.name,
			label: config.name,
		})) || []

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<div className="flex-1">
					{isRenaming ? (
						<div className="flex items-center gap-2">
							<Input
								ref={inputRef}
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleSave()
									} else if (e.key === "Escape") {
										e.preventDefault()
										handleCancel()
									}
								}}
								className="flex-1"
							/>
							<Button variant="ghost" size="icon" onClick={handleSave}>
								<span className="codicon codicon-check" />
							</Button>
							<Button variant="ghost" size="icon" onClick={handleCancel}>
								<span className="codicon codicon-close" />
							</Button>
						</div>
					) : (
						<SearchableSelect
							value={currentImageGenerationConfigName}
							options={configOptions}
							onValueChange={handleSelectConfig}
							placeholder={t("settings:imageGeneration.selectConfig")}
							searchPlaceholder={t("settings:imageGeneration.searchConfig")}
							emptyMessage={t("settings:imageGeneration.noConfigs")}
						/>
					)}
				</div>
				{!isRenaming && (
					<>
						<StandardTooltip content={t("settings:imageGeneration.addConfig")}>
							<Button variant="ghost" size="icon" onClick={handleAdd}>
								<span className="codicon codicon-add" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:imageGeneration.renameConfig")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleStartRename}
								disabled={!currentImageGenerationConfigName}
							>
								<span className="codicon codicon-edit" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:imageGeneration.deleteConfig")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleDelete}
								disabled={!currentImageGenerationConfigName || (listImageGenerationConfigMeta?.length || 0) <= 1}
							>
								<span className="codicon codicon-trash" />
							</Button>
						</StandardTooltip>
					</>
				)}
			</div>
			{error && <div className="text-destructive text-sm">{error}</div>}

			{/* New Profile Dialog */}
			<Dialog open={isCreating} onOpenChange={(open) => !open && resetCreateState()}>
				<DialogContent>
					<DialogTitle>{t("settings:imageGeneration.newConfig")}</DialogTitle>
					<div className="space-y-4">
						<div>
							<label className="text-sm font-medium">{t("settings:imageGeneration.configName")}</label>
							<Input
								ref={newProfileInputRef}
								value={newProfileName}
								onChange={(e) => setNewProfileName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleNewProfileSave()
									}
								}}
								placeholder={t("settings:imageGeneration.configNamePlaceholder")}
							/>
						</div>
						{error && <div className="text-destructive text-sm">{error}</div>}
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={resetCreateState}>
								{t("common:cancel")}
							</Button>
							<Button onClick={handleNewProfileSave}>{t("common:create")}</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export default memo(ImageGenerationConfigManager)
