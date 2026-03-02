/**
 * Tool response types
 *
 * This module contains types related to tool responses and progress.
 */

import type { ClineAsk, ToolProgressStatus } from "./message.js"

/**
 * Callback type for asking user approval before executing a tool.
 */
export type AskApproval = (
	type: ClineAsk,
	partialMessage?: string,
	progressStatus?: ToolProgressStatus,
	forceApproval?: boolean,
) => Promise<boolean>

/**
 * Callback type for handling errors that occur during tool execution.
 */
export type HandleError = (action: string, error: Error) => Promise<void>

/**
 * Callback type for pushing tool results to the output.
 */
export type PushToolResult = (content: string | Array<any>) => void

/**
 * Tool response type - can be a simple string or an array of text/image blocks.
 */
export type ToolResponse = string | Array<any>
