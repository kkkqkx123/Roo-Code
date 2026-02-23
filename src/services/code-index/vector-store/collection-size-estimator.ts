import { QdrantClient } from "@qdrant/js-client-rest"

/**
 * Estimates collection size by querying Qdrant
 * Used at runtime to check current collection status and determine if upgrade is needed
 */
export class CollectionSizeEstimator {
	private client: QdrantClient

	constructor(qdrantUrl: string, apiKey?: string) {
		this.client = new QdrantClient({
			url: qdrantUrl,
			apiKey,
		})
	}

	/**
	 * Estimates the size of a collection by querying Qdrant
	 * @param collectionName The name of the collection
	 * @returns The number of points in the collection, or 0 if collection doesn't exist
	 */
	async estimateSize(collectionName: string): Promise<number> {
		try {
			const collectionInfo = await this.client.getCollection(collectionName)
			return collectionInfo.points_count || 0
		} catch (error) {
			console.warn(
				`[CollectionSizeEstimator] Failed to get collection size for ${collectionName}:`,
				error,
			)
			return 0
		}
	}

	/**
	 * Gets detailed collection information
	 * @param collectionName The name of the collection
	 * @returns Collection info or null if collection doesn't exist
	 */
	async getCollectionInfo(collectionName: string): Promise<Record<string, unknown> | null> {
		try {
			const collectionInfo = await this.client.getCollection(collectionName)
			return collectionInfo
		} catch (error) {
			console.warn(
				`[CollectionSizeEstimator] Failed to get collection info for ${collectionName}:`,
				error,
			)
			return null
		}
	}
}