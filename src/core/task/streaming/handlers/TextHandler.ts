/**
 * Text Handler
 * 
 * Handles text content chunks from the streaming API.
 * Accumulates text and updates the assistant message content blocks.
 */

import { BaseChunkHandler } from "./ChunkHandler"
import type { ChunkHandlerContext, StreamChunk } from "../types"

export class TextHandler extends BaseChunkHandler {
	/**
	 * Handle text stream chunks
	 */
	async handle(chunk: StreamChunk): Promise<void> {
		if (chunk.type !== "text") {
			return
		}

		// Accumulate text
		this.stateManager.appendAssistantMessage(chunk.text)

		// Accumulate tokens
		this.tokenManager.addTextTokens(chunk.text)

		// Create or update text block
		this.updateTextBlock()

		// Present assistant message
		this.config.onPresentAssistant()
	}

	/**
	 * Update the text content block in the assistant message
	 * Either updates the last block if it's a partial text block,
	 * or creates a new text block
	 */
	private updateTextBlock(): void {
		const lastBlock = this.stateManager.getAssistantMessageContent().at(-1)

		if (lastBlock?.type === "text" && lastBlock.partial) {
			// Update existing partial text block
			lastBlock.content = this.stateManager.getAssistantMessage()
		} else {
			// Create new text block
			this.stateManager.addAssistantContentBlock({
				type: "text",
				content: this.stateManager.getAssistantMessage(),
				partial: true,
			})
		}
	}
}
