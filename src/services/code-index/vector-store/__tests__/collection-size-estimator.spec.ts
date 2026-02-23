import { describe, it, expect, vi, beforeEach } from "vitest"
import { CollectionSizeEstimator } from "../collection-size-estimator"
import { QdrantClient } from "@qdrant/js-client-rest"

// Mock QdrantClient
const mockGetCollection = vi.fn()
vi.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vi.fn().mockImplementation(() => ({
		getCollection: mockGetCollection,
	})),
}))

describe("CollectionSizeEstimator", () => {
	let estimator: CollectionSizeEstimator

	beforeEach(() => {
		mockGetCollection.mockClear()
		estimator = new CollectionSizeEstimator("http://localhost:6333", "test-api-key")
	})

	describe("estimateSize", () => {
		it("should return collection size when collection exists", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
			})

			const size = await estimator.estimateSize("test-collection")

			expect(size).toBe(5000)
			expect(mockGetCollection).toHaveBeenCalledWith("test-collection")
		})

		it("should return 0 when collection does not exist", async () => {
			mockGetCollection.mockRejectedValue(new Error("Collection not found"))

			const size = await estimator.estimateSize("test-collection")

			expect(size).toBe(0)
		})

		it("should return 0 when points_count is undefined", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: undefined,
			})

			const size = await estimator.estimateSize("test-collection")

			expect(size).toBe(0)
		})

		it("should handle network errors gracefully", async () => {
			mockGetCollection.mockRejectedValue(new Error("Network error"))

			const size = await estimator.estimateSize("test-collection")

			expect(size).toBe(0)
		})
	})

	describe("getCollectionInfo", () => {
		it("should return full collection info when collection exists", async () => {
			const mockInfo = {
				points_count: 5000,
				config: {
					hnsw_config: { m: 16, ef_construct: 128 },
					vectors_config: { on_disk: true },
				},
			}
			mockGetCollection.mockResolvedValue(mockInfo)

			const info = await estimator.getCollectionInfo("test-collection")

			expect(info).toEqual(mockInfo)
		})

		it("should return null when collection does not exist", async () => {
			mockGetCollection.mockRejectedValue(new Error("Collection not found"))

			const info = await estimator.getCollectionInfo("test-collection")

			expect(info).toBeNull()
		})
	})
})