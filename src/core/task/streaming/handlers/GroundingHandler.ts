/**
 * Grounding Handler
 *
 * Handles grounding chunks from the streaming API.
 * Stores citation sources separately to avoid state persistence issues.
 */

import type { ChunkHandlerContext, StreamChunk } from "../types"

/**
 * Handle grounding stream chunks
 */
export async function handleGroundingChunk(
  context: ChunkHandlerContext,
  chunk: StreamChunk
): Promise<void> {
  if (chunk.type !== "grounding") {
    return
  }

  // Store grounding sources separately to avoid state persistence issues
  if (chunk.sources && chunk.sources.length > 0) {
    context.stateManager.addGroundingSources(chunk.sources)

    // Publish grounding event
    await context.eventBus?.publish('stream:chunk', {
      type: 'grounding',
      data: { type: 'grounding', sources: chunk.sources },
    })
  }
}
