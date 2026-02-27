/**
 * VSCode Extension Host Module
 *
 * This module provides types for communication between VSCode extension and webview/CLI.
 *
 * Structure:
 * - extension-messages.ts: Extension -> Webview/CLI message types
 * - webview-messages.ts: Webview/CLI -> Extension message types
 * - commands.ts: Command interface
 * - indexing.ts: Indexing status types
 * - cline-types.ts: Cline-specific types (ClineSayTool, ClineApiReqInfo, etc.)
 */

// Extension Messages
export type {
	ExtensionMessageBase,
	ExtensionMessageType,
	ExtensionMessage,
	ExtensionState,
} from "./extension-messages.js"

// Webview Messages
export type {
	ClineAskResponse,
	AudioType,
	UpdateTodoListPayload,
	EditQueuedMessagePayload,
	WebviewMessageBase,
	WebviewMessageType,
	WebviewMessage,
	WebviewInboundMessageType,
	WebviewOutboundMirrorMessageType,
	WebviewInboundMessage,
	WebviewOutboundMirrorMessage,
	CheckpointDiffPayload,
	CheckpointRestorePayload,
	WebViewMessagePayload,
} from "./webview-messages.js"

export {
	checkoutDiffPayloadSchema,
	checkoutRestorePayloadSchema,
} from "./webview-messages.js"

// Commands
export type { Command } from "./commands.js"

// Indexing
export type {
	IndexingStatusPayload,
	IndexClearedPayload,
	IndexingStatus,
	IndexingStatusUpdateMessage,
} from "./indexing.js"

// Cline Types
export type {
	LanguageModelChatSelector,
	ClineSayTool,
	ClineAskUseMcpServer,
	ClineApiReqInfo,
	ClineApiReqCancelReason,
} from "./cline-types.js"