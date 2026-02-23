/**
 * Custom error types for Qdrant vector store operations
 * These errors allow precise differentiation between different types of failures
 */

/**
 * Error thrown when connection to Qdrant server fails
 * This error is retryable and typically indicates temporary network issues
 */
export class QdrantConnectionError extends Error {
	constructor(message: string, public readonly originalError?: Error) {
		super(message)
		this.name = "QdrantConnectionError"
		Object.setPrototypeOf(this, QdrantConnectionError.prototype)
	}
}

/**
 * Error thrown when a Qdrant collection is not found
 * This error is not retryable and indicates the collection needs to be created
 */
export class QdrantCollectionNotFoundError extends Error {
	constructor(collectionName: string) {
		super(`Collection "${collectionName}" not found`)
		this.name = "QdrantCollectionNotFoundError"
		Object.setPrototypeOf(this, QdrantCollectionNotFoundError.prototype)
	}
}