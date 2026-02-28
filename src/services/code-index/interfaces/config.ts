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
	vectorStorageConfig?: VectorStorageConfig
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

/**
 * Result of configuration change analysis
 * Used to determine what action is needed when configuration changes
 */
export interface ConfigChangeResult {
	/** Whether any restart is needed */
	requiresRestart: boolean
	/** Whether the index data needs to be rebuilt (e.g., vector dimension changed) */
	requiresReindex: boolean
	/** Whether only the service needs to be restarted (e.g., API key changed) */
	requiresServiceRestart: boolean
	/** Human-readable reason for the restart requirement */
	reason?: string
}
