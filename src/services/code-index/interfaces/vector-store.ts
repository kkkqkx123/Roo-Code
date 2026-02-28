/**
 * Interface for vector database clients
 */
export type PointStruct = {
	id: string
	vector: number[]
	payload: Record<string, any>
}

/**
 * Size estimation result
 */
export interface SizeEstimationResult {
	/** Estimated number of vectors */
	estimatedVectorCount: number
	/** Estimated total token count */
	estimatedTokenCount: number
	/** Number of files processed */
	fileCount: number
	/** Total file size in bytes */
	totalFileSize: number
}

/**
 * Index metadata stored in the vector store
 * Used to track indexing state and enable fast-start optimization
 */
export interface IndexMetadata {
	/** Type identifier for metadata points */
	type: "metadata"
	/** Whether indexing is complete */
	indexing_complete: boolean
	/** Timestamp when indexing completed (milliseconds since epoch) */
	completed_at?: number
	/** Timestamp when indexing started */
	started_at?: number
	/** Number of files that were indexed */
	indexed_file_count?: number
	/** Hash of the workspace path for verification */
	workspace_hash?: string
	/** Configuration version hash to detect config changes */
	config_version?: string
	/** Vector dimension used for this index */
	vector_dimension?: number
	/** Embedder provider used */
	embedder_provider?: string
	/** Model ID used for embeddings */
	model_id?: string
}

export interface IVectorStore {
	/**
	 * Initializes the vector store
	 * @returns Promise resolving to boolean indicating if a new collection was created
	 */
	initialize(): Promise<boolean>

	/**
	 * Upserts points into the vector store
	 * @param points Array of points to upsert
	 */
	upsertPoints(points: PointStruct[]): Promise<void>

	/**
	 * Searches for similar vectors
	 * @param queryVector Vector to search for
	 * @param directoryPrefix Optional directory prefix to filter results
	 * @param minScore Optional minimum score threshold
	 * @param maxResults Optional maximum number of results to return
	 * @returns Promise resolving to search results
	 */
	search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]>

	/**
	 * Deletes points by file path
	 * @param filePath Path of the file to delete points for
	 */
	deletePointsByFilePath(filePath: string): Promise<void>

	/**
	 * Deletes points by multiple file paths
	 * @param filePaths Array of file paths to delete points for
	 */
	deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void>

	/**
	 * Clears all points from the collection
	 */
	clearCollection(): Promise<void>

	/**
	 * Deletes the entire collection.
	 */
	deleteCollection(): Promise<void>

	/**
	 * Checks if the collection exists
	 * @returns Promise resolving to boolean indicating if the collection exists
	 */
	collectionExists(): Promise<boolean>

	/**
	 * Checks if the collection exists and has indexed points
	 * @returns Promise resolving to boolean indicating if the collection exists and has points
	 */
	hasIndexedData(): Promise<boolean>

	/**
	 * Marks the indexing process as complete by storing metadata
	 * Should be called after a successful full workspace scan or incremental scan
	 */
	markIndexingComplete(): Promise<void>

	/**
	 * Marks the indexing process as incomplete by storing metadata
	 * Should be called at the start of indexing to indicate work in progress
	 */
	markIndexingIncomplete(): Promise<void>

	/**
	 * Gets the index metadata from the vector store
	 * @returns Promise resolving to the index metadata or null if not found
	 */
	getIndexMetadata(): Promise<IndexMetadata | null>

	/**
	 * Marks the indexing process as complete with additional metadata
	 * Should be called after a successful full workspace scan or incremental scan
	 * @param additionalMetadata Optional additional metadata to store
	 */
	markIndexingCompleteWithMetadata?(additionalMetadata: {
		indexed_file_count?: number
		config_version?: string
		vector_dimension?: number
		embedder_provider?: string
		model_id?: string
	}): Promise<void>

	/**
	 * Sets collection configuration based on estimation result
	 * Used before indexing to set initial configuration based on estimated size
	 * @param estimation The size estimation result
	 */
	setCollectionConfigFromEstimation?(estimation: SizeEstimationResult): Promise<void>
}

export interface VectorStoreSearchResult {
	id: string | number
	score: number
	payload?: Payload | null
}

export interface Payload {
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
	[key: string]: any
}
