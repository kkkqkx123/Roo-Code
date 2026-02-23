import { EventEmitter } from "events"
import { CollectionConfigUpgradeService } from "./collection-config-upgrade-service"
import { SchedulerConfig, DEFAULT_SCHEDULER_CONFIG, UpgradeCheckResult } from "../interfaces/collection-config-upgrade"

/**
 * Scheduler for automatic collection configuration upgrades
 * Periodically checks collections and triggers upgrades when needed
 */
export class ConfigUpgradeScheduler extends EventEmitter {
	private config: SchedulerConfig
	private upgradeServices: Map<string, CollectionConfigUpgradeService> = new Map()
	private timer: NodeJS.Timeout | null = null
	private lastCheckTime: number = 0
	private totalUpgradesCompleted: number = 0
	private totalUpgradesFailed: number = 0

	constructor(config: Partial<SchedulerConfig> = {}) {
		super()
		this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config }
	}

	/**
	 * Starts the scheduler
	 */
	public start(): void {
		if (this.timer) {
			console.warn("[ConfigUpgradeScheduler] Scheduler is already running")
			return
		}

		if (!this.config.enabled) {
			console.log("[ConfigUpgradeScheduler] Scheduler is disabled")
			return
		}

		console.log("[ConfigUpgradeScheduler] Starting scheduler with interval:", this.config.checkInterval)
		this.scheduleNextCheck()
	}

	/**
	 * Stops the scheduler
	 */
	public stop(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
			console.log("[ConfigUpgradeScheduler] Scheduler stopped")
		}
	}

	/**
	 * Registers a collection upgrade service
	 */
	public registerUpgradeService(
		collectionName: string,
		service: CollectionConfigUpgradeService,
	): void {
		this.upgradeServices.set(collectionName, service)
		console.log(`[ConfigUpgradeScheduler] Registered upgrade service for ${collectionName}`)
	}

	/**
	 * Unregisters a collection upgrade service
	 */
	public unregisterUpgradeService(collectionName: string): void {
		this.upgradeServices.delete(collectionName)
		console.log(`[ConfigUpgradeScheduler] Unregistered upgrade service for ${collectionName}`)
	}

	/**
	 * Schedules the next check
	 */
	private scheduleNextCheck(): void {
		if (!this.config.enabled) {
			return
		}

		this.timer = setTimeout(() => {
			this.performCheck().catch((error) => {
				console.error("[ConfigUpgradeScheduler] Error during scheduled check:", error)
			})
		}, this.config.checkInterval)
	}

	/**
	 * Performs a check on all registered collections
	 */
	private async performCheck(): Promise<void> {
		this.lastCheckTime = Date.now()
		this.emit("checkStarted", { checkTime: this.lastCheckTime })

		try {
			// 1. Check if within upgrade time window
			const currentHour = new Date().getHours()
			const { startHour, endHour } = this.config.upgradeWindow

			if (!this.isWithinUpgradeWindow(currentHour, startHour, endHour)) {
				console.log("[ConfigUpgradeScheduler] Outside upgrade window, skipping check")
				this.scheduleNextCheck()
				return
			}

			// 2. Check concurrent limit
			const runningUpgrades = this.countRunningUpgrades()
			if (runningUpgrades >= this.config.maxConcurrentUpgrades) {
				console.log(
					`[ConfigUpgradeScheduler] Maximum concurrent upgrades reached (${runningUpgrades}), skipping check`,
				)
				this.scheduleNextCheck()
				return
			}

			// 3. Check all collections
			const upgradeResults = await this.checkAllCollections()

			for (const result of upgradeResults) {
				if (result.success) {
					this.totalUpgradesCompleted++
					this.emit("upgradeCompleted", {
						collectionName: result.collectionName,
						duration: result.duration,
					})
				} else {
					this.totalUpgradesFailed++
					this.emit("upgradeFailed", {
						collectionName: result.collectionName,
						error: result.error,
					})
				}
			}
		} catch (error) {
			console.error("[ConfigUpgradeScheduler] Error during check:", error)
			this.emit("checkError", { error })
		} finally {
			this.emit("checkCompleted", {
				checkTime: this.lastCheckTime,
				duration: Date.now() - this.lastCheckTime,
			})
			this.scheduleNextCheck()
		}
	}

	/**
	 * Checks all registered collections for upgrades
	 */
	private async checkAllCollections(): Promise<UpgradeCheckResult[]> {
		const results: UpgradeCheckResult[] = []

		for (const [collectionName, service] of this.upgradeServices.entries()) {
			// Skip if upgrade is already in progress
			if (service.isUpgradeInProgress()) {
				console.log(`[ConfigUpgradeScheduler] Upgrade already in progress for ${collectionName}, skipping`)
				continue
			}

			const startTime = Date.now()
			try {
				const needsUpgrade = await service.checkAndUpgradeCollection()
				const duration = Date.now() - startTime

				results.push({
					success: true,
					collectionName,
					needsUpgrade,
					duration,
				})

				if (needsUpgrade) {
					console.log(`[ConfigUpgradeScheduler] Upgrade completed for ${collectionName} in ${duration}ms`)
				}
			} catch (error: unknown) {
				const duration = Date.now() - startTime
				const errorMessage = error instanceof Error ? error.message : String(error)
				results.push({
					success: false,
					collectionName,
					needsUpgrade: false,
					duration,
					error: errorMessage,
				})
				console.error(`[ConfigUpgradeScheduler] Upgrade check failed for ${collectionName}:`, error)
			}
		}

		return results
	}

	/**
	 * Checks if current time is within upgrade window
	 */
	private isWithinUpgradeWindow(currentHour: number, startHour: number, endHour: number): boolean {
		if (startHour <= endHour) {
			// Same day window (e.g., 0-24)
			return currentHour >= startHour && currentHour < endHour
		} else {
			// Cross-day window (e.g., 22-6)
			return currentHour >= startHour || currentHour < endHour
		}
	}

	/**
	 * Counts the number of currently running upgrades
	 */
	private countRunningUpgrades(): number {
		let count = 0
		for (const service of this.upgradeServices.values()) {
			if (service.isUpgradeInProgress()) {
				count++
			}
		}
		return count
	}

	/**
	 * Triggers an immediate check (manual trigger)
	 */
	public async triggerCheck(): Promise<UpgradeCheckResult[]> {
		console.log("[ConfigUpgradeScheduler] Manual check triggered")
		return this.checkAllCollections()
	}

	/**
	 * Gets scheduler statistics
	 */
	public getStats() {
		return {
			enabled: this.config.enabled,
			checkInterval: this.config.checkInterval,
			maxConcurrentUpgrades: this.config.maxConcurrentUpgrades,
			upgradeWindow: this.config.upgradeWindow,
			lastCheckTime: this.lastCheckTime,
			totalUpgradesCompleted: this.totalUpgradesCompleted,
			totalUpgradesFailed: this.totalUpgradesFailed,
			registeredCollections: this.upgradeServices.size,
			runningUpgrades: this.countRunningUpgrades(),
		}
	}

	/**
	 * Updates scheduler configuration
	 */
	public updateConfig(config: Partial<SchedulerConfig>): void {
		this.config = { ...this.config, ...config }
		console.log("[ConfigUpgradeScheduler] Configuration updated:", this.config)

		// Restart scheduler if interval changed
		if (config.checkInterval !== undefined && this.timer) {
			this.stop()
			this.start()
		}
	}
}