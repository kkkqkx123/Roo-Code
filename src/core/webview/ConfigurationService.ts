/**
 * ConfigurationService - Centralized configuration management service
 *
 * This service extracts configuration management logic from ClineProvider.ts,
 * providing a clean separation of concerns and improved testability.
 *
 * Responsibilities:
 * - Configuration CRUD operations
 * - Provider profile management
 * - Mode management
 * - Command list management
 * - Configuration validation
 */

import * as vscode from "vscode"

import {
	type CoderSettings,
	type ProviderSettings,
	type ProviderSettingsEntry,
	type GlobalState,
	type HistoryItem,
	type TaskProviderEvents,
	CoderEventName,
	DEFAULT_WRITE_DELAY_MS,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	getModelId,
} from "@coder/types"

import { Package } from "../../shared/package"
import { Mode, defaultModeSlug } from "../../shared/modes"
import { formatLanguage } from "@coder/types"
import { Terminal } from "../../integrations/terminal/Terminal"

import { ContextProxy } from "../config/ContextProxy"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { TaskHistoryStore } from "../task-persistence"
import { StateBuilder } from "./StateBuilder"
import { t } from "../../i18n"

/**
 * Options for activating a provider profile
 */
export interface ActivateProfileOptions {
	persistModeConfig?: boolean
	persistTaskHistory?: boolean
}

/**
 * Callback types for ConfigurationService
 */
export interface ConfigurationServiceCallbacks {
	/** Called when state should be posted to webview */
	postStateToWebview: () => Promise<void>
	/** Called to get the current task ID */
	getCurrentTaskId: () => string | undefined
	/** Called to get task history item by ID */
	getTaskHistoryItem: (taskId: string) => HistoryItem | undefined
	/** Called to update task history */
	updateTaskHistory: (item: HistoryItem) => Promise<HistoryItem[]>
	/** Called to update task's API configuration */
	updateTaskApiConfiguration: (providerSettings: ProviderSettings) => void
	/** Called to set task's API config name */
	setTaskApiConfigName: (apiConfigName: string) => void
	/** Called to emit events */
	emit: <K extends keyof TaskProviderEvents>(event: K, ...args: TaskProviderEvents[K]) => boolean
	/** Called to log messages */
	log: (message: string) => void
}

/**
 * ConfigurationService provides centralized configuration management
 * for the Cline extension, separating configuration concerns from
 * the main ClineProvider class.
 */
export class ConfigurationService {
	private stateBuilder: StateBuilder

	constructor(
		private readonly contextProxy: ContextProxy,
		private readonly providerSettingsManager: ProviderSettingsManager,
		private readonly customModesManager: CustomModesManager,
		private readonly taskHistoryStore: TaskHistoryStore,
		private readonly callbacks: ConfigurationServiceCallbacks,
	) {
		this.stateBuilder = new StateBuilder(
			contextProxy,
			customModesManager,
			taskHistoryStore,
		)
	}

	// ==================== State Management ====================

	/**
	 * Get the current configuration state
	 */
	async getState(): Promise<
		Omit<
			import("@coder/types").ExtensionState,
			"clineMessages" | "renderContext" | "hasOpenedModeSelector" | "version" | "shouldShowAnnouncement"
		>
	> {
		return this.stateBuilder.buildState()
	}

	/**
	 * Get the state to post to webview
	 */
	async getStateToPostToWebview(options: {
		renderContext: "sidebar" | "editor"
		version: string
		latestAnnouncementId: string
		settingsImportedAt?: number
		getCurrentTask: () => {
			taskId: string
			clineMessages: import("@coder/types").ClineMessage[]
			todoList: import("@coder/types").TodoItem[]
			messageQueueService?: { messages: import("@coder/types").QueuedMessage[] }
		} | undefined
		cwd: string | undefined
		mcpServers: import("@coder/types").McpServer[]
		mdmCompliant?: boolean
	}): Promise<import("@coder/types").ExtensionState> {
		return this.stateBuilder.buildStateForWebview(options)
	}

	// ==================== Provider Profile Management ====================

	/**
	 * Get all provider profile entries
	 */
	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.contextProxy.getValues().listApiConfigMeta || []
	}

	/**
	 * Get a single provider profile entry by name
	 */
	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	/**
	 * Check if a provider profile entry exists
	 */
	hasProviderProfileEntry(name: string): boolean {
		return !!this.getProviderProfileEntry(name)
	}

	/**
	 * Create or update a provider profile
	 */
	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		try {
			const id = await this.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await this.getState()

				await Promise.all([
					this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
					this.contextProxy.setValue("currentApiConfigName", name),
					this.providerSettingsManager.setModeConfig(mode, id),
					this.contextProxy.setProviderSettings(providerSettings),
				])

				// Update the current task's API handler
				this.callbacks.updateTaskApiConfiguration(providerSettings)

				// Keep the current task's sticky provider profile in sync
				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				await this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig())
			}

			await this.callbacks.postStateToWebview()
			return id
		} catch (error) {
			this.callbacks.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			vscode.window.showErrorMessage(t("common:errors.create_api_config"))
			return undefined
		}
	}

	/**
	 * Delete a provider profile
	 */
	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry): Promise<void> {
		const globalSettings = this.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.callbacks.postStateToWebview()
	}

	/**
	 * Activate a provider profile
	 */
	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: ActivateProfileOptions,
	): Promise<void> {
		const { name, id, ...providerSettings } = await this.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true

		await Promise.all([
			this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
			this.contextProxy.setValue("currentApiConfigName", name),
			this.contextProxy.setProviderSettings(providerSettings),
		])

		const { mode } = await this.getState()

		if (id && persistModeConfig) {
			await this.providerSettingsManager.setModeConfig(mode, id)
		}

		// Update the current task's API handler
		this.callbacks.updateTaskApiConfiguration(providerSettings)

		// Update the current task's sticky provider profile
		if (persistTaskHistory) {
			await this.persistStickyProviderProfileToCurrentTask(name)
		}

		await this.callbacks.postStateToWebview()

		if (providerSettings.apiProvider) {
			this.callbacks.emit(CoderEventName.ProviderProfileChanged, { name, provider: providerSettings.apiProvider })
		}
	}

	/**
	 * Persist the sticky provider profile to the current task
	 */
	private async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const taskId = this.callbacks.getCurrentTaskId()
		if (!taskId) {
			return
		}

		try {
			// Update in-memory state immediately
			this.callbacks.setTaskApiConfigName(apiConfigName)

			const taskHistoryItem = this.callbacks.getTaskHistoryItem(taskId)

			if (taskHistoryItem) {
				await this.callbacks.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
			}
		} catch (error) {
			this.callbacks.log(
				`Failed to persist provider profile switch for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	// ==================== Mode Management ====================

	/**
	 * Handle switching to a new mode
	 */
	async handleModeSwitch(newMode: Mode): Promise<void> {
		// Update the task history with the new mode
		const taskId = this.callbacks.getCurrentTaskId()
		if (taskId) {
			this.callbacks.emit(CoderEventName.TaskModeSwitched, taskId, newMode)

			try {
				const taskHistoryItem = this.callbacks.getTaskHistoryItem(taskId)

				if (taskHistoryItem) {
					await this.callbacks.updateTaskHistory({ ...taskHistoryItem, mode: newMode })
				}
			} catch (error) {
				this.callbacks.log(
					`Failed to persist mode switch for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)
				throw error
			}
		}

		await this.contextProxy.setValue("mode", newMode)

		this.callbacks.emit(CoderEventName.ModeChanged, newMode)

		// If workspace lock is on, keep the current API config
		const lockApiConfigAcrossModes = vscode.workspace.workspaceFolders?.[0]
			? vscode.workspace.getConfiguration(Package.name, vscode.workspace.workspaceFolders[0].uri).get("lockApiConfigAcrossModes", false)
			: false

		if (lockApiConfigAcrossModes) {
			await this.callbacks.postStateToWebview()
			return
		}

		// Load the saved API config for the new mode if it exists
		const savedConfigId = await this.providerSettingsManager.getModeConfigId(newMode)
		const listApiConfig = await this.providerSettingsManager.listConfig()

		// Update listApiConfigMeta first
		await this.contextProxy.setValue("listApiConfigMeta", listApiConfig)

		// If this mode has a saved config, use it
		if (savedConfigId) {
			const profile = listApiConfig.find(({ id }) => id === savedConfigId)

			if (profile?.name) {
				// Check if the profile has actual API configuration
				const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
				const hasActualSettings = !!fullProfile.apiProvider

				if (hasActualSettings) {
					await this.activateProviderProfile({ name: profile.name })
				}
			}
		} else {
			// If no saved config for this mode, save current config as default
			const currentApiConfigNameAfter = this.contextProxy.getValue("currentApiConfigName")

			if (currentApiConfigNameAfter) {
				const config = listApiConfig.find((c) => c.name === currentApiConfigNameAfter)

				if (config?.id) {
					await this.providerSettingsManager.setModeConfig(newMode, config.id)
				}
			}
		}

		await this.callbacks.postStateToWebview()
	}

	// ==================== Configuration Update ====================

	/**
	 * Set a single configuration value
	 */
	async setValue<K extends keyof CoderSettings>(key: K, value: CoderSettings[K]): Promise<void> {
		await this.contextProxy.setValue(key, value)
	}

	/**
	 * Get a single configuration value
	 */
	getValue<K extends keyof CoderSettings>(key: K): CoderSettings[K] {
		return this.contextProxy.getValue(key)
	}

	/**
	 * Get all configuration values
	 */
	getValues(): CoderSettings {
		return this.contextProxy.getValues()
	}

	/**
	 * Set multiple configuration values
	 */
	async setValues(values: CoderSettings): Promise<void> {
		await this.contextProxy.setValues(values)
	}

	// ==================== Command Management ====================

	/**
	 * Merge allowed commands from global state and workspace configuration
	 */
	mergeAllowedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("allowedCommands", "allowed", globalStateCommands)
	}

	/**
	 * Merge denied commands from global state and workspace configuration
	 */
	mergeDeniedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("deniedCommands", "denied", globalStateCommands)
	}

	/**
	 * Common utility for merging command lists
	 */
	private mergeCommandLists(
		configKey: "allowedCommands" | "deniedCommands",
		commandType: "allowed" | "denied",
		globalStateCommands?: string[],
	): string[] {
		try {
			// Validate and sanitize global state commands
			const validGlobalCommands = Array.isArray(globalStateCommands)
				? globalStateCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Get workspace configuration commands
			const workspaceCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>(configKey) || []

			// Validate and sanitize workspace commands
			const validWorkspaceCommands = Array.isArray(workspaceCommands)
				? workspaceCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Combine and deduplicate commands
			const mergedCommands = [...new Set([...validGlobalCommands, ...validWorkspaceCommands])]

			return mergedCommands
		} catch (error) {
			console.error(`Error merging ${commandType} commands:`, error)
			return []
		}
	}

	// ==================== Other Configuration Operations ====================

	/**
	 * Update custom instructions
	 */
	async updateCustomInstructions(instructions?: string): Promise<void> {
		await this.contextProxy.setValue("customInstructions", instructions || undefined)
	}

	/**
	 * Update global state
	 */
	async updateGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]): Promise<void> {
		await this.contextProxy.setValue(key, value)
	}

	/**
	 * Get global state
	 */
	getGlobalState<K extends keyof GlobalState>(key: K): GlobalState[K] {
		return this.contextProxy.getValue(key)
	}

	// ==================== Reset Operations ====================

	/**
	 * Reset all configuration state
	 */
	async resetState(): Promise<void> {
		await this.contextProxy.resetAllState()
		await this.providerSettingsManager.resetAllConfigs()
		await this.customModesManager.resetCustomModes()
	}

	// ==================== Getters ====================

	/**
	 * Get the StateBuilder instance
	 */
	getStateBuilder(): StateBuilder {
		return this.stateBuilder
	}
}
