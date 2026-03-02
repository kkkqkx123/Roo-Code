import { create } from 'zustand'

import type { ExtensionState } from '@coder/types'

interface SettingsState {
  // Cached state for form editing
  cachedState: Partial<ExtensionState>
  originalState: Partial<ExtensionState>

  // UI state
  isDirty: boolean
  settingsImportedAt: number | null

  // Actions
  setCachedState: (state: Partial<ExtensionState> | ((prev: Partial<ExtensionState>) => Partial<ExtensionState>)) => void
  updateCachedField: <K extends keyof ExtensionState>(field: K, value: ExtensionState[K]) => void
  commitChanges: () => void
  resetChanges: () => void
  importSettings: (state: Partial<ExtensionState>) => void
  clearDirty: () => void
}

// Helper function for deep equality check
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false

  if (Array.isArray(a) !== Array.isArray(b)) return false

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!deepEqual(a[key as keyof typeof a], b[key as keyof typeof b])) return false
  }

  return true
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  cachedState: {},
  originalState: {},
  isDirty: false,
  settingsImportedAt: null,

  setCachedState: (state) =>
    set((prev) => ({
      cachedState: typeof state === 'function' ? state(prev.cachedState) : state,
    })),

  updateCachedField: (field, value) =>
    set((state) => {
      // Check if the value is actually changing
      if (state.cachedState[field] === value) {
        return state
      }

      return {
        cachedState: {
          ...state.cachedState,
          [field]: value,
        },
        isDirty: true,
      }
    }),

  commitChanges: () =>
    set((state) => ({
      originalState: state.cachedState,
      isDirty: false,
    })),

  resetChanges: () =>
    set((state) => ({
      cachedState: state.originalState,
      isDirty: false,
    })),

  importSettings: (state) =>
    set(() => ({
      cachedState: state,
      originalState: state,
      settingsImportedAt: Date.now(),
      isDirty: false,
    })),

  clearDirty: () => set({ isDirty: false }),

  // Computed value via selector pattern
  get hasUnsavedChanges() {
    return !deepEqual(get().cachedState, get().originalState)
  },
}))
