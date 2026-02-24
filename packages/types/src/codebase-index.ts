import { z } from "zod"

/**
 * Codebase Index Constants
 */
export const CODEBASE_INDEX_DEFAULTS = {
	MIN_SEARCH_RESULTS: 10,
	MAX_SEARCH_RESULTS: 200,
	DEFAULT_SEARCH_RESULTS: 50,
	SEARCH_RESULTS_STEP: 10,
	MIN_SEARCH_SCORE: 0,
	MAX_SEARCH_SCORE: 1,
	DEFAULT_SEARCH_MIN_SCORE: 0.4,
	SEARCH_SCORE_STEP: 0.05,
} as const

/**
 * Vector Storage Configuration Types
 */

/**
 * Vector storage mode
 * auto: Automatically select preset based on codebase size
 * tiny/small/medium/large: Use specific preset directly
 */
export type VectorStorageMode = "auto" | "tiny" | "small" | "medium" | "large"

/**
 * Vector storage preset types (kept for backward compatibility)
 * @deprecated Use VectorStorageMode instead
 */
export type VectorStoragePreset = "tiny" | "small" | "medium" | "large"

export const vectorStorageModeSchema = z.enum(["auto", "tiny", "small", "medium", "large"])

export const vectorStoragePresetSchema = z.enum(["tiny", "small", "medium", "large"])

/**
 * CodebaseIndexConfig
 */

export const codebaseIndexConfigSchema = z.object({
	codebaseIndexEnabled: z.boolean().optional(),
	codebaseIndexQdrantUrl: z.string().optional(),
	codebaseIndexEmbedderProvider: z.enum(["openai", "openai-compatible", "gemini"]).optional(),
	codebaseIndexEmbedderBaseUrl: z.string().optional(),
	codebaseIndexEmbedderModelId: z.string().optional(),
	codebaseIndexEmbedderModelDimension: z.number().optional(),
	codebaseIndexSearchMinScore: z.number().min(0).max(1).optional(),
	codebaseIndexSearchMaxResults: z
		.number()
		.min(CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS)
		.max(CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS)
		.optional(),
	// OpenAI Compatible specific fields
	codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
	codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
	// Indexing behavior configuration
	// manualIndexingOnly: If true, indexing only starts when user clicks "Start Indexing"
	// If false, indexing starts automatically when extension activates
	manualIndexingOnly: z.boolean().optional(),
	// autoUpdateIndex: If true, index is automatically updated based on file changes
	// If false, index is only built at startup and not updated via file watching
	autoUpdateIndex: z.boolean().optional(),
	// Vector storage configuration
	vectorStorageMode: vectorStorageModeSchema.optional(),
	vectorStoragePreset: vectorStoragePresetSchema.optional(),
	// Vector storage thresholds for auto mode
	vectorStorageThresholds: z
		.object({
			tiny: z.number().optional(),
			small: z.number().optional(),
			medium: z.number().optional(),
			large: z.number().optional(),
		})
		.optional(),
})

export type CodebaseIndexConfig = z.infer<typeof codebaseIndexConfigSchema>

/**
 * CodebaseIndexModels
 */

export const codebaseIndexModelsSchema = z.object({
	openai: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	"openai-compatible": z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	gemini: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
})

export type CodebaseIndexModels = z.infer<typeof codebaseIndexModelsSchema>

/**
 * CdebaseIndexProvider
 */

export const codebaseIndexProviderSchema = z.object({
	codeIndexOpenAiKey: z.string().optional(),
	codeIndexQdrantApiKey: z.string().optional(),
	codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
	codebaseIndexOpenAiCompatibleApiKey: z.string().optional(),
	codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
	codebaseIndexGeminiApiKey: z.string().optional(),
})

export type CodebaseIndexProvider = z.infer<typeof codebaseIndexProviderSchema>
