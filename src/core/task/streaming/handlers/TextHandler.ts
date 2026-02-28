/**
 * Text Handler
 *
 * Handles text content chunks from the streaming API.
 * Accumulates text and updates the assistant message content blocks.
 */

import type { ChunkHandlerContext, StreamChunk } from "../types"
import type { AssistantMessageContent } from "../../../assistant-message/types"

/**
 * Handle text stream chunks
 */
export async function handleTextChunk(
  context: ChunkHandlerContext,
  chunk: StreamChunk
): Promise<void> {
  if (chunk.type !== "text") {
    return
  }

  // Accumulate text
  context.stateManager.appendAssistantMessage(chunk.text)

  // Accumulate tokens
  context.tokenManager.addTextTokens(chunk.text)

  // Create or update text block
  updateTextBlock(context)

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish text chunk event
  await context.eventBus?.publish('stream:chunk', {
    type: 'text',
    data: { type: 'text', text: chunk.text },
  })
}

/**
 * Update the text content block in the assistant message
 * Either updates the last block if it's a partial text block,
 * or creates a new text block
 */
function updateTextBlock(context: ChunkHandlerContext): void {
  const lastBlock = context.stateManager.getAssistantMessageContent().at(-1)

  if (lastBlock?.type === "text" && lastBlock.partial) {
    // Update existing partial text block
    lastBlock.content = context.stateManager.getAssistantMessage()
  } else {
    // Create new text block
    context.stateManager.addAssistantContentBlock({
      type: "text",
      content: context.stateManager.getAssistantMessage(),
      partial: true,
    } satisfies AssistantMessageContent)
  }
}
