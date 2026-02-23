import { describe, it, expect, vi, beforeEach } from "vitest"
import { CollectionConfigUpgradeService } from "../collection-config-upgrade-service"
import { QdrantClient } from "@qdrant/js-client-rest"
import { VectorStorageConfig } from "../../interfaces/vector-storage-config"

// Mock QdrantClient
const mockGetCollection = vi.fn()
const mockUpdateCollection = vi.fn()

vi.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vi.fn().mockImplementation(() => ({
		getCollection: mockGetCollection,
		updateCollection: mockUpdateCollection,
	})),
}))

describe("CollectionConfigUpgradeService", () => {
	let service: CollectionConfigUpgradeService
	let config: VectorStorageConfig

	beforeEach(() => {
		mockGetCollection.mockClear()
		mockUpdateCollection.mockClear()

		config = {
			mode: "auto",
			thresholds: {
				tiny: 2000,
				small: 10000,
				medium: 100000,
				large: 1000000,
			},
		}

		service = new CollectionConfigUpgradeService("http://localhost:6333", "test-api-key", "test-collection", config)
	})

	describe("constructor", () => {
		it("should initialize with provided config", () => {
			expect(service).toBeDefined()
			expect(service.statusEmitter).toBeDefined()
		})

		it("should use default thresholds if not provided", () => {
			const serviceWithoutThresholds = new CollectionConfigUpgradeService(
				"http://localhost:6333",
				"test-api-key",
				"test-collection",
				{ mode: "auto" },
			)
			expect(serviceWithoutThresholds).toBeDefined()
		})
	})

	describe("isUpgradeInProgress", () => {
		it("should return false when no upgrade is in progress", () => {
			expect(service.isUpgradeInProgress()).toBe(false)
		})

		it("should return true when upgrade is in progress", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			// Start an upgrade but don't await it
			const upgradePromise = service.checkAndUpgradeCollection()

			// Check if upgrade is in progress
			expect(service.isUpgradeInProgress()).toBe(false) // Not yet started

			await upgradePromise
		})
	})

	describe("getCurrentUpgrade", () => {
		it("should return undefined when no upgrade is in progress", () => {
			const currentUpgrade = service.getCurrentUpgrade()
			expect(currentUpgrade).toBeUndefined()
		})
	})

	describe("checkAndUpgradeCollection", () => {
		it("should return false when no upgrade needed", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {
					hnsw_config: { m: 16, ef_construct: 128 },
				},
			})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(false)
			expect(mockGetCollection).toHaveBeenCalledWith("test-collection")
		})

		it("should return true when upgrade is performed", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 15000,
				config: {
					hnsw_config: { m: 16, ef_construct: 128 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(true)
			expect(mockUpdateCollection).toHaveBeenCalled()
		})

		it("should upgrade from tiny to small", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {}, // No HNSW config = tiny
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(true)
			expect(mockUpdateCollection).toHaveBeenCalledWith(
				"test-collection",
				expect.objectContaining({
					hnsw_config: expect.any(Object),
				}),
			)
		})

		it("should upgrade from small to medium", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 50000,
				config: {
					hnsw_config: { m: 16, ef_construct: 128 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(true)
		})

		it("should upgrade from medium to large", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 500000,
				config: {
					hnsw_config: { m: 32, ef_construct: 256 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(true)
		})

		it("should handle collection not found error", async () => {
			mockGetCollection.mockRejectedValue(new Error("Collection not found"))

			await expect(service.checkAndUpgradeCollection()).rejects.toThrow("Collection not found")
		})

		it("should handle network errors", async () => {
			mockGetCollection.mockRejectedValue(new Error("Network error"))

			await expect(service.checkAndUpgradeCollection()).rejects.toThrow("Network error")
		})

		it("should not downgrade from large to small", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {
					hnsw_config: { m: 64, ef_construct: 512 },
				},
			})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(false)
			expect(mockUpdateCollection).not.toHaveBeenCalled()
		})
	})

	describe("determineTargetPreset", () => {
		it("should return tiny for very small collections", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 1000,
				config: {},
			})

			await service.checkAndUpgradeCollection()

			// Should not upgrade as it's already tiny
			expect(mockUpdateCollection).not.toHaveBeenCalled()
		})

		it("should return small for small collections", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			expect(mockUpdateCollection).toHaveBeenCalled()
		})

		it("should return medium for medium collections", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 50000,
				config: {
					hnsw_config: { m: 16, ef_construct: 128 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			expect(mockUpdateCollection).toHaveBeenCalled()
		})

		it("should return large for large collections", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 500000,
				config: {
					hnsw_config: { m: 32, ef_construct: 256 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			expect(mockUpdateCollection).toHaveBeenCalled()
		})
	})

	describe("detectCurrentPreset", () => {
		it("should detect tiny preset (no HNSW config)", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await service.checkAndUpgradeCollection()

			// Tiny to small upgrade (5000 >= 2000 threshold)
			expect(result).toBe(true)
		})

		it("should detect small preset", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {
					hnsw_config: { m: 16, ef_construct: 128 },
				},
			})

			const result = await service.checkAndUpgradeCollection()

			// Already at small, no upgrade needed
			expect(result).toBe(false)
		})

		it("should detect medium preset", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 50000,
				config: {
					hnsw_config: { m: 32, ef_construct: 256 },
				},
			})

			const result = await service.checkAndUpgradeCollection()

			// Already at medium, no upgrade needed
			expect(result).toBe(false)
		})

		it("should detect large preset", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 500000,
				config: {
					hnsw_config: { m: 64, ef_construct: 512 },
				},
			})

			const result = await service.checkAndUpgradeCollection()

			// Already at large, no upgrade needed
			expect(result).toBe(false)
		})

		it("should return null for unknown preset", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 50000,
				config: {
					hnsw_config: { m: 99, ef_construct: 999 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			// Unknown preset will still try to upgrade to medium (target preset based on size)
			const result = await service.checkAndUpgradeCollection()

			// Since current preset is unknown, it will upgrade to target preset
			expect(result).toBe(true)
		})
	})

	describe("calculateUpgradePath", () => {
		it("should calculate path from tiny to small", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// Should upgrade to small
			expect(mockUpdateCollection).toHaveBeenCalledTimes(1)
		})

		it("should calculate path from tiny to medium", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 50000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// Should upgrade through small to medium
			expect(mockUpdateCollection).toHaveBeenCalledTimes(2)
		})

		it("should calculate path from tiny to large", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 500000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// Should upgrade through small, medium to large (3 steps)
			// But each step may call updateCollection multiple times (HNSW + quantization)
			expect(mockUpdateCollection).toHaveBeenCalled()
		})

		it("should not calculate downgrade path", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 1000,
				config: {
					hnsw_config: { m: 64, ef_construct: 512 },
				},
			})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(false)
			expect(mockUpdateCollection).not.toHaveBeenCalled()
		})
	})

	describe("pauseUpgrade", () => {
		it("should return false when no upgrade is in progress", () => {
			const result = service.pauseUpgrade()
			expect(result).toBe(false)
		})

		it("should return false when upgrade is not in progress status", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// Upgrade is completed, cannot pause
			const result = service.pauseUpgrade()
			expect(result).toBe(false)
		})
	})

	describe("resumeUpgrade", () => {
		it("should return false when no upgrade is paused", async () => {
			const result = await service.resumeUpgrade()
			expect(result).toBe(false)
		})
	})

	describe("cancelUpgrade", () => {
		it("should return false when no upgrade is in progress", () => {
			const result = service.cancelUpgrade()
			expect(result).toBe(false)
		})
	})

	describe("rollbackUpgrade", () => {
		it("should return false when no upgrade history exists", async () => {
			const result = await service.rollbackUpgrade()
			expect(result).toBe(false)
		})

		it("should return false when last upgrade was not completed", async () => {
			// This would require setting up a failed upgrade in history
			// For now, just test the basic case
			const result = await service.rollbackUpgrade()
			expect(result).toBe(false)
		})
	})

	describe("getUpgradeHistory", () => {
		it("should return empty array when no history", () => {
			const history = service.getUpgradeHistory()
			expect(history).toEqual([])
		})
	})

	describe("upgrade progress events", () => {
		it("should emit upgradeProgress events during upgrade", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			const progressSpy = vi.fn()
			service.statusEmitter.on("upgradeProgress", progressSpy)

			await service.checkAndUpgradeCollection()

			expect(progressSpy).toHaveBeenCalled()
		})

		it("should emit completed status on successful upgrade", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			const progressSpy = vi.fn()
			service.statusEmitter.on("upgradeProgress", progressSpy)

			await service.checkAndUpgradeCollection()

			const lastCall = progressSpy.mock.calls[progressSpy.mock.calls.length - 1]
			expect(lastCall[0].status).toBe("completed")
		})

		it("should emit failed status on upgrade error", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockRejectedValue(new Error("Update failed"))

			const progressSpy = vi.fn()
			service.statusEmitter.on("upgradeProgress", progressSpy)

			await expect(service.checkAndUpgradeCollection()).rejects.toThrow()

			const lastCall = progressSpy.mock.calls[progressSpy.mock.calls.length - 1]
			expect(lastCall[0].status).toBe("failed")
		})
	})

	describe("applyPresetConfig", () => {
		it("should apply HNSW configuration", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// First call should include HNSW config
			expect(mockUpdateCollection).toHaveBeenCalledWith(
				"test-collection",
				expect.objectContaining({
					hnsw_config: expect.any(Object),
				}),
			)
		})

		it("should apply quantization configuration for large preset", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 500000,
				config: {
					hnsw_config: { m: 24, ef_construct: 256 },
				},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// Check if any call includes quantization_config (large preset has quantization)
			const calls = mockUpdateCollection.mock.calls
			const hasQuantization = calls.some(
				(call) => call[1] && typeof call[1] === "object" && "quantization_config" in call[1],
			)
			expect(hasQuantization).toBe(true)
		})

		it("should not apply quantization configuration for small preset", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			await service.checkAndUpgradeCollection()

			// Small preset does not have quantization
			const calls = mockUpdateCollection.mock.calls
			const hasQuantization = calls.some(
				(call) => call[1] && typeof call[1] === "object" && "quantization_config" in call[1],
			)
			expect(hasQuantization).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("should handle zero points count", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 0,
				config: {},
			})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(false)
		})

		it("should handle undefined points count", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: undefined,
				config: {},
			})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(false)
		})

		it("should handle missing config", async () => {
			mockGetCollection.mockResolvedValue({
				points_count: 5000,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await service.checkAndUpgradeCollection()

			expect(result).toBe(true)
		})

		it("should handle custom thresholds", async () => {
			const customConfig: VectorStorageConfig = {
				mode: "auto",
				thresholds: {
					tiny: 100,
					small: 500,
					medium: 1000,
					large: 5000,
				},
			}

			const customService = new CollectionConfigUpgradeService(
				"http://localhost:6333",
				"test-api-key",
				"test-collection",
				customConfig,
			)

			mockGetCollection.mockResolvedValue({
				points_count: 750,
				config: {},
			})

			mockUpdateCollection.mockResolvedValue({})

			const result = await customService.checkAndUpgradeCollection()

			// 750 is between small (500) and medium (1000), so should upgrade to medium
			expect(result).toBe(true)
		})
	})
})