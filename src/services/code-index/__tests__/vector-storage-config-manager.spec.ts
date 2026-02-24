import { describe, it, expect, vi, beforeEach } from "vitest"
import { VectorStorageConfigManager } from "../vector-storage-config-manager"
import { QdrantClient } from "@qdrant/js-client-rest"
import {
	VectorStorageConfig,
	DEFAULT_VECTOR_STORAGE_CONFIG,
	VECTOR_STORAGE_PRESETS,
	VectorStoragePreset,
} from "../interfaces/vector-storage-config"

// Mock QdrantClient
vi.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vi.fn().mockImplementation(() => ({
		getCollection: vi.fn(),
	})),
}))

describe("VectorStorageConfigManager", () => {
	let mockClient: any
	let configManager: VectorStorageConfigManager
	const testCollectionName = "test-collection"

	beforeEach(() => {
		mockClient = new QdrantClient({ url: "http://localhost:6333" })
	})

	describe("constructor", () => {
		it("should initialize with provided config", () => {
			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)
			expect(configManager.getConfig()).toEqual(config)
		})
	})

	describe("getCollectionConfig - auto mode", () => {
		it("should return tiny preset for empty collection", async () => {
			mockClient.getCollection.mockRejectedValue(new Error("Collection not found"))

			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.tiny.customConfig)
		})

		it("should return tiny preset for collection with < 2000 points", async () => {
			mockClient.getCollection.mockResolvedValue({
				points_count: 1500,
			})

			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.tiny.customConfig)
		})

		it("should return small preset for collection with 2000-10000 points", async () => {
			mockClient.getCollection.mockResolvedValue({
				points_count: 5000,
			})

			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.small.customConfig)
		})

		it("should return medium preset for collection with 10000-100000 points", async () => {
			mockClient.getCollection.mockResolvedValue({
				points_count: 50000,
			})

			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.medium.customConfig)
		})

		it("should return large preset for collection with >= 100000 points", async () => {
			mockClient.getCollection.mockResolvedValue({
				points_count: 150000,
			})

			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.large.customConfig)
		})

		it("should use custom thresholds when provided", async () => {
			mockClient.getCollection.mockResolvedValue({
				points_count: 500,
			})

			const config: VectorStorageConfig = {
				mode: "auto",
				thresholds: {
					tiny: 100,
					small: 1000,
					medium: 10000,
					large: 100000,
				},
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.small.customConfig)
		})
	})

	describe("getCollectionConfig - preset mode", () => {
		it("should return tiny preset when mode is preset and preset is tiny", async () => {
			const config: VectorStorageConfig = {
				mode: "preset",
				preset: "tiny",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.tiny.customConfig)
		})

		it("should return small preset when mode is preset and preset is small", async () => {
			const config: VectorStorageConfig = {
				mode: "preset",
				preset: "small",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.small.customConfig)
		})

		it("should return medium preset when mode is preset and preset is medium", async () => {
			const config: VectorStorageConfig = {
				mode: "preset",
				preset: "medium",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.medium.customConfig)
		})

		it("should return large preset when mode is preset and preset is large", async () => {
			const config: VectorStorageConfig = {
				mode: "preset",
				preset: "large",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.large.customConfig)
		})

		it("should default to medium preset when preset is not specified", async () => {
			const config: VectorStorageConfig = {
				mode: "preset",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			const result = await configManager.getCollectionConfig()
			expect(result).toEqual(VECTOR_STORAGE_PRESETS.medium.customConfig)
		})
	})



	describe("updateConfig", () => {
		it("should update the configuration", () => {
			const config: VectorStorageConfig = {
				mode: "auto",
			}
			configManager = new VectorStorageConfigManager(config, mockClient, testCollectionName)

			configManager.updateConfig({ mode: "preset", preset: "large" })
			expect(configManager.getConfig()).toEqual({
				mode: "preset",
				preset: "large",
			})
		})
	})

	describe("validateCustomConfig", () => {
		it("should validate a correct custom config", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
				},
				hnsw: {
					m: 32,
					ef_construct: 256,
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(true)
			expect(result.errors).toHaveLength(0)
		})

		it("should reject config with invalid HNSW m value", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
				},
				hnsw: {
					m: 200, // > 128
					ef_construct: 256,
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("HNSW m must be between 2 and 128")
		})

		it("should reject config with invalid HNSW ef_construct value", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
				},
				hnsw: {
					m: 32,
					ef_construct: 5, // < 10
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("HNSW ef_construct must be between 10 and 1000")
		})

		it("should reject config with on_disk set to false", () => {
			const customConfig = {
				vectors: {
					on_disk: false as any, // Should be true
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Vectors must have on_disk set to true (unified disk storage)")
		})

		it("should reject config with invalid quantization type", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
					quantization: {
						enabled: true,
						type: "invalid" as any,
					},
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Quantization type must be 'scalar' or 'product'")
		})

		it("should reject config with invalid quantization bits", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
					quantization: {
						enabled: true,
						type: "scalar" as const,
						bits: 20, // > 16
					},
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Quantization bits must be between 1 and 16")
		})

		it("should reject config with invalid WAL capacity", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
				},
				wal: {
					capacity_mb: 0, // < 1
					segments: 2,
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("WAL capacity_mb must be at least 1")
		})

		it("should reject config with invalid WAL segments", () => {
			const customConfig = {
				vectors: {
					on_disk: true as const,
				},
				wal: {
					capacity_mb: 32,
					segments: 0, // < 1
				},
			}

			const result = VectorStorageConfigManager.validateCustomConfig(customConfig)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("WAL segments must be at least 1")
		})
	})
})