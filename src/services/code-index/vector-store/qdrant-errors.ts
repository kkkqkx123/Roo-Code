/**
 * Custom error types for Qdrant vector store operations
 *
 * DEPRECATED: These error types are now re-exported from @coder/types.
 * This file is kept for backward compatibility during the migration period.
 * Please update imports to use @coder/types directly.
 *
 * Example migration:
 *   import { QdrantConnectionError } from "./qdrant-errors"
 *   → import { QdrantConnectionError } from "@coder/types"
 */

export {
	QdrantConnectionError,
	QdrantCollectionNotFoundError,
	QdrantVectorDimensionMismatchError,
	QdrantTimeoutError,
	QdrantQuotaExceededError,
	isQdrantConnectionError,
	isQdrantCollectionNotFoundError,
	type QdrantError,
} from "@coder/types"