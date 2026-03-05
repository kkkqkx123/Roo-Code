import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useDebounce } from "react-use"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider } from "@/components/ui"

interface TemperatureControlProps {
	value: number | undefined | null
	onChange: (value: number | undefined | null) => void
	maxValue?: number // Some providers like OpenAI use 0-2 range.
	defaultValue?: number // Default temperature from model configuration
}

export const TemperatureControl = ({ value, onChange, maxValue = 1, defaultValue }: TemperatureControlProps) => {
	const { t } = useAppTranslation()
	const hasCustomTemperature = value !== undefined && value !== null

	// Debounce onChange callback with null check
	useDebounce(() => {
		if (onChange) {
			onChange(value)
		}
	}, 50, [onChange, value])

	return (
		<>
			<div>
				<VSCodeCheckbox
					checked={hasCustomTemperature}
					onChange={(e: any) => {
						const isChecked = e.target.checked
						onChange(isChecked ? defaultValue ?? 0.5 : undefined)

						if (!isChecked) {
							setInputValue(null) // Unset the temperature, note that undefined is unserializable.
						} else {
							// Use the value from apiConfiguration, or fallback to model's defaultTemperature, or finally to 0
							setInputValue(value ?? defaultValue ?? 0)
						}
					}}>
					<label className="block font-medium mb-1">{t("settings:temperature.useCustom")}</label>
				</VSCodeCheckbox>
				<div className="text-sm text-vscode-descriptionForeground mt-1">
					{t("settings:temperature.description")}
				</div>
			</div>

			{hasCustomTemperature && (
				<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
					<div>
						<div className="flex items-center gap-2">
							<Slider
								min={0}
								max={maxValue}
								step={0.01}
								value={[value ?? 0]}
								onValueChange={([newVal]) => onChange(newVal)}
							/>
							<span className="w-10">{value}</span>
						</div>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:temperature.rangeDescription")}
						</div>
					</div>
				</div>
			)}
		</>
	)
}
