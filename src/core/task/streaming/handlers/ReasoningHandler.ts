/**
 * Reasoning Handler
 * 
 * Handles reasoning message chunks from the streaming API.
 * Includes dead loop detection to prevent infinite loops in reasoning.
 */

import { DeadLoopDetector } from "../../../utils/deadLoopDetector"
import { BaseChunkHandler } from "./ChunkHandler"
import type { ChunkHandlerContext, StreamChunk } from "../types"

export class ReasoningHandler extends BaseChunkHandler {
	private deadLoopDetector: DeadLoopDetector

	constructor(context: ChunkHandlerContext) {
		super(context)
		this.deadLoopDetector = new DeadLoopDetector()
	}

	/**
	 * Handle reasoning stream chunks
	 */
	async handle(chunk: StreamChunk): Promise<void> {
		if (!this.matchesType(chunk, "reasoning")) {
			return
		}

		// Accumulate reasoning message
		this.stateManager.appendReasoningMessage(chunk.text)

		// Accumulate tokens
		this.tokenManager.addReasoningTokens(chunk.text)

		// Format reasoning message for display
		const formattedReasoning = this.formatReasoningMessage(
			this.stateManager.getReasoningMessage()
		)

		// Dead loop detection
		const detectionResult = this.deadLoopDetector.detect(
			this.stateManager.getReasoningMessage()
		)

		if (detectionResult.detected) {
			await this.handleDeadLoop(detectionResult)
			return
		}

		// Display reasoning message
		await this.config.onSay("reasoning", formattedReasoning, undefined, true)
	}

	/**
	 * Format reasoning message for better readability
	 * Adds line breaks before headings that follow sentence endings
	 */
	private formatReasoningMessage(message: string): string {
		if (message.includes("**")) {
			return message.replace(/([.!?])\*\*([^*\n]+)\*\*/g, "$1\n\n**$2**")
		}
		return message
	}

	/**
	 * Handle dead loop detection
	 * Aborts the stream and notifies the user
	 */
	private async handleDeadLoop(result: { detected: boolean; details?: string }): Promise<void> {
		const errorMessage = `检测到死循环：${result.details}。任务已终止，请尝试重新描述任务或调整提示词。`

		await this.config.onSay("error", errorMessage)

		this.stateManager.setAborted(true, "streaming_failed")

		throw new Error(errorMessage)
	}

	/**
	 * Reset the dead loop detector
	 */
	resetDeadLoopDetector(): void {
		this.deadLoopDetector.reset()
	}
}
