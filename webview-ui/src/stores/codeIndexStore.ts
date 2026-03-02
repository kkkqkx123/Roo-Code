import { create } from 'zustand'

import type { IndexingStatus, EmbedderProvider, VectorStorageMode, VectorStoragePreset } from '@coder/types'

interface LocalCodeIndexSettings {
  codebaseIndexEnabled: boolean
  codebaseIndexQdrantUrl: string
  codebaseIndexEmbedderProvider: EmbedderProvider
  codebaseIndexEmbedderBaseUrl?: string
  codebaseIndexEmbedderModelId: string
  codebaseIndexEmbedderModelDimension?: number
  codebaseIndexSearchMaxResults?: number
  codebaseIndexSearchMinScore?: number
  vectorStorageMode: VectorStorageMode
  vectorStoragePreset: VectorStoragePreset
  vectorStorageThresholds?: {
    tiny: number
    small: number
    medium: number
    large: number
  }
  codeIndexOpenAiKey?: string
  codeIndexQdrantApiKey?: string
  codebaseIndexOpenAiCompatibleApiKey?: string
  codebaseIndexGeminiApiKey?: string
  manualIndexingOnly?: boolean
  autoUpdateIndex?: boolean
  codebaseIndexAllowedProjects?: string[]
}

interface CodeIndexUIState {
  // UI State
  isOpen: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
  formErrors: Record<string, string>
  isAdvancedSettingsOpen: boolean
  isSetupSettingsOpen: boolean
  isVectorStorageOpen: boolean
  isIndexingBehaviorOpen: boolean
  isDiscardDialogShow: boolean

  // Settings state
  initialSettings: LocalCodeIndexSettings
  currentSettings: LocalCodeIndexSettings
  indexingStatus: IndexingStatus

  // Actions
  setOpen: (open: boolean) => void
  setSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  setSaveError: (error: string | null) => void
  setFormErrors: (errors: Record<string, string>) => void
  setIsAdvancedSettingsOpen: (open: boolean) => void
  setIsSetupSettingsOpen: (open: boolean) => void
  setIsVectorStorageOpen: (open: boolean) => void
  setIsIndexingBehaviorOpen: (open: boolean) => void
  setIsDiscardDialogShow: (open: boolean) => void
  setInitialSettings: (settings: LocalCodeIndexSettings) => void
  setCurrentSettings: (settings: LocalCodeIndexSettings) => void
  updateSetting: (key: keyof LocalCodeIndexSettings, value: any) => void
  setIndexingStatus: (status: IndexingStatus) => void
  resetSettings: () => void
}

const getDefaultSettings = (): LocalCodeIndexSettings => ({
  codebaseIndexEnabled: true,
  codebaseIndexQdrantUrl: '',
  codebaseIndexEmbedderProvider: 'openai',
  codebaseIndexEmbedderBaseUrl: '',
  codebaseIndexEmbedderModelId: '',
  codebaseIndexEmbedderModelDimension: undefined,
  codebaseIndexSearchMaxResults: 20,
  codebaseIndexSearchMinScore: 0.3,
  vectorStorageMode: 'auto',
  vectorStoragePreset: 'medium',
  vectorStorageThresholds: {
    tiny: 2000,
    small: 10000,
    medium: 100000,
    large: 1000000,
  },
  codeIndexOpenAiKey: '',
  codeIndexQdrantApiKey: '',
  codebaseIndexOpenAiCompatibleApiKey: '',
  codebaseIndexGeminiApiKey: '',
  manualIndexingOnly: false,
  autoUpdateIndex: true,
  codebaseIndexAllowedProjects: [],
})

export const useCodeIndexStore = create<CodeIndexUIState>()((set) => ({
  // UI State
  isOpen: false,
  saveStatus: 'idle',
  saveError: null,
  formErrors: {},
  isAdvancedSettingsOpen: false,
  isSetupSettingsOpen: false,
  isVectorStorageOpen: false,
  isIndexingBehaviorOpen: false,
  isDiscardDialogShow: false,

  // Settings state
  initialSettings: getDefaultSettings(),
  currentSettings: getDefaultSettings(),
  indexingStatus: {
    systemStatus: 'idle',
    message: '',
    processedItems: 0,
    totalItems: 0,
    currentItemUnit: 'items',
  },

  // Actions
  setOpen: (open) => set({ isOpen: open }),

  setSaveStatus: (status) => set({ saveStatus: status }),

  setSaveError: (error) => set({ saveError: error }),

  setFormErrors: (errors) => set({ formErrors: errors }),

  setIsAdvancedSettingsOpen: (open) => set({ isAdvancedSettingsOpen: open }),

  setIsSetupSettingsOpen: (open) => set({ isSetupSettingsOpen: open }),

  setIsVectorStorageOpen: (open) => set({ isVectorStorageOpen: open }),

  setIsIndexingBehaviorOpen: (open) => set({ isIndexingBehaviorOpen: open }),

  setIsDiscardDialogShow: (open) => set({ isDiscardDialogShow: open }),

  setInitialSettings: (settings) => set({ initialSettings: settings }),

  setCurrentSettings: (settings) => set({ currentSettings: settings }),

  updateSetting: (key, value) =>
    set((state) => ({
      currentSettings: {
        ...state.currentSettings,
        [key]: value,
      },
    })),

  setIndexingStatus: (status) => set({ indexingStatus: status }),

  resetSettings: () =>
    set((state) => ({
      ...state,
      currentSettings: getDefaultSettings(),
      formErrors: {},
    })),
}))
