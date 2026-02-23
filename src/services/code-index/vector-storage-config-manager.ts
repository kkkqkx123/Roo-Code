import { QdrantClient, Schemas } from "@qdrant/js-client-rest"
import {
	VectorStorageConfig,
	CustomVectorStorageConfig,
	VectorStoragePreset,
	DEFAULT_VECTOR_STORAGE_CONFIG,
	VECTOR_STORAGE_PRESETS,
	DEFAULT_CUSTOM_VECTOR_STORAGE_CONFIG,
} from "./interfaces/vector-storage-config"
import { SizeEstimationResult } from "./token-based-size-estimator"

/**
 * Manages vector storage configuration for Qdrant collections
 * Handles auto, preset, and custom configuration modes
 */
export class VectorStorageConfigManager {
	private config: VectorStorageConfig
	private client: QdrantClient
	private collectionName: string

	constructor(
		config: VectorStorageConfig,
		client: QdrantClient,
		collectionName: string,
	) {
		this.config = config
		this.client = client
		this.collectionName = collectionName
	}

	/**
	 * Gets the collection configuration based on current settings
	 * For auto mode, estimates collection size and selects appropriate preset
	 * For preset mode, uses the specified preset
	 * For custom mode, uses the custom configuration
	 */
	async getCollectionConfig(): Promise<CustomVectorStorageConfig> {
		if (this.config.mode === "auto") {
			const collectionSize = await this.estimateCollectionSize()
			return this.getAutoConfig(collectionSize)
		}
		if (this.config.mode === "preset") {
			const preset = this.config.preset ?? "medium"
			return VECTOR_STORAGE_PRESETS[preset].customConfig
		}
		// custom mode
		return this.config.customConfig ?? DEFAULT_CUSTOM_VECTOR_STORAGE_CONFIG
	}

	/**
	 * Gets the collection configuration based on estimation result
	 * Used before indexing to set initial configuration based on estimated size
	 * @param estimation The size estimation result
	 * @returns The appropriate configuration for the estimated size
	 */
	getCollectionConfigFromEstimation(estimation: SizeEstimationResult): CustomVectorStorageConfig {
		if (this.config.mode === "auto") {
			return this.getAutoConfig(estimation.estimatedVectorCount)
		}
		if (this.config.mode === "preset") {
			const preset = this.config.preset ?? "medium"
			return VECTOR_STORAGE_PRESETS[preset].customConfig
		}
		// custom mode
		return this.config.customConfig ?? DEFAULT_CUSTOM_VECTOR_STORAGE_CONFIG
	}

	/**
	 * Estimates the collection size based on current point count
	 */
	private async estimateCollectionSize(): Promise<number> {
		try {
			const collectionInfo = await this.client.getCollection(this.collectionName)
			return collectionInfo.points_count ?? 0
		} catch (error) {
			// Collection doesn't exist or error occurred
			// Return 0 to use tiny preset for new collections
			return 0
		}
	}

	/**
	 * Gets the appropriate configuration based on collection size (auto mode)
	 */
	private getAutoConfig(collectionSize: number): CustomVectorStorageConfig {
		const thresholds = this.config.thresholds ?? DEFAULT_VECTOR_STORAGE_CONFIG.thresholds ?? { tiny: 100, small: 1000, medium: 10000 }

		if (collectionSize < thresholds.tiny) {
			return VECTOR_STORAGE_PRESETS.tiny.customConfig
		} else if (collectionSize < thresholds.small) {
			return VECTOR_STORAGE_PRESETS.small.customConfig
		} else if (collectionSize < thresholds.medium) {
			return VECTOR_STORAGE_PRESETS.medium.customConfig
		} else {
			return VECTOR_STORAGE_PRESETS.large.customConfig
		}
	}

	/**
	 * Updates the configuration
	 */
	updateConfig(config: Partial<VectorStorageConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Gets the current configuration
	 */
	getConfig(): VectorStorageConfig {
		return this.config
	}

	/**
	 * Validates a custom configuration
	 */
	static validateCustomConfig(config: CustomVectorStorageConfig): { valid: boolean; errors: string[] } {
		const errors: string[] = []

		// Validate HNSW configuration
		if (config.hnsw) {
			if (config.hnsw.m < 2 || config.hnsw.m > 128) {
				errors.push("HNSW m must be between 2 and 128")
			}
			if (config.hnsw.ef_construct < 10 || config.hnsw.ef_construct > 1000) {
				errors.push("HNSW ef_construct must be between 10 and 1000")
			}
		}

		// Validate vector configuration
		if (!config.vectors.on_disk) {
			errors.push("Vectors must have on_disk set to true (unified disk storage)")
		}

		// Validate quantization configuration
		if (config.vectors.quantization?.enabled) {
			if (config.vectors.quantization.type !== "scalar" && config.vectors.quantization.type !== "product") {
				errors.push("Quantization type must be 'scalar' or 'product'")
			}
			if (config.vectors.quantization.bits && (config.vectors.quantization.bits < 1 || config.vectors.quantization.bits > 16)) {
				errors.push("Quantization bits must be between 1 and 16")
			}
		}

		// Validate WAL configuration
		if (config.wal) {
			if (config.wal.capacity_mb < 1) {
				errors.push("WAL capacity_mb must be at least 1")
			}
			if (config.wal.segments < 1) {
				errors.push("WAL segments must be at least 1")
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		}
	}
}