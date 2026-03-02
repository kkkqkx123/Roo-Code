import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import type {
  ProviderSettings,
  ProviderSettingsEntry,
  CustomModePrompts,
  ModeConfig,
  ExperimentId,
  SkillMetadata,
  McpServer,
  CodebaseIndexConfig,
} from '@coder/types'
import { Mode, defaultModeSlug, defaultPrompts } from '@coder/modes'
import { experimentDefault } from '@coder/experiments'
import { DEFAULT_CHECKPOINT_TIMEOUT_SECONDS } from '@coder/types'

// API Configuration slice
interface ApiConfigSlice {
  apiConfiguration: ProviderSettings
  currentApiConfigName: string
  listApiConfigMeta: ProviderSettingsEntry[]
  pinnedApiConfigs?: Record<string, boolean>
  setApiConfiguration: (config: ProviderSettings) => void
  setCurrentApiConfigName: (name: string) => void
  setListApiConfigMeta: (configs: ProviderSettingsEntry[]) => void
  setPinnedApiConfigs: (pinned: Record<string, boolean>) => void
  togglePinnedApiConfig: (configName: string) => void
}

// Preferences slice
interface PreferencesSlice {
  soundEnabled: boolean
  soundVolume: number
  ttsEnabled: boolean
  ttsSpeed: number
  setSoundEnabled: (enabled: boolean) => void
  setSoundVolume: (volume: number) => void
  setTtsEnabled: (enabled: boolean) => void
  setTtsSpeed: (speed: number) => void
}

// Modes slice
interface ModesSlice {
  mode: Mode
  customModes: ModeConfig[]
  customModePrompts: CustomModePrompts
  alwaysAllowModeSwitch: boolean
  hasOpenedModeSelector: boolean
  setMode: (mode: Mode) => void
  setCustomModes: (modes: ModeConfig[]) => void
  setCustomModePrompts: (prompts: CustomModePrompts) => void
  setAlwaysAllowModeSwitch: (enabled: boolean) => void
  setHasOpenedModeSelector: (value: boolean) => void
}

// Auto-approval slice
interface AutoApprovalSlice {
  autoApprovalEnabled: boolean
  alwaysAllowReadOnly: boolean
  alwaysAllowReadOnlyOutsideWorkspace: boolean
  alwaysAllowWrite: boolean
  alwaysAllowWriteOutsideWorkspace: boolean
  alwaysAllowExecute: boolean
  alwaysAllowMcp: boolean
  alwaysAllowSubtasks: boolean
  alwaysAllowFollowupQuestions: boolean
  followupAutoApproveTimeoutMs: number | undefined
  setAutoApprovalEnabled: (enabled: boolean) => void
  setAlwaysAllowReadOnly: (enabled: boolean) => void
  setAlwaysAllowReadOnlyOutsideWorkspace: (enabled: boolean) => void
  setAlwaysAllowWrite: (enabled: boolean) => void
  setAlwaysAllowWriteOutsideWorkspace: (enabled: boolean) => void
  setAlwaysAllowExecute: (enabled: boolean) => void
  setAlwaysAllowMcp: (enabled: boolean) => void
  setAlwaysAllowSubtasks: (enabled: boolean) => void
  setAlwaysAllowFollowupQuestions: (enabled: boolean) => void
  setFollowupAutoApproveTimeoutMs: (timeout: number | undefined) => void
}

// Settings slice
interface SettingsSlice {
  customInstructions?: string
  maxOpenTabsContext: number
  maxWorkspaceFiles: number
  writeDelayMs: number
  terminalShellIntegrationTimeout: number
  terminalShellIntegrationDisabled: boolean
  terminalOutputPreviewSize?: 'small' | 'medium' | 'large'
  enableCheckpoints: boolean
  checkpointTimeout: number
  includeDiagnosticMessages: boolean
  maxDiagnosticMessages: number
  includeTaskHistoryInEnhance: boolean
  includeCurrentTime: boolean
  includeCurrentCost: boolean
  autoCondenseContext: boolean
  autoCondenseContextPercent: number
  enterBehavior: 'send' | 'newline'
  ignoreMode: 'gitignore' | 'rooignore' | 'both'
  enableSubfolderRules: boolean
  showRooIgnoredFiles: boolean
  setCustomInstructions: (value: string | undefined) => void
  setMaxOpenTabsContext: (value: number) => void
  setMaxWorkspaceFiles: (value: number) => void
  setWriteDelayMs: (value: number) => void
  setTerminalShellIntegrationTimeout: (value: number) => void
  setTerminalShellIntegrationDisabled: (value: boolean) => void
  setTerminalOutputPreviewSize: (value: 'small' | 'medium' | 'large') => void
  setEnableCheckpoints: (value: boolean) => void
  setCheckpointTimeout: (value: number) => void
  setIncludeDiagnosticMessages: (value: boolean) => void
  setMaxDiagnosticMessages: (value: number) => void
  setIncludeTaskHistoryInEnhance: (value: boolean) => void
  setIncludeCurrentTime: (value: boolean) => void
  setIncludeCurrentCost: (value: boolean) => void
  setAutoCondenseContext: (value: boolean) => void
  setAutoCondenseContextPercent: (value: number) => void
  setEnterBehavior: (value: 'send' | 'newline') => void
  setIgnoreMode: (value: 'gitignore' | 'rooignore' | 'both') => void
  setEnableSubfolderRules: (value: boolean) => void
  setShowRooIgnoredFiles: (value: boolean) => void
}

// Code Index slice
interface CodeIndexSlice {
  codebaseIndexConfig: CodebaseIndexConfig
  codebaseIndexModels: Record<string, any>
  setCodebaseIndexConfig: (config: CodebaseIndexConfig) => void
  setCodebaseIndexModels: (models: Record<string, any>) => void
}

// Experiments slice
interface ExperimentsSlice {
  experiments: Record<ExperimentId, boolean>
  setExperimentEnabled: (id: ExperimentId, enabled: boolean) => void
}

// MCP & Remote Control slice
interface McpSlice {
  mcpServers: McpServer[]
  mcpEnabled: boolean
  remoteControlEnabled: boolean
  taskSyncEnabled: boolean
  featureRoomoteControlEnabled: boolean
  setMcpServers: (servers: McpServer[]) => void
  setMcpEnabled: (enabled: boolean) => void
  setRemoteControlEnabled: (enabled: boolean) => void
  setTaskSyncEnabled: (enabled: boolean) => void
  setFeatureRoomoteControlEnabled: (enabled: boolean) => void
}

// Skills slice
interface SkillsSlice {
  skills?: SkillMetadata[]
  skillsEnabled: boolean
  disabledSkills?: string[]
  setSkills: (skills: SkillMetadata[]) => void
  setSkillsEnabled: (enabled: boolean) => void
  setDisabledSkills: (disabled: string[]) => void
}

// Profile slice
interface ProfileSlice {
  profileThresholds: Record<string, number>
  setProfileThresholds: (thresholds: Record<string, number>) => void
}

// Allowed commands slice
interface CommandsSlice {
  allowedCommands: string[]
  deniedCommands: string[]
  allowedMaxRequests: number | undefined
  allowedMaxCost: number | undefined
  setAllowedCommands: (commands: string[]) => void
  setDeniedCommands: (commands: string[]) => void
  setAllowedMaxRequests: (max: number | undefined) => void
  setAllowedMaxCost: (max: number | undefined) => void
}

// Terminal slice
interface TerminalSlice {
  terminalZdotdir: boolean
  terminalZshOhMy: boolean
  terminalZshP10k: boolean
  setTerminalZdotdir: (value: boolean) => void
  setTerminalZshOhMy: (value: boolean) => void
  setTerminalZshP10k: (value: boolean) => void
}

// UI State slice
interface UiStateSlice {
  historyPreviewCollapsed: boolean
  reasoningBlockCollapsed: boolean
  showAnnouncement: boolean
  setHistoryPreviewCollapsed: (value: boolean) => void
  setReasoningBlockCollapsed: (value: boolean) => void
  setShowAnnouncement: (value: boolean) => void
}

// Enhancement slice
interface EnhancementSlice {
  enhancementApiConfigId?: string
  lockApiConfigAcrossModes: boolean
  setEnhancementApiConfigId: (id: string) => void
  setLockApiConfigAcrossModes: (value: boolean) => void
}

// Image limits slice
interface ImageLimitsSlice {
  maxImageFileSize: number
  maxTotalImageSize: number
  setMaxImageFileSize: (value: number) => void
  setMaxTotalImageSize: (value: number) => void
}

// Combine all slices
type ExtensionStoreState = ApiConfigSlice &
  PreferencesSlice &
  ModesSlice &
  AutoApprovalSlice &
  SettingsSlice &
  CodeIndexSlice &
  ExperimentsSlice &
  McpSlice &
  SkillsSlice &
  ProfileSlice &
  CommandsSlice &
  TerminalSlice &
  UiStateSlice &
  EnhancementSlice &
  ImageLimitsSlice

const initialApiConfigState: Pick<
  ApiConfigSlice,
  'apiConfiguration' | 'currentApiConfigName' | 'listApiConfigMeta' | 'pinnedApiConfigs'
> = {
  apiConfiguration: {},
  currentApiConfigName: 'default',
  listApiConfigMeta: [],
  pinnedApiConfigs: {},
}

const initialPreferencesState: Pick<
  PreferencesSlice,
  'soundEnabled' | 'soundVolume' | 'ttsEnabled' | 'ttsSpeed'
> = {
  soundEnabled: false,
  soundVolume: 0.5,
  ttsEnabled: false,
  ttsSpeed: 1.0,
}

const initialModesState: Pick<
  ModesSlice,
  'mode' | 'customModes' | 'customModePrompts' | 'alwaysAllowModeSwitch' | 'hasOpenedModeSelector'
> = {
  mode: defaultModeSlug,
  customModes: [],
  customModePrompts: defaultPrompts,
  alwaysAllowModeSwitch: false,
  hasOpenedModeSelector: false,
}

const initialAutoApprovalState: Pick<
  AutoApprovalSlice,
  | 'autoApprovalEnabled'
  | 'alwaysAllowReadOnly'
  | 'alwaysAllowReadOnlyOutsideWorkspace'
  | 'alwaysAllowWrite'
  | 'alwaysAllowWriteOutsideWorkspace'
  | 'alwaysAllowExecute'
  | 'alwaysAllowMcp'
  | 'alwaysAllowSubtasks'
  | 'alwaysAllowFollowupQuestions'
  | 'followupAutoApproveTimeoutMs'
> = {
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowReadOnlyOutsideWorkspace: false,
  alwaysAllowWrite: false,
  alwaysAllowWriteOutsideWorkspace: false,
  alwaysAllowExecute: false,
  alwaysAllowMcp: false,
  alwaysAllowSubtasks: false,
  alwaysAllowFollowupQuestions: false,
  followupAutoApproveTimeoutMs: undefined,
}

const initialSettingsState: Pick<
  SettingsSlice,
  | 'customInstructions'
  | 'maxOpenTabsContext'
  | 'maxWorkspaceFiles'
  | 'writeDelayMs'
  | 'terminalShellIntegrationTimeout'
  | 'terminalShellIntegrationDisabled'
  | 'terminalOutputPreviewSize'
  | 'enableCheckpoints'
  | 'checkpointTimeout'
  | 'includeDiagnosticMessages'
  | 'maxDiagnosticMessages'
  | 'includeTaskHistoryInEnhance'
  | 'includeCurrentTime'
  | 'includeCurrentCost'
  | 'autoCondenseContext'
  | 'autoCondenseContextPercent'
  | 'enterBehavior'
  | 'ignoreMode'
  | 'enableSubfolderRules'
  | 'showRooIgnoredFiles'
> = {
  customInstructions: undefined,
  maxOpenTabsContext: 20,
  maxWorkspaceFiles: 200,
  writeDelayMs: 1000,
  terminalShellIntegrationTimeout: 4000,
  terminalShellIntegrationDisabled: false,
  terminalOutputPreviewSize: undefined,
  enableCheckpoints: true,
  checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
  includeDiagnosticMessages: true,
  maxDiagnosticMessages: 50,
  includeTaskHistoryInEnhance: true,
  includeCurrentTime: true,
  includeCurrentCost: true,
  autoCondenseContext: true,
  autoCondenseContextPercent: 100,
  enterBehavior: 'send',
  ignoreMode: 'both',
  enableSubfolderRules: false,
  showRooIgnoredFiles: false,
}

const initialCodeIndexState: Pick<CodeIndexSlice, 'codebaseIndexConfig' | 'codebaseIndexModels'> = {
  codebaseIndexConfig: {
    codebaseIndexEnabled: true,
    codebaseIndexQdrantUrl: 'http://localhost:6333',
    codebaseIndexEmbedderProvider: 'openai',
    codebaseIndexEmbedderBaseUrl: '',
    codebaseIndexEmbedderModelId: '',
    codebaseIndexSearchMaxResults: undefined,
    codebaseIndexSearchMinScore: undefined,
  },
  codebaseIndexModels: { openai: {} },
}

const initialExperimentsState: Pick<ExperimentsSlice, 'experiments'> = {
  experiments: experimentDefault,
}

const initialMcpState: Pick<McpSlice, 'mcpServers' | 'mcpEnabled' | 'remoteControlEnabled' | 'taskSyncEnabled' | 'featureRoomoteControlEnabled'> =
  {
    mcpServers: [],
    mcpEnabled: true,
    remoteControlEnabled: false,
    taskSyncEnabled: false,
    featureRoomoteControlEnabled: false,
  }

const initialSkillsState: Pick<SkillsSlice, 'skills' | 'skillsEnabled' | 'disabledSkills'> = {
  skills: [],
  skillsEnabled: true,
  disabledSkills: [],
}

const initialProfileState: Pick<ProfileSlice, 'profileThresholds'> = {
  profileThresholds: {},
}

const initialCommandsState: Pick<
  CommandsSlice,
  'allowedCommands' | 'deniedCommands' | 'allowedMaxRequests' | 'allowedMaxCost'
> = {
  allowedCommands: [],
  deniedCommands: [],
  allowedMaxRequests: undefined,
  allowedMaxCost: undefined,
}

const initialTerminalState: Pick<TerminalSlice, 'terminalZdotdir' | 'terminalZshOhMy' | 'terminalZshP10k'> = {
  terminalZdotdir: false,
  terminalZshOhMy: false,
  terminalZshP10k: false,
}

const initialUiStateState: Pick<
  UiStateSlice,
  'historyPreviewCollapsed' | 'reasoningBlockCollapsed' | 'showAnnouncement'
> = {
  historyPreviewCollapsed: false,
  reasoningBlockCollapsed: true,
  showAnnouncement: false,
}

const initialEnhancementState: Pick<
  EnhancementSlice,
  'enhancementApiConfigId' | 'lockApiConfigAcrossModes'
> = {
  enhancementApiConfigId: '',
  lockApiConfigAcrossModes: false,
}

const initialImageLimitsState: Pick<ImageLimitsSlice, 'maxImageFileSize' | 'maxTotalImageSize'> = {
  maxImageFileSize: 5,
  maxTotalImageSize: 20,
}

export const useExtensionStore = create<ExtensionStoreState>()(
  subscribeWithSelector((set) => ({
    // API Config slice
    ...initialApiConfigState,
    setApiConfiguration: (config) => set({ apiConfiguration: config }),
    setCurrentApiConfigName: (name) => set({ currentApiConfigName: name }),
    setListApiConfigMeta: (configs) => set({ listApiConfigMeta: configs }),
    setPinnedApiConfigs: (pinned) => set({ pinnedApiConfigs: pinned }),
    togglePinnedApiConfig: (configName) =>
      set((state) => ({
        pinnedApiConfigs: {
          ...state.pinnedApiConfigs,
          [configName]: !state.pinnedApiConfigs?.[configName],
        },
      })),

    // Preferences slice
    ...initialPreferencesState,
    setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
    setSoundVolume: (volume) => set({ soundVolume: volume }),
    setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }),
    setTtsSpeed: (speed) => set({ ttsSpeed: speed }),

    // Modes slice
    ...initialModesState,
    setMode: (mode) => set({ mode }),
    setCustomModes: (modes) => set({ customModes: modes }),
    setCustomModePrompts: (prompts) => set({ customModePrompts: prompts }),
    setAlwaysAllowModeSwitch: (enabled) => set({ alwaysAllowModeSwitch: enabled }),
    setHasOpenedModeSelector: (value) => set({ hasOpenedModeSelector: value }),

    // Auto-approval slice
    ...initialAutoApprovalState,
    setAutoApprovalEnabled: (enabled) => set({ autoApprovalEnabled: enabled }),
    setAlwaysAllowReadOnly: (enabled) => set({ alwaysAllowReadOnly: enabled }),
    setAlwaysAllowReadOnlyOutsideWorkspace: (enabled) => set({ alwaysAllowReadOnlyOutsideWorkspace: enabled }),
    setAlwaysAllowWrite: (enabled) => set({ alwaysAllowWrite: enabled }),
    setAlwaysAllowWriteOutsideWorkspace: (enabled) => set({ alwaysAllowWriteOutsideWorkspace: enabled }),
    setAlwaysAllowExecute: (enabled) => set({ alwaysAllowExecute: enabled }),
    setAlwaysAllowMcp: (enabled) => set({ alwaysAllowMcp: enabled }),
    setAlwaysAllowSubtasks: (enabled) => set({ alwaysAllowSubtasks: enabled }),
    setAlwaysAllowFollowupQuestions: (enabled) => set({ alwaysAllowFollowupQuestions: enabled }),
    setFollowupAutoApproveTimeoutMs: (timeout) => set({ followupAutoApproveTimeoutMs: timeout }),

    // Settings slice
    ...initialSettingsState,
    setCustomInstructions: (value) => set({ customInstructions: value }),
    setMaxOpenTabsContext: (value) => set({ maxOpenTabsContext: value }),
    setMaxWorkspaceFiles: (value) => set({ maxWorkspaceFiles: value }),
    setWriteDelayMs: (value) => set({ writeDelayMs: value }),
    setTerminalShellIntegrationTimeout: (value) => set({ terminalShellIntegrationTimeout: value }),
    setTerminalShellIntegrationDisabled: (value) => set({ terminalShellIntegrationDisabled: value }),
    setTerminalOutputPreviewSize: (value) => set({ terminalOutputPreviewSize: value }),
    setEnableCheckpoints: (value) => set({ enableCheckpoints: value }),
    setCheckpointTimeout: (value) => set({ checkpointTimeout: value }),
    setIncludeDiagnosticMessages: (value) => set({ includeDiagnosticMessages: value }),
    setMaxDiagnosticMessages: (value) => set({ maxDiagnosticMessages: value }),
    setIncludeTaskHistoryInEnhance: (value) => set({ includeTaskHistoryInEnhance: value }),
    setIncludeCurrentTime: (value) => set({ includeCurrentTime: value }),
    setIncludeCurrentCost: (value) => set({ includeCurrentCost: value }),
    setAutoCondenseContext: (value) => set({ autoCondenseContext: value }),
    setAutoCondenseContextPercent: (value) => set({ autoCondenseContextPercent: value }),
    setEnterBehavior: (value) => set({ enterBehavior: value }),
    setIgnoreMode: (value) => set({ ignoreMode: value }),
    setEnableSubfolderRules: (value) => set({ enableSubfolderRules: value }),
    setShowRooIgnoredFiles: (value) => set({ showRooIgnoredFiles: value }),

    // Code Index slice
    ...initialCodeIndexState,
    setCodebaseIndexConfig: (config) => set({ codebaseIndexConfig: config }),
    setCodebaseIndexModels: (models) => set({ codebaseIndexModels: models }),

    // Experiments slice
    ...initialExperimentsState,
    setExperimentEnabled: (id, enabled) =>
      set((state) => ({
        experiments: {
          ...state.experiments,
          [id]: enabled,
        },
      })),

    // MCP slice
    ...initialMcpState,
    setMcpServers: (servers) => set({ mcpServers: servers }),
    setMcpEnabled: (enabled) => set({ mcpEnabled: enabled }),
    setRemoteControlEnabled: (enabled) => set({ remoteControlEnabled: enabled }),
    setTaskSyncEnabled: (enabled) => set({ taskSyncEnabled: enabled }),
    setFeatureRoomoteControlEnabled: (enabled) => set({ featureRoomoteControlEnabled: enabled }),

    // Skills slice
    ...initialSkillsState,
    setSkills: (skills) => set({ skills }),
    setSkillsEnabled: (enabled) => set({ skillsEnabled: enabled }),
    setDisabledSkills: (disabled) => set({ disabledSkills: disabled }),

    // Profile slice
    ...initialProfileState,
    setProfileThresholds: (thresholds) => set({ profileThresholds: thresholds }),

    // Commands slice
    ...initialCommandsState,
    setAllowedCommands: (commands) => set({ allowedCommands: commands }),
    setDeniedCommands: (commands) => set({ deniedCommands: commands }),
    setAllowedMaxRequests: (max) => set({ allowedMaxRequests: max }),
    setAllowedMaxCost: (max) => set({ allowedMaxCost: max }),

    // Terminal slice
    ...initialTerminalState,
    setTerminalZdotdir: (value) => set({ terminalZdotdir: value }),
    setTerminalZshOhMy: (value) => set({ terminalZshOhMy: value }),
    setTerminalZshP10k: (value) => set({ terminalZshP10k: value }),

    // UI State slice
    ...initialUiStateState,
    setHistoryPreviewCollapsed: (value) => set({ historyPreviewCollapsed: value }),
    setReasoningBlockCollapsed: (value) => set({ reasoningBlockCollapsed: value }),
    setShowAnnouncement: (value) => set({ showAnnouncement: value }),

    // Enhancement slice
    ...initialEnhancementState,
    setEnhancementApiConfigId: (id) => set({ enhancementApiConfigId: id }),
    setLockApiConfigAcrossModes: (value) => set({ lockApiConfigAcrossModes: value }),

    // Image limits slice
    ...initialImageLimitsState,
    setMaxImageFileSize: (value) => set({ maxImageFileSize: value }),
    setMaxTotalImageSize: (value) => set({ maxTotalImageSize: value }),
  }))
)
