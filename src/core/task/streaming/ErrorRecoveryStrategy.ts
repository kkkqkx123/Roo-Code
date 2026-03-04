/**
 * Error Recovery Strategy
 *
 * Provides unified error recovery logic for streaming processing.
 * Handles retry decisions, backoff calculations, and retry delays.
 *
 * Features:
 * - Configurable retry limits and backoff parameters
 * - Automatic retry-after header support for rate limit errors
 * - Exponential backoff with jitter to avoid thundering herd
 * - Integration with ApiProviderError type system
 */

import type { ApiProviderError } from "@coder/types"
import { isRetryableError } from "@coder/types"

/**
 * Configuration for error recovery strategy
 */
export interface ErrorRecoveryConfig {
	/** Maximum number of retry attempts */
	maxRetries: number
	/** Base delay in milliseconds for exponential backoff */
	baseDelayMs: number
	/** Maximum delay in milliseconds */
	maxDelayMs: number
	/** Multiplier for exponential backoff */
	backoffMultiplier: number
	/** Maximum jitter in milliseconds */
	maxJitterMs: number
}

/**
 * Default configuration for error recovery
 */
const DEFAULT_CONFIG: ErrorRecoveryConfig = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	maxJitterMs: 500,
}

/**
 * Error recovery strategy for streaming processing
 *
 * Provides unified logic for:
 * - Deciding whether to retry based on error type and retry count
 * - Calculating retry delays with exponential backoff and jitter
 * - Applying backoff delays
 *
 * @example
 * ```typescript
 * const strategy = new ErrorRecoveryStrategy({
 *   maxRetries: 5,
 *   baseDelayMs: 2000,
 * })
 *
 * if (strategy.shouldRetry(error, retryCount)) {
 *   await strategy.applyBackoff(retryCount, error)
 *   // Retry the operation
 * }
 * ```
 */
export class ErrorRecoveryStrategy {
	private config: ErrorRecoveryConfig

	constructor(config?: Partial<ErrorRecoveryConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
		}
	}

	/**
	 * Get the current configuration
	 */
	getConfig(): Readonly<ErrorRecoveryConfig> {
		return { ...this.config }
	}

	/**
	 * Update the configuration
	 */
	updateConfig(config: Partial<ErrorRecoveryConfig>): void {
		this.config = {
			...this.config,
			...config,
		}
	}

	/**
	 * Reset retry count (for tracking purposes)
	 * This is a no-op in the strategy itself, but can be used by callers
	 */
	resetRetryCount(): void {
		// No-op - retry tracking is managed by the caller
	}

	/**
	 * Determine if an error should be retried
	 *
	 * @param error - The error that occurred
	 * @param retryCount - Current retry attempt count (0-indexed)
	 * @returns true if the operation should be retried
	 */
	shouldRetry(error: ApiProviderError, retryCount: number): boolean {
		// Check retry limit
		if (retryCount >= this.config.maxRetries) {
			console.warn(
				`[ErrorRecoveryStrategy] Max retries (${this.config.maxRetries}) exceeded`
			)
			return false
		}

		// Use isRetryableError helper from types package
		const isRetryable = isRetryableError(error)

		if (!isRetryable) {
			console.warn(
				`[ErrorRecoveryStrategy] Error is not retryable: ${error.name} (${error.code})`
			)
		}

		return isRetryable
	}

	/**
	 * Calculate retry delay for a given retry attempt
	 *
	 * Uses exponential backoff with jitter:
	 * delay = min(baseDelay * (multiplier ^ retryCount), maxDelay) + random(0, maxJitter)
	 *
	 * Special handling for rate limit errors with retry-after header.
	 *
	 * @param retryCount - Current retry attempt count (0-indexed)
	 * @param error - Optional error that occurred (used for retry-after header)
	 * @returns Delay in milliseconds
	 */
	calculateRetryDelay(retryCount: number, error?: ApiProviderError): number {
		// Use retry-after from rate limit error if available
		if (error && error.statusCode === 429) {
			// Try to get retry-after from RateLimitError
			const retryAfter = (error as any).retryAfter
			if (typeof retryAfter === "number" && retryAfter > 0) {
				const delayMs = retryAfter * 1000
				console.log(
					`[ErrorRecoveryStrategy] Using retry-after header: ${delayMs}ms`
				)
				return delayMs
			}
		}

		// Calculate exponential backoff
		const exponentialDelay = Math.min(
			this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, retryCount),
			this.config.maxDelayMs
		)

		// Add jitter to avoid thundering herd
		const jitter = Math.random() * this.config.maxJitterMs
		const finalDelay = Math.floor(exponentialDelay + jitter)

		console.log(
			`[ErrorRecoveryStrategy] Calculated retry delay: ${finalDelay}ms ` +
				`(exponential: ${exponentialDelay}ms, jitter: ${jitter.toFixed(2)}ms, attempt: ${retryCount})`
		)

		return finalDelay
	}

	/**
	 * Apply backoff delay
	 *
	 * Waits for the calculated delay time, logging the progress.
	 *
	 * @param retryCount - Current retry attempt count (0-indexed)
	 * @param error - Optional error that occurred
	 */
	async applyBackoff(retryCount: number, error?: ApiProviderError): Promise<void> {
		const delay = this.calculateRetryDelay(retryCount, error)

		console.log(
			`[ErrorRecoveryStrategy] Applying backoff: ${delay}ms before retry ${retryCount + 1}/${this.config.maxRetries}`
		)

		// Log additional context if error is provided
		if (error) {
			console.log(
				`[ErrorRecoveryStrategy] Backoff reason: ${error.name} (${error.code}): ${error.message}`
			)
		}

		await new Promise((resolve) => setTimeout(resolve, delay))

		console.log(`[ErrorRecoveryStrategy] Backoff completed, ready to retry`)
	}

	/**
	 * Get remaining retry attempts
	 *
	 * @param retryCount - Current retry attempt count (0-indexed)
	 * @returns Number of remaining retry attempts
	 */
	getRemainingRetries(retryCount: number): number {
		return Math.max(0, this.config.maxRetries - retryCount)
	}

	/**
	 * Check if this is the last retry attempt
	 *
	 * @param retryCount - Current retry attempt count (0-indexed)
	 * @returns true if this is the last retry attempt
	 */
	isLastRetry(retryCount: number): boolean {
		return retryCount === this.config.maxRetries - 1
	}
}

/**
 * Create an error recovery strategy with default configuration
 *
 * Convenience function for creating a strategy with standard settings.
 *
 * @example
 * ```typescript
 * const strategy = createDefaultErrorRecoveryStrategy()
 * ```
 */
export function createDefaultErrorRecoveryStrategy(): ErrorRecoveryStrategy {
	return new ErrorRecoveryStrategy()
}