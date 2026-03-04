import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { vscode } from '@src/utils/vscode'
import type { CodebaseIndexConfig } from '@coder/types'

export function useCodeIndexConfig() {
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery<CodebaseIndexConfig>({
    queryKey: ['codeIndexConfig'],
    queryFn: () => {
      return new Promise<CodebaseIndexConfig>((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.data.type === 'state') {
            window.removeEventListener('message', handler)
            resolve(event.data.state?.codebaseIndexConfig || {})
          }
        }
        window.addEventListener('message', handler)
        // Note: webviewDidLaunch is sent once by App.tsx on mount.
        // This hook relies on receiving the state message from that initial launch.

        // Timeout fallback
        setTimeout(() => {
          window.removeEventListener('message', handler)
          resolve({
            codebaseIndexEnabled: true,
            codebaseIndexQdrantUrl: 'http://localhost:6333',
            codebaseIndexEmbedderProvider: 'openai',
            codebaseIndexEmbedderBaseUrl: '',
            codebaseIndexEmbedderModelId: '',
            codebaseIndexSearchMaxResults: 20,
            codebaseIndexSearchMinScore: 0.3,
          })
        }, 5000)
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (newConfig: CodebaseIndexConfig) => {
      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data.type === 'codeIndexSettingsSaved') {
            window.removeEventListener('message', handler)
            if (event.data.success) {
              resolve()
            } else {
              reject(new Error(event.data.error || 'Failed to save settings'))
            }
          }
        }
        window.addEventListener('message', handler)
        vscode.postMessage({
          type: 'saveCodeIndexSettingsAtomic',
          values: newConfig as Record<string, unknown>,
        })

        // Timeout fallback
        setTimeout(() => {
          window.removeEventListener('message', handler)
          reject(new Error('Timeout waiting for save response'))
        }, 10000)
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['codeIndexConfig'] })
      queryClient.invalidateQueries({ queryKey: ['indexingStatus'] })
    },
  })

  return {
    config,
    isLoading,
    updateConfig: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    error: updateMutation.error,
  }
}
