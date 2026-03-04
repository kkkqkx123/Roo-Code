// Test for StreamingProcessor blocking issue
// This test verifies that the streaming processor doesn't block on text chunks

import { describe, it, expect, beforeEach, vi } from "vitest"
import { StreamingProcessor } from "../StreamingProcessor"
import { StreamingStateManager } from "../StreamingStateManager"
import { StreamingTokenManager } from "../StreamingTokenManager"
import type { StreamChunk, StreamingProcessorConfig } from "../types"

// Mock API
const createMockApi = () => ({
	getModel: () => ({ id: "test-model", info: {} }),
})

describe("StreamingProcessor - Text Chunk Blocking", () => {
	let processor: StreamingProcessor
	let config: StreamingProcessorConfig
	let onPresentAssistantCalls: number[] = []

	beforeEach(() => {
		onPresentAssistantCalls = []

		config = {
			taskId: "test-task",
			api: createMockApi() as any,
			diffViewProvider: null as any,
			onSay: vi.fn(),
			onUpdateMessage: vi.fn(),
			onAddToHistory: vi.fn(),
			onPresentAssistant: () => {
				onPresentAssistantCalls.push(Date.now())
				// Simulate slow processing (like UI update)
				// Note: This is synchronous in the real code
			},
			eventBus: undefined,
		}

		processor = new StreamingProcessor(config)
	})

	it("should process text chunks without blocking", async () => {
		// Create a stream of 5 text chunks
		async function* textStream(): AsyncGenerator<StreamChunk> {
			for (let i = 0; i < 5; i++) {
				yield { type: "text", text: `Chunk ${i}` }
			}
		}

		const startTime = Date.now()
		await processor.processStream(textStream())
		const endTime = Date.now()
		const totalTime = endTime - startTime

		console.log(`Total processing time: ${totalTime}ms`)
		console.log(`onPresentAssistant calls: ${onPresentAssistantCalls.length}`)

		// All chunks should be processed
		expect(onPresentAssistantCalls.length).toBe(5)
		
		// Should complete quickly (not blocked)
		// Allow more time for test overhead
		expect(totalTime).toBeLessThan(200)
	})

	it("should verify that processLoop processes chunks sequentially", async () => {
		let chunkProcessTimes: number[] = []

		// Create a custom handler that tracks timing
		const originalHandler = config.onPresentAssistant
		config.onPresentAssistant = () => {
			chunkProcessTimes.push(Date.now())
			// Simulate slow synchronous work
			const start = Date.now()
			while (Date.now() - start < 20) {
				// Busy wait for 20ms
			}
		}

		processor = new StreamingProcessor(config)

		async function* textStream(): AsyncGenerator<StreamChunk> {
			for (let i = 0; i < 3; i++) {
				yield { type: "text", text: `Chunk ${i}` }
			}
		}

		const startTime = Date.now()
		await processor.processStream(textStream())
		const endTime = Date.now()
		const totalTime = endTime - startTime

		console.log(`Sequential processing time: ${totalTime}ms`)
		console.log(`Chunk times: ${chunkProcessTimes.join(', ')}`)

		// If sequential: 3 chunks * 20ms = 60ms minimum
		// If parallel: would be ~20-30ms
		expect(totalTime).toBeGreaterThanOrEqual(60) // This proves it's sequential!
	})

	it("CRITICAL: should identify the real blocking point", async () => {
		// This test simulates the real scenario where say() is slow
		let sayCallTimes: Array<{ start: number; end: number }> = []

		config.onSay = async (type: string, text?: string, images?: string[], partial?: boolean) => {
			const start = Date.now()
			// Simulate slow webview update (100ms)
			await new Promise(resolve => setTimeout(resolve, 100))
			const end = Date.now()
			sayCallTimes.push({ start, end })
		}

		processor = new StreamingProcessor(config)

		async function* textStream(): AsyncGenerator<StreamChunk> {
			for (let i = 0; i < 3; i++) {
				yield { type: "text", text: `Chunk ${i}` }
			}
		}

		const startTime = Date.now()
		await processor.processStream(textStream())
		const endTime = Date.now()
		const totalTime = endTime - startTime

		console.log(`Total time with slow say(): ${totalTime}ms`)
		console.log(`Say calls: ${sayCallTimes.length}`)

		// CRITICAL: If onSay is called from onPresentAssistant and awaited,
		// total time would be 3 * 100ms = 300ms
		// If onSay is NOT awaited, total time would be ~100-150ms
		
		// This test will reveal if the blocking is in StreamingProcessor
		// or in the onPresentAssistant chain
		expect(totalTime).toBeLessThan(200) // Should be fast if non-blocking
	})
})
