/**
 * StreamingProcessor Tests
 *
 * Unit tests for the StreamingProcessor class.
 * Focuses on the critical fix for stream:complete event synchronization.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { StreamingProcessor } from '../StreamingProcessor'
import { TaskEventBus } from '../../TaskEventBus'
import type { StreamingProcessorConfig, StreamChunk } from '../types'

// Mock API handler
const createMockApiHandler = () => ({
	getModel: () => ({ id: 'test-model', info: { contextWindow: 128000, maxTokens: 4096 } }),
	countTokens: vi.fn().mockResolvedValue(100),
})

// Mock diff view provider
const createMockDiffViewProvider = () => ({
	isEditing: false,
	reset: vi.fn().mockResolvedValue(undefined),
	revertChanges: vi.fn().mockResolvedValue(undefined),
})

// Create a mock stream from chunks
async function* createMockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
	for (const chunk of chunks) {
		yield chunk
	}
}

describe('StreamingProcessor', () => {
	let eventBus: TaskEventBus
	let processor: StreamingProcessor
	let config: StreamingProcessorConfig

	beforeEach(() => {
		eventBus = new TaskEventBus()

		config = {
			taskId: 'test-task-id',
			api: createMockApiHandler() as any,
			diffViewProvider: createMockDiffViewProvider() as any,
			onSay: vi.fn().mockResolvedValue(undefined),
			onUpdateMessage: vi.fn().mockResolvedValue(undefined),
			onSaveMessages: vi.fn().mockResolvedValue(undefined),
			onAddToHistory: vi.fn().mockResolvedValue(undefined),
			onPresentAssistant: vi.fn(),
			eventBus,
		}

		processor = new StreamingProcessor(config)
	})

	afterEach(() => {
		eventBus.dispose()
	})

	// ============================================================================
	// CRITICAL: stream:complete Event Synchronization Tests
	// ============================================================================

	describe('CRITICAL: stream:complete event synchronization', () => {
		it('should wait for stream:complete listeners to complete before returning', async () => {
			// This is the CRITICAL test for the fix
			// The bug was: publishAsync didn't wait for listeners
			// The fix: use publish (not publishAsync) and await it

			let listenerCompleted = false
			let listenerStarted = false

			// Subscribe to stream:complete with an async handler
			eventBus.subscribe('stream:complete', async (result) => {
				listenerStarted = true
				// Simulate slow listener (e.g., setting didCompleteReadingStream)
				await new Promise((resolve) => setTimeout(resolve, 100))
				listenerCompleted = true
			})

			// Create a simple stream
			const stream = createMockStream([
				{ type: 'text', text: 'Hello' },
				{ type: 'text', text: ' World' },
			])

			// Process the stream
			const result = await processor.processStream(stream)

			// CRITICAL ASSERTION: The listener should have completed
			// If this fails, it means buildResult didn't wait for the listener
			expect(listenerStarted).toBe(true)
			expect(listenerCompleted).toBe(true)

			// Result should be valid
			expect(result.assistantMessage).toBe('Hello World')
			expect(result.aborted).toBe(false)
		})

		it('should ensure didCompleteReadingStream is set before tool execution', async () => {
			// This simulates the real scenario from Task.ts
			// where didCompleteReadingStream must be set before tools execute

			let didCompleteReadingStream = false

			// Simulate Task's stream:complete listener
			eventBus.subscribe('stream:complete', async (result) => {
				// Simulate the delay in setting didCompleteReadingStream
				await new Promise((resolve) => setTimeout(resolve, 50))
				didCompleteReadingStream = true
			})

			const stream = createMockStream([{ type: 'text', text: 'Test' }])

			// Process stream
			await processor.processStream(stream)

			// After processStream returns, didCompleteReadingStream should be set
			expect(didCompleteReadingStream).toBe(true)
		})

		it('should handle multiple stream:complete listeners in order', async () => {
			const executionOrder: string[] = []

			// Add multiple listeners
			eventBus.subscribe('stream:complete', async () => {
				await new Promise((resolve) => setTimeout(resolve, 30))
				executionOrder.push('listener1')
			})

			eventBus.subscribe('stream:complete', async () => {
				await new Promise((resolve) => setTimeout(resolve, 20))
				executionOrder.push('listener2')
			})

			eventBus.subscribe('stream:complete', async () => {
				await new Promise((resolve) => setTimeout(resolve, 10))
				executionOrder.push('listener3')
			})

			const stream = createMockStream([{ type: 'text', text: 'Test' }])

			await processor.processStream(stream)

			// All listeners should have completed
			expect(executionOrder).toHaveLength(3)
			expect(executionOrder).toContain('listener1')
			expect(executionOrder).toContain('listener2')
			expect(executionOrder).toContain('listener3')
		})

		it('should pass correct result data in stream:complete event', async () => {
			let capturedResult: any = null

			eventBus.subscribe('stream:complete', async (result) => {
				capturedResult = result
			})

			const stream = createMockStream([
				{ type: 'text', text: 'Hello ' },
				{ type: 'text', text: 'World' },
			])

			await processor.processStream(stream)

			// Verify the result passed to listeners
			expect(capturedResult).not.toBeNull()
			expect(capturedResult.assistantMessage).toBe('Hello World')
			expect(capturedResult.didUseTool).toBe(false)
			expect(capturedResult.didRejectTool).toBe(false)
			expect(capturedResult.aborted).toBe(false)
		})
	})

	// ============================================================================
	// buildResult Method Tests
	// ============================================================================

	describe('buildResult method', () => {
		it('should build result with correct assistant message', async () => {
			const stream = createMockStream([
				{ type: 'text', text: 'First ' },
				{ type: 'text', text: 'Second ' },
				{ type: 'text', text: 'Third' },
			])

			const result = await processor.processStream(stream)

			expect(result.assistantMessage).toBe('First Second Third')
		})

		it('should build result with tool usage flag', async () => {
			// Use tool_call_start and tool_call_end for complete tool call flow
			const stream = createMockStream([
				{ type: 'text', text: 'Using tool...' },
				{
					type: 'tool_call_start',
					id: 'tool-1',
					name: 'read_file',
				},
				{
					type: 'tool_call_delta',
					id: 'tool-1',
					args: '{"path": "/test.txt"}',
				},
				{
					type: 'tool_call_end',
					id: 'tool-1',
				},
			])

			const result = await processor.processStream(stream)

			expect(result.didUseTool).toBe(true)
		})

		it('should build result with rejection flag', async () => {
			// Create a stream that will be rejected
			const stream = createMockStream([{ type: 'text', text: 'Test' }])

			// Manually set rejection state before processing completes
			// This simulates the state being set during stream processing
			eventBus.subscribe('stream:chunk', async () => {
				// Set rejection during streaming
				const stateManager = processor.getStateManager()
				stateManager.setDidRejectTool(true)
			})

			const result = await processor.processStream(stream)

			expect(result.didRejectTool).toBe(true)
			expect(result.assistantMessage).toContain('[Response interrupted by user feedback]')
		})

		it('should build result with error information', async () => {
			// Create a stream that will error
			async function* errorStream(): AsyncIterable<StreamChunk> {
				yield { type: 'text', text: 'Start' }
				throw new Error('Stream error')
			}

			const result = await processor.processStream(errorStream())

			expect(result.error).not.toBeNull()
			expect(result.assistantMessage).toBe('Start')
		})

		it('should include token information in result', async () => {
			const stream = createMockStream([
				{ type: 'text', text: 'Test message' },
				{
					type: 'usage',
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 10,
					cacheReadTokens: 5,
				},
			])

			const result = await processor.processStream(stream)

			expect(result.tokens).toBeDefined()
			expect(result.tokens.input).toBe(100)
			expect(result.tokens.output).toBe(50)
		})
	})

	// ============================================================================
	// Event Publishing Tests
	// ============================================================================

	describe('event publishing', () => {
		it('should publish stream:start event', async () => {
			let startEventCalled = false

			eventBus.subscribe('stream:start', async () => {
				startEventCalled = true
			})

			const stream = createMockStream([{ type: 'text', text: 'Test' }])

			await processor.processStream(stream)

			expect(startEventCalled).toBe(true)
		})

		it('should publish stream:chunk events for text', async () => {
			const chunks: any[] = []

			eventBus.subscribe('stream:chunk', async (chunk) => {
				// Only collect text chunks
				if (chunk.type === 'text') {
					chunks.push(chunk)
				}
			})

			const stream = createMockStream([
				{ type: 'text', text: 'A' },
				{ type: 'text', text: 'B' },
				{ type: 'text', text: 'C' },
			])

			await processor.processStream(stream)

			// Note: TextHandler publishes stream:chunk, and StreamingProcessor.handleChunk
			// also publishes it, so we get 2 events per text chunk (6 total)
			// This is expected behavior - both layers publish the event
			expect(chunks.length).toBeGreaterThanOrEqual(3)
			
			// Verify the unique text values
			const textValues = [...new Set(chunks.map(c => c.data.text))]
			expect(textValues).toContain('A')
			expect(textValues).toContain('B')
			expect(textValues).toContain('C')
		})

		it('should publish stream:complete event with full result', async () => {
			let completeEvent: any = null

			eventBus.subscribe('stream:complete', async (result) => {
				completeEvent = result
			})

			const stream = createMockStream([
				{ type: 'text', text: 'Hello ' },
				{ type: 'text', text: 'World' },
			])

			await processor.processStream(stream)

			expect(completeEvent).not.toBeNull()
			expect(completeEvent.assistantMessage).toBe('Hello World')
		})
	})

	// ============================================================================
	// Integration Tests
	// ============================================================================

	describe('integration scenarios', () => {
		it('should handle complete streaming workflow', async () => {
			const events: string[] = []

			eventBus.subscribe('stream:start', async () => events.push('start'))
			eventBus.subscribe('stream:chunk', async (chunk) => {
				// Only track text chunks to avoid noise
				if (chunk.type === 'text') {
					events.push('chunk')
				}
			})
			eventBus.subscribe('stream:complete', async () => events.push('complete'))

			const stream = createMockStream([
				{ type: 'text', text: 'A' },
				{ type: 'text', text: 'B' },
			])

			await processor.processStream(stream)

			// Verify event order
			// Note: We get multiple chunk events per text chunk (from both TextHandler and StreamingProcessor)
			expect(events[0]).toBe('start')
			expect(events[events.length - 1]).toBe('complete')
			
			// Should have at least 2 chunk events (one per text chunk, possibly more)
			const chunkEvents = events.filter(e => e === 'chunk')
			expect(chunkEvents.length).toBeGreaterThanOrEqual(2)
		})

		it('should handle abort during streaming', async () => {
			const abortController = new AbortController()

			let aborted = false
			eventBus.subscribe('stream:complete', async (result) => {
				aborted = result.aborted
			})

			// Create a stream that we'll abort
			async function* abortableStream(): AsyncIterable<StreamChunk> {
				yield { type: 'text', text: 'Start' }
				await new Promise((resolve) => setTimeout(resolve, 10))
				abortController.abort()
				yield { type: 'text', text: 'Should not appear' }
			}

			const result = await processor.processStream(abortableStream(), abortController)

			expect(result.aborted).toBe(true)
		})

		it('should handle reasoning chunks', async () => {
			const stream = createMockStream([
				{ type: 'reasoning', text: 'Thinking...' },
				{ type: 'text', text: 'Answer' },
			])

			const result = await processor.processStream(stream)

			expect(result.reasoningMessage).toBe('Thinking...')
			expect(result.assistantMessage).toBe('Answer')
		})

		it('should handle grounding sources', async () => {
			const stream = createMockStream([
				{ type: 'text', text: 'Based on search results...' },
				{
					type: 'grounding',
					sources: [
						{ id: '1', title: 'Source 1', url: 'https://example.com/1' },
						{ id: '2', title: 'Source 2', url: 'https://example.com/2' },
					],
				},
			])

			const result = await processor.processStream(stream)

			expect(result.groundingSources).toHaveLength(2)
			expect(result.groundingSources[0].title).toBe('Source 1')
		})
	})

	// ============================================================================
	// Error Handling Tests
	// ============================================================================

	describe('error handling', () => {
		it('should handle stream errors gracefully', async () => {
			async function* errorStream(): AsyncIterable<StreamChunk> {
				yield { type: 'text', text: 'Before error' }
				throw new Error('Stream failed')
			}

			const result = await processor.processStream(errorStream())

			expect(result.error).not.toBeNull()
			expect(result.assistantMessage).toBe('Before error')
		})

		it('should still publish stream:complete on error', async () => {
			let completePublished = false

			eventBus.subscribe('stream:complete', async () => {
				completePublished = true
			})

			async function* errorStream(): AsyncIterable<StreamChunk> {
				yield { type: 'text', text: 'Test' }
				throw new Error('Error')
			}

			await processor.processStream(errorStream())

			expect(completePublished).toBe(true)
		})

		it('should wait for stream:complete listener even on error', async () => {
			let listenerCompleted = false

			eventBus.subscribe('stream:complete', async () => {
				await new Promise((resolve) => setTimeout(resolve, 50))
				listenerCompleted = true
			})

			async function* errorStream(): AsyncIterable<StreamChunk> {
				yield { type: 'text', text: 'Test' }
				throw new Error('Error')
			}

			await processor.processStream(errorStream())

			// CRITICAL: Even on error, the listener should complete
			expect(listenerCompleted).toBe(true)
		})
	})

	// ============================================================================
	// Performance Tests
	// ============================================================================

	describe('performance', () => {
		it('should not add significant delay from event synchronization', async () => {
			const stream = createMockStream([{ type: 'text', text: 'Test' }])

			const startTime = Date.now()
			await processor.processStream(stream)
			const endTime = Date.now()

			// Should complete quickly (less than 200ms for simple stream)
			expect(endTime - startTime).toBeLessThan(200)
		})

		it('should handle large streams efficiently', async () => {
			// Create a large stream
			const chunks: StreamChunk[] = []
			for (let i = 0; i < 100; i++) {
				chunks.push({ type: 'text', text: `Chunk ${i} ` })
			}

			const stream = createMockStream(chunks)

			const startTime = Date.now()
			const result = await processor.processStream(stream)
			const endTime = Date.now()

			expect(result.assistantMessage).toContain('Chunk 0')
			expect(result.assistantMessage).toContain('Chunk 99')
			// Should handle 100 chunks in reasonable time
			expect(endTime - startTime).toBeLessThan(1000)
		})
	})
})
