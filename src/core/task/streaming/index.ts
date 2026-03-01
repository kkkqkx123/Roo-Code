/**
 * Streaming Module
 *
 * Exports all streaming processing components for easy import.
 */

// Core types
export type {
	StreamChunk,
	ToolCallEvent,
	GroundingSource,
	ClineMessage,
	ApiMessage,
	TokenUsage,
	TokenBreakdown,
	StreamingResult,
	ErrorHandlingResult,
	StreamingProcessorConfig,
	ApiHandler,
	DiffViewProvider,
	ChunkHandlerContext,
} from "./types"

export { StreamingRetryError } from "./types"

// Core components
export { StreamingProcessor } from "./StreamingProcessor"
export { StreamingStateManager } from "./StreamingStateManager"
export { StreamingTokenManager, type ApiProtocol, type StreamingTokenManagerConfig } from "./StreamingTokenManager"
export { StreamingErrorHandler } from "./StreamingErrorHandler"

// Token estimation
export { InputTokenEstimator, createInputTokenEstimator } from "./InputTokenEstimator"
export type { InputTokenEstimationInput, InputTokenEstimationResult } from "./InputTokenEstimator"

// Handler functions
export { handleReasoningChunk } from "./handlers/ReasoningHandler"
export { handleTextChunk } from "./handlers/TextHandler"
export { handleToolCallChunk, finalizeToolCall } from "./handlers/ToolCallHandler"
export { handleUsageChunk } from "./handlers/UsageHandler"
export { handleGroundingChunk } from "./handlers/GroundingHandler"

// Handler types
export type { ChunkHandlerFn, ChunkHandlerMap } from "./handlers/ChunkHandler"
