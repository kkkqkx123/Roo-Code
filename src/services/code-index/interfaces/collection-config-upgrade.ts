import { VectorStoragePreset } from "./vector-storage-config"

/**
 * Upgrade status types
 */
export type UpgradeStatus =
	| "pending"
	| "in_progress"
	| "paused"
	| "completed"
	| "failed"
	| "rolling_back"
	| "cancelled"

/**
 * Upgrade progress information
 */
export interface UpgradeProgress {
	collectionName: string
	workspacePath?: string
	currentPreset: VectorStoragePreset | null
	targetPreset: VectorStoragePreset
	status: UpgradeStatus
	progress: number
	message: string
	startTime: number
	endTime?: number
	error?: string
	steps: UpgradeStep[]
	previousConfig?: any
}

/**
 * Individual upgrade step
 */
export interface UpgradeStep {
	preset?: VectorStoragePreset
	name?: string
	status: "pending" | "in_progress" | "completed" | "failed"
	startTime?: number
	endTime?: number
	error?: string
}

/**
 * Upgrade check result
 */
export interface UpgradeCheckResult {
	success: boolean
	collectionName: string
	needsUpgrade: boolean
	currentPreset?: VectorStoragePreset | null
	targetPreset?: VectorStoragePreset
	upgradePath?: VectorStoragePreset[]
	duration?: number
	error?: string
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
	enabled: boolean
	checkInterval: number // milliseconds
	maxConcurrentUpgrades: number
	upgradeWindow: {
		startHour: number
		endHour: number
	}
}

/**
 * Default scheduler configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
	enabled: true,
	checkInterval: 60 * 60 * 1000, // 1 hour
	maxConcurrentUpgrades: 1,
	upgradeWindow: {
		startHour: 0,
		endHour: 24,
	},
}