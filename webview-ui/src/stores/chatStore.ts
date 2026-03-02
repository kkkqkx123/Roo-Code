import { create } from 'zustand'

import type { ClineAsk, ClineMessage } from '@coder/types'

interface ChatState {
  // State
  messages: ClineMessage[]
  clineAsk: ClineAsk | undefined
  enableButtons: boolean
  primaryButtonText: string | undefined
  secondaryButtonText: string | undefined
  sendingDisabled: boolean

  // Actions
  setMessages: (messages: ClineMessage[]) => void
  setClineAsk: (ask: ClineAsk | undefined) => void
  setEnableButtons: (enabled: boolean) => void
  setPrimaryButtonText: (text: string | undefined) => void
  setSecondaryButtonText: (text: string | undefined) => void
  setSendingDisabled: (disabled: boolean) => void
  
  // Combined action for atomic updates
  updateButtonStates: (states: {
    sendingDisabled?: boolean
    clineAsk?: ClineAsk | undefined
    enableButtons?: boolean
    primaryButtonText?: string | undefined
    secondaryButtonText?: string | undefined
  }) => void
  
  resetChatState: () => void
}

const initialState = {
  messages: [],
  clineAsk: undefined,
  enableButtons: false,
  primaryButtonText: undefined,
  secondaryButtonText: undefined,
  sendingDisabled: false,
}

export const useChatStore = create<ChatState>()((set) => ({
  // Initial state
  ...initialState,

  // Actions
  setMessages: (messages) => set({ messages }),

  setClineAsk: (ask) => set({ clineAsk: ask }),

  setEnableButtons: (enabled) => set({ enableButtons: enabled }),

  setPrimaryButtonText: (text) => set({ primaryButtonText: text }),

  setSecondaryButtonText: (text) => set({ secondaryButtonText: text }),

  setSendingDisabled: (disabled) => set({ sendingDisabled: disabled }),

  // Atomic update for multiple button states at once
  updateButtonStates: (states) => set(states),

  resetChatState: () => set(initialState),
}))
