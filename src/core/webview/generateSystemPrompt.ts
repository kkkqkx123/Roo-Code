import * as vscode from "vscode"
import type { WebviewMessage } from "@coder/types"
import { defaultModeSlug } from "../../shared/modes"

import { SystemPromptBuilder } from "../prompts/SystemPromptBuilder"
import { MultiSearchReplaceDiffStrategy } from "../diff/strategies/multi-search-replace"
import { Package } from "../../shared/package"

import { ClineProvider } from "./ClineProvider"

export const generateSystemPrompt = async (provider: ClineProvider, message: WebviewMessage) => {
	const {
		apiConfiguration,
		customModePrompts,
		customInstructions,
		mcpEnabled,
		experiments,
		language,
		enableSubfolderRules,
		skillsEnabled,
		disabledSkills,
	} = await provider.configurationService.getState()

	const diffStrategy = new MultiSearchReplaceDiffStrategy()

	const cwd = provider.cwd

	const mode = message.mode ?? defaultModeSlug
	const customModes = await provider.customModesManager.getCustomModes()

	const rooIgnoreInstructions = provider.getCurrentTask()?.rooIgnoreController?.getInstructions()

	const settings = {
		todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
		useAgentRules: vscode.workspace.getConfiguration(Package.name).get<boolean>("useAgentRules") ?? true,
		enableSubfolderRules: enableSubfolderRules ?? false,
		newTaskRequireTodos: vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("newTaskRequireTodos", false),
		skillsEnabled: skillsEnabled ?? true,
		disabledSkills: disabledSkills ?? [],
	}

	const systemPrompt = await SystemPromptBuilder.create()
		.withContext(provider.context, cwd)
		.withMode(mode, customModes, customModePrompts)
		.withMcp(mcpEnabled ? provider.getMcpHub() : undefined)
		.withDiffStrategy(diffStrategy)
		.withCustomInstructions(customInstructions, rooIgnoreInstructions)
		.withExperiments(experiments)
		.withLanguage(language)
		.withSettings(settings)
		.withSkillsManager(provider.getSkillsManager())
		.withComputerUseSupport(false)
		.build()

	return systemPrompt
}
