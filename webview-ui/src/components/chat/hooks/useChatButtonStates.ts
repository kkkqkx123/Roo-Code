import { useCallback } from 'react'

import { useChatStore } from '@src/stores/chatStore'
import type { ClineAsk, ClineMessage, ClineSayTool } from '@coder/types'

interface UseChatButtonStatesOptions {
  t: (key: string) => string
  currentTaskItem?: { parentTaskId?: string }
  messages: ClineMessage[]
  messageQueue?: any[]
  playSound: (type: string) => void
}

export function useChatButtonStates({
  t,
  currentTaskItem,
  messages,
  messageQueue,
  playSound,
}: UseChatButtonStatesOptions) {
  const { updateButtonStates } = useChatStore()

  // Process message and update button states
  const processMessage = useCallback((lastMessage: ClineMessage | undefined, secondLastMessage: ClineMessage | undefined) => {
    if (!lastMessage) {
      updateButtonStates({
        sendingDisabled: false,
        clineAsk: undefined,
        enableButtons: false,
        primaryButtonText: undefined,
        secondaryButtonText: undefined,
      })
      return
    }

    if (lastMessage.type === 'ask') {
      const isPartial = lastMessage.partial === true

      switch (lastMessage.ask) {
        case 'api_req_failed':
          playSound('progress_loop')
          updateButtonStates({
            sendingDisabled: true,
            clineAsk: 'api_req_failed',
            enableButtons: true,
            primaryButtonText: t('chat:retry.title'),
            secondaryButtonText: t('chat:startNewTask.title'),
          })
          break

        case 'mistake_limit_reached':
          playSound('progress_loop')
          updateButtonStates({
            sendingDisabled: false,
            clineAsk: 'mistake_limit_reached',
            enableButtons: true,
            primaryButtonText: t('chat:proceedAnyways.title'),
            secondaryButtonText: t('chat:startNewTask.title'),
          })
          break

        case 'followup':
          updateButtonStates({
            sendingDisabled: isPartial,
            clineAsk: 'followup',
            enableButtons: true,
            primaryButtonText: undefined,
            secondaryButtonText: undefined,
          })
          break

        case 'tool': {
          const tool = JSON.parse(lastMessage.text || '{}') as ClineSayTool
          updateButtonStates({
            sendingDisabled: isPartial,
            clineAsk: 'tool',
            enableButtons: !isPartial,
          })

          switch (tool.tool) {
            case 'editedExistingFile':
            case 'appliedDiff':
            case 'newFileCreated':
              if (tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
                updateButtonStates({
                  primaryButtonText: t('chat:edit-batch.approve.title'),
                  secondaryButtonText: t('chat:edit-batch.deny.title'),
                })
              } else {
                updateButtonStates({
                  primaryButtonText: t('chat:save.title'),
                  secondaryButtonText: t('chat:reject.title'),
                })
              }
              break

            case 'generateImage':
              updateButtonStates({
                primaryButtonText: t('chat:save.title'),
                secondaryButtonText: t('chat:reject.title'),
              })
              break

            case 'finishTask':
              updateButtonStates({
                primaryButtonText: t('chat:completeSubtaskAndReturn'),
                secondaryButtonText: undefined,
              })
              break

            case 'readFile':
              if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
                updateButtonStates({
                  primaryButtonText: t('chat:read-batch.approve.title'),
                  secondaryButtonText: t('chat:read-batch.deny.title'),
                })
              } else {
                updateButtonStates({
                  primaryButtonText: t('chat:approve.title'),
                  secondaryButtonText: t('chat:reject.title'),
                })
              }
              break

            case 'listFilesTopLevel':
            case 'listFilesRecursive':
              if (tool.batchDirs && Array.isArray(tool.batchDirs)) {
                updateButtonStates({
                  primaryButtonText: t('chat:list-batch.approve.title'),
                  secondaryButtonText: t('chat:list-batch.deny.title'),
                })
              } else {
                updateButtonStates({
                  primaryButtonText: t('chat:approve.title'),
                  secondaryButtonText: t('chat:reject.title'),
                })
              }
              break

            default:
              updateButtonStates({
                primaryButtonText: t('chat:approve.title'),
                secondaryButtonText: t('chat:reject.title'),
              })
              break
          }
          break
        }

        case 'command':
          updateButtonStates({
            sendingDisabled: isPartial,
            clineAsk: 'command',
            enableButtons: !isPartial,
            primaryButtonText: t('chat:runCommand.title'),
            secondaryButtonText: t('chat:reject.title'),
          })
          break

        case 'command_output':
          updateButtonStates({
            sendingDisabled: false,
            clineAsk: 'command_output',
            enableButtons: true,
            primaryButtonText: t('chat:proceedWhileRunning.title'),
            secondaryButtonText: t('chat:killCommand.title'),
          })
          break

        case 'use_mcp_server':
          updateButtonStates({
            sendingDisabled: isPartial,
            clineAsk: 'use_mcp_server',
            enableButtons: !isPartial,
            primaryButtonText: t('chat:approve.title'),
            secondaryButtonText: t('chat:reject.title'),
          })
          break

        case 'completion_result':
          if (!isPartial && (!messageQueue || messageQueue.length === 0)) {
            playSound('celebration')
          }
          updateButtonStates({
            sendingDisabled: isPartial,
            clineAsk: 'completion_result',
            enableButtons: !isPartial,
            primaryButtonText: t('chat:startNewTask.title'),
            secondaryButtonText: undefined,
          })
          break

        case 'resume_task': {
          const isCompletedSubtask =
            currentTaskItem?.parentTaskId &&
            messages.some(
              (msg) => msg.ask === 'completion_result' || msg.say === 'completion_result',
            )
          updateButtonStates({
            sendingDisabled: false,
            clineAsk: 'resume_task',
            enableButtons: true,
            primaryButtonText: isCompletedSubtask
              ? t('chat:startNewTask.title')
              : t('chat:resumeTask.title'),
            secondaryButtonText: isCompletedSubtask ? undefined : t('chat:terminate.title'),
          })
          break
        }

        case 'resume_completed_task':
          updateButtonStates({
            sendingDisabled: false,
            clineAsk: 'resume_completed_task',
            enableButtons: true,
            primaryButtonText: t('chat:startNewTask.title'),
            secondaryButtonText: undefined,
          })
          break
      }
    } else if (lastMessage.type === 'say') {
      switch (lastMessage.say) {
        case 'api_req_retry_delayed':
        case 'api_req_rate_limit_wait':
          updateButtonStates({ sendingDisabled: true })
          break

        case 'api_req_started':
          updateButtonStates({
            sendingDisabled: true,
            clineAsk: undefined,
            enableButtons: false,
            primaryButtonText: undefined,
            secondaryButtonText: undefined,
          })
          break
      }
    }
  }, [t, currentTaskItem?.parentTaskId, messages, messageQueue, playSound, updateButtonStates])

  // Reset states when messages array is empty
  const resetStatesIfEmpty = useCallback(() => {
    if (messages.length === 0) {
      updateButtonStates({
        sendingDisabled: false,
        clineAsk: undefined,
        enableButtons: false,
        primaryButtonText: undefined,
        secondaryButtonText: undefined,
      })
    }
  }, [messages.length, updateButtonStates])

  // Update button text when messages change for subtasks in resume_task state
  const updateResumeTaskButtons = useCallback(() => {
    const { clineAsk } = useChatStore.getState()
    if (clineAsk === 'resume_task' && currentTaskItem?.parentTaskId) {
      const hasCompletionResult = messages.some(
        (msg) => msg.ask === 'completion_result' || msg.say === 'completion_result',
      )
      if (hasCompletionResult) {
        updateButtonStates({
          primaryButtonText: t('chat:startNewTask.title'),
          secondaryButtonText: undefined,
        })
      }
    }
  }, [currentTaskItem?.parentTaskId, messages, t, updateButtonStates])

  return {
    processMessage,
    resetStatesIfEmpty,
    updateResumeTaskButtons,
  }
}
