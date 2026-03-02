import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { vscode } from '@src/utils/vscode'
import type { ModeConfig } from '@coder/types'

function fetchModes(): Promise<ModeConfig[]> {
  return new Promise<ModeConfig[]>((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'state') {
        window.removeEventListener('message', handler)
        resolve(event.data.state?.customModes || [])
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'requestModes' })

    // Timeout fallback
    setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve([])
    }, 5000)
  })
}

export function useModes() {
  const queryClient = useQueryClient()

  const { data: modes, isLoading } = useQuery<ModeConfig[]>({
    queryKey: ['modes'],
    queryFn: fetchModes,
  })

  const updateModeMutation = useMutation({
    mutationFn: ({ slug, updates }: { slug: string; updates: Partial<ModeConfig> }) => {
      return new Promise<ModeConfig>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data.type === 'state') {
            window.removeEventListener('message', handler)
            const updatedModes = event.data.state?.customModes || []
            const updated = updatedModes.find((m: ModeConfig) => m.slug === slug)
            if (updated) {
              resolve(updated)
            } else {
              reject(new Error('Mode not found after update'))
            }
          }
        }
        window.addEventListener('message', handler)
        // Build complete mode config by merging updates with existing mode
        const completeMode: Partial<ModeConfig> = { slug, ...updates }
        vscode.postMessage({
          type: 'updateCustomMode',
          slug,
          modeConfig: completeMode as ModeConfig,
        })

        setTimeout(() => {
          window.removeEventListener('message', handler)
          reject(new Error('Timeout waiting for update response'))
        }, 10000)
      })
    },
    onMutate: async ({ slug, updates }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['modes'] })
      const previousModes = queryClient.getQueryData(['modes'])

      queryClient.setQueryData(['modes'], (old: ModeConfig[] | undefined) =>
        (old || []).map((m) => (m.slug === slug ? { ...m, ...updates } : m))
      )

      return { previousModes }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousModes) {
        queryClient.setQueryData(['modes'], context.previousModes)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['modes'] })
    },
  })

  const deleteModeMutation = useMutation({
    mutationFn: (slug: string) => {
      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data.type === 'state') {
            window.removeEventListener('message', handler)
            resolve()
          }
        }
        window.addEventListener('message', handler)
        vscode.postMessage({
          type: 'deleteCustomMode',
          slug,
        })

        setTimeout(() => {
          window.removeEventListener('message', handler)
          reject(new Error('Timeout waiting for delete response'))
        }, 10000)
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modes'] })
    },
  })

  return {
    modes,
    isLoading,
    updateMode: updateModeMutation.mutate,
    deleteMode: deleteModeMutation.mutate,
    isUpdating: updateModeMutation.isPending,
    isDeleting: deleteModeMutation.isPending,
  }
}
