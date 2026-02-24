// pnpm --filter @coder/vscode-webview test src/components/chat/__tests__/ChatView.tts-streaming.spec.tsx

import React from "react"
import { render, waitFor, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView from "../ChatView"

interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
}

interface ExtensionState {
	version: string
	clineMessages: ClineMessage[]
	taskHistory: any[]
	shouldShowAnnouncement: boolean
	allowedCommands: string[]
	alwaysAllowExecute: boolean
	ttsEnabled?: boolean
	ttsSpeed?: number
	[key: string]: any
}

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [vi.fn()]
	}),
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
	}) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item, index) => (
					<div key={item.ts} data-testid={`virtuoso-item-${index}`}>
						{itemContent(index, item)}
					</div>
				))}
			</div>
		)
	},
}))

vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

vi.mock("../Announcement", () => ({
	default: function MockAnnouncement({ hideAnnouncement }: { hideAnnouncement: () => void }) {
		const React = require("react")
		return React.createElement(
			"div",
			{ "data-testid": "announcement-modal" },
			React.createElement("div", null, "What's New"),
			React.createElement("button", { onClick: hideAnnouncement }, "Close"),
		)
	},
}))

vi.mock("../ChatTextArea", () => {
	const React = require("react")
	const ChatTextAreaComponent = React.forwardRef(function MockChatTextArea(props: any, ref: any) {
		return <div data-testid="chat-text-area">ChatTextArea</div>
	})
	return {
		default: ChatTextAreaComponent,
		ChatTextArea: ChatTextAreaComponent,
	}
})

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: function MockVSCodeButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
		return <button onClick={onClick}>{children}</button>
	},
	VSCodeTextField: function MockVSCodeTextField({ value, onInput }: { value: string; onInput?: (e: any) => void }) {
		return <input type="text" value={value} onChange={onInput} />
	},
	VSCodeLink: function MockVSCodeLink({ children, href }: { children: React.ReactNode; href?: string }) {
		return <a href={href}>{children}</a>
	},
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: Partial<ExtensionState>) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages: [],
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
				ttsEnabled: true,
				ttsSpeed: 1.0,
				...state,
			},
		},
		"*",
	)
}

const queryClient = new QueryClient()

const renderChatView = () => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView isHidden={false} showAnnouncement={false} hideAnnouncement={() => {}} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatView TTS Streaming", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("TTS trigger conditions", () => {
		it("should NOT trigger TTS during streaming (partial message)", async () => {
			renderChatView()

			// Hydrate state with streaming in progress (partial message)
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: true,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now(),
						text: "Streaming content",
						partial: true,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: "playTts" }),
				)
			})
		})

		it("should trigger TTS when streaming completes (transition from streaming to non-streaming)", async () => {
			renderChatView()

			// First: streaming in progress
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: true,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now() - 1000,
						text: "Streaming content",
						partial: true,
					},
				],
			})

			// Then: streaming completes (partial: false)
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now(),
						text: "Complete message content",
						partial: false,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "playTts",
						text: "Complete message content",
					}),
				)
			})
		})

		it("should NOT trigger TTS if wasStreaming was already false (no state transition)", async () => {
			renderChatView()

			// Initial state: not streaming
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now(),
						text: "Static message",
						partial: false,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: "playTts" }),
				)
			})
		})

		it("should strip mermaid diagrams before triggering TTS", async () => {
			renderChatView()

			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now(),
						text: "Here is a diagram:\n```mermaid\ngraph TD;\n    A-->B;\n```\nDone.",
						partial: false,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "playTts",
						text: expect.not.stringContaining("mermaid"),
					}),
				)
			})
		})

		it("should NOT trigger TTS for JSON messages", async () => {
			renderChatView()

			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now(),
						text: '{"key": "value"}',
						partial: false,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: "playTts" }),
				)
			})
		})

		it("should NOT trigger TTS for completion_result during streaming", async () => {
			renderChatView()

			mockPostMessage({
				ttsEnabled: true,
				isStreaming: true,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "completion_result",
						ts: Date.now(),
						text: "Task in progress",
						partial: true,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: "playTts" }),
				)
			})
		})

		it("should trigger TTS for completion_result after streaming completes", async () => {
			renderChatView()

			// First: streaming
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: true,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "completion_result",
						ts: Date.now() - 1000,
						text: "In progress",
						partial: true,
					},
				],
			})

			// Then: streaming completes
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "completion_result",
						ts: Date.now(),
						text: "Task completed successfully",
						partial: false,
					},
				],
			})

			await waitFor(() => {
				expect(vscode.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "playTts",
						text: "Task completed successfully",
					}),
				)
			})
		})

		it("should NOT trigger TTS for duplicate messages", async () => {
			renderChatView()

			// First transition: streaming → completed
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now(),
						text: "Same message",
						partial: false,
					},
				],
			})

			// Wait for first TTS trigger
			await waitFor(() => {
				expect(vscode.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "playTts",
						text: "Same message",
					}),
				)
			})

			// Clear mock
			vi.clearAllMocks()

			// Second update with same message (simulating re-render)
			mockPostMessage({
				ttsEnabled: true,
				isStreaming: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "say",
						say: "text",
						ts: Date.now() + 1000,
						text: "Same message",
						partial: false,
					},
				],
			})

			// Should NOT trigger TTS again for same message
			await waitFor(() => {
				expect(vscode.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: "playTts" }),
				)
			})
		})
	})
})
