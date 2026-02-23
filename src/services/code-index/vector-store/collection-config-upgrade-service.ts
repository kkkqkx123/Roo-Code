import { QdrantClient } from "@qdrant/js-client-rest"
import { EventEmitter } from "events"
import {
	VectorStorageConfig,
	VectorStoragePreset,
	VECTOR_STORAGE_PRESETS,
} from "../interfaces/vector-storage-config"
import {
	UpgradeProgress,
	UpgradeStep,
	UpgradeCheckResult,
	UpgradeStatus,
} from "../interfaces/collection-config-upgrade"

/**
 * Service for managing Qdrant collection configuration upgrades
 * Handles automatic detection, planning, and execution of configuration upgrades
 */
export class CollectionConfigUpgradeService extends EventEmitter {
	private qdrantClient: QdrantClient
	private collectionName: string
	private config: VectorStorageConfig
	private thresholds: { tiny: number; small: number; medium: number; large: number }

	// Upgrade state
	private currentUpgrades: Map<string, UpgradeProgress> = new Map()
	private upgradeHistory: Map<string, UpgradeProgress[]> = new Map()
	private _cancellationRequested: boolean = false
	private _pauseRequested: boolean = false
	private _pausedStepIndex: number = 0

	// Status emitter
	private _statusEmitter = new EventEmitter()

	constructor(
		qdrantUrl: string,
		apiKey: string | undefined,
		collectionName: string,
		config: VectorStorageConfig,
	) {
		super()
		this.qdrantClient = new QdrantClient({ url: qdrantUrl, apiKey })
		this.collectionName = collectionName
		this.config = config
		this.thresholds = config.thresholds ?? { tiny: 2000, small: 10000, medium: 100000, large: 1000000 }
	}

	/**
	 * Gets the status emitter for upgrade progress events
	 */
	get statusEmitter() {
		return this._statusEmitter
	}

	/**
	 * Checks if an upgrade is currently in progress
	 */
	isUpgradeInProgress(): boolean {
		const currentUpgrade = this.currentUpgrades.get(this.collectionName)
		return currentUpgrade?.status === "in_progress" || currentUpgrade?.status === "paused"
	}

	/**
	 * Gets the current upgrade progress
	 */
	getCurrentUpgrade(): UpgradeProgress | undefined {
		return this.currentUpgrades.get(this.collectionName)
	}

	/**
	 * Checks and upgrades the collection if needed
	 * @returns true if upgrade was performed, false if no upgrade needed
	 */
	public async checkAndUpgradeCollection(): Promise<boolean> {
		try {
			// 1. Get collection information
			const collectionInfo = await this.qdrantClient.getCollection(this.collectionName)
			const currentSize = collectionInfo.points_count || 0

			// 2. Determine target preset
			const targetPreset = this.determineTargetPreset(currentSize)

			// 3. Detect current preset
			const currentPreset = this.detectCurrentPreset(collectionInfo.config)

			// 4. Check if upgrade is needed
			if (currentPreset === targetPreset) {
				return false // No upgrade needed
			}

			// 5. Calculate upgrade path
			const upgradePath = this.calculateUpgradePath(currentPreset, targetPreset)
			if (upgradePath.length === 0) {
				return false // No valid upgrade path
			}

			// 6. Execute upgrade
			await this.executeUpgrade(collectionInfo, upgradePath)
			return true
		} catch (error) {
			console.error(
				`[CollectionConfigUpgradeService] Failed to check and upgrade collection ${this.collectionName}:`,
				error,
			)
			throw error
		}
	}

	/**
	 * Determines the target preset based on collection size
	 */
	private determineTargetPreset(currentSize: number): VectorStoragePreset {
		if (currentSize < this.thresholds.tiny) {
			return "tiny"
		} else if (currentSize < this.thresholds.small) {
			return "small"
		} else if (currentSize < this.thresholds.medium) {
			return "medium"
		} else {
			return "large"
		}
	}

	/**
	 * Detects the current preset from collection configuration
	 */
	private detectCurrentPreset(config: Record<string, unknown>): VectorStoragePreset | null {
		const hnswConfig = config.hnsw_config as Record<string, unknown> | undefined
		const vectorsConfig = config.vectors_config
		const quantizationConfig = config.quantization_config

		// No HNSW config = tiny
		if (!hnswConfig) {
			return "tiny"
		}

		const m = (hnswConfig as Record<string, unknown>).m as number | undefined
		const efConstruct = (hnswConfig as Record<string, unknown>).ef_construct as number | undefined

		// Determine preset based on HNSW parameters
		if (m === 16 && efConstruct === 128) {
			return "small"
		} else if (m === 32 && efConstruct === 256) {
			return "medium"
		} else if (m === 64 && efConstruct === 512) {
			return "large"
		}

		return null
	}

	/**
	 * Calculates the upgrade path from current to target preset
	 * Supports gradual upgrades, no cross-level jumps
	 */
	private calculateUpgradePath(
		currentPreset: VectorStoragePreset | null,
		targetPreset: VectorStoragePreset,
	): VectorStoragePreset[] {
		const presetOrder: VectorStoragePreset[] = ["tiny", "small", "medium", "large"]

		if (!currentPreset) {
			return [targetPreset]
		}

		const currentIndex = presetOrder.indexOf(currentPreset)
		const targetIndex = presetOrder.indexOf(targetPreset)

		if (currentIndex === -1 || targetIndex === -1) {
			return []
		}

		// Only support upward upgrades, return all intermediate levels
		if (targetIndex > currentIndex) {
			return presetOrder.slice(currentIndex + 1, targetIndex + 1)
		}

		return [] // Don't support downgrades
	}

	/**
	 * Executes the upgrade process
	 */
	private async executeUpgrade(
		collectionInfo: Record<string, unknown>,
		upgradePath: VectorStoragePreset[],
		startStepIndex: number = 0,
	): Promise<void> {
		const currentPreset = this.detectCurrentPreset((collectionInfo as Record<string, unknown>).config as Record<string, unknown>)
		const targetPreset = upgradePath[upgradePath.length - 1]
		const currentSize = collectionInfo.points_count || 0

		// Create upgrade progress object
		const progress: UpgradeProgress = {
			collectionName: this.collectionName,
			currentPreset,
			targetPreset,
			status: "in_progress",
			progress: 0,
			message: `Starting upgrade from ${currentPreset} to ${targetPreset}`,
			startTime: Date.now(),
			steps: [],
			previousConfig: collectionInfo.config,
		}

		this.currentUpgrades.set(this.collectionName, progress)
		this._statusEmitter.emit("upgradeProgress", { ...progress })

		try {
			for (let i = startStepIndex; i < upgradePath.length; i++) {
				// Check for cancellation/pause requests
				if (this._cancellationRequested) {
					throw new Error("Upgrade was cancelled by user")
				}

				if (this._pauseRequested) {
					this._pauseRequested = false
					progress.status = "paused"
					this.currentUpgrades.set(this.collectionName, { ...progress })
					this._statusEmitter.emit("upgradeProgress", { ...progress })
					return
				}

				// Create step object
				const preset = upgradePath[i]
				const step: UpgradeStep = {
					preset,
					status: "in_progress",
					startTime: Date.now(),
				}

				progress.steps.push(step)
				progress.progress = (i / upgradePath.length) * 100
				progress.message = `Applying ${preset} configuration (${i + 1}/${upgradePath.length})`
				this.currentUpgrades.set(this.collectionName, { ...progress })
				this._statusEmitter.emit("upgradeProgress", { ...progress })

				// Apply configuration
				await this.applyPresetConfig(preset)

				// Mark step as completed
				step.status = "completed"
				step.endTime = Date.now()
				progress.progress = ((i + 1) / upgradePath.length) * 100

				// Send progress update
				this.currentUpgrades.set(this.collectionName, { ...progress })
				this._statusEmitter.emit("upgradeProgress", { ...progress })
			}

			// Upgrade completed
			progress.status = "completed"
			progress.progress = 100
			progress.message = `Successfully upgraded from ${currentPreset} to ${targetPreset}`
			progress.endTime = Date.now()

			this.currentUpgrades.delete(this.collectionName)
			this._statusEmitter.emit("upgradeProgress", { ...progress })

			// Record history
			const history = this.upgradeHistory.get(this.collectionName) || []
			history.push(progress)
			this.upgradeHistory.set(this.collectionName, history)
		} catch (error: unknown) {
			// Upgrade failed
			progress.status = "failed"
			const errorMessage = error instanceof Error ? error.message : String(error)
			progress.error = errorMessage
			progress.message = `Upgrade failed: ${errorMessage}`
			progress.endTime = Date.now()

			this.currentUpgrades.delete(this.collectionName)
			this._statusEmitter.emit("upgradeProgress", { ...progress })

			const history = this.upgradeHistory.get(this.collectionName) || []
			history.push(progress)
			this.upgradeHistory.set(this.collectionName, history)

			throw error
		}
	}

	/**
	 * Applies preset configuration to the collection
	 */
	private async applyPresetConfig(preset: VectorStoragePreset): Promise<void> {
		const presetConfig = VECTOR_STORAGE_PRESETS[preset]

		// Apply HNSW configuration
		if (presetConfig.customConfig.hnsw) {
			await this.qdrantClient.updateCollection(this.collectionName, {
				hnsw_config: presetConfig.customConfig.hnsw,
				optimizers_config: {
					indexing_threshold: 0, // Disable background optimizer threshold
				},
			})
		}

		// Apply quantization configuration
		if (presetConfig.customConfig.vectors.quantization?.enabled) {
			await this.qdrantClient.updateCollection(this.collectionName, {
				quantization_config: {
					scalar: {
						type: "int8",
					},
				},
			})
		}
	}

	/**
	 * Pauses the current upgrade
	 */
	public pauseUpgrade(): boolean {
		const currentUpgrade = this.currentUpgrades.get(this.collectionName)
		if (!currentUpgrade || currentUpgrade.status !== "in_progress") {
			return false
		}

		this._pauseRequested = true
		this._pausedStepIndex = currentUpgrade.steps.length
		currentUpgrade.status = "paused"
		currentUpgrade.message = "Upgrade paused by user"
		this.currentUpgrades.set(this.collectionName, { ...currentUpgrade })
		this._statusEmitter.emit("upgradeProgress", { ...currentUpgrade })
		return true
	}

	/**
	 * Resumes a paused upgrade
	 */
	public async resumeUpgrade(): Promise<boolean> {
		const currentUpgrade = this.currentUpgrades.get(this.collectionName)
		if (!currentUpgrade || currentUpgrade.status !== "paused") {
			return false
		}

		this._pauseRequested = false
		const pausedStepIndex = this._pausedStepIndex

		currentUpgrade.status = "in_progress"
		currentUpgrade.message = "Resuming upgrade..."
		this.currentUpgrades.set(this.collectionName, { ...currentUpgrade })
		this._statusEmitter.emit("upgradeProgress", { ...currentUpgrade })

		// Resume from paused step
		const upgradePath = currentUpgrade.steps.map((s) => s.preset).filter(Boolean) as VectorStoragePreset[]
		const collectionInfo = await this.qdrantClient.getCollection(this.collectionName)
		await this.executeUpgrade(collectionInfo, upgradePath, pausedStepIndex)
		return true
	}

	/**
	 * Cancels the current upgrade
	 */
	public cancelUpgrade(): boolean {
		const currentUpgrade = this.currentUpgrades.get(this.collectionName)
		if (!currentUpgrade || currentUpgrade.status !== "in_progress") {
			return false
		}

		this._cancellationRequested = true
		currentUpgrade.status = "cancelled"
		currentUpgrade.message = "Upgrade cancelled by user"
		currentUpgrade.endTime = Date.now()
		this.currentUpgrades.delete(this.collectionName)
		this._statusEmitter.emit("upgradeProgress", { ...currentUpgrade })

		// Record history
		const history = this.upgradeHistory.get(this.collectionName) || []
		history.push(currentUpgrade)
		this.upgradeHistory.set(this.collectionName, history)

		return true
	}

	/**
	 * Rolls back the last upgrade
	 */
	public async rollbackUpgrade(): Promise<boolean> {
		const history = this.upgradeHistory.get(this.collectionName) || []
		const lastUpgrade = history[history.length - 1]

		if (!lastUpgrade || lastUpgrade.status !== "completed") {
			return false
		}

		if (!lastUpgrade.previousConfig) {
			console.error("Cannot rollback: No previous config saved")
			return false
		}

		try {
			// Restore HNSW configuration
			if (lastUpgrade.previousConfig.hnsw_config) {
				await this.qdrantClient.updateCollection(this.collectionName, {
					hnsw_config: lastUpgrade.previousConfig.hnsw_config,
				})
			}

			// Restore quantization configuration
			if (lastUpgrade.previousConfig.quantization_config) {
				await this.qdrantClient.updateCollection(this.collectionName, {
					quantization_config: lastUpgrade.previousConfig.quantization_config,
				})
			}

			return true
		} catch (error) {
			console.error("Rollback failed:", error)
			return false
		}
	}

	/**
	 * Gets upgrade history for the collection
	 */
	public getUpgradeHistory(): UpgradeProgress[] {
		return this.upgradeHistory.get(this.collectionName) || []
	}
}