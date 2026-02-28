/**
 * Usage Handler
 *
 * Handles usage chunks from the streaming API.
 * Accumulates token usage information (input, output, cache tokens, and cost).
 */

import type { ChunkHandlerContext, StreamChunk } from "../types"

/**
 * Handle usage stream chunks
 */
export async function handleUsageChunk(
  context: ChunkHandlerContext,
  chunk: StreamChunk
): Promise<void> {
  if (chunk.type !== "usage") {
    return
  }

  // Accumulate tokens
  context.tokenManager.addApiUsage(
    chunk.inputTokens,
    chunk.outputTokens,
    chunk.cacheWriteTokens ?? 0,
    chunk.cacheReadTokens ?? 0,
    chunk.totalCost ?? 0
  )

  // Publish token update event (matching TaskEventMap definition)
  const tokens = context.tokenManager.getTokens()
  const breakdown = context.tokenManager.getTokenBreakdown()
  await context.eventBus?.publish('token:update', {
    tokens,
    breakdown,
    isFinal: false,
  })
}
