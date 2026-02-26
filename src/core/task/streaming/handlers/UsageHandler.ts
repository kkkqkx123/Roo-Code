/**
 * Usage Handler
 * 
 * Handles usage chunks from the streaming API.
 * Accumulates token usage information (input, output, cache tokens, and cost).
 */

import { BaseChunkHandler } from "./ChunkHandler"
import type { ChunkHandlerContext, StreamChunk } from "../types"

export class UsageHandler extends BaseChunkHandler {
	/**
	 * Handle usage stream chunks
	 */
	async handle(chunk: StreamChunk): Promise<void> {
		if (!this.matchesType(chunk, "usage")) {
			return
		}

		// Accumulate tokens
		this.tokenManager.addApiUsage(
			chunk.inputTokens,
			chunk.outputTokens,
			chunk.cacheWriteTokens ?? 0,
			chunk.cacheReadTokens ?? 0,
			chunk.totalCost
		)
	}
}
