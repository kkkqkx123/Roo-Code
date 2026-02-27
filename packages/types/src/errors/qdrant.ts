/**
 * Qdrant Error Classes
 *
 * Error classes for Qdrant vector database operations.
 * These errors extend HTTP errors for HTTP-related failures
 * and provide specific error types for Qdrant operations.
 */

import { HttpError } from "./http.js"

/**
 * Error thrown when connection to Qdrant server fails.
 * This error is retryable and typically indicates temporary network issues
 * such as ECONNREFUSED, ETIMEDOUT, or ENOTFOUND.
 */
export class QdrantConnectionError extends HttpError {
	constructor(
		message: string = "Failed to connect to Qdrant server.",
		originalError?: Error
	) {
		super(message, 0, undefined, originalError, "QDRANT_CONNECTION_ERROR")
	}
}

/**
 * Error thrown when a Qdrant collection is not found.
 * This error is not retryable and indicates the collection needs to be created.
 */
export class QdrantCollectionNotFoundError extends HttpError {
	constructor(
		public readonly collectionName: string,
		originalError?: Error
	) {
		super(`Collection "${collectionName}" not found`, 404, undefined, originalError, "QDRANT_COLLECTION_NOT_FOUND")
	}
}

/**
 * Error thrown when Qdrant vector dimension mismatch occurs.
 * This error indicates the existing collection has a different vector size
 * than what is required.
 */
export class QdrantVectorDimensionMismatchError extends HttpError {
	constructor(
		public readonly collectionName: string,
		public readonly existingDimension: number,
		public readonly requiredDimension: number,
		originalError?: Error
	) {
		super(
			`Collection "${collectionName}" has vector dimension ${existingDimension}, but ${requiredDimension} is required`,
			400,
			undefined,
			originalError,
			"QDRANT_VECTOR_DIMENSION_MISMATCH"
		)
	}
}

/**
 * Error thrown when Qdrant operation times out.
 */
export class QdrantTimeoutError extends HttpError {
	constructor(
		message: string = "Qdrant operation timed out.",
		public readonly operation: string,
		originalError?: Error
	) {
		super(message, 408, undefined, originalError, "QDRANT_TIMEOUT_ERROR")
	}
}

/**
 * Error thrown when Qdrant quota or resource limit is exceeded.
 */
export class QdrantQuotaExceededError extends HttpError {
	constructor(
		message: string = "Qdrant quota or resource limit exceeded.",
		originalError?: Error
	) {
		super(message, 429, undefined, originalError, "QDRANT_QUOTA_EXCEEDED_ERROR")
	}
}

/**
 * Type guard to check if an error is a Qdrant connection error
 */
export function isQdrantConnectionError(error: unknown): error is QdrantConnectionError {
	return error instanceof QdrantConnectionError
}

/**
 * Type guard to check if an error is a Qdrant collection not found error
 */
export function isQdrantCollectionNotFoundError(error: unknown): error is QdrantCollectionNotFoundError {
	return error instanceof QdrantCollectionNotFoundError
}

/**
 * Union type for all Qdrant errors
 */
export type QdrantError =
	| QdrantConnectionError
	| QdrantCollectionNotFoundError
	| QdrantVectorDimensionMismatchError
	| QdrantTimeoutError
	| QdrantQuotaExceededError
