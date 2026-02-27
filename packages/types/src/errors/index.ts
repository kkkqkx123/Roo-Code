/**
 * Unified Error Exports
 *
 * This file re-exports all error classes and types from the errors directory.
 * Import from this file to access all error-related functionality.
 */

// Base error classes
export { BaseError } from "./base.js"

// HTTP errors
export {
	HttpError,
	Http401Error,
	Http403Error,
	Http404Error,
	Http400Error,
	Http422Error,
	Http429Error,
	Http408Error,
	Http5xxError,
	HttpConnectionError,
	isHttpError,
	getHttpStatusCode,
	getRequestId,
} from "./http.js"

// Streaming errors
export {
	StreamingError,
	InvalidStreamError,
	ChunkHandlerError,
	StreamAbortedError,
	ToolCallError,
	TokenError,
	UserInterruptError,
	ToolInterruptError,
	StreamProviderError,
	StreamTimeoutError,
	StateError,
	StreamingRetryError,
	isStreamingError,
	type StreamingErrorType,
} from "./streaming.js"

// API Provider errors
export {
	ApiProviderError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	ConnectionError,
	RequestTimeoutError,
	BadRequestError,
	PermissionDeniedError,
	NotFoundError,
	UnprocessableEntityError,
	isApiProviderError,
	type ApiProviderErrorType,
} from "./api-provider.js"

// Qdrant errors
export {
	QdrantConnectionError,
	QdrantCollectionNotFoundError,
	QdrantVectorDimensionMismatchError,
	QdrantTimeoutError,
	QdrantQuotaExceededError,
	isQdrantConnectionError,
	isQdrantCollectionNotFoundError,
	type QdrantError,
} from "./qdrant.js"

// Utility functions
export {
	isRetryableError,
	getErrorCode,
	getErrorContext,
	type ErrorHandlingResult,
} from "./utils.js"
