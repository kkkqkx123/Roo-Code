import { QdrantClient, Schemas } from "@qdrant/js-client-rest"
import { AxiosError } from "axios"
import { createHash } from "crypto"
import * as path from "path"
import { v5 as uuidv5 } from "uuid"
import { IVectorStore, IndexMetadata } from "../interfaces/vector-store"
import { Payload, VectorStoreSearchResult } from "../interfaces"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE, QDRANT_CODE_BLOCK_NAMESPACE } from "../constants"
import { t } from "../../../i18n"
import { VectorStorageConfigManager } from "../vector-storage-config-manager"
import { QdrantConnectionError, QdrantCollectionNotFoundError } from "@coder/types"

/**
 * Qdrant implementation of the vector store interface
 */
export class QdrantVectorStore implements IVectorStore {
	private readonly vectorSize!: number
	private readonly DISTANCE_METRIC = "Cosine"

	private client: QdrantClient
	private readonly collectionName: string
	private readonly qdrantUrl: string = "http://localhost:6333"
	private readonly workspacePath: string
	private vectorStorageConfigManager?: VectorStorageConfigManager

	/**
	 * Creates a new Qdrant vector store
	 * @param workspacePath Path to the workspace
	 * @param url Optional URL to the Qdrant server
	 * @param vectorSize Size of the embedding vectors
	 * @param apiKey Optional API key for Qdrant
	 * @param vectorStorageConfigManager Optional vector storage configuration manager
	 */
	constructor(
		workspacePath: string,
		url: string,
		vectorSize: number,
		apiKey?: string,
		vectorStorageConfigManager?: VectorStorageConfigManager,
	) {
		// Parse the URL to determine the appropriate QdrantClient configuration
		const parsedUrl = this.parseQdrantUrl(url)

		// Store the resolved URL for our property
		this.qdrantUrl = parsedUrl
		this.workspacePath = workspacePath

		try {
			const urlObj = new URL(parsedUrl)

			// Always use host-based configuration with explicit ports to avoid QdrantClient defaults
			let port: number
			let useHttps: boolean

			if (urlObj.port) {
				// Explicit port specified - use it and determine protocol
				port = Number(urlObj.port)
				useHttps = urlObj.protocol === "https:"
			} else {
				// No explicit port - use protocol defaults
				if (urlObj.protocol === "https:") {
					port = 443
					useHttps = true
				} else {
					// http: or other protocols default to port 80
					port = 80
					useHttps = false
				}
			}

			this.client = new QdrantClient({
				host: urlObj.hostname,
				https: useHttps,
				port: port,
				prefix: urlObj.pathname === "/" ? undefined : urlObj.pathname.replace(/\/+$/, ""),
				apiKey,
				headers: {
					"User-Agent": "coder",
				},
			})
		} catch (urlError) {
			// If URL parsing fails, fall back to URL-based config
			// Note: This fallback won't correctly handle prefixes, but it's a last resort for malformed URLs.
			this.client = new QdrantClient({
				url: parsedUrl,
				apiKey,
				headers: {
					"User-Agent": "coder",
				},
			})
		}

		// Generate collection name from workspace path
		const hash = createHash("sha256").update(workspacePath).digest("hex")
		this.vectorSize = vectorSize
		this.collectionName = `ws-${hash.substring(0, 16)}`
		this.vectorStorageConfigManager = vectorStorageConfigManager
	}

	/**
	 * Parses and normalizes Qdrant server URLs to handle various input formats
	 * @param url Raw URL input from user
	 * @returns Properly formatted URL for QdrantClient
	 */
	private parseQdrantUrl(url: string | undefined): string {
		// Handle undefined/null/empty cases
		if (!url || url.trim() === "") {
			return "http://localhost:6333"
		}

		const trimmedUrl = url.trim()

		// Check if it starts with a protocol
		if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://") && !trimmedUrl.includes("://")) {
			// No protocol - treat as hostname
			return this.parseHostname(trimmedUrl)
		}

		try {
			// Attempt to parse as complete URL - return as-is, let constructor handle ports
			const parsedUrl = new URL(trimmedUrl)
			return trimmedUrl
		} catch {
			// Failed to parse as URL - treat as hostname
			return this.parseHostname(trimmedUrl)
		}
	}

	/**
	 * Handles hostname-only inputs
	 * @param hostname Raw hostname input
	 * @returns Properly formatted URL with http:// prefix
	 */
	private parseHostname(hostname: string): string {
		if (hostname.includes(":")) {
			// Has port - add http:// prefix if missing
			return hostname.startsWith("http") ? hostname : `http://${hostname}`
		} else {
			// No port - add http:// prefix without port (let constructor handle port assignment)
			return `http://${hostname}`
		}
	}

	private async getCollectionInfo(): Promise<Schemas["CollectionInfo"]> {
		try {
			const response = await this.client.getCollection(this.collectionName)
			return response as Schemas["CollectionInfo"]
		} catch (error) {
			if (error instanceof AxiosError) {
				if (error.response?.status === 404) {
					throw new QdrantCollectionNotFoundError(this.collectionName)
				}
				if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
					throw new QdrantConnectionError(
						`Failed to connect to Qdrant: ${error.message}`,
						error,
					)
				}
			}
			throw error
		}
	}

	/**
	 * Retry mechanism with exponential backoff for connection errors
	 * @param operation The async operation to retry
	 * @param maxRetries Maximum number of retry attempts (default: 3)
	 * @param initialDelay Initial delay in milliseconds (default: 1000)
	 * @returns Promise resolving to the operation result
	 */
	private async retryWithBackoff<T>(
		operation: () => Promise<T>,
		maxRetries: number = 3,
		initialDelay: number = 1000,
	): Promise<T> {
		let lastError: unknown

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await operation()
			} catch (error) {
				lastError = error

				if (error instanceof QdrantConnectionError) {
					if (attempt < maxRetries) {
						const delay = initialDelay * Math.pow(2, attempt)
						console.log(
							`[QdrantVectorStore] Connection error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`,
						)
						await new Promise((resolve) => setTimeout(resolve, delay))
						continue
					}
				}

				throw error
			}
		}

		throw lastError || new Error("Retry failed")
	}

	/**
	 * Initializes the vector store
	 * @returns Promise resolving to boolean indicating if a new collection was created
	 */
	async initialize(): Promise<boolean> {
		let created = false
		try {
			let collectionInfo: Schemas["CollectionInfo"] | undefined

			try {
				collectionInfo = await this.retryWithBackoff(() => this.getCollectionInfo())
			} catch (error) {
				if (error instanceof QdrantCollectionNotFoundError) {
					// Collection does not exist, create it
					const config = await this.getCollectionConfig()
					await this.client.createCollection(this.collectionName, {
						vectors: {
							size: this.vectorSize,
							distance: this.DISTANCE_METRIC,
							on_disk: config.vectors.on_disk,
						},
						hnsw_config: config.hnsw && {
							m: config.hnsw.m,
							ef_construct: config.hnsw.ef_construct,
							on_disk: true, // Always use disk storage for HNSW
						},
						quantization_config: config.vectors.quantization?.enabled
							? {
								scalar: config.vectors.quantization.type === "scalar"
									? {
										type: "int8",
										always_ram: false,
									}
									: undefined,
								product: config.vectors.quantization.type === "product"
									? {
										product: {
											always_ram: false,
										},
									}
									: undefined,
							}
							: undefined,
						optimizers_config: config.wal && {
							indexing_threshold: 0,
						},
					})
					created = true
				} else if (error instanceof QdrantConnectionError) {
					// Re-throw connection errors
					throw error
				} else {
					// Log warning for other errors but still try to create collection
					const errorMessage = error instanceof Error ? error.message : String(error)
					console.warn(
						`Warning during getCollectionInfo for "${this.collectionName}":`,
						errorMessage,
					)
					// Try to create collection anyway
					const config = await this.getCollectionConfig()
					await this.client.createCollection(this.collectionName, {
						vectors: {
							size: this.vectorSize,
							distance: this.DISTANCE_METRIC,
							on_disk: config.vectors.on_disk,
						},
						hnsw_config: config.hnsw && {
							m: config.hnsw.m,
							ef_construct: config.hnsw.ef_construct,
							on_disk: true, // Always use disk storage for HNSW
						},
						quantization_config: config.vectors.quantization?.enabled
							? {
								scalar: config.vectors.quantization.type === "scalar"
									? {
										type: "int8",
										always_ram: false,
									}
									: undefined,
								product: config.vectors.quantization.type === "product"
									? {
										product: {
											always_ram: false,
										},
									}
									: undefined,
							}
							: undefined,
						optimizers_config: config.wal && {
							indexing_threshold: 0,
						},
					})
					created = true
				}
			}

			if (!created && collectionInfo) {
				// Collection exists, check vector size
				const vectorsConfig = collectionInfo.config?.params?.vectors
				let existingVectorSize: number

				if (typeof vectorsConfig === "number") {
					existingVectorSize = vectorsConfig
				} else if (
					vectorsConfig &&
					typeof vectorsConfig === "object" &&
					"size" in vectorsConfig &&
					typeof vectorsConfig.size === "number"
				) {
					existingVectorSize = vectorsConfig.size
				} else {
					existingVectorSize = 0 // Fallback for unknown configuration
				}

				if (existingVectorSize === this.vectorSize) {
					created = false // Exists and correct
				} else {
					// Exists but wrong vector size, recreate with enhanced error handling
					created = await this._recreateCollectionWithNewDimension(existingVectorSize)
				}
			}

			// Create payload indexes
			await this._createPayloadIndexes()
			return created
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(
				`[QdrantVectorStore] Failed to initialize Qdrant collection "${this.collectionName}":`,
				errorMessage,
			)

			// If this is already a vector dimension mismatch error (identified by cause), re-throw it as-is
			if (error instanceof Error && error.cause !== undefined) {
				throw error
			}

			// Otherwise, provide a more user-friendly error message that includes the original error
			throw new Error(
				t("embeddings:vectorStore.qdrantConnectionFailed", { qdrantUrl: this.qdrantUrl, errorMessage }),
				{ cause: error },
			)
		}
	}

	/**
	 * Recreates the collection with a new vector dimension, handling failures gracefully.
	 * @param existingVectorSize The current vector size of the existing collection
	 * @returns Promise resolving to boolean indicating if a new collection was created
	 */
	private async _recreateCollectionWithNewDimension(existingVectorSize: number): Promise<boolean> {
		console.warn(
			`[QdrantVectorStore] Collection ${this.collectionName} exists with vector size ${existingVectorSize}, but expected ${this.vectorSize}. Recreating collection.`,
		)

		let deletionSucceeded = false
		let recreationAttempted = false

		try {
			// Step 1: Attempt to delete the existing collection
			console.log(`[QdrantVectorStore] Deleting existing collection ${this.collectionName}...`)
			await this.client.deleteCollection(this.collectionName)
			deletionSucceeded = true
			console.log(`[QdrantVectorStore] Successfully deleted collection ${this.collectionName}`)

			// Step 2: Wait a brief moment to ensure deletion is processed
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Step 3: Verify the collection is actually deleted
			try {
				await this.getCollectionInfo()
				throw new Error("Collection still exists after deletion attempt")
			} catch (verificationError) {
				if (verificationError instanceof QdrantCollectionNotFoundError) {
					// Expected: collection should not exist
					console.log(`[QdrantVectorStore] Verified collection ${this.collectionName} is deleted`)
				} else {
					// Unexpected error
					throw verificationError
				}
			}

			// Step 4: Create the new collection with correct dimensions
			console.log(
				`[QdrantVectorStore] Creating new collection ${this.collectionName} with vector size ${this.vectorSize}...`,
			)
			recreationAttempted = true
			const config = await this.getCollectionConfig()
			await this.client.createCollection(this.collectionName, {
				vectors: {
					size: this.vectorSize,
					distance: this.DISTANCE_METRIC,
					on_disk: config.vectors.on_disk,
				},
				hnsw_config: config.hnsw && {
					m: config.hnsw.m,
					ef_construct: config.hnsw.ef_construct,
					on_disk: true, // Always use disk storage for HNSW
				},
				quantization_config: config.vectors.quantization?.enabled
					? {
						scalar: config.vectors.quantization.type === "scalar"
							? {
								type: "int8",
								always_ram: false,
							}
							: undefined,
						product: config.vectors.quantization.type === "product"
							? {
								product: {
									always_ram: false,
								},
							}
							: undefined,
					}
					: undefined,
				optimizers_config: config.wal && {
					indexing_threshold: 0,
				},
			})
			console.log(`[QdrantVectorStore] Successfully created new collection ${this.collectionName}`)
			return true
		} catch (recreationError) {
			const errorMessage = recreationError instanceof Error ? recreationError.message : String(recreationError)

			// Provide detailed error context based on what stage failed
			let contextualErrorMessage: string
			if (!deletionSucceeded) {
				contextualErrorMessage = `Failed to delete existing collection with vector size ${existingVectorSize}. ${errorMessage}`
			} else if (!recreationAttempted) {
				contextualErrorMessage = `Deleted existing collection but failed verification step. ${errorMessage}`
			} else {
				contextualErrorMessage = `Deleted existing collection but failed to create new collection with vector size ${this.vectorSize}. ${errorMessage}`
			}

			console.error(
				`[QdrantVectorStore] CRITICAL: Failed to recreate collection ${this.collectionName} for dimension change (${existingVectorSize} -> ${this.vectorSize}). ${contextualErrorMessage}`,
			)

			// Create a comprehensive error message for the user
			const dimensionMismatchError = new Error(
				t("embeddings:vectorStore.vectorDimensionMismatch", {
					errorMessage: contextualErrorMessage,
				}),
				{ cause: recreationError },
			)
			throw dimensionMismatchError
		}
	}

	/**
	 * Creates payload indexes for the collection, handling errors gracefully.
	 */
	private async _createPayloadIndexes(): Promise<void> {
		// Create index for the 'type' field to enable metadata filtering
		try {
			await this.client.createPayloadIndex(this.collectionName, {
				field_name: "type",
				field_schema: "keyword",
			})
		} catch (indexError: unknown) {
			const errorMessage = (indexError instanceof Error ? indexError.message : String(indexError) || "").toLowerCase()
			if (!errorMessage.includes("already exists")) {
				console.warn(
					`[QdrantVectorStore] Could not create payload index for type on ${this.collectionName}. Details:`,
					indexError instanceof Error ? indexError.message : indexError,
				)
			}
		}

		// Create indexes for pathSegments fields
		for (let i = 0; i <= 4; i++) {
			try {
				await this.client.createPayloadIndex(this.collectionName, {
					field_name: `pathSegments.${i}`,
					field_schema: "keyword",
				})
			} catch (indexError: unknown) {
				const errorMessage = (indexError instanceof Error ? indexError.message : String(indexError) || "").toLowerCase()
				if (!errorMessage.includes("already exists")) {
					console.warn(
						`[QdrantVectorStore] Could not create payload index for pathSegments.${i} on ${this.collectionName}. Details:`,
						indexError instanceof Error ? indexError.message : indexError,
					)
				}
			}
		}
	}

	/**
	 * Upserts points into the vector store
	 * @param points Array of points to upsert
	 */
	async upsertPoints(
		points: Array<{
			id: string
			vector: number[]
			payload: Record<string, unknown>
		}>,
	): Promise<void> {
		try {
			const processedPoints = points.map((point) => {
				if (typeof point.payload?.filePath === "string") {
					const segments = point.payload.filePath.split(path.sep).filter(Boolean)
					const pathSegments = segments.reduce(
						(acc: Record<string, string>, segment: string, index: number) => {
							acc[index.toString()] = segment
							return acc
						},
						{},
					)
					return {
						...point,
						payload: {
							...point.payload,
							pathSegments,
						},
					}
				}
				return point
			})

			await this.client.upsert(this.collectionName, {
				points: processedPoints,
				wait: true,
			})
		} catch (error) {
			console.error("Failed to upsert points:", error)
			throw error
		}
	}

	/**
	 * Checks if a payload is valid
	 * @param payload Payload to check
	 * @returns Boolean indicating if the payload is valid
	 */
	private isPayloadValid(payload: Record<string, unknown> | null | undefined): payload is Payload {
		if (!payload) {
			return false
		}
		const validKeys = ["filePath", "codeChunk", "startLine", "endLine"]
		const hasValidKeys = validKeys.every((key) => key in payload)
		return hasValidKeys
	}

	/**
	 * Searches for similar vectors
	 * @param queryVector Vector to search for
	 * @param directoryPrefix Optional directory prefix to filter results
	 * @param minScore Optional minimum score threshold
	 * @param maxResults Optional maximum number of results to return
	 * @returns Promise resolving to search results
	 */
	async search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]> {
		try {
			let filter:
				| {
					must: Array<{ key: string; match: { value: string } }>
					must_not?: Array<{ key: string; match: { value: string } }>
				}
				| undefined = undefined

			if (directoryPrefix) {
				// Check if the path represents current directory
				const normalizedPrefix = path.posix.normalize(directoryPrefix.replace(/\\/g, "/"))
				// Note: path.posix.normalize("") returns ".", and normalize("./") returns "./"
				if (normalizedPrefix === "." || normalizedPrefix === "./") {
					// Don't create a filter - search entire workspace
					filter = undefined
				} else {
					// Remove leading "./" from paths like "./src" to normalize them
					const cleanedPrefix = path.posix.normalize(
						normalizedPrefix.startsWith("./") ? normalizedPrefix.slice(2) : normalizedPrefix,
					)
					const segments = cleanedPrefix.split("/").filter(Boolean)
					if (segments.length > 0) {
						filter = {
							must: segments.map((segment, index) => ({
								key: `pathSegments.${index}`,
								match: { value: segment },
							})),
						}
					}
				}
			}

			// Always exclude metadata points at query-time to avoid wasting top-k
			const metadataExclusion = {
				must_not: [{ key: "type", match: { value: "metadata" } }],
			}

			const mergedFilter = filter
				? { ...filter, must_not: [...(filter.must_not || []), ...metadataExclusion.must_not] }
				: metadataExclusion

			const searchRequest = {
				query: queryVector,
				filter: mergedFilter,
				score_threshold: minScore ?? DEFAULT_SEARCH_MIN_SCORE,
				limit: maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			}

			const operationResult = await this.client.query(this.collectionName, searchRequest)
			const filteredPoints = operationResult.points.filter((p) => this.isPayloadValid(p.payload))

			return filteredPoints as VectorStoreSearchResult[]
		} catch (error) {
			console.error("Failed to search points:", error)
			throw error
		}
	}

	/**
	 * Deletes points by file path
	 * @param filePath Path of the file to delete points for
	 */
	async deletePointsByFilePath(filePath: string): Promise<void> {
		return this.deletePointsByMultipleFilePaths([filePath])
	}

	async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			return
		}

		try {
			// First check if the collection exists
			const collectionExists = await this.collectionExists()
			if (!collectionExists) {
				console.warn(
					`[QdrantVectorStore] Skipping deletion - collection "${this.collectionName}" does not exist`,
				)
				return
			}

			const workspaceRoot = this.workspacePath

			// Build filters using pathSegments to match the indexed fields
			const filters = filePaths.map((filePath) => {
				// IMPORTANT: Use the relative path to match what's stored in upsertPoints
				// upsertPoints stores the relative filePath, not the absolute path
				const relativePath = path.isAbsolute(filePath) ? path.relative(workspaceRoot, filePath) : filePath

				// Normalize the relative path
				const normalizedRelativePath = path.normalize(relativePath)

				// Split the path into segments like we do in upsertPoints
				const segments = normalizedRelativePath.split(path.sep).filter(Boolean)

				// Create a filter that matches all segments of the path
				// This ensures we only delete points that match the exact file path
				const mustConditions = segments.map((segment, index) => ({
					key: `pathSegments.${index}`,
					match: { value: segment },
				}))

				return { must: mustConditions }
			})

			// Use 'should' to match any of the file paths (OR condition)
			const filter = filters.length === 1 ? filters[0] : { should: filters }

			if (!filter) {
				console.warn(`[QdrantVectorStore] No valid filter generated for file paths`)
				return
			}

			await this.client.delete(this.collectionName, {
				filter,
				wait: true,
			})
		} catch (error: unknown) {
			// Extract more detailed error information
			const errorMessage = error instanceof Error ? error.message : String(error)
			const errorObj = error as Record<string, unknown> | undefined
			const errorStatus = errorObj?.status || (errorObj?.response as Record<string, unknown>)?.status || errorObj?.statusCode
			const errorDetails = (errorObj?.response as Record<string, unknown>)?.data || errorObj?.data || ""

			console.error(`[QdrantVectorStore] Failed to delete points by file paths:`, {
				error: errorMessage,
				status: errorStatus,
				details: errorDetails,
				collection: this.collectionName,
				fileCount: filePaths.length,
				// Include first few file paths for debugging (avoid logging too many)
				samplePaths: filePaths.slice(0, 3),
			})
		}
	}

	/**
	 * Deletes the entire collection.
	 */
	async deleteCollection(): Promise<void> {
		try {
			// Check if collection exists before attempting deletion to avoid errors
			if (await this.collectionExists()) {
				await this.client.deleteCollection(this.collectionName)
			}
		} catch (error) {
			console.error(`[QdrantVectorStore] Failed to delete collection ${this.collectionName}:`, error)
			throw error // Re-throw to allow calling code to handle it
		}
	}

	/**
	 * Clears all points from the collection
	 */
	async clearCollection(): Promise<void> {
		try {
			await this.client.delete(this.collectionName, {
				filter: {
					must: [],
				},
				wait: true,
			})
		} catch (error) {
			console.error("Failed to clear collection:", error)
			throw error
		}
	}

	/**
	 * Checks if the collection exists
	 * @returns Promise resolving to boolean indicating if the collection exists
	 */
	async collectionExists(): Promise<boolean> {
		try {
			await this.getCollectionInfo()
			return true
		} catch (error) {
			if (error instanceof QdrantConnectionError) {
				throw error
			}
			if (error instanceof QdrantCollectionNotFoundError) {
				return false
			}
			// Log warning for non-404 errors but return false
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.warn(
				`Warning during getCollectionInfo for "${this.collectionName}":`,
				errorMessage,
			)
			return false
		}
	}

	/**
	 * Checks if the collection exists and has indexed points
	 * @returns Promise resolving to boolean indicating if the collection exists and has points
	 */
	async hasIndexedData(): Promise<boolean> {
		try {
			const collectionInfo = await this.getCollectionInfo()

			// Check if the collection has any points indexed
			const pointsCount = collectionInfo.points_count ?? 0
			if (pointsCount === 0) {
				return false
			}

			// Check if the indexing completion marker exists
			// Use a deterministic UUID generated from a constant string
			const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)
			const metadataPoints = await this.client.retrieve(this.collectionName, {
				ids: [metadataId],
			})

			// If marker exists, use it to determine completion status
			if (metadataPoints.length > 0 && metadataPoints[0]) {
				const isComplete = metadataPoints[0].payload?.indexing_complete === true
				if (isComplete) {
					console.log(
						"[QdrantVectorStore] Index metadata found: indexing is complete.",
					)
				} else {
					console.log(
						"[QdrantVectorStore] Index metadata found: indexing is incomplete (was interrupted).",
					)
				}
				return isComplete
			}

			// No metadata marker found - this indicates either:
			// 1. Old index from pre-metadata version (backward compatibility)
			// 2. Index was interrupted before any metadata was written
			// 
			// We need to distinguish these cases. If there are many points, it's likely
			// an old complete index. If there are few points, it might be incomplete.
			// 
			// For safety, we now require the metadata marker to consider an index complete.
			// This prevents the bug where a partially indexed collection was incorrectly
			// considered complete.
			console.log(
				"[QdrantVectorStore] No indexing metadata marker found. Collection has %d points but no completion marker. Treating as incomplete to ensure data integrity.",
				pointsCount,
			)
			return false
		} catch (error) {
			if (error instanceof QdrantConnectionError) {
				throw error
			}
			if (error instanceof QdrantCollectionNotFoundError) {
				return false
			}
			throw error
		}
	}

	/**
	 * Marks the indexing process as complete by storing metadata
	 * Should be called after a successful full workspace scan or incremental scan
	 */
	async markIndexingComplete(): Promise<void> {
		try {
			// Create a metadata point with a deterministic UUID to mark indexing as complete
			// Use uuidv5 to generate a consistent UUID from a constant string
			const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)

			await this.client.upsert(this.collectionName, {
				points: [
					{
						id: metadataId,
						vector: new Array(this.vectorSize).fill(0),
						payload: {
							type: "metadata",
							indexing_complete: true,
							completed_at: Date.now(),
						},
					},
				],
				wait: true,
			})
			console.log("[QdrantVectorStore] Marked indexing as complete")
		} catch (error) {
			console.error("[QdrantVectorStore] Failed to mark indexing as complete:", error)
			throw error
		}
	}

	/**
	 * Marks the indexing process as complete with additional metadata
	 * Should be called after a successful full workspace scan or incremental scan
	 * @param additionalMetadata Additional metadata to store
	 */
	async markIndexingCompleteWithMetadata(additionalMetadata: {
		indexed_file_count?: number
		config_version?: string
		vector_dimension?: number
		embedder_provider?: string
		model_id?: string
	}): Promise<void> {
		try {
			const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)
			const workspaceHash = createHash("sha256").update(this.workspacePath).digest("hex").substring(0, 16)

			await this.client.upsert(this.collectionName, {
				points: [
					{
						id: metadataId,
						vector: new Array(this.vectorSize).fill(0),
						payload: {
							type: "metadata",
							indexing_complete: true,
							completed_at: Date.now(),
							workspace_hash: workspaceHash,
							...additionalMetadata,
						},
					},
				],
				wait: true,
			})
			console.log("[QdrantVectorStore] Marked indexing as complete with metadata:", additionalMetadata)
		} catch (error) {
			console.error("[QdrantVectorStore] Failed to mark indexing as complete with metadata:", error)
			throw error
		}
	}

	/**
	 * Gets the index metadata from the vector store
	 * @returns Promise resolving to the index metadata or null if not found
	 */
	async getIndexMetadata(): Promise<IndexMetadata | null> {
		try {
			const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)
			const metadataPoints = await this.client.retrieve(this.collectionName, {
				ids: [metadataId],
			})

			if (metadataPoints.length > 0 && metadataPoints[0]?.payload) {
				return metadataPoints[0].payload as unknown as IndexMetadata
			}

			return null
		} catch (error) {
			if (error instanceof QdrantConnectionError) {
				throw error
			}
			if (error instanceof QdrantCollectionNotFoundError) {
				return null
			}
			console.error("[QdrantVectorStore] Failed to get index metadata:", error)
			throw error
		}
	}

	/**
	 * Marks the indexing process as incomplete by storing metadata
	 * Should be called at the start of indexing to indicate work in progress
	 */
	async markIndexingIncomplete(): Promise<void> {
		try {
			// Create a metadata point with a deterministic UUID to mark indexing as incomplete
			// Use uuidv5 to generate a consistent UUID from a constant string
			const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)

			await this.client.upsert(this.collectionName, {
				points: [
					{
						id: metadataId,
						vector: new Array(this.vectorSize).fill(0),
						payload: {
							type: "metadata",
							indexing_complete: false,
							started_at: Date.now(),
						},
					},
				],
				wait: true,
			})
			console.log("[QdrantVectorStore] Marked indexing as incomplete (in progress)")
		} catch (error) {
			console.error("[QdrantVectorStore] Failed to mark indexing as incomplete:", error)
			throw error
		}
	}

	/**
		* Gets the collection configuration from the vector storage config manager
		* Falls back to default configuration if no manager is set
		*/
	private async getCollectionConfig(): Promise<{
		vectors: { on_disk: boolean; quantization?: { enabled: boolean; type: string; bits?: number } }
		hnsw?: { m: number; ef_construct: number }
		wal?: { capacity_mb: number; segments: number }
	}> {
		if (this.vectorStorageConfigManager) {
			const config = await this.vectorStorageConfigManager.getCollectionConfig()
			return {
				vectors: {
					on_disk: config.vectors.on_disk,
					quantization: config.vectors.quantization,
				},
				hnsw: config.hnsw,
				wal: config.wal,
			}
		}

		// Fallback to default configuration (medium preset)
		return {
			vectors: {
				on_disk: true,
			},
			hnsw: {
				m: 64,
				ef_construct: 512,
			},
		}
	}

	/**
	 * Sets collection configuration based on estimation result
	 * Used before indexing to set initial configuration based on estimated size
	 * @param estimation The size estimation result
	 */
	async setCollectionConfigFromEstimation(estimation: {
		estimatedVectorCount: number
		estimatedTokenCount: number
		fileCount: number
		totalFileSize: number
	}): Promise<void> {
		if (!this.vectorStorageConfigManager) {
			console.warn("[QdrantVectorStore] No vector storage config manager available, skipping config update")
			return
		}

		try {
			const config = this.vectorStorageConfigManager.getCollectionConfigFromEstimation(estimation)

			// Check if collection exists
			const exists = await this.collectionExists()
			if (!exists) {
				console.log(
					`[QdrantVectorStore] Collection does not exist yet, config will be applied during initialization`,
				)
				return
			}

			// Apply configuration to existing collection
			const updateParams: Record<string, unknown> = {}

			// Apply HNSW configuration
			if (config.hnsw) {
				updateParams.hnsw_config = config.hnsw
				updateParams.optimizers_config = {
					indexing_threshold: 0, // Disable background optimizer threshold
				}
			}

			// Apply quantization configuration
			if (config.vectors.quantization?.enabled) {
				updateParams.quantization_config = {
					scalar: {
						type: "int8",
					},
				}
			}

			// Apply WAL configuration
			if (config.wal) {
				updateParams.wal_config = config.wal
			}

			// Update collection if there are changes
			if (Object.keys(updateParams).length > 0) {
				await this.client.updateCollection(this.collectionName, updateParams)
				console.log(
					`[QdrantVectorStore] Updated collection configuration based on estimation: ${estimation.estimatedVectorCount} vectors`,
				)
			}
		} catch (error) {
			console.error("[QdrantVectorStore] Failed to set collection config from estimation:", error)
			throw error
		}
	}
}
