/**
 * Task Event Bus
 *
 * Centralized event bus for Task-related events.
 * Provides decoupled communication between StreamingProcessor, ToolExecutor, and Task.
 *
 * Features:
 * - Backpressure control via PQueue
 * - Event history for debugging/replay
 * - Type-safe event publishing/subscribing
 * - Automatic cleanup on subscription disposal
 *
 * @example
 * ```typescript
 * const eventBus = new TaskEventBus()
 *
 * // Subscribe to events
 * const subscription = eventBus.subscribe('stream:complete', (result) => {
 *   console.log('Stream completed:', result)
 * })
 *
 * // Publish events
 * await eventBus.publish('stream:complete', {
 *   assistantMessage: 'Done!',
 *   tokens: { input: 100, output: 50 }
 * })
 *
 * // Cleanup
 * subscription.unsubscribe()
 * ```
 */

import EventEmitter from 'events'

// Import types
import type {
  TaskEventMap,
  TaskEvent,
  StreamingErrorType,
  ToolCallEvent,
  ToolResult,
  ToolProgressStatus,
  TokenBreakdown,
  TaskState,
} from './types'
import type { StreamingResult } from './streaming/types'
import type { TokenUsage } from '@coder/types'

/**
 * Subscription interface for managing event listeners
 */
export interface Subscription {
  /**
   * Unsubscribe from the event
   */
  unsubscribe(): void

  /**
   * Check if subscription is still active
   */
  readonly isActive: boolean
}

/**
 * Event record for history tracking
 */
interface EventRecord {
  type: string
  data: unknown
  timestamp: number
  sequence: number
}

/**
 * Task Event Bus configuration
 */
export interface TaskEventBusConfig {
  /**
   * Maximum number of events to keep in history
   * @default 1000
   */
  maxHistorySize?: number

  /**
   * Enable event history tracking
   * @default true
   */
  enableHistory?: boolean

  /**
   * Concurrency limit for event processing
   * @default 1 (sequential processing)
   */
  concurrency?: number
}

/**
 * Simple queue for event processing (replaces p-queue dependency)
 */
class SimpleEventQueue {
  private queue: Array<() => Promise<void>> = []
  private processing = false
  private concurrency: number
  private activeCount = 0

  constructor(concurrency: number = 1) {
    this.concurrency = concurrency
  }

  async add(task: () => Promise<void>): Promise<void> {
    // Wait for queue to have room based on concurrency
    while (this.activeCount >= this.concurrency) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.activeCount++
          await task()
          resolve()
        } catch (error) {
          reject(error)
        } finally {
          this.activeCount--
        }
      })
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (task) {
        // Fire and forget for async processing
        task().catch(console.error)
      }
    }

    this.processing = false
  }

  get size(): number {
    return this.queue.length
  }

  get active(): number {
    return this.activeCount
  }

  clear(): void {
    this.queue = []
  }

  async onIdle(): Promise<void> {
    while (this.queue.length > 0 || this.activeCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}

/**
 * Task Event Bus - Centralized event communication hub
 *
 * Provides type-safe, backpressure-controlled event publishing
 * and subscribing for Task-related components.
 */
export class TaskEventBus extends EventEmitter {
  private config: Required<TaskEventBusConfig>
  private queue: SimpleEventQueue
  private eventHistory: EventRecord[]
  private sequenceNumber: number
  private subscriptions: Set<Subscription>

  constructor(config: TaskEventBusConfig = {}) {
    super()

    this.config = {
      maxHistorySize: config.maxHistorySize ?? 1000,
      enableHistory: config.enableHistory ?? true,
      concurrency: config.concurrency ?? 1,
    }

    this.queue = new SimpleEventQueue(this.config.concurrency)

    this.eventHistory = []
    this.sequenceNumber = 0
    this.subscriptions = new Set()

    // Set max listeners to prevent warnings
    this.setMaxListeners(100)
  }

  // ============================================================================
  // Public API - Publishing Events
  // ============================================================================

  /**
   * Publish an event to all subscribers
   *
   * Events are queued with backpressure control to prevent overwhelming subscribers.
   * If history is enabled, events are also recorded for debugging/replay.
   *
   * @param type - Event type
   * @param data - Event data
   * @returns Promise that resolves when event is processed
   *
   * @example
   * ```typescript
   * await eventBus.publish('stream:chunk', {
   *   type: 'text',
   *   data: { text: 'Hello' }
   * })
   * ```
   */
  async publish<K extends keyof TaskEventMap>(
    type: K,
    data: TaskEventMap[K]
  ): Promise<void> {
    return this.queue.add(async () => {
      // Record event in history
      if (this.config.enableHistory) {
        this.recordEvent(type, data)
      }

      // Emit event to subscribers
      this.emit(type, data)

      // Also emit generic event for monitoring
      this.emit('*', { type, data, timestamp: Date.now() })
    })
  }

  /**
   * Publish an event without waiting for processing
   *
   * Use this for fire-and-forget events where ordering doesn't matter.
   *
   * @param type - Event type
   * @param data - Event data
   */
  publishAsync<K extends keyof TaskEventMap>(
    type: K,
    data: TaskEventMap[K]
  ): void {
    this.queue.add(async () => {
      if (this.config.enableHistory) {
        this.recordEvent(type, data)
      }
      this.emit(type, data)
      this.emit('*', { type, data, timestamp: Date.now() })
    }).catch((error: any) => {
      console.error('[TaskEventBus] Async publish error:', error)
    })
  }

  // ============================================================================
  // Public API - Subscribing to Events
  // ============================================================================

  /**
   * Subscribe to an event
   *
   * @param type - Event type to subscribe to
   * @param handler - Event handler function
   * @returns Subscription object for cleanup
   *
   * @example
   * ```typescript
   * const subscription = eventBus.subscribe('stream:complete', (result) => {
   *   console.log('Stream completed:', result)
   * })
   *
   * // Later...
   * subscription.unsubscribe()
   * ```
   */
  subscribe<K extends keyof TaskEventMap>(
    type: K,
    handler: (data: TaskEventMap[K]) => void | Promise<void>
  ): Subscription {
    const subscription: Subscription = {
      unsubscribe: () => {
        this.off(type, handler)
        this.subscriptions.delete(subscription)
          ; (subscription as any)._active = false
      },
      get isActive(): boolean {
        return (subscription as any)._active ?? true
      },
    }

    this.on(type as string, handler)
    this.subscriptions.add(subscription)

    return subscription
  }

  /**
   * Subscribe to an event once
   *
   * @param type - Event type
   * @param handler - Event handler function
   * @returns Subscription object
   */
  subscribeOnce<K extends keyof TaskEventMap>(
    type: K,
    handler: (data: TaskEventMap[K]) => void | Promise<void>
  ): Subscription {
    const subscription: Subscription = {
      unsubscribe: () => {
        this.off(type, handler)
        this.subscriptions.delete(subscription)
          ; (subscription as any)._active = false
      },
      get isActive(): boolean {
        return (subscription as any)._active ?? true
      },
    }

    this.once(type as string, handler)
    this.subscriptions.add(subscription)

    return subscription
  }

  /**
   * Subscribe to all events (wildcard)
   *
   * @param handler - Event handler function
   * @returns Subscription object
   */
  subscribeAll(
    handler: (event: { type: string; data: unknown; timestamp: number }) => void | Promise<void>
  ): Subscription {
    return this.subscribe('*', handler as any)
  }

  // ============================================================================
  // Public API - Event History
  // ============================================================================

  /**
   * Get event history for debugging/replay
   *
   * @param filters - Optional filters
   * @returns Array of event records
   *
   * @example
   * ```typescript
   * // Get all events
   * const history = eventBus.getHistory()
   *
   * // Get only stream events
   * const streamHistory = eventBus.getHistory({ type: 'stream:*' })
   *
   * // Get events since timestamp
   * const recentHistory = eventBus.getHistory({ since: Date.now() - 60000 })
   * ```
   */
  getHistory(filters?: {
    type?: string
    since?: number
    limit?: number
  }): EventRecord[] {
    let history = [...this.eventHistory]

    if (filters) {
      if (filters.type) {
        history = history.filter((record) => record.type.startsWith(filters.type!.replace('*', '')))
      }

      if (filters.since) {
        history = history.filter((record) => record.timestamp >= filters.since!)
      }

      if (filters.limit) {
        history = history.slice(-filters.limit)
      }
    }

    return history
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = []
    this.sequenceNumber = 0
  }

  /**
   * Replay events from history
   *
   * @param handler - Handler to call for each event
   * @param filters - Optional filters
   * @returns Promise that resolves when all events are replayed
   */
  async replayHistory(
    handler: (event: EventRecord) => void | Promise<void>,
    filters?: { type?: string; since?: number }
  ): Promise<void> {
    const history = this.getHistory(filters)

    for (const event of history) {
      await handler(event)
    }
  }

  // ============================================================================
  // Public API - Queue Management
  // ============================================================================

  /**
   * Get the number of pending events in the queue
   */
  get pendingEventCount(): number {
    return this.queue.size
  }

  /**
   * Get the number of active event processors
   */
  get activeProcessorCount(): number {
    return this.queue.active
  }

  /**
   * Wait for all pending events to be processed
   */
  async drain(): Promise<void> {
    await this.queue.onIdle()
  }

  /**
   * Clear the event queue
   */
  clearQueue(): void {
    this.queue.clear()
  }

  // ============================================================================
  // Public API - Cleanup
  // ============================================================================

  /**
   * Remove all subscriptions and clear resources
   */
  dispose(): void {
    // Unsubscribe all subscriptions
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe()
    }
    this.subscriptions.clear()

    // Clear queue
    this.queue.clear()

    // Clear history
    this.clearHistory()

    // Remove all listeners
    this.removeAllListeners()
  }

  /**
   * Get statistics about the event bus
   */
  getStats(): {
    listenerCount: number
    subscriptionCount: number
    pendingEvents: number
    activeProcessors: number
    historySize: number
  } {
    return {
      listenerCount: this.listenerCount('*'),
      subscriptionCount: this.subscriptions.size,
      pendingEvents: this.pendingEventCount,
      activeProcessors: this.activeProcessorCount,
      historySize: this.eventHistory.length,
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Record an event in history
   */
  private recordEvent(type: string, data: unknown): void {
    const record: EventRecord = {
      type,
      data,
      timestamp: Date.now(),
      sequence: ++this.sequenceNumber,
    }

    this.eventHistory.push(record)

    // Trim history if it exceeds max size
    if (this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.config.maxHistorySize)
    }
  }
}

// ============================================================================
// Convenience types for event data
// ============================================================================

/**
 * Stream start event data
 */
export interface StreamStartEvent {
  requestId: string
  systemPrompt: string
  messages: any[]
}

/**
 * Stream chunk event data
 */
export interface StreamChunkEvent {
  type: 'text' | 'reasoning' | 'tool_call' | 'usage' | 'grounding'
  data: unknown
}

/**
 * Tool call start event data
 */
export interface ToolCallStartEvent {
  toolCall: ToolCallEvent
}

/**
 * Tool call progress event data
 */
export interface ToolCallProgressEvent {
  toolCallId: string
  progress: ToolProgressStatus
}

/**
 * Tool call complete event data
 */
export interface ToolCallCompleteEvent {
  toolCallId: string
  result: ToolResult
}

/**
 * Tool call error event data
 */
export interface ToolCallErrorEvent {
  toolCallId: string
  error: Error
}

/**
 * Token update event data
 */
export interface TokenUpdateEvent {
  tokens: TokenUsage
  breakdown: TokenBreakdown
}

/**
 * Task state change event data
 */
export interface TaskStateChangeEvent {
  state: TaskState
}

/**
 * Task abort event data
 */
export interface TaskAbortEvent {
  reason: string
}
