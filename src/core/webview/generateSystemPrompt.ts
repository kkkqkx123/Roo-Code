import * as vscode from "vscode"
import type { WebviewMessage } from "@coder/types"
import { defaultModeSlug } from "../../shared/modes"
import pWaitFor from "p-wait-for"

import { SystemPromptBuilder } from "../prompts/SystemPromptBuilder"
import { MultiSearchReplaceDiffStrategy } from "../diff/strategies/multi-search-replace"
import { Package } from "../../shared/package"
import { McpHub } from "../../services/mcp/McpHub"

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

	// Get MCP hub if enabled - wait for it to be fully initialized
	const mcpHub: McpHub | undefined = mcpEnabled ? provider.getMcpHub() : undefined
	
	// Wait for MCP servers to be connected before generating system prompt
	if (mcpHub) {
		try {
			await pWaitFor(() => !mcpHub.isConnecting, { timeout: 10_000 }).catch(() => {
				console.error("MCP servers failed to connect in time for system prompt preview")
			})
		} catch (error) {
			// Continue even if MCP times out
			provider.log(`[generateSystemPrompt] MCP wait timeout: ${error}`)
		}
	}

	const systemPrompt = await SystemPromptBuilder.create()
		.withContext(provider.context, cwd)
		.withMode(mode, customModes, customModePrompts)
		.withMcp(mcpHub)
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
