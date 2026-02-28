import { type ToolName, type TokenUsage, type ToolUsage, type ClineMessage } from "@coder/types"
import { consolidateApiRequests as combineApiRequests, consolidateCommands as combineCommandSequences, consolidateTokenUsage as getApiMetrics } from "@coder/core/browser"
import EventEmitter from "events"
import type { LogEntry } from "../errors/tools/validation-errors.js"

export interface MetricsServiceEvents {
	toolFailed: [taskId: string, toolName: ToolName, error: string | LogEntry]
	tokenUsageUpdated: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
}

/**
 * MetricsService handles all metrics and telemetry operations for a task.
 * Responsibilities include:
 * - Recording tool usage (attempts and failures)
 * - Computing token usage from message history
 * - Combining messages for metric calculation
 * - Emitting tool failure events
 * - Emitting token usage updates (now immediate, no throttling needed)
 * - Managing token usage snapshots for efficient access
 *
 * This service encapsulates metrics logic that was previously mixed with
 * Task's core business logic, improving separation of concerns.
 *
 * NOTE: Throttling has been removed because token updates now only happen
 * after streaming completes, ensuring UI always receives complete data.
 */
export class MetricsService extends EventEmitter<MetricsServiceEvents> {
	private toolUsage: ToolUsage = {}
	private taskId: string
	private tokenUsageSnapshot?: TokenUsage
	private toolUsageSnapshot?: ToolUsage
	private emitCallback: (tokenUsage: TokenUsage, toolUsage: ToolUsage) => void

	constructor(taskId: string, emitCallback: (tokenUsage: TokenUsage, toolUsage: ToolUsage) => void) {
		super()
		this.taskId = taskId
		this.emitCallback = emitCallback
	}

	/**
	 * Check if token usage has changed compared to the snapshot.
	 */
	private hasTokenUsageChanged(tokenUsage: TokenUsage): boolean {
		if (!this.tokenUsageSnapshot) {
			return true
		}
		return (
			tokenUsage.totalTokensIn !== this.tokenUsageSnapshot.totalTokensIn ||
			tokenUsage.totalTokensOut !== this.tokenUsageSnapshot.totalTokensOut
		)
	}

	/**
	 * Check if tool usage has changed compared to the snapshot.
	 */
	private hasToolUsageChanged(toolUsage: ToolUsage): boolean {
		if (!this.toolUsageSnapshot) {
			return true
		}
		return JSON.stringify(toolUsage) !== JSON.stringify(this.toolUsageSnapshot)
	}

	/**
	 * Update snapshots for change detection.
	 */
	private updateSnapshots(tokenUsage: TokenUsage, toolUsage: ToolUsage): void {
		this.tokenUsageSnapshot = tokenUsage
		this.toolUsageSnapshot = JSON.parse(JSON.stringify(toolUsage))
	}

	/**
	 * Emit token usage update immediately.
	 * Throttling has been removed since updates now only happen after streaming completes.
	 * This ensures UI always receives complete and accurate token data.
	 */
	public emitTokenUsageUpdate(tokenUsage: TokenUsage, toolUsage: ToolUsage): void {
		const tokenChanged = this.hasTokenUsageChanged(tokenUsage)
		const toolChanged = this.hasToolUsageChanged(toolUsage)

		if (tokenChanged || toolChanged) {
			this.emitCallback(tokenUsage, toolUsage)
			this.updateSnapshots(tokenUsage, toolUsage)
		}
	}

	/**
	 * Force emit a final token usage update.
	 * Called before task completion or abort to ensure final stats are captured.
	 * Now just calls emitTokenUsageUpdate directly since throttling is removed.
	 */
	public emitFinalTokenUsageUpdate(tokenUsage: TokenUsage, toolUsage: ToolUsage): void {
		this.emitCallback(tokenUsage, toolUsage)
		this.updateSnapshots(tokenUsage, toolUsage)
	}

	/**
	 * Combine messages for metric calculation.
	 * Applies command sequence combining and API request combining.
	 */
	public combineMessages(messages: ClineMessage[]): ClineMessage[] {
		return combineApiRequests(combineCommandSequences(messages))
	}

	/**
	 * Calculate token usage from combined messages.
	 */
	public getTokenUsage(messages: ClineMessage[]): TokenUsage {
		return getApiMetrics(this.combineMessages(messages))
	}

	/**
	 * Record a tool invocation attempt.
	 * Initializes tool usage entry if it doesn't exist.
	 */
	public recordToolUsage(toolName: ToolName): void {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}
		this.toolUsage[toolName].attempts++
	}

	/**
	 * Record a tool execution failure.
	 * Initializes tool usage entry if it doesn't exist.
	 * Emits a failure event if error message is provided.
	 * @param toolName - The name of the tool that failed
	 * @param error - Either an error message string or a structured LogEntry
	 */
	public recordToolError(toolName: ToolName, error?: string | LogEntry): void {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}
		this.toolUsage[toolName].failures++

		if (error) {
			this.emit("toolFailed", this.taskId, toolName, error)
		}
	}

	/**
	 * Get the current tool usage statistics.
	 * Returns a deep copy to prevent external modification of internal state.
	 */
	public getToolUsage(): ToolUsage {
		return JSON.parse(JSON.stringify(this.toolUsage))
	}

	/**
	 * Reset tool usage statistics (useful for testing or when clearing history).
	 */
	public resetToolUsage(): void {
		this.toolUsage = {}
	}

	/**
	 * Update internal toolUsage from external state (used during deserialization).
	 * Useful when loading task state from persistent storage.
	 */
	public setToolUsage(usage: ToolUsage): void {
		this.toolUsage = { ...usage }
	}

	/**
	 * Get the current token usage snapshot.
	 * Returns cached snapshot if available, undefined otherwise.
	 */
	public getTokenUsageSnapshot(): TokenUsage | undefined {
		return this.tokenUsageSnapshot
	}

	/**
	 * Update the token usage snapshot with the provided messages.
	 * This is useful for maintaining an up-to-date snapshot without emitting events.
	 *
	 * @param messages - The messages to calculate token usage from
	 */
	public updateTokenUsageSnapshot(messages: ClineMessage[]): void {
		this.tokenUsageSnapshot = this.getTokenUsage(messages)
	}

	/**
	 * Dispose of the service and remove all listeners.
	 */
	public dispose(): void {
		this.removeAllListeners()
	}
}
