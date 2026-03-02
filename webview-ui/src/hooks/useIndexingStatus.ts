import { useQuery } from '@tanstack/react-query'

import { vscode } from '@src/utils/vscode'
import type { IndexingStatus } from '@coder/types'

function fetchIndexingStatus(workspacePath?: string): Promise<IndexingStatus> {
  return new Promise<IndexingStatus>((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'indexingStatusUpdate') {
        const values = event.data.values
        // Only resolve if the workspacePath matches or if no workspacePath is provided
        if (!values.workspacePath || values.workspacePath === workspacePath) {
          window.removeEventListener('message', handler)
          resolve({
            systemStatus: values.systemStatus,
            message: values.message || '',
            processedItems: values.processedItems,
            totalItems: values.totalItems,
            currentItemUnit: values.currentItemUnit || 'items',
          })
        }
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'requestIndexingStatus' })

    // Timeout fallback
    setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve({
        systemStatus: 'idle',
        message: '',
        processedItems: 0,
        totalItems: 0,
        currentItemUnit: 'items',
      })
    }, 5000)
  })
}

export function useIndexingStatus(workspacePath?: string) {
  return useQuery<IndexingStatus>({
    queryKey: ['indexingStatus', workspacePath],
    queryFn: () => fetchIndexingStatus(workspacePath),
    refetchInterval: 5000, // Poll every 5s
    enabled: true,
  })
}
