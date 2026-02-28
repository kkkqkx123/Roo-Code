/**
 * Tool Call Handler
 *
 * Handles tool call chunks from the streaming API.
 * Supports both partial (streaming) and complete tool calls.
 * Manages incremental updates of tool call parameters.
 */

import { NativeToolCallParser } from "../../../assistant-message/NativeToolCallParser"
import type { ChunkHandlerContext, StreamChunk, ToolCallEvent } from "../types"
import type { ToolName } from "../../../../shared/tools"

/**
 * Handle tool call stream chunks
 */
export async function handleToolCallChunk(
  context: ChunkHandlerContext,
  chunk: StreamChunk
): Promise<void> {
  if (chunk.type === "tool_call_partial") {
    await handleToolCallPartial(context, chunk)
  } else if (chunk.type === "tool_call") {
    await handleCompleteToolCall(context, chunk)
  } else if (chunk.type === "tool_call_start") {
    await handleDirectToolCallStart(context, chunk)
  } else if (chunk.type === "tool_call_delta") {
    await handleDirectToolCallDelta(context, chunk)
  } else if (chunk.type === "tool_call_end") {
    await handleDirectToolCallEnd(context, chunk)
  }
}

/**
 * Handle partial tool call chunks (streaming)
 */
async function handleToolCallPartial(
  context: ChunkHandlerContext,
  chunk: Extract<StreamChunk, { type: "tool_call_partial" }>
): Promise<void> {
  const events = NativeToolCallParser.processRawChunk({
    index: chunk.index,
    id: chunk.id,
    name: chunk.name,
    arguments: chunk.arguments,
  })

  for (const event of events) {
    switch (event.type) {
      case "tool_call_start":
        await handleToolCallStart(context, event)
        break
      case "tool_call_delta":
        await handleToolCallDelta(context, event)
        break
      case "tool_call_end":
        await handleToolCallEnd(context, event)
        break
    }
  }
}

/**
 * Handle tool_call_start event
 */
async function handleToolCallStart(
  context: ChunkHandlerContext,
  event: Extract<ToolCallEvent, { type: "tool_call_start" }>
): Promise<void> {
  // Prevent duplicate tool call start events
  if (context.stateManager.getToolCallIndex(event.id) !== undefined) {
    console.warn(
      `[Task#${context.config.taskId}] Ignoring duplicate tool_call_start for ID: ${event.id} (tool: ${event.name})`
    )
    return
  }

  // Initialize streaming tool call
  NativeToolCallParser.startStreamingToolCall(event.id, event.name as ToolName)

  // Track tool call tokens
  context.tokenManager.addToolCallTokens(event.id, event.name, "")

  // Complete previous text block
  completePreviousTextBlock(context)

  // Record tool call index
  const toolUseIndex = context.stateManager.getAssistantMessageContent().length
  context.stateManager.addToolCallIndex(event.id, toolUseIndex)

  // Create partial tool use
  const partialToolUse: any = {
    type: "tool_use",
    name: event.name,
    params: {},
    partial: true,
  }
  partialToolUse.id = event.id

  context.stateManager.addAssistantContentBlock(partialToolUse)

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish tool call start event
  await context.eventBus?.publish('tool:call:start', {
    toolCall: {
      id: event.id,
      name: event.name,
      args: {},
      type: 'tool_use',
    },
    timestamp: Date.now(),
  })
}

/**
 * Handle tool_call_delta event
 */
async function handleToolCallDelta(
  context: ChunkHandlerContext,
  event: Extract<ToolCallEvent, { type: "tool_call_delta" }>
): Promise<void> {
  const partialToolUse = NativeToolCallParser.processStreamingChunk(event.id, event.delta)

  if (!partialToolUse) {
    return
  }

  const toolUseIndex = context.stateManager.getToolCallIndex(event.id)

  if (toolUseIndex === undefined) {
    return
  }

  ;(partialToolUse as any).id = event.id
  context.stateManager.updateAssistantContentBlock(toolUseIndex, partialToolUse)

  // Update tool call token count
  if (partialToolUse.name) {
    context.tokenManager.addToolCallTokens(
      event.id,
      partialToolUse.name,
      JSON.stringify(partialToolUse.params || {})
    )
  }

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish tool call progress event
  await context.eventBus?.publish('tool:call:progress', {
    toolCallId: event.id,
    progress: {
      percentage: undefined,
      message: undefined,
      details: {
        delta: event.delta,
        params: partialToolUse.params,
      },
    },
  })
}

/**
 * Handle tool_call_end event
 */
async function handleToolCallEnd(
  context: ChunkHandlerContext,
  event: Extract<ToolCallEvent, { type: "tool_call_end" }>
): Promise<void> {
  const finalToolUse = NativeToolCallParser.finalizeStreamingToolCall(event.id)
  const toolUseIndex = context.stateManager.getToolCallIndex(event.id)

  if (finalToolUse) {
    ;(finalToolUse as any).id = event.id

    if (toolUseIndex !== undefined) {
      context.stateManager.updateAssistantContentBlock(toolUseIndex, finalToolUse)
    }

    context.stateManager.removeToolCallIndex(event.id)
  } else if (toolUseIndex !== undefined) {
    // JSON format error or missing parameters
    const existingToolUse = context.stateManager.getAssistantMessageContent()[toolUseIndex]

    if (existingToolUse && existingToolUse.type === "tool_use") {
      existingToolUse.partial = false
      ;(existingToolUse as any).id = event.id
    }

    context.stateManager.removeToolCallIndex(event.id)
  }

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish tool call complete event
  await context.eventBus?.publish('tool:call:complete', {
    toolCallId: event.id,
    result: {
      toolCallId: event.id,
      result: finalToolUse,
      success: true,
    },
  })
}

/**
 * Handle direct tool_call_start chunk (from AI SDK)
 */
async function handleDirectToolCallStart(
  context: ChunkHandlerContext,
  chunk: Extract<StreamChunk, { type: "tool_call_start" }>
): Promise<void> {
  // Prevent duplicate tool call start events
  if (context.stateManager.getToolCallIndex(chunk.id) !== undefined) {
    console.warn(
      `[Task#${context.config.taskId}] Ignoring duplicate tool_call_start for ID: ${chunk.id} (tool: ${chunk.name})`
    )
    return
  }

  // Initialize streaming tool call
  NativeToolCallParser.startStreamingToolCall(chunk.id, chunk.name as ToolName)

  // Track tool call tokens
  const beforeTokens = context.tokenManager.getTotalEstimatedTokens()
  context.tokenManager.addToolCallTokens(chunk.id, chunk.name, "")
  const afterTokens = context.tokenManager.getTotalEstimatedTokens()
  const delta = afterTokens - beforeTokens
  const breakdown = context.tokenManager.getTokenBreakdown()

  if (delta !== 0) {
    console.log(
      `[ToolCallHandler#handleDirectToolCallStart] id=${chunk.id} name=${chunk.name} | delta=${delta} | total=${afterTokens} | ` +
      `breakdown{text:${breakdown.text},reasoning:${breakdown.reasoning},toolCalls:${breakdown.toolCalls}}`
    )
  }

  // Complete previous text block
  completePreviousTextBlock(context)

  // Record tool call index
  const toolUseIndex = context.stateManager.getAssistantMessageContent().length
  context.stateManager.addToolCallIndex(chunk.id, toolUseIndex)

  // Create partial tool use
  const partialToolUse: any = {
    type: "tool_use",
    name: chunk.name,
    params: {},
    partial: true,
  }
  partialToolUse.id = chunk.id

  context.stateManager.addAssistantContentBlock(partialToolUse)

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish tool call start event
  await context.eventBus?.publish('tool:call:start', {
    toolCall: {
      id: chunk.id,
      name: chunk.name,
      args: {},
      type: 'tool_use',
    },
    timestamp: Date.now(),
  })
}

/**
 * Handle direct tool_call_delta chunk (from AI SDK)
 */
async function handleDirectToolCallDelta(
  context: ChunkHandlerContext,
  chunk: Extract<StreamChunk, { type: "tool_call_delta" }>
): Promise<void> {
  const toolUseIndex = context.stateManager.getToolCallIndex(chunk.id)

  if (toolUseIndex === undefined) {
    console.warn(
      `[Task#${context.config.taskId}] Received tool_call_delta without tool_call_start for ID: ${chunk.id}`
    )
    return
  }

  // Parse the delta as JSON to get parameters
  let paramsUpdate: any = {}
  try {
    // Try to parse the delta as JSON
    const parsed = JSON.parse(chunk.delta)
    paramsUpdate = parsed
  } catch {
    // If not valid JSON, accumulate as partial JSON string
    // Get existing tool use and append delta
    const existingToolUse = context.stateManager.getAssistantMessageContent()[toolUseIndex]
    if (existingToolUse && existingToolUse.type === "tool_use") {
      const currentParams = existingToolUse.params || {}
      const currentParamsStr = JSON.stringify(currentParams)
      const newParamsStr = currentParamsStr + chunk.delta

      try {
        paramsUpdate = JSON.parse(newParamsStr)
      } catch {
        // Still incomplete JSON, store as is
        existingToolUse.params = currentParams
        context.config.onPresentAssistant()
        return
      }
    }
  }

  // Update the tool use with parsed parameters
  const existingToolUse = context.stateManager.getAssistantMessageContent()[toolUseIndex]
  if (existingToolUse && existingToolUse.type === "tool_use") {
    existingToolUse.params = { ...existingToolUse.params, ...paramsUpdate }
    context.stateManager.updateAssistantContentBlock(toolUseIndex, existingToolUse)

    // Update tool call token count
    const beforeTokens = context.tokenManager.getTotalEstimatedTokens()
    context.tokenManager.addToolCallTokens(
      chunk.id,
      existingToolUse.name,
      JSON.stringify(existingToolUse.params || {})
    )
    const afterTokens = context.tokenManager.getTotalEstimatedTokens()
    const delta = afterTokens - beforeTokens
    const breakdown = context.tokenManager.getTokenBreakdown()

    if (delta !== 0) {
      console.log(
        `[ToolCallHandler#handleDirectToolCallDelta] id=${chunk.id} name=${existingToolUse.name} | delta=${delta} | total=${afterTokens} | ` +
        `breakdown{text:${breakdown.text},reasoning:${breakdown.reasoning},toolCalls:${breakdown.toolCalls}}`
      )
    }
  }

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish tool call progress event
  await context.eventBus?.publish('tool:call:progress', {
    toolCallId: chunk.id,
    progress: {
      percentage: undefined,
      message: undefined,
      details: {
        delta: chunk.delta,
        params: paramsUpdate,
      },
    },
  })
}

/**
 * Handle direct tool_call_end chunk (from AI SDK)
 */
async function handleDirectToolCallEnd(
  context: ChunkHandlerContext,
  chunk: Extract<StreamChunk, { type: "tool_call_end" }>
): Promise<void> {
  const toolUseIndex = context.stateManager.getToolCallIndex(chunk.id)

  if (toolUseIndex === undefined) {
    console.warn(
      `[Task#${context.config.taskId}] Received tool_call_end without tool_call_start for ID: ${chunk.id}`
    )
    return
  }

  // Finalize the tool use
  const existingToolUse = context.stateManager.getAssistantMessageContent()[toolUseIndex]
  if (existingToolUse && existingToolUse.type === "tool_use") {
    existingToolUse.partial = false
    ;(existingToolUse as any).id = chunk.id
    context.stateManager.updateAssistantContentBlock(toolUseIndex, existingToolUse)
  }

  context.stateManager.removeToolCallIndex(chunk.id)

  // Present assistant message
  context.config.onPresentAssistant()

  // Publish tool call complete event
  await context.eventBus?.publish('tool:call:complete', {
    toolCallId: chunk.id,
    result: {
      toolCallId: chunk.id,
      result: existingToolUse,
      success: true,
    },
  })
}

/**
 * Handle complete tool call chunks (non-streaming, backward compatibility)
 */
async function handleCompleteToolCall(
  context: ChunkHandlerContext,
  chunk: Extract<StreamChunk, { type: "tool_call" }>
): Promise<void> {
  // Backward compatibility: handle complete tool calls
  const toolUse = NativeToolCallParser.parseToolCall({
    id: chunk.id,
    name: chunk.name as ToolName,
    arguments: chunk.arguments,
  })

  if (!toolUse) {
    console.error(`Failed to parse tool call for task ${context.config.taskId}:`, chunk)
    return
  }

  ;(toolUse as any).id = chunk.id
  context.stateManager.addAssistantContentBlock(toolUse)

  // Present assistant message
  context.config.onPresentAssistant()
}

/**
 * Complete the previous text block if it exists
 */
function completePreviousTextBlock(context: ChunkHandlerContext): void {
  const lastBlock = context.stateManager.getAssistantMessageContent().at(-1)

  if (lastBlock?.type === "text" && lastBlock.partial) {
    lastBlock.partial = false
  }
}

/**
 * Finalize a specific tool call (called when stream ends without explicit end event)
 */
export async function finalizeToolCall(
  context: ChunkHandlerContext,
  toolCallId: string
): Promise<void> {
  await handleToolCallEnd(context, { type: "tool_call_end", id: toolCallId })
}
