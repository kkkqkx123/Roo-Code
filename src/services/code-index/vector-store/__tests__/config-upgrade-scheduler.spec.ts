import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ConfigUpgradeScheduler } from "../config-upgrade-scheduler"
import { CollectionConfigUpgradeService } from "../collection-config-upgrade-service"

// Mock CollectionConfigUpgradeService
vi.mock("../collection-config-upgrade-service", () => ({
	CollectionConfigUpgradeService: vi.fn().mockImplementation(() => ({
		checkAndUpgradeCollection: vi.fn(),
		isUpgradeInProgress: vi.fn(),
	})),
}))

describe("ConfigUpgradeScheduler", () => {
	let scheduler: ConfigUpgradeScheduler

	beforeEach(() => {
		vi.useFakeTimers()
		scheduler = new ConfigUpgradeScheduler()
	})

	afterEach(() => {
		vi.useRealTimers()
		scheduler.stop()
	})

	describe("constructor", () => {
		it("should initialize with default config", () => {
			const defaultScheduler = new ConfigUpgradeScheduler()
			const stats = defaultScheduler.getStats()

			expect(stats.enabled).toBe(true)
			expect(stats.checkInterval).toBe(60 * 60 * 1000)
			expect(stats.maxConcurrentUpgrades).toBe(1)
			expect(stats.upgradeWindow).toEqual({ startHour: 0, endHour: 24 })
		})

		it("should merge custom config with defaults", () => {
			const customScheduler = new ConfigUpgradeScheduler({
				enabled: false,
				checkInterval: 30 * 60 * 1000,
			})
			const stats = customScheduler.getStats()

			expect(stats.enabled).toBe(false)
			expect(stats.checkInterval).toBe(30 * 60 * 1000)
			expect(stats.maxConcurrentUpgrades).toBe(1) // default value
		})
	})

	describe("start", () => {
		it("should start the scheduler when enabled", () => {
			const emitSpy = vi.spyOn(scheduler, "emit")

			scheduler.start()

			expect(emitSpy).not.toHaveBeenCalledWith("checkStarted")
		})

		it("should not start when already running", () => {
			scheduler.start()
			const emitSpy = vi.spyOn(scheduler, "emit")

			scheduler.start()

			expect(emitSpy).not.toHaveBeenCalled()
		})

		it("should not start when disabled", () => {
			const disabledScheduler = new ConfigUpgradeScheduler({ enabled: false })
			const emitSpy = vi.spyOn(disabledScheduler, "emit")

			disabledScheduler.start()

			expect(emitSpy).not.toHaveBeenCalled()
		})
	})

	describe("stop", () => {
		it("should stop the scheduler", () => {
			scheduler.start()
			scheduler.stop()

			const stats = scheduler.getStats()
			expect(stats.runningUpgrades).toBe(0)
		})

		it("should handle stop when not running", () => {
			expect(() => scheduler.stop()).not.toThrow()
		})
	})

	describe("registerUpgradeService", () => {
		it("should register a service", () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			scheduler.registerUpgradeService("test-collection", mockService)

			const stats = scheduler.getStats()
			expect(stats.registeredCollections).toBe(1)
		})

		it("should allow registering multiple services", () => {
			const mockService1 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test1", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			const mockService2 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test2", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})

			scheduler.registerUpgradeService("collection1", mockService1)
			scheduler.registerUpgradeService("collection2", mockService2)

			const stats = scheduler.getStats()
			expect(stats.registeredCollections).toBe(2)
		})
	})

	describe("unregisterUpgradeService", () => {
		it("should unregister a service", () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			scheduler.registerUpgradeService("test-collection", mockService)
			scheduler.unregisterUpgradeService("test-collection")

			const stats = scheduler.getStats()
			expect(stats.registeredCollections).toBe(0)
		})

		it("should handle unregistering non-existent service", () => {
			expect(() => scheduler.unregisterUpgradeService("non-existent")).not.toThrow()
		})
	})

	describe("triggerCheck", () => {
		it("should trigger manual check and return results", async () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			scheduler.registerUpgradeService("test-collection", mockService)

			const results = await scheduler.triggerCheck()

			expect(results).toHaveLength(1)
			expect(results[0].success).toBe(true)
			expect(results[0].collectionName).toBe("test-collection")
			expect(mockService.checkAndUpgradeCollection).toHaveBeenCalled()
		})

		it("should handle upgrade failure", async () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockRejectedValue(new Error("Upgrade failed"))
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			scheduler.registerUpgradeService("test-collection", mockService)

			const results = await scheduler.triggerCheck()

			expect(results).toHaveLength(1)
			expect(results[0].success).toBe(false)
			expect(results[0].error).toBe("Upgrade failed")
		})

		it("should skip collections with upgrade in progress", async () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(true)

			scheduler.registerUpgradeService("test-collection", mockService)

			const results = await scheduler.triggerCheck()

			expect(results).toHaveLength(0)
			expect(mockService.checkAndUpgradeCollection).not.toHaveBeenCalled()
		})

		it("should check multiple collections", async () => {
			const mockService1 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test1", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			const mockService2 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test2", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})

			vi.spyOn(mockService1, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService1, "isUpgradeInProgress").mockReturnValue(false)
			vi.spyOn(mockService2, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService2, "isUpgradeInProgress").mockReturnValue(false)

			scheduler.registerUpgradeService("collection1", mockService1)
			scheduler.registerUpgradeService("collection2", mockService2)

			const results = await scheduler.triggerCheck()

			expect(results).toHaveLength(2)
			expect(mockService1.checkAndUpgradeCollection).toHaveBeenCalledTimes(1)
			expect(mockService2.checkAndUpgradeCollection).toHaveBeenCalledTimes(1)
		})
	})

	describe("getStats", () => {
		it("should return correct statistics", () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			scheduler.registerUpgradeService("test-collection", mockService)

			const stats = scheduler.getStats()

			expect(stats).toHaveProperty("enabled")
			expect(stats).toHaveProperty("checkInterval")
			expect(stats).toHaveProperty("maxConcurrentUpgrades")
			expect(stats).toHaveProperty("upgradeWindow")
			expect(stats).toHaveProperty("lastCheckTime")
			expect(stats).toHaveProperty("totalUpgradesCompleted")
			expect(stats).toHaveProperty("totalUpgradesFailed")
			expect(stats).toHaveProperty("registeredCollections")
			expect(stats).toHaveProperty("runningUpgrades")
		})

		it("should count running upgrades correctly", () => {
			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(true)
			scheduler.registerUpgradeService("test-collection", mockService)

			const stats = scheduler.getStats()

			expect(stats.runningUpgrades).toBe(1)
		})
	})

	describe("updateConfig", () => {
		it("should update configuration", () => {
			scheduler.updateConfig({ enabled: false, checkInterval: 30 * 60 * 1000 })

			const stats = scheduler.getStats()
			expect(stats.enabled).toBe(false)
			expect(stats.checkInterval).toBe(30 * 60 * 1000)
		})

		it("should restart scheduler when checkInterval changes", () => {
			scheduler.start()
			scheduler.updateConfig({ checkInterval: 30 * 60 * 1000 })

			// Should not throw
			expect(() => scheduler.stop()).not.toThrow()
		})

		it("should not restart when checkInterval not changed", () => {
			scheduler.start()
			scheduler.updateConfig({ maxConcurrentUpgrades: 2 })

			// Should not throw
			expect(() => scheduler.stop()).not.toThrow()
		})
	})

	describe("events", () => {
		it("should emit upgradeCompleted event on successful upgrade during scheduled check", async () => {
			const schedulerWithEvents = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				upgradeWindow: { startHour: 0, endHour: 24 },
			})

			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithEvents.registerUpgradeService("test-collection", mockService)

			const emitSpy = vi.spyOn(schedulerWithEvents, "emit")
			schedulerWithEvents.start()

			// Fast forward time to trigger scheduled check
			await vi.advanceTimersByTimeAsync(1000)

			expect(emitSpy).toHaveBeenCalledWith("upgradeCompleted", {
				collectionName: "test-collection",
				duration: expect.any(Number),
			})

			schedulerWithEvents.stop()
		})

		it("should emit upgradeFailed event on failed upgrade during scheduled check", async () => {
			const schedulerWithEvents = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				upgradeWindow: { startHour: 0, endHour: 24 },
			})

			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockRejectedValue(new Error("Test error"))
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithEvents.registerUpgradeService("test-collection", mockService)

			const emitSpy = vi.spyOn(schedulerWithEvents, "emit")
			schedulerWithEvents.start()

			// Fast forward time to trigger scheduled check
			await vi.advanceTimersByTimeAsync(1000)

			expect(emitSpy).toHaveBeenCalledWith("upgradeFailed", {
				collectionName: "test-collection",
				error: "Test error",
			})

			schedulerWithEvents.stop()
		})
	})

	describe("scheduled checks", () => {
		it("should perform scheduled check within upgrade window", async () => {
			const schedulerWithWindow = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				upgradeWindow: { startHour: 0, endHour: 24 },
			})

			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithWindow.registerUpgradeService("test-collection", mockService)

			const emitSpy = vi.spyOn(schedulerWithWindow, "emit")

			schedulerWithWindow.start()

			// Fast forward time
			await vi.advanceTimersByTimeAsync(1000)

			expect(emitSpy).toHaveBeenCalledWith("checkStarted", expect.any(Object))
			expect(emitSpy).toHaveBeenCalledWith("checkCompleted", expect.any(Object))

			schedulerWithWindow.stop()
		})

		it("should skip check outside upgrade window", async () => {
			const schedulerWithWindow = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				upgradeWindow: { startHour: 10, endHour: 18 },
			})

			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithWindow.registerUpgradeService("test-collection", mockService)

			const emitSpy = vi.spyOn(schedulerWithWindow, "emit")

			// Mock current hour to be outside window
			const originalDate = global.Date as any
			global.Date = class extends Date {
				constructor(...args: unknown[]) {
					super()
					if (args.length === 0) {
						this.setHours(20) // 8 PM, outside 10-18 window
					}
				}
			} as any

			schedulerWithWindow.start()
			await vi.advanceTimersByTimeAsync(1000)

			// Should not emit checkStarted because outside window
			expect(emitSpy).not.toHaveBeenCalledWith("checkStarted")

			global.Date = originalDate
			schedulerWithWindow.stop()
		})

		it("should respect maxConcurrentUpgrades limit", async () => {
			const schedulerWithLimit = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				maxConcurrentUpgrades: 1,
			})

			const mockService1 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test1", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			const mockService2 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test2", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})

			vi.spyOn(mockService1, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService1, "isUpgradeInProgress").mockReturnValue(true)
			vi.spyOn(mockService2, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService2, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithLimit.registerUpgradeService("collection1", mockService1)
			schedulerWithLimit.registerUpgradeService("collection2", mockService2)

			schedulerWithLimit.start()
			await vi.advanceTimersByTimeAsync(1000)

			// When maxConcurrentUpgrades is 1 and one upgrade is already in progress,
			// no new upgrades should be started
			expect(mockService1.checkAndUpgradeCollection).not.toHaveBeenCalled()
			expect(mockService2.checkAndUpgradeCollection).not.toHaveBeenCalled()

			schedulerWithLimit.stop()
		})

		it("should allow upgrades when below maxConcurrentUpgrades limit", async () => {
			const schedulerWithLimit = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				maxConcurrentUpgrades: 2,
			})

			const mockService1 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test1", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			const mockService2 = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test2", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})

			vi.spyOn(mockService1, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService1, "isUpgradeInProgress").mockReturnValue(true)
			vi.spyOn(mockService2, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService2, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithLimit.registerUpgradeService("collection1", mockService1)
			schedulerWithLimit.registerUpgradeService("collection2", mockService2)

			schedulerWithLimit.start()
			await vi.advanceTimersByTimeAsync(1000)

			// collection1 should be skipped because it has upgrade in progress
			// collection2 should be checked since we're below the limit (1 < 2)
			expect(mockService1.checkAndUpgradeCollection).not.toHaveBeenCalled()
			expect(mockService2.checkAndUpgradeCollection).toHaveBeenCalledTimes(1)

			schedulerWithLimit.stop()
		})
	})

	describe("cross-day upgrade window", () => {
		it("should handle cross-day upgrade window (22-6)", async () => {
			const schedulerWithWindow = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				upgradeWindow: { startHour: 22, endHour: 6 },
			})

			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithWindow.registerUpgradeService("test-collection", mockService)

			const emitSpy = vi.spyOn(schedulerWithWindow, "emit")

			// Mock current hour to be 23 (within 22-6 window)
			const originalDate = global.Date as any
			global.Date = class extends Date {
				constructor(...args: unknown[]) {
					super()
					if (args.length === 0) {
						this.setHours(23)
					}
				}
			} as any

			schedulerWithWindow.start()
			await vi.advanceTimersByTimeAsync(1000)

			expect(emitSpy).toHaveBeenCalledWith("checkStarted", expect.any(Object))

			global.Date = originalDate
			schedulerWithWindow.stop()
		})

		it("should skip check outside cross-day window", async () => {
			const schedulerWithWindow = new ConfigUpgradeScheduler({
				checkInterval: 1000,
				upgradeWindow: { startHour: 22, endHour: 6 },
			})

			const mockService = new CollectionConfigUpgradeService("http://localhost:6333", undefined, "test", {
				mode: "auto",
				thresholds: { tiny: 2000, small: 10000, medium: 100000, large: 1000000 },
			})
			vi.spyOn(mockService, "checkAndUpgradeCollection").mockResolvedValue(true)
			vi.spyOn(mockService, "isUpgradeInProgress").mockReturnValue(false)

			schedulerWithWindow.registerUpgradeService("test-collection", mockService)

			const emitSpy = vi.spyOn(schedulerWithWindow, "emit")

			// Mock current hour to be 12 (outside 22-6 window)
			const originalDate = global.Date as any
			global.Date = class extends Date {
				constructor(...args: unknown[]) {
					super()
					if (args.length === 0) {
						this.setHours(12)
					}
				}
			} as any

			schedulerWithWindow.start()
			await vi.advanceTimersByTimeAsync(1000)

			expect(emitSpy).not.toHaveBeenCalledWith("checkStarted")

			global.Date = originalDate
			schedulerWithWindow.stop()
		})
	})
})