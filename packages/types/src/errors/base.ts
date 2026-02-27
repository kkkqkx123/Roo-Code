/**
 * Base Error Classes
 *
 * Foundation classes for all application errors.
 */

/**
 * Base error class for all application errors
 */
export abstract class BaseError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly context?: Record<string, unknown>
	) {
		super(message)
		this.name = this.constructor.name
	}
}
