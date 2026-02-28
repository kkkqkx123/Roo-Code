/**
 * TaskEventBus Tests
 *
 * Unit tests for the Task event bus system.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TaskEventBus } from '../TaskEventBus'
import type { StreamChunkEvent, TokenUpdateEvent } from '../types'

describe('TaskEventBus', () => {
  let eventBus: TaskEventBus

  beforeEach(() => {
    eventBus = new TaskEventBus()
  })

  afterEach(() => {
    eventBus.dispose()
  })

  // ============================================================================
  // Constructor & Configuration
  // ============================================================================

  describe('constructor', () => {
    it('should create event bus with default config', () => {
      const bus = new TaskEventBus()
      expect(bus).toBeDefined()
      bus.dispose()
    })

    it('should create event bus with custom config', () => {
      const bus = new TaskEventBus({
        maxHistorySize: 500,
        enableHistory: false,
        concurrency: 2,
      })
      expect(bus).toBeDefined()
      bus.dispose()
    })

    it('should set max listeners to prevent warnings', () => {
      const bus = new TaskEventBus()
      expect(bus.getMaxListeners()).toBe(100)
      bus.dispose()
    })
  })

  // ============================================================================
  // Publishing Events
  // ============================================================================

  describe('publish', () => {
    it('should publish event to subscribers', async () => {
      const handler = vi.fn()
      eventBus.subscribe('stream:chunk', handler)

      const eventData: StreamChunkEvent = {
        type: 'text',
        data: { type: 'text', text: 'Hello' },
      }

      await eventBus.publish('stream:chunk', eventData)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(eventData)
    })

    it('should publish events in order', async () => {
      const results: string[] = []

      eventBus.subscribe('stream:chunk', (data) => {
        results.push((data.data as any).text)
      })

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'C' } })

      expect(results).toEqual(['A', 'B', 'C'])
    })

    it('should handle async handlers', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      eventBus.subscribe('stream:complete', handler)

      await eventBus.publish('stream:complete', {
        assistantMessage: 'Done',
        reasoningMessage: '',
        assistantMessageContent: [],
        userMessageContent: [],
        groundingSources: [],
        tokens: { totalTokensIn: 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
        didUseTool: false,
        didRejectTool: false,
        aborted: false,
      })

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should emit wildcard event for all events', async () => {
      const wildcardHandler = vi.fn()
      eventBus.subscribe('*', wildcardHandler)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })

      expect(wildcardHandler).toHaveBeenCalledTimes(1)
      expect(wildcardHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stream:chunk',
          timestamp: expect.any(Number),
        })
      )
    })
  })

  describe('publishAsync', () => {
    it('should publish event without waiting', async () => {
      const handler = vi.fn()
      eventBus.subscribe('token:update', handler)

      const eventData: TokenUpdateEvent = {
        tokens: { totalTokensIn: 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
        breakdown: { text: 100, reasoning: 0, toolCalls: 0 },
        isFinal: false,
      }

      eventBus.publishAsync('token:update', eventData)

      // Wait for async processing
      await eventBus.drain()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(eventData)
    })

    it('should handle errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const handler = vi.fn().mockImplementation(async () => {
        throw new Error('Handler error')
      })

      eventBus.subscribe('stream:chunk', handler)

      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })

      await eventBus.drain()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TaskEventBus] Async publish error:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  // ============================================================================
  // Subscribing to Events
  // ============================================================================

  describe('subscribe', () => {
    it('should return subscription object', () => {
      const handler = vi.fn()
      const subscription = eventBus.subscribe('stream:chunk', handler)

      expect(subscription).toBeDefined()
      expect(subscription.isActive).toBe(true)
      expect(typeof subscription.unsubscribe).toBe('function')
    })

    it('should allow unsubscribing', async () => {
      const handler = vi.fn()
      const subscription = eventBus.subscribe('stream:chunk', handler)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      expect(handler).toHaveBeenCalledTimes(1)

      subscription.unsubscribe()
      expect(subscription.isActive).toBe(false)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })
      expect(handler).toHaveBeenCalledTimes(1) // Still 1, not 2
    })

    it('should support multiple subscribers to same event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      eventBus.subscribe('stream:chunk', handler1)
      eventBus.subscribe('stream:chunk', handler2)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('should support subscribing to multiple events', async () => {
      const streamHandler = vi.fn()
      const tokenHandler = vi.fn()

      eventBus.subscribe('stream:chunk', streamHandler)
      eventBus.subscribe('token:update', tokenHandler)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })
      await eventBus.publish('token:update', {
        tokens: { totalTokensIn: 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
        breakdown: { text: 100, reasoning: 0, toolCalls: 0 },
        isFinal: false,
      })

      expect(streamHandler).toHaveBeenCalledTimes(1)
      expect(tokenHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('subscribeOnce', () => {
    it('should subscribe for single event', async () => {
      const handler = vi.fn()
      eventBus.subscribeOnce('stream:chunk', handler)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      expect(handler).toHaveBeenCalledTimes(1) // Only called once
    })
  })

  describe('subscribeAll', () => {
    it('should subscribe to all events', async () => {
      const handler = vi.fn()
      eventBus.subscribeAll(handler)

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('token:update', {
        tokens: { totalTokensIn: 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
        breakdown: { text: 100, reasoning: 0, toolCalls: 0 },
        isFinal: false,
      })

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  // ============================================================================
  // Event History
  // ============================================================================

  describe('event history', () => {
    it('should record events in history', async () => {
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })

      const history = eventBus.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        type: 'stream:chunk',
        data: { type: 'text', data: { type: 'text', text: 'Test' } },
        timestamp: expect.any(Number),
        sequence: 1,
      })
    })

    it('should respect maxHistorySize', async () => {
      const bus = new TaskEventBus({ maxHistorySize: 3 })

      await bus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await bus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })
      await bus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'C' } })
      await bus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'D' } })

      const history = bus.getHistory()
      expect(history).toHaveLength(3)
      expect(history.map((h) => (h.data as any).data.text)).toEqual(['B', 'C', 'D'])

      bus.dispose()
    })

    it('should filter history by type', async () => {
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('token:update', {
        tokens: { totalTokensIn: 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
        breakdown: { text: 100, reasoning: 0, toolCalls: 0 },
        isFinal: false,
      })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      const streamHistory = eventBus.getHistory({ type: 'stream:' })
      expect(streamHistory).toHaveLength(2)

      const tokenHistory = eventBus.getHistory({ type: 'token:' })
      expect(tokenHistory).toHaveLength(1)
    })

    it('should filter history by timestamp', async () => {
      const beforeTime = Date.now()

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })

      const afterTime = Date.now()

      const recentHistory = eventBus.getHistory({ since: afterTime })
      expect(recentHistory).toHaveLength(1)

      const oldHistory = eventBus.getHistory({ since: beforeTime - 1000 })
      expect(oldHistory).toHaveLength(1)
    })

    it('should limit history results', async () => {
      for (let i = 0; i < 10; i++) {
        await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: `Item ${i}` } })
      }

      const limited = eventBus.getHistory({ limit: 5 })
      expect(limited).toHaveLength(5)
      expect(limited.map((h) => (h.data as any).data.text)).toEqual([
        'Item 5',
        'Item 6',
        'Item 7',
        'Item 8',
        'Item 9',
      ])
    })

    it('should clear history', async () => {
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })
      expect(eventBus.getHistory()).toHaveLength(1)

      eventBus.clearHistory()
      expect(eventBus.getHistory()).toHaveLength(0)
    })

    it('should replay history', async () => {
      const handler = vi.fn()

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      await eventBus.replayHistory(handler)

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler.mock.calls[0][0].data).toEqual({ type: 'text', data: { type: 'text', text: 'A' } })
      expect(handler.mock.calls[1][0].data).toEqual({ type: 'text', data: { type: 'text', text: 'B' } })
    })

    it('should not record events when history is disabled', async () => {
      const bus = new TaskEventBus({ enableHistory: false })

      await bus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })

      expect(bus.getHistory()).toHaveLength(0)
      bus.dispose()
    })
  })

  // ============================================================================
  // Queue Management
  // ============================================================================

  describe('queue management', () => {
    it('should track pending events', async () => {
      expect(eventBus.pendingEventCount).toBe(0)

      // Add events without waiting
      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      // Give time for queue to process
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(eventBus.pendingEventCount).toBe(0) // Should be processed by now
    })

    it('should wait for all events to complete with drain', async () => {
      const results: string[] = []

      eventBus.subscribe('stream:chunk', async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        results.push((data.data as any).text)
      })

      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      await eventBus.drain()

      expect(results).toEqual(['A', 'B'])
    })

    it('should clear queue', async () => {
      const handler = vi.fn()
      eventBus.subscribe('stream:chunk', handler)

      // Add slow handler to keep items in queue
      eventBus.subscribe('stream:chunk', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      // Clear queue before items are processed
      eventBus.clearQueue()

      await eventBus.drain()

      // First handler should have been called before clear
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // Cleanup & Disposal
  // ============================================================================

  describe('dispose', () => {
    it('should unsubscribe all subscriptions', async () => {
      const handler = vi.fn()
      const sub1 = eventBus.subscribe('stream:chunk', handler)
      const sub2 = eventBus.subscribe('token:update', handler)

      eventBus.dispose()

      expect(sub1.isActive).toBe(false)
      expect(sub2.isActive).toBe(false)

      // Publishing after dispose should not call handlers
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })
      expect(handler).toHaveBeenCalledTimes(0)
    })

    it('should clear all resources', () => {
      eventBus.subscribe('stream:chunk', vi.fn())
      eventBus.publishAsync('stream:chunk', { type: 'text', data: { type: 'text', text: 'Test' } })

      eventBus.dispose()

      expect(eventBus.getHistory()).toHaveLength(0)
      expect(eventBus.pendingEventCount).toBe(0)
    })

    it('should remove all listeners', () => {
      const handler = vi.fn()
      eventBus.on('custom:event', handler)

      expect(eventBus.listenerCount('custom:event')).toBe(1)

      eventBus.dispose()

      expect(eventBus.listenerCount('custom:event')).toBe(0)
    })
  })

  // ============================================================================
  // Statistics
  // ============================================================================

  describe('getStats', () => {
    it('should return statistics', () => {
      eventBus.subscribe('stream:chunk', vi.fn())
      eventBus.subscribe('token:update', vi.fn())

      const stats = eventBus.getStats()

      expect(stats).toMatchObject({
        subscriptionCount: 2,
        pendingEvents: 0,
        activeProcessors: 0,
        historySize: 0,
      })
    })

    it('should track history size', async () => {
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      const stats = eventBus.getStats()
      expect(stats.historySize).toBe(2)
    })
  })

  // ============================================================================
  // Integration Scenarios
  // ============================================================================

  describe('integration scenarios', () => {
    it('should handle streaming workflow', async () => {
      const events: string[] = []

      eventBus.subscribe('stream:start', () => { events.push('start') })
      // Single subscriber for stream:chunk
      eventBus.subscribe('stream:chunk', () => { events.push('chunk') })
      eventBus.subscribe('stream:complete', () => { events.push('complete') })

      await eventBus.publish('stream:start', {
        requestId: 'req-1',
        systemPrompt: 'Test prompt',
        messages: [],
      })

      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'A' } })
      await eventBus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: 'B' } })

      await eventBus.publish('stream:complete', {
        assistantMessage: 'Done',
        reasoningMessage: '',
        assistantMessageContent: [],
        userMessageContent: [],
        groundingSources: [],
        tokens: { totalTokensIn: 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
        didUseTool: false,
        didRejectTool: false,
        aborted: false,
      })

      expect(events).toEqual(['start', 'chunk', 'chunk', 'complete'])
    })

    it('should handle tool call workflow', async () => {
      const toolEvents: string[] = []

      eventBus.subscribe('tool:call:start', (data) => {
        toolEvents.push(`start:${data.toolCall.name}`)
      })

      eventBus.subscribe('tool:call:complete', (data) => {
        toolEvents.push(`complete:${data.result.toolCallId}`)
      })

      await eventBus.publish('tool:call:start', {
        toolCall: { id: 'tool-1', name: 'read_file', args: { path: 'test.txt' } },
        timestamp: Date.now(),
      })

      await eventBus.publish('tool:call:complete', {
        toolCallId: 'tool-1',
        result: {
          toolCallId: 'tool-1',
          result: { content: 'File content' },
          success: true,
        },
      })

      expect(toolEvents).toEqual(['start:read_file', 'complete:tool-1'])
    })

    it('should handle concurrent event streams', async () => {
      const bus = new TaskEventBus({ concurrency: 3 })

      const tokenEvents: number[] = []
      const streamEvents: string[] = []

      bus.subscribe('token:update', async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        tokenEvents.push(data.tokens.totalTokensIn)
      })

      bus.subscribe('stream:chunk', async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        streamEvents.push((data.data as any).text)
      })

      // Publish concurrent events
      const promises: Promise<void>[] = []

      for (let i = 0; i < 5; i++) {
        promises.push(
          bus.publish('token:update', {
            tokens: { totalTokensIn: i * 100, totalTokensOut: 50, totalCacheWrites: 0, totalCacheReads: 0, totalCost: 0, contextTokens: 0 },
            breakdown: { text: i * 100, reasoning: 0, toolCalls: 0 },
            isFinal: false,
          })
        )

        promises.push(
          bus.publish('stream:chunk', { type: 'text', data: { type: 'text', text: `Chunk ${i}` } })
        )
      }

      await Promise.all(promises)
      await bus.drain()

      expect(tokenEvents).toEqual([0, 100, 200, 300, 400])
      expect(streamEvents).toEqual(['Chunk 0', 'Chunk 1', 'Chunk 2', 'Chunk 3', 'Chunk 4'])

      bus.dispose()
    })
  })
})
