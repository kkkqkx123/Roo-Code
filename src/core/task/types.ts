/**
 * Task Event Types
 *
 * Type definitions for the Task event bus system.
 * Provides type-safe event publishing and subscribing.
 */

import type { GroundingSource } from "../../api/transform/stream"
import type { TokenUsage } from "@coder/types"

/**
 * Token breakdown by category
 */
export interface TokenBreakdown {
  /** Tokens used for text content */
  text: number
  /** Tokens used for reasoning */
  reasoning: number
  /** Tokens used for tool calls */
  toolCalls: number
}

// ============================================================================
// Streaming Events
// ============================================================================

/**
 * Stream start event
 * Emitted when an API request stream begins
 */
export interface StreamStartEvent {
  /** Unique request identifier */
  requestId: string
  /** System prompt sent to the API */
  systemPrompt: string
  /** Conversation messages sent to the API */
  messages: unknown[]
}

/**
 * Stream chunk event
 * Emitted for each chunk received from the API stream
 */
export interface StreamChunkEvent {
  /** Chunk type */
  type: 'text' | 'reasoning' | 'tool_call' | 'usage' | 'grounding'
  /** Chunk-specific data */
  data: TextChunkData | ReasoningChunkData | ToolCallChunkData | UsageChunkData | GroundingChunkData
}

/**
 * Text chunk data
 */
export interface TextChunkData {
  type: 'text'
  text: string
}

/**
 * Reasoning chunk data
 */
export interface ReasoningChunkData {
  type: 'reasoning'
  text: string
}

/**
 * Tool call chunk data
 */
export interface ToolCallChunkData {
  type: 'tool_call'
  id: string
  name: string
  args?: string
  delta?: string
  isStart?: boolean
  isEnd?: boolean
}

/**
 * Usage chunk data
 */
export interface UsageChunkData {
  type: 'usage'
  inputTokens: number
  outputTokens: number
  cacheWriteTokens?: number
  cacheReadTokens?: number
}

/**
 * Grounding chunk data
 */
export interface GroundingChunkData {
  type: 'grounding'
  sources: GroundingSource[]
}

/**
 * Stream complete event
 * Emitted when the API stream completes successfully
 */
export interface StreamCompleteEvent {
  /** Final assistant message text */
  assistantMessage: string
  /** Final reasoning message text */
  reasoningMessage: string
  /** Parsed assistant message content (text + tool calls) */
  assistantMessageContent: unknown[]
  /** Generated user message content (tool results) */
  userMessageContent: unknown[]
  /** Grounding sources if any */
  groundingSources: GroundingSource[]
  /** Token usage statistics */
  tokens: TokenUsage
  /** Whether any tool was called */
  didUseTool: boolean
  /** Whether the stream was rejected by user */
  didRejectTool: boolean
  /** Whether the stream was aborted */
  aborted: boolean
  /** Abort reason if aborted */
  abortReason?: string
  /** Error if the stream failed */
  error?: unknown
}

/**
 * Stream error event
 * Emitted when an error occurs during streaming
 */
export interface StreamErrorEvent {
  /** The error that occurred */
  error: StreamingErrorType
  /** Current retry attempt number */
  retryAttempt: number
  /** Whether the error is retryable */
  isRetryable?: boolean
  /** Suggested retry delay in milliseconds */
  retryDelay?: number
}

// ============================================================================
// Tool Events
// ============================================================================

/**
 * Tool call event (from API response)
 */
export interface ToolCallEvent {
  /** Unique tool call identifier */
  id: string
  /** Tool name */
  name: string
  /** Tool arguments */
  args: Record<string, unknown>
  /** Tool call type */
  type?: 'tool_use' | 'mcp_tool_use'
}

/**
 * Tool call start event
 * Emitted when a tool call begins execution
 */
export interface ToolCallStartEvent {
  /** The tool call being executed */
  toolCall: ToolCallEvent
  /** Timestamp when the tool call started */
  timestamp: number
}

/**
 * Tool call progress event
 * Emitted when a long-running tool reports progress
 */
export interface ToolCallProgressEvent {
  /** Tool call identifier */
  toolCallId: string
  /** Progress status */
  progress: ToolProgressStatus
}

/**
 * Tool progress status
 */
export interface ToolProgressStatus {
  /** Progress percentage (0-100) */
  percentage?: number
  /** Progress message */
  message?: string
  /** Progress details */
  details?: unknown
}

/**
 * Tool result
 */
export interface ToolResult {
  /** Tool call identifier */
  toolCallId: string
  /** Tool execution result (success) */
  result?: unknown
  /** Tool execution error */
  error?: Error
  /** Whether the tool call was successful */
  success: boolean
}

/**
 * Tool call complete event
 * Emitted when a tool call completes (success or error)
 */
export interface ToolCallCompleteEvent {
  /** Tool call identifier */
  toolCallId: string
  /** Tool execution result */
  result: ToolResult
}

/**
 * Tool call error event
 * Emitted when a tool call fails with an error
 */
export interface ToolCallErrorEvent {
  /** Tool call identifier */
  toolCallId: string
  /** The error that occurred */
  error: Error
  /** Whether the error is retryable */
  isRetryable: boolean
}

// ============================================================================
// Token Events
// ============================================================================

/**
 * Token update event
 * Emitted when token counts are updated during streaming
 */
export interface TokenUpdateEvent {
  /** Current token usage */
  tokens: TokenUsage
  /** Detailed token breakdown */
  breakdown: TokenBreakdown
  /** Whether this is the final token count */
  isFinal: boolean
}

// ============================================================================
// Task State Events
// ============================================================================

/**
 * Task state
 */
export type TaskState = 'idle' | 'running' | 'paused' | 'completed' | 'aborted' | 'error'

/**
 * Task state change event
 * Emitted when the task state changes
 */
export interface TaskStateChangeEvent {
  /** Previous state */
  previousState: TaskState
  /** New state */
  newState: TaskState
  /** Timestamp of the state change */
  timestamp: number
  /** Optional reason for the state change */
  reason?: string
}

/**
 * Task abort event
 * Emitted when a task is aborted
 */
export interface TaskAbortEvent {
  /** Abort reason */
  reason: string
  /** Timestamp of the abort */
  timestamp: number
}

// ============================================================================
// Event Map
// ============================================================================

/**
 * Task event map - defines all event types and their data
 *
 * @example
 * ```typescript
 * // Subscribe to a specific event
 * eventBus.subscribe('stream:complete', (data) => {
 *   console.log('Stream completed:', data.assistantMessage)
 * })
 *
 * // Publish an event
 * await eventBus.publish('stream:chunk', {
 *   type: 'text',
 *   data: { text: 'Hello' }
 * })
 * ```
 */
export interface TaskEventMap {
  // Wildcard event (matches all)
  '*': { type: string; data: unknown; timestamp: number }

  // Streaming events
  'stream:start': StreamStartEvent
  'stream:chunk': StreamChunkEvent
  'stream:complete': StreamCompleteEvent
  'stream:error': StreamErrorEvent

  // Tool events
  'tool:call:start': ToolCallStartEvent
  'tool:call:progress': ToolCallProgressEvent
  'tool:call:complete': ToolCallCompleteEvent
  'tool:call:error': ToolCallErrorEvent

  // Token events
  'token:update': TokenUpdateEvent

  // Task state events
  'task:state:change': TaskStateChangeEvent
  'task:abort': TaskAbortEvent
}

/**
 * Union type of all task events
 */
export type TaskEvent =
  | { type: 'stream:start'; data: StreamStartEvent }
  | { type: 'stream:chunk'; data: StreamChunkEvent }
  | { type: 'stream:complete'; data: StreamCompleteEvent }
  | { type: 'stream:error'; data: StreamErrorEvent }
  | { type: 'tool:call:start'; data: ToolCallStartEvent }
  | { type: 'tool:call:progress'; data: ToolCallProgressEvent }
  | { type: 'tool:call:complete'; data: ToolCallCompleteEvent }
  | { type: 'tool:call:error'; data: ToolCallErrorEvent }
  | { type: 'token:update'; data: TokenUpdateEvent }
  | { type: 'task:state:change'; data: TaskStateChangeEvent }
  | { type: 'task:abort'; data: TaskAbortEvent }

// ============================================================================
// Error Types
// ============================================================================

/**
 * Streaming error type
 * Base interface for all streaming errors
 */
export interface StreamingErrorType extends Error {
  /** Error code for programmatic handling */
  code?: string
  /** HTTP status code if applicable */
  status?: number
  /** Whether the error is retryable */
  isRetryable?: boolean
  /** Original error cause */
  cause?: unknown
}

/**
 * Stream aborted error
 */
export interface StreamAbortedError extends StreamingErrorType {
  name: 'StreamAbortedError'
  abortReason: string
}

/**
 * Token error
 */
export interface TokenError extends StreamingErrorType {
  name: 'TokenError'
  estimatedTokens?: number
  actualTokens?: number
}

/**
 * API provider error
 */
export interface ApiProviderError extends StreamingErrorType {
  name: 'ApiProviderError'
  provider: string
  endpoint?: string
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a stream start event
 */
export function isStreamStartEvent(event: unknown): event is StreamStartEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'requestId' in event &&
    'systemPrompt' in event &&
    'messages' in event
  )
}

/**
 * Check if a value is a stream chunk event
 */
export function isStreamChunkEvent(event: unknown): event is StreamChunkEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    'data' in event &&
    ['text', 'reasoning', 'tool_call', 'usage', 'grounding'].includes((event as any).type)
  )
}

/**
 * Check if a value is a stream complete event
 */
export function isStreamCompleteEvent(event: unknown): event is StreamCompleteEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'assistantMessage' in event &&
    'tokens' in event
  )
}

/**
 * Check if a value is a tool call event
 */
export function isToolCallEvent(event: unknown): event is ToolCallEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'id' in event &&
    'name' in event &&
    'args' in event
  )
}

/**
 * Check if a value is a token update event
 */
export function isTokenUpdateEvent(event: unknown): event is TokenUpdateEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'tokens' in event &&
    'breakdown' in event
  )
}
