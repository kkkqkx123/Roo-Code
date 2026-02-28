/**
 * Webview Message Types
 * Webview | CLI -> Extension
 */

import { z } from "zod"

import type { ProviderSettings } from "../provider-settings/index.js"
import type { ModeConfig, PromptComponent } from "../mode.js"
import type { TodoItem } from "../todo.js"
import type { QueuedMessage } from "../message.js"
import type { CoderSettings } from "../global-settings.js"
import type { IndexingStatusPayload, IndexClearedPayload } from "./indexing.js"

/**
 * WebviewMessage
 * Webview | CLI -> Extension
 */

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse" | "objectResponse"

export type AudioType = "notification" | "celebration" | "progress_loop"

export interface UpdateTodoListPayload {
	todos: TodoItem[]
}

export type EditQueuedMessagePayload = Pick<QueuedMessage, "id" | "text" | "images">

export interface WebviewMessageBase {
	type:
		| "updateTodoList"
		| "deleteMultipleTasksWithIds"
		| "currentApiConfigName"
		| "saveApiConfiguration"
		| "upsertApiConfiguration"
		| "deleteApiConfiguration"
		| "loadApiConfiguration"
		| "loadApiConfigurationById"
		| "renameApiConfiguration"
		| "getListApiConfiguration"
		| "customInstructions"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "terminalOperation"
		| "clearTask"
		| "didShowAnnouncement"
		| "selectImages"
		| "exportCurrentTask"
		| "exportCurrentTaskContext"
		| "shareCurrentTask"
		| "showTaskWithId"
		| "deleteTaskWithId"
		| "exportTaskWithId"
		| "importSettings"
		| "exportSettings"
		| "resetState"
		| "requestOpenAiModels"
		| "openImage"
		| "saveImage"
		| "openFile"
		| "openMention"
		| "cancelTask"
		| "cancelAutoApproval"
		| "updateVSCodeSetting"
		| "getVSCodeSetting"
		| "vsCodeSetting"
		| "updateCondensingPrompt"
		| "playSound"
		| "playTts"
		| "stopTts"
		| "ttsEnabled"
		| "ttsSpeed"
		| "openKeyboardShortcuts"
		| "openMcpSettings"
		| "openProjectMcpSettings"
		| "restartMcpServer"
		| "refreshAllMcpServers"
		| "toggleToolAlwaysAllow"
		| "toggleToolEnabledForPrompt"
		| "toggleMcpServer"
		| "updateMcpTimeout"
		| "toggleSkillEnabledForPrompt"
		| "getEnabledSkills"
		| "enabledSkills"
		| "skillsEnabled"
		| "disabledSkills"
		| "enhancePrompt"
		| "enhancedPrompt"
		| "draggedImages"
		| "deleteMessage"
		| "deleteMessageConfirm"
		| "submitEditedMessage"
		| "editMessageConfirm"
		| "remoteControlEnabled"
		| "taskSyncEnabled"
		| "searchCommits"
		| "setApiConfigPassword"
		| "mode"
		| "updatePrompt"
		| "getSystemPrompt"
		| "copySystemPrompt"
		| "systemPrompt"
		| "enhancementApiConfigId"
		| "autoApprovalEnabled"
		| "updateCustomMode"
		| "deleteCustomMode"
		| "setopenAiCustomModelInfo"
		| "openCustomModesSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "deleteMcpServer"
		| "codebaseIndexEnabled"
		| "searchFiles"
		| "toggleApiConfigPin"
		| "hasOpenedModeSelector"
		| "lockApiConfigAcrossModes"
		| "condenseTaskContextRequest"
		| "requestIndexingStatus"
		| "startIndexing"
		| "stopIndexing"
		| "clearIndexData"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "toggleWorkspaceIndexing"
		| "setAutoEnableDefault"
		| "focusPanelRequest"
		| "openExternal"
		| "switchTab"
		| "shareTaskSuccess"
		| "exportMode"
		| "exportModeResult"
		| "importMode"
		| "importModeResult"
		| "checkRulesDirectory"
		| "checkRulesDirectoryResult"
		| "saveCodeIndexSettingsAtomic"
		| "requestCodeIndexSecretStatus"
		| "requestCommands"
		| "openCommandFile"
		| "deleteCommand"
		| "createCommand"
		| "insertTextIntoTextarea"
		| "showMdmAuthRequiredNotification"
		| "imageGenerationSettings"
		| "queueMessage"
		| "removeQueuedMessage"
		| "editQueuedMessage"
		| "dismissUpsell"
		| "getDismissedUpsells"
		| "openMarkdownPreview"
		| "updateSettings"
		| "allowedCommands"
		| "getTaskWithAggregatedCosts"
		| "deniedCommands"
		| "openDebugApiHistory"
		| "openDebugUiHistory"
		| "downloadErrorDiagnostics"
		| "refreshCustomTools"
		| "requestModes"
		| "switchMode"
		| "debugSetting"
		// Worktree messages
		| "listWorktrees"
		| "createWorktree"
		| "deleteWorktree"
		| "switchWorktree"
		| "getAvailableBranches"
		| "getWorktreeDefaults"
		| "getWorktreeIncludeStatus"
		| "checkBranchWorktreeInclude"
		| "createWorktreeInclude"
		| "checkoutBranch"
		| "browseForWorktreePath"
		// Skills messages
		| "requestSkills"
		| "createSkill"
		| "deleteSkill"
		| "moveSkill"
		| "updateSkillModes"
		| "openSkillFile"
	text?: string
	editedMessageContent?: string
	tab?: "settings" | "history" | "mcp" | "modes" | "chat"
	disabled?: boolean
	context?: string
	dataUri?: string
	askResponse?: ClineAskResponse
	apiConfiguration?: ProviderSettings
	images?: string[]
	bool?: boolean
	value?: number
	stepIndex?: number
	isLaunchAction?: boolean
	forceShow?: boolean
	commands?: string[]
	audioType?: AudioType
	serverName?: string
	toolName?: string
	alwaysAllow?: boolean
	isEnabled?: boolean
	skillsEnabled?: boolean
	disabledSkills?: string[]
	mode?: string
	promptMode?: string | "enhance"
	customPrompt?: PromptComponent
	dataUrls?: string[]
	/** Generic payload for webview messages that use `values` */
	values?: Record<string, unknown>
	query?: string
	setting?: string
	slug?: string
	modeConfig?: ModeConfig
	timeout?: number
	payload?: WebViewMessagePayload
	source?: "global" | "project"
	skillName?: string // For skill operations (createSkill, deleteSkill, moveSkill, openSkillFile)
	/** @deprecated Use skillModeSlugs instead */
	skillMode?: string // For skill operations (current mode restriction)
	/** @deprecated Use newSkillModeSlugs instead */
	newSkillMode?: string // For moveSkill (target mode)
	skillDescription?: string // For createSkill (skill description)
	/** Mode slugs for skill operations. undefined/empty = any mode */
	skillModeSlugs?: string[] // For skill operations (mode restrictions)
	/** Target mode slugs for updateSkillModes */
	newSkillModeSlugs?: string[] // For updateSkillModes (new mode restrictions)
	requestId?: string
	ids?: string[]
	terminalOperation?: "continue" | "abort"
	messageTs?: number
	restoreCheckpoint?: boolean
	historyPreviewCollapsed?: boolean
	filters?: { type?: string; search?: string; tags?: string[] }
	settings?: unknown
	url?: string // For openExternal
	config?: Record<string, unknown> // Add config to the payload
	hasContent?: boolean // For checkRulesDirectoryResult
	checkOnly?: boolean // For deleteCustomMode check
	upsellId?: string // For dismissUpsell
	list?: string[] // For dismissedUpsells response
	codeIndexSettings?: {
		// Global state settings
		codebaseIndexEnabled: boolean
		codebaseIndexQdrantUrl: string
		codebaseIndexEmbedderProvider: "openai" | "openai-compatible" | "gemini"
		codebaseIndexEmbedderBaseUrl?: string
		codebaseIndexEmbedderModelId: string
		codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
		codebaseIndexOpenAiCompatibleBaseUrl?: string
		codebaseIndexSearchMaxResults?: number
		codebaseIndexSearchMinScore?: number
		// Indexing behavior settings
		manualIndexingOnly?: boolean
		autoUpdateIndex?: boolean
		codebaseIndexAllowedProjects?: string[]
		// Vector storage configuration
		vectorStorageMode?: "auto" | "tiny" | "small" | "medium" | "large"
		vectorStoragePreset?: "tiny" | "small" | "medium" | "large"
		vectorStorageThresholds?: {
			tiny?: number
			small?: number
			medium?: number
			large?: number
		}

		// Secret settings
		codeIndexOpenAiKey?: string
		codeIndexQdrantApiKey?: string
		codebaseIndexOpenAiCompatibleApiKey?: string
		codebaseIndexGeminiApiKey?: string
	}
	updatedSettings?: CoderSettings
	// Worktree properties
	worktreePath?: string
	worktreeBranch?: string
	worktreeBaseBranch?: string
	worktreeCreateNewBranch?: boolean
	worktreeForce?: boolean
	worktreeNewWindow?: boolean
	worktreeIncludeContent?: string
}

export type WebviewMessageType = WebviewMessageBase["type"]

export type WebviewMessage = {
	[K in WebviewMessageType]: Omit<WebviewMessageBase, "type"> & { type: K }
}[WebviewMessageType]

// Messages intentionally handled in webviewMessageHandler switch as inbound requests.
export type WebviewInboundMessageType = Exclude<
	WebviewMessageType,
	| "checkRulesDirectoryResult"
	| "codebaseIndexEnabled"
	| "currentApiConfigName"
	| "draggedImages"
	| "enabledSkills"
	| "enhancedPrompt"
	| "exportModeResult"
	| "imageGenerationSettings"
	| "importModeResult"
	| "indexCleared"
	| "indexingStatusUpdate"
	| "playSound"
	| "setApiConfigPassword"
	| "setAutoEnableDefault"
	| "setopenAiCustomModelInfo"
	| "shareTaskSuccess"
	| "switchMode"
	| "systemPrompt"
	| "toggleWorkspaceIndexing"
	| "updateCondensingPrompt"
	| "vsCodeSetting"
>

export type WebviewOutboundMirrorMessageType = Exclude<WebviewMessageType, WebviewInboundMessageType>

export type WebviewInboundMessage = Extract<WebviewMessage, { type: WebviewInboundMessageType }>
export type WebviewOutboundMirrorMessage = Extract<WebviewMessage, { type: WebviewOutboundMirrorMessageType }>

// ============================================================================
// Payload Schemas and Types
// ============================================================================

export const checkoutDiffPayloadSchema = z.object({
	ts: z.number().optional(),
	previousCommitHash: z.string().optional(),
	commitHash: z.string(),
	mode: z.enum(["full", "checkpoint", "from-init", "to-current"]),
})

export type CheckpointDiffPayload = z.infer<typeof checkoutDiffPayloadSchema>

export const checkoutRestorePayloadSchema = z.object({
	ts: z.number(),
	commitHash: z.string(),
	mode: z.enum(["preview", "restore"]),
})

export type CheckpointRestorePayload = z.infer<typeof checkoutRestorePayloadSchema>

export type WebViewMessagePayload =
	| CheckpointDiffPayload
	| CheckpointRestorePayload
	| IndexingStatusPayload
	| IndexClearedPayload
	| UpdateTodoListPayload
	| EditQueuedMessagePayload