/**
 * Chunk Handler Interfaces and Types
 *
 * Defines the contract for handling different types of stream chunks.
 * Each chunk type (reasoning, text, tool_call, etc.) has its own handler implementation.
 */

import type { ChunkHandlerContext, StreamChunk } from "../types"
import type { DeadLoopDetector } from "../../../../utils/deadLoopDetector"

/**
 * Function type for chunk handlers
 */
export type ChunkHandlerFn = (context: ChunkHandlerContext, chunk: StreamChunk) => Promise<void>

/**
 * Handler function mapping for each chunk type
 */
export interface ChunkHandlerMap {
  reasoning: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "reasoning" }>, deadLoopDetector: DeadLoopDetector) => Promise<void>
  text: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "text" }>) => Promise<void>
  tool_call_partial: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "tool_call_partial" }>) => Promise<void>
  tool_call: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "tool_call" }>) => Promise<void>
  tool_call_start: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "tool_call_start" }>) => Promise<void>
  tool_call_delta: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "tool_call_delta" }>) => Promise<void>
  tool_call_end: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "tool_call_end" }>) => Promise<void>
  usage: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "usage" }>) => Promise<void>
  grounding: (context: ChunkHandlerContext, chunk: Extract<StreamChunk, { type: "grounding" }>) => Promise<void>
}

// Re-export types from types.ts for convenience
export type { ChunkHandlerContext } from "../types"
