/**
 * Reasoning Handler
 *
 * Handles reasoning message chunks from the streaming API.
 * Includes dead loop detection to prevent infinite loops in reasoning.
 */

import { DeadLoopDetector } from "../../../../utils/deadLoopDetector"
import type { ChunkHandlerContext, StreamChunk } from "../types"

/**
 * Handle reasoning stream chunks
 */
export async function handleReasoningChunk(
  context: ChunkHandlerContext,
  chunk: StreamChunk,
  deadLoopDetector: DeadLoopDetector
): Promise<void> {
  if (chunk.type !== "reasoning") {
    return
  }

  // Accumulate reasoning message
  context.stateManager.appendReasoningMessage(chunk.text)

  // Accumulate tokens
  context.tokenManager.addReasoningTokens(chunk.text)

  // Format reasoning message for display
  const formattedReasoning = formatReasoningMessage(
    context.stateManager.getReasoningMessage()
  )

  // Dead loop detection
  const detectionResult = deadLoopDetector.detect(
    context.stateManager.getReasoningMessage()
  )

  console.log('[ReasoningHandler] detectionResult:', detectionResult, 'reasoningLength:', context.stateManager.getReasoningMessage().length)

  if (detectionResult.detected) {
    console.log('[ReasoningHandler] Dead loop detected!')
    await handleDeadLoop(context, detectionResult)
    return
  }

  // Display reasoning message
  await context.config.onSay("reasoning", formattedReasoning, undefined, true)

  // Publish reasoning chunk event
  await context.eventBus?.publish('stream:chunk', {
    type: 'reasoning',
    data: { type: 'reasoning', text: chunk.text },
  })
}

/**
 * Format reasoning message for better readability
 * Adds line breaks before headings that follow sentence endings
 */
function formatReasoningMessage(message: string): string {
  if (message.includes("**")) {
    return message.replace(/([.!?])\*\*([^*\n]+)\*\*/g, "$1\n\n**$2**")
  }
  return message
}

/**
 * Handle dead loop detection
 * Aborts the stream and notifies the user
 */
async function handleDeadLoop(
  context: ChunkHandlerContext,
  result: { detected: boolean; details?: string }
): Promise<void> {
  const errorMessage = `检测到死循环：${result.details}。任务已终止，请尝试重新描述任务或调整提示词。`

  console.log('[ReasoningHandler] handleDeadLoop:', errorMessage)

  // Display error message first
  await context.config.onSay("error", errorMessage)

  console.log('[ReasoningHandler] handleDeadLoop completed')

  // Set aborted state
  context.stateManager.setAborted(true, "streaming_failed")

  // Throw error to stop stream processing
  throw new Error(errorMessage)
}
