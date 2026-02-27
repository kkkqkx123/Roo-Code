/**
 * Grounding Handler
 *
 * Handles grounding chunks from the streaming API.
 * Stores citation sources separately to avoid state persistence issues.
 */

import { BaseChunkHandler } from "./ChunkHandler"
import type { ChunkHandlerContext, StreamChunk } from "../types"

export class GroundingHandler extends BaseChunkHandler {
	/**
	 * Handle grounding stream chunks
	 */
	async handle(chunk: StreamChunk): Promise<void> {
		if (chunk.type !== "grounding") {
			return
		}

		// Store grounding sources separately to avoid state persistence issues
		if (chunk.sources && chunk.sources.length > 0) {
			this.stateManager.addGroundingSources(chunk.sources)
		}
	}
}
