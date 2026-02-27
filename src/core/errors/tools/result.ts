/**
 * Tool Execution Result Types
 *
 * Provides a structured way to handle batch tool operations where multiple
 * items may succeed or fail independently. This allows LLM to see all
 * errors at once rather than processing them one by one.
 *
 * Design Goals:
 * 1. Collect multiple errors in batch operations
 * 2. Generate unified reports for LLM consumption
 * 3. Provide structured logging entries
 * 4. Maintain type safety for success values
 */

import type { LogEntry } from "./validation-errors.js"
import type { ToolError } from "./index.js"

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a batch tool operation.
 * Tracks both successful results and errors independently.
 *
 * @template T - The type of successful result values
 *
 * @example
 * ```typescript
 * const result = createToolResult<FileContent>()
 *
 * files.forEach(file => {
 *   try {
 *     const content = readFile(file)
 *     result.successes.push({ path: file, content })
 *   } catch (e) {
 *     result.errors.push(new FileNotFoundToolError("read_file", file))
 *   }
 * })
 *
 * if (result.hasErrors()) {
 *   task.recordToolErrors(result.toLogEntries())
 *   pushToolResult(result.toLLMReport())
 * }
 * ```
 */
export interface ToolExecutionResult<T> {
	/**
	 * Successfully processed items.
	 */
	readonly successes: T[]

	/**
	 * Errors that occurred during processing.
	 */
	readonly errors: ToolError[]

	/**
	 * Check if any errors occurred.
	 */
	hasErrors(): boolean

	/**
	 * Check if any items were processed successfully.
	 */
	hasSuccesses(): boolean

	/**
	 * Check if the result is completely empty (no successes, no errors).
	 */
	isEmpty(): boolean

	/**
	 * Get the total count of processed items (successes + errors).
	 */
	totalCount(): number

	/**
	 * Generate a unified error report for LLM consumption.
	 * Includes all errors with suggestions in a readable format.
	 */
	toLLMReport(): string

	/**
	 * Generate a brief summary for LLM (useful for token optimization).
	 */
	toLLMSummary(): string

	/**
	 * Generate log entries for all errors.
	 * Used for telemetry and logging systems.
	 */
	toLogEntries(): LogEntry[]

	/**
	 * Map success values to a new type.
	 * Errors are preserved unchanged.
	 */
	map<U>(fn: (value: T) => U): ToolExecutionResult<U>

	/**
	 * Filter successful values.
	 */
	filter(predicate: (value: T) => boolean): ToolExecutionResult<T>

	/**
	 * Get the success rate as a percentage.
	 */
	successRate(): number
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an empty tool execution result.
 */
export function createToolResult<T>(): MutableToolExecutionResult<T>

/**
 * Create a tool execution result with initial values.
 */
export function createToolResult<T>(
	successes: T[],
	errors: ToolError[]
): ToolExecutionResult<T>

export function createToolResult<T>(
	successes: T[] = [],
	errors: ToolError[] = []
): ToolExecutionResult<T> {
	return new ToolExecutionResultImpl<T>(successes, errors)
}

/**
 * Create a tool execution result from a single success.
 */
export function toolResultSuccess<T>(value: T): ToolExecutionResult<T> {
	return createToolResult([value], [])
}

/**
 * Create a tool execution result from a single error.
 */
export function toolResultError<T>(error: ToolError): ToolExecutionResult<T> {
	return createToolResult<T>([], [error])
}

/**
 * Create a tool execution result from multiple errors.
 */
export function toolResultErrors<T>(errors: ToolError[]): ToolExecutionResult<T> {
	return createToolResult<T>([], errors)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Merge multiple tool execution results into one.
 */
export function mergeToolResults<T>(
	...results: ToolExecutionResult<T>[]
): ToolExecutionResult<T> {
	return createToolResult(
		results.flatMap((r) => r.successes),
		results.flatMap((r) => r.errors)
	)
}

/**
 * Partition an array of items into successes and errors using a transformation function.
 * Useful for batch processing with automatic error collection.
 *
 * @example
 * ```typescript
 * const result = partitionResults(
 *   files,
 *   (file) => {
 *     const content = fs.readFileSync(file, 'utf-8')
 *     return { path: file, content }
 *   },
 *   (file, error) => new FileNotFoundToolError("read_file", file)
 * )
 * ```
 */
export function partitionResults<T, R>(
	items: T[],
	process: (item: T) => R,
	mapError: (item: T, error: unknown) => ToolError
): ToolExecutionResult<R> {
	const successes: R[] = []
	const errors: ToolError[] = []

	for (const item of items) {
		try {
			successes.push(process(item))
		} catch (e) {
			errors.push(mapError(item, e))
		}
	}

	return createToolResult(successes, errors)
}

/**
 * Async version of partitionResults.
 */
export async function partitionResultsAsync<T, R>(
	items: T[],
	process: (item: T) => Promise<R>,
	mapError: (item: T, error: unknown) => ToolError
): Promise<ToolExecutionResult<R>> {
	const successes: R[] = []
	const errors: ToolError[] = []

	for (const item of items) {
		try {
			successes.push(await process(item))
		} catch (e) {
			errors.push(mapError(item, e))
		}
	}

	return createToolResult(successes, errors)
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Mutable version for building results incrementally.
 * Use this when processing items one by one.
 */
export interface MutableToolExecutionResult<T> extends ToolExecutionResult<T> {
	/**
	 * Add a successful result.
	 */
	addSuccess(value: T): void

	/**
	 * Add an error.
	 */
	addError(error: ToolError): void

	/**
	 * Convert to immutable result.
	 */
	toImmutable(): ToolExecutionResult<T>
}

/**
 * Create a mutable tool execution result for incremental building.
 */
export function createMutableToolResult<T>(): MutableToolExecutionResult<T> {
	const successes: T[] = []
	const errors: ToolError[] = []

	return {
		get successes() {
			return successes
		},
		get errors() {
			return errors
		},
		hasErrors() {
			return errors.length > 0
		},
		hasSuccesses() {
			return successes.length > 0
		},
		isEmpty() {
			return successes.length === 0 && errors.length === 0
		},
		totalCount() {
			return successes.length + errors.length
		},
		toLLMReport(): string {
			return createToolResult(successes, errors).toLLMReport()
		},
		toLLMSummary(): string {
			return createToolResult(successes, errors).toLLMSummary()
		},
		toLogEntries(): LogEntry[] {
			return errors.map((e) => e.toLogEntry())
		},
		map<U>(fn: (value: T) => U): ToolExecutionResult<U> {
			return createToolResult(successes.map(fn), errors)
		},
		filter(predicate: (value: T) => boolean): ToolExecutionResult<T> {
			return createToolResult(successes.filter(predicate), errors)
		},
		successRate(): number {
			const total = successes.length + errors.length
			return total === 0 ? 0 : Math.round((successes.length / total) * 100)
		},
		addSuccess(value: T) {
			successes.push(value)
		},
		addError(error: ToolError) {
			errors.push(error)
		},
		toImmutable() {
			return createToolResult([...successes], [...errors])
		},
	}
}

/**
 * Internal implementation of ToolExecutionResult.
 */
class ToolExecutionResultImpl<T> implements ToolExecutionResult<T> {
	constructor(
		private readonly _successes: T[],
		private readonly _errors: ToolError[]
	) {}

	get successes(): T[] {
		return this._successes
	}

	get errors(): ToolError[] {
		return this._errors
	}

	hasErrors(): boolean {
		return this._errors.length > 0
	}

	hasSuccesses(): boolean {
		return this._successes.length > 0
	}

	isEmpty(): boolean {
		return this._successes.length === 0 && this._errors.length === 0
	}

	totalCount(): number {
		return this._successes.length + this._errors.length
	}

	toLLMReport(): string {
		const parts: string[] = []

		// Success summary
		if (this._successes.length > 0) {
			parts.push(`✅ Successfully processed ${this._successes.length} item(s).`)
		}

		// Error details
		if (this._errors.length > 0) {
			parts.push(`\n❌ Errors (${this._errors.length}):`)
			parts.push("")

			this._errors.forEach((error, index) => {
				const payload = error.toLLMMessage()
				const num = index + 1

				parts.push(`${num}. [${payload.error_class || "Error"}] ${payload.message}`)

				if (payload.suggestion) {
					parts.push(`   💡 Suggestion: ${payload.suggestion}`)
				}

				// Add path if available (for file operations)
				if (payload.path) {
					parts.push(`   📁 Path: ${payload.path}`)
				}

				parts.push("")
			})
		}

		// Summary if mixed results
		if (this._successes.length > 0 && this._errors.length > 0) {
			const rate = Math.round((this._successes.length / this.totalCount()) * 100)
			parts.push(`📊 Success rate: ${rate}%`)
		}

		return parts.join("\n").trim()
	}

	toLLMSummary(): string {
		if (this.isEmpty()) {
			return "No items processed."
		}

		if (this._errors.length === 0) {
			return `All ${this._successes.length} item(s) processed successfully.`
		}

		if (this._successes.length === 0) {
			return `All ${this._errors.length} item(s) failed.`
		}

		return `Processed ${this.totalCount()} items: ${this._successes.length} succeeded, ${this._errors.length} failed.`
	}

	toLogEntries(): LogEntry[] {
		return this._errors.map((error) => error.toLogEntry())
	}

	map<U>(fn: (value: T) => U): ToolExecutionResult<U> {
		return new ToolExecutionResultImpl<U>(
			this._successes.map(fn),
			this._errors
		)
	}

	filter(predicate: (value: T) => boolean): ToolExecutionResult<T> {
		return new ToolExecutionResultImpl<T>(
			this._successes.filter(predicate),
			this._errors
		)
	}

	successRate(): number {
		if (this.totalCount() === 0) return 0
		return Math.round((this._successes.length / this.totalCount()) * 100)
	}
}

// ============================================================================
// Format Helpers
// ============================================================================

/**
 * Format options for LLM reports.
 */
export interface LLMReportOptions {
	/** Include detailed error messages */
	includeDetails: boolean
	/** Include suggestions for each error */
	includeSuggestions: boolean
	/** Include paths for file operations */
	includePaths: boolean
	/** Maximum number of errors to include (0 = all) */
	maxErrors: number
}

const DEFAULT_REPORT_OPTIONS: LLMReportOptions = {
	includeDetails: true,
	includeSuggestions: true,
	includePaths: true,
	maxErrors: 0,
}

/**
 * Generate a customized LLM report with specific formatting options.
 */
export function formatLLMReport<T>(
	result: ToolExecutionResult<T>,
	options: Partial<LLMReportOptions> = {}
): string {
	const opts = { ...DEFAULT_REPORT_OPTIONS, ...options }
	const parts: string[] = []

	// Success summary
	if (result.successes.length > 0) {
		parts.push(`Successfully processed ${result.successes.length} item(s).`)
	}

	// Error details
	if (result.errors.length > 0) {
		const errorsToShow = opts.maxErrors > 0 ? result.errors.slice(0, opts.maxErrors) : result.errors

		parts.push(`\nErrors (${result.errors.length}):`)

		errorsToShow.forEach((error, index) => {
			const payload = error.toLLMMessage()
			let errorLine = `${index + 1}. ${payload.message}`

			if (opts.includePaths && payload.path) {
				errorLine += ` (path: ${payload.path})`
			}

			parts.push(errorLine)

			if (opts.includeSuggestions && payload.suggestion) {
				parts.push(`   Suggestion: ${payload.suggestion}`)
			}
		})

		if (opts.maxErrors > 0 && result.errors.length > opts.maxErrors) {
			parts.push(`... and ${result.errors.length - opts.maxErrors} more errors.`)
		}
	}

	return parts.join("\n")
}
