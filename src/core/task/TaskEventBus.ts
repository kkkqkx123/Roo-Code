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
} from './types'

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
 * Event queue with backpressure control for TaskEventBus.
 *
 * Provides concurrency-limited event processing to prevent overwhelming subscribers.
 * Events are processed in order with configurable concurrency.
 */
class PooledEventQueue {
  private queue: Array<() => Promise<void>> = []
  private concurrency: number
  private activeCount = 0
  private pendingResolves: Array<() => void> = []

  constructor(concurrency: number = 1) {
    this.concurrency = concurrency
  }

  async add(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          this.activeCount++
          await task()
          resolve()
        } catch (error) {
          reject(error)
        } finally {
          this.activeCount--
          this.tryStartNext()
        }
      }

      this.queue.push(wrappedTask)
      this.tryStartNext()
    })
  }

  private tryStartNext(): void {
    // Check if we can start more tasks
    if (this.queue.length === 0 || this.activeCount >= this.concurrency) {
      // No tasks to process or at concurrency limit
      // Signal idle waiters if queue is empty and no active tasks
      if (this.queue.length === 0 && this.activeCount === 0) {
        this.notifyIdle()
      }
      return
    }

    // Start a new task
    const task = this.queue.shift()
    if (task) {
      // Execute task asynchronously
      task().catch(console.error)
    }
  }

  private notifyIdle(): void {
    while (this.pendingResolves.length > 0) {
      const res = this.pendingResolves.shift()
      if (res) res()
    }
  }

  get size(): number {
    return this.queue.length
  }

  get active(): number {
    return this.activeCount
  }

  clear(): void {
    this.queue.splice(0)
  }

  async onIdle(): Promise<void> {
    // Always wait at least one tick to ensure pending tasks are processed
    await new Promise<void>(resolve => setImmediate(resolve))

    if (this.queue.length === 0 && this.activeCount === 0) {
      return
    }

    return new Promise<void>(resolve => {
      this.pendingResolves.push(resolve)
    })
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
  private queue: PooledEventQueue
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

    this.queue = new PooledEventQueue(this.config.concurrency)

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

      // Emit event and wait for all listeners to complete
      await this.emitAsync(type, data)

      // Also emit generic event for monitoring
      this.emit('*', { type, data, timestamp: Date.now() })
    })
  }

  /**
   * Publish an event without waiting for processing
   *
   * Use this for fire-and-forget events where ordering doesn't matter.
   * The event is queued and will be processed asynchronously.
   *
   * @param type - Event type
   * @param data - Event data
   */
  publishAsync<K extends keyof TaskEventMap>(
    type: K,
    data: TaskEventMap[K]
  ): void {
    // Fire and forget - add to queue but don't wait for completion
    const promise = this.queue.add(async () => {
      if (this.config.enableHistory) {
        this.recordEvent(type, data)
      }
      // Emit event and wait for all listeners to complete
      await this.emitAsync(type, data)
      this.emit('*', { type, data, timestamp: Date.now() })
    })

    // Catch errors to prevent unhandled promise rejection
    promise.catch((error: any) => {
      console.error('[TaskEventBus] Async publish error:', error)
    })
  }

  /**
   * Emit event and wait for all listeners to complete
   */
  private async emitAsync<K extends keyof TaskEventMap>(
    type: K,
    data: TaskEventMap[K]
  ): Promise<void> {
    const listeners = this.listeners(type as string | symbol)
    if (listeners.length === 0) {
      return
    }

    // Wait for all listeners to complete
    await Promise.all(
      listeners.map(listener => Promise.resolve().then(() => listener(data)))
    )
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
    let called = false
    const wrappedHandler = async (data: TaskEventMap[K]) => {
      if (called) return
      called = true
      await handler(data)
      // Unsubscribe after first call
      subscription.unsubscribe()
    }

    const subscription: Subscription = {
      unsubscribe: () => {
        this.off(type, wrappedHandler)
        this.subscriptions.delete(subscription)
          ; (subscription as any)._active = false
      },
      get isActive(): boolean {
        return (subscription as any)._active ?? true
      },
    }

    this.on(type as string, wrappedHandler)
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
   * Note: This only clears pending tasks that haven't started execution.
   * Tasks already being executed will complete.
   */
  clearQueue(): void {
    // Only clear tasks that haven't started execution
    // Tasks already in activeCount will complete
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
