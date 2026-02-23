import { ApiHandlerOptions } from "../../../shared/api" // Adjust path if needed
import { EmbedderProvider } from "./manager"
import { VectorStorageConfig } from "./vector-storage-config"

/**
 * Configuration state for the code indexing feature
 */
export interface CodeIndexConfig {
	isConfigured: boolean
	embedderProvider: EmbedderProvider
	modelId?: string
	modelDimension?: number
	openAiOptions?: ApiHandlerOptions
	openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
	geminiOptions?: { apiKey: string }
	qdrantUrl?: string
	qdrantApiKey?: string
	searchMinScore?: number
	searchMaxResults?: number
}

/**
 * Snapshot of previous configuration used to determine if a restart is required
 */
export type PreviousConfigSnapshot = {
	enabled: boolean
	configured: boolean
	embedderProvider: EmbedderProvider
	modelId?: string
	modelDimension?: number
	openAiKey?: string
	openAiCompatibleBaseUrl?: string
	openAiCompatibleApiKey?: string
	geminiApiKey?: string
	qdrantUrl?: string
	qdrantApiKey?: string
	vectorStorageMode?: string
}
