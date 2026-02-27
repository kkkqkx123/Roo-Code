/**
 * Vector storage configuration interfaces for Qdrant
 * Simplified version with unified disk storage (on_disk always true)
 */

/**
 * HNSW index configuration
 */
export interface HnswConfig {
	/** Number of connections per node (2-128) */
	m: number
	/** Search depth during construction (10-1000) */
	ef_construct: number
}

/**
 * Vector configuration
 */
export interface VectorConfig {
	/** Always true - unified disk storage */
	on_disk: true
	/** Quantization configuration for memory optimization */
	quantization?: QuantizationConfig
}

/**
 * Quantization configuration
 */
export interface QuantizationConfig {
	/** Whether quantization is enabled */
	enabled: boolean
	/** Quantization type */
	type: "scalar" | "product"
	/** Number of bits for quantization (typically 8) */
	bits?: number
}

/**
 * Write-Ahead Log configuration
 */
export interface WalConfig {
	/** WAL file maximum capacity in MB */
	capacity_mb: number
	/** Number of WAL segments */
	segments: number
}

/**
 * Custom vector storage configuration
 */
export interface CustomVectorStorageConfig {
	/** HNSW index configuration */
	hnsw?: HnswConfig
	/** Vector configuration */
	vectors: VectorConfig
	/** WAL configuration */
	wal?: WalConfig
}

/**
 * Vector storage configuration mode
 * auto: Automatically select preset based on codebase size
 * preset: Use a specific preset (tiny/small/medium/large)
 * custom: Use custom configuration
 */
export type VectorStorageMode = "auto" | "preset" | "custom"

/**
 * Vector storage configuration
 */
export interface VectorStorageConfig {
	/** Configuration mode */
	mode: VectorStorageMode
	/** Preset to use (only used when mode is "preset") */
	preset?: VectorStoragePreset
	/** Custom configuration (only used when mode is "custom") */
	customConfig?: CustomVectorStorageConfig
	/** Thresholds for auto mode - determines when to switch between presets */
	thresholds?: {
		tiny: number
		small: number
		medium: number
		large: number
	}
}

/**
 * Vector storage preset types
 */
export type VectorStoragePreset = "tiny" | "small" | "medium" | "large"

/**
 * Vector storage preset definitions
 */
export interface VectorStoragePresetDefinition {
	/** HNSW configuration */
	hnsw?: HnswConfig
	/** Vector configuration */
	vectors: VectorConfig
	/** WAL configuration */
	wal?: WalConfig
	/** Custom configuration */
	customConfig: CustomVectorStorageConfig
}

/**
 * Default vector storage configuration
 */
export const DEFAULT_VECTOR_STORAGE_CONFIG: VectorStorageConfig = {
	mode: "auto",
	thresholds: {
		tiny: 2000, // < 2000: tiny
		small: 10000, // < 10000: small
		medium: 100000, // < 100000: medium
		large: 1000000, // >= 100000: large
	},
}

/**
 * Vector storage presets
 * All configurations use unified disk storage (on_disk: true)
 */
export const VECTOR_STORAGE_PRESETS: Record<VectorStoragePreset, VectorStoragePresetDefinition> = {
	tiny: {
		hnsw: undefined, // No HNSW - full table scan
		vectors: {
			on_disk: true,
		},
		wal: {
			capacity_mb: 16,
			segments: 1,
		},
		customConfig: {
			vectors: {
				on_disk: true,
			},
			wal: {
				capacity_mb: 16,
				segments: 1,
			},
		},
	},
	small: {
		hnsw: {
			m: 16,
			ef_construct: 128,
		},
		vectors: {
			on_disk: true,
		},
		wal: {
			capacity_mb: 32,
			segments: 2,
		},
		customConfig: {
			hnsw: {
				m: 16,
				ef_construct: 128,
			},
			vectors: {
				on_disk: true,
			},
			wal: {
				capacity_mb: 32,
				segments: 2,
			},
		},
	},
	medium: {
		hnsw: {
			m: 24,
			ef_construct: 256,
		},
		vectors: {
			on_disk: true,
		},
		wal: {
			capacity_mb: 64,
			segments: 4,
		},
		customConfig: {
			hnsw: {
				m: 24,
				ef_construct: 256,
			},
			vectors: {
				on_disk: true,
			},
			wal: {
				capacity_mb: 64,
				segments: 4,
			},
		},
	},
	large: {
		hnsw: {
			m: 32,
			ef_construct: 256,
		},
		vectors: {
			on_disk: true,
			quantization: {
				enabled: true,
				type: "scalar",
				bits: 8,
			},
		},
		wal: {
			capacity_mb: 128,
			segments: 8,
		},
		customConfig: {
			hnsw: {
				m: 32,
				ef_construct: 256,
			},
			vectors: {
				on_disk: true,
				quantization: {
					enabled: true,
					type: "scalar",
					bits: 8,
				},
			},
			wal: {
				capacity_mb: 128,
				segments: 8,
			},
		},
	},
}

/**
 * Default custom configuration (medium preset)
 */
export const DEFAULT_CUSTOM_VECTOR_STORAGE_CONFIG: CustomVectorStorageConfig = VECTOR_STORAGE_PRESETS.medium.customConfig