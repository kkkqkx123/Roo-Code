import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"

import { OpenAiNativeHandler } from "../openai-native"
import { ApiHandlerOptions } from "../../../shared/api"

const mockResponsesCreate = vi.fn()

vi.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			responses: {
				create: mockResponsesCreate,
			},
		})),
	}
})

function createSseStream(events: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const event of events) {
				controller.enqueue(new TextEncoder().encode(`data: ${event}\n\n`))
			}
			controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
			controller.close()
		},
	})
}

describe("OpenAiNativeHandler tool call streaming", () => {
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "hi" }]
	const options: ApiHandlerOptions = {
		apiModelId: "gpt-5.1",
		openAiNativeApiKey: "test-api-key",
	}

	beforeEach(() => {
		mockResponsesCreate.mockReset()
		mockResponsesCreate.mockRejectedValue(new Error("SDK unavailable"))
	})

	afterEach(() => {
		if ((global as any).fetch) {
			delete (global as any).fetch
		}
	})

	it("emits tool_call_partial from *.done when provider skips delta events", async () => {
		;(global as any).fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSseStream([
				JSON.stringify({
					type: "response.output_item.added",
					item: { type: "function_call", call_id: "call_done_only", name: "read_file" },
				}),
				JSON.stringify({
					type: "response.function_call_arguments.done",
					call_id: "call_done_only",
					name: "read_file",
					arguments: JSON.stringify({ path: "src/index.ts", mode: "slice" }),
				}),
				JSON.stringify({ type: "response.done", response: {} }),
			]),
		})

		const handler = new OpenAiNativeHandler(options)
		const chunks: any[] = []
		for await (const chunk of handler.createMessage(systemPrompt, messages)) {
			chunks.push(chunk)
		}

		const toolChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
		expect(toolChunks).toHaveLength(1)
		expect(toolChunks[0]).toMatchObject({
			type: "tool_call_partial",
			id: "call_done_only",
			name: "read_file",
		})
		expect(String(toolChunks[0]?.arguments)).toContain("\"path\":\"src/index.ts\"")
	})

	it("assigns distinct synthetic indices when multiple calls omit index", async () => {
		;(global as any).fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSseStream([
				JSON.stringify({
					type: "response.output_item.added",
					item: { type: "function_call", call_id: "call_A", name: "search_files" },
				}),
				JSON.stringify({
					type: "response.function_call_arguments.delta",
					call_id: "call_A",
					name: "search_files",
					delta: "{\"path\":\".\",\"regex\":\"global-agent\"}",
				}),
				JSON.stringify({
					type: "response.output_item.added",
					item: { type: "function_call", call_id: "call_B", name: "read_file" },
				}),
				JSON.stringify({
					type: "response.function_call_arguments.delta",
					call_id: "call_B",
					name: "read_file",
					delta: "{\"path\":\"src/types/global-agent.d.ts\",\"mode\":\"slice\"}",
				}),
				JSON.stringify({ type: "response.done", response: {} }),
			]),
		})

		const handler = new OpenAiNativeHandler(options)
		const chunks: any[] = []
		for await (const chunk of handler.createMessage(systemPrompt, messages)) {
			chunks.push(chunk)
		}

		const toolChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
		expect(toolChunks).toHaveLength(2)
		const indices = new Set(toolChunks.map((chunk) => chunk.index))
		expect(indices.size).toBe(2)
	})
})

