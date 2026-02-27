/**
 * Chunk Handler Interface
 *
 * Defines the contract for handling different types of stream chunks.
 * Each chunk type (reasoning, text, tool_call, etc.) has its own handler implementation.
 */

import type { ChunkHandlerContext, StreamChunk, ChunkHandler as ChunkHandlerInterface } from "../types"

/**
 * Base handler interface for processing stream chunks
 * Note: ChunkHandler interface is defined in ../types.ts
 */

// Re-export the ChunkHandler interface for convenience
export type ChunkHandler = ChunkHandlerInterface

/**
 * Base class for chunk handlers with common functionality
 */
export abstract class BaseChunkHandler implements ChunkHandler {
	protected stateManager: ChunkHandlerContext["stateManager"]
	protected tokenManager: ChunkHandlerContext["tokenManager"]
	protected config: ChunkHandlerContext["config"]

	constructor(context: ChunkHandlerContext) {
		this.stateManager = context.stateManager
		this.tokenManager = context.tokenManager
		this.config = context.config
	}

	/**
	 * Abstract method to be implemented by concrete handlers
	 */
	abstract handle(chunk: StreamChunk): Promise<void>

	/**
	 * Helper method to check if the chunk type matches this handler
	 */
	protected matchesType(chunk: StreamChunk, expectedType: string): boolean {
		return chunk.type === expectedType
	}

	/**
	 * Helper method to log warnings
	 */
	protected warn(message: string): void {
		console.warn(`[ChunkHandler] ${message}`)
	}

	/**
	 * Helper method to log errors
	 */
	protected error(message: string, error?: unknown): void {
		console.error(`[ChunkHandler] ${message}`, error)
	}
}
