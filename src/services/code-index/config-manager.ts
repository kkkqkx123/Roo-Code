import { ApiHandlerOptions } from "../../shared/api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { EmbedderProvider } from "./interfaces/manager"
import { CodeIndexConfig, PreviousConfigSnapshot, ConfigChangeResult } from "./interfaces/config"
import { DEFAULT_SEARCH_MIN_SCORE, DEFAULT_MAX_SEARCH_RESULTS } from "./constants"
import { getModelDimension, getModelScoreThreshold, getDefaultModelId, type EmbeddingModelProfiles } from "@coder/types"
import { VectorStorageConfig, DEFAULT_VECTOR_STORAGE_CONFIG } from "./interfaces/vector-storage-config"

/**
 * Manages configuration state and validation for the code indexing feature.
 * Handles loading, validating, and providing access to configuration values.
 */
export class CodeIndexConfigManager {
	private codebaseIndexEnabled: boolean = false
	private embedderProvider: EmbedderProvider = "openai"
	private modelId?: string
	private modelDimension?: number
	private openAiOptions?: ApiHandlerOptions
	private openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
	private geminiOptions?: { apiKey: string }
	private qdrantUrl?: string = "http://localhost:6333"
	private qdrantApiKey?: string
	private searchMinScore?: number
	private searchMaxResults?: number
	private _vectorStorageConfig: VectorStorageConfig = DEFAULT_VECTOR_STORAGE_CONFIG
	// Store the full config object for accessing new fields
	private codebaseIndexConfig?: any
	// Allowed projects list
	private allowedProjects?: string[]
	// User-defined embedding model profiles
	private embeddingModelProfiles: EmbeddingModelProfiles = {}

	constructor(private readonly contextProxy: ContextProxy) {
		// Initialize with current configuration to avoid false restart triggers
		this._loadAndSetConfiguration()
	}

	/**
	 * Gets the context proxy instance
	 */
	public getContextProxy(): ContextProxy {
		return this.contextProxy
	}

	/**
	 * Private method that handles loading configuration from storage and updating instance variables.
	 * This eliminates code duplication between initializeWithCurrentConfig() and loadConfiguration().
	 */
	private _loadAndSetConfiguration(): void {
		// Load configuration from storage
		const codebaseIndexConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig") ?? {
			codebaseIndexEnabled: false,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderProvider: "openai",
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
			codebaseIndexSearchMinScore: undefined,
			codebaseIndexSearchMaxResults: undefined,
			vectorStorageMode: "auto",
			vectorStoragePreset: "medium",
			vectorStorageThresholds: undefined,
		}

		// Store the full config object for accessing new fields
		this.codebaseIndexConfig = codebaseIndexConfig

		console.log("[CodeIndexConfigManager] Raw configuration from globalState:", JSON.stringify(codebaseIndexConfig, null, 2))

		const {
			codebaseIndexEnabled,
			codebaseIndexQdrantUrl,
			codebaseIndexEmbedderProvider,
			codebaseIndexEmbedderBaseUrl,
			codebaseIndexEmbedderModelId,
			codebaseIndexSearchMinScore,
			codebaseIndexSearchMaxResults,
			vectorStorageMode,
			vectorStoragePreset,
			vectorStorageThresholds,
			codebaseIndexAllowedProjects,
		} = codebaseIndexConfig

		// Store allowed projects list
		this.allowedProjects = codebaseIndexAllowedProjects

		// Load user-defined embedding model profiles
		this.embeddingModelProfiles = this.contextProxy?.getGlobalState("codebaseIndexModels") ?? {}

		const openAiKey = this.contextProxy?.getSecret("codeIndexOpenAiKey") ?? ""
		const qdrantApiKey = this.contextProxy?.getSecret("codeIndexQdrantApiKey") ?? ""
		// Use the generic baseUrl field for all providers
		const openAiCompatibleBaseUrl = codebaseIndexConfig.codebaseIndexEmbedderBaseUrl ?? ""
		const openAiCompatibleApiKey = this.contextProxy?.getSecret("codebaseIndexOpenAiCompatibleApiKey") ?? ""
		const geminiApiKey = this.contextProxy?.getSecret("codebaseIndexGeminiApiKey") ?? ""

		console.log("[CodeIndexConfigManager] Secrets loaded:")
		console.log("  openAiKey (codeIndexOpenAiKey):", openAiKey ? "****" + openAiKey.slice(-4) : "empty")
		console.log("  qdrantApiKey (codeIndexQdrantApiKey):", qdrantApiKey ? "****" + qdrantApiKey.slice(-4) : "empty")
		console.log("  openAiCompatibleApiKey (codebaseIndexOpenAiCompatibleApiKey):", openAiCompatibleApiKey ? "****" + openAiCompatibleApiKey.slice(-4) : "empty")
		console.log("  geminiApiKey (codebaseIndexGeminiApiKey):", geminiApiKey ? "****" + geminiApiKey.slice(-4) : "empty")
		console.log("  openAiCompatibleBaseUrl (codebaseIndexEmbedderBaseUrl):", openAiCompatibleBaseUrl)

		// Update instance variables with configuration
		this.codebaseIndexEnabled = codebaseIndexEnabled ?? false
		this.qdrantUrl = codebaseIndexQdrantUrl
		this.qdrantApiKey = qdrantApiKey ?? ""
		this.searchMinScore = codebaseIndexSearchMinScore
		this.searchMaxResults = codebaseIndexSearchMaxResults

		// Validate and set model dimension
		// Use the generic dimension field (used by all providers)
		const rawDimension = codebaseIndexConfig.codebaseIndexEmbedderModelDimension

		console.log("[ConfigManager] Processing model dimension:", {
			rawValue: rawDimension,
			valueType: typeof rawDimension,
			isUndefined: rawDimension === undefined,
			isNull: rawDimension === null,
		})

		if (rawDimension !== undefined && rawDimension !== null) {
			const dimension = Number(rawDimension)
			console.log("[ConfigManager] Dimension conversion:", {
				original: rawDimension,
				converted: dimension,
				isNaN: isNaN(dimension),
				isPositive: dimension > 0,
			})

			if (!isNaN(dimension) && dimension > 0) {
				this.modelDimension = dimension
				console.log(`[ConfigManager] Model dimension set to: ${dimension}`)
			} else {
				console.warn(
					`[ConfigManager] Invalid model dimension value: ${rawDimension}. Must be a positive number.`,
				)
				this.modelDimension = undefined
			}
		} else {
			this.modelDimension = undefined
			console.log(`[ConfigManager] Model dimension not set (will use model default)`)
		}

		this.openAiOptions = { openAiNativeApiKey: openAiKey }

		// Set embedder provider with support for openai-compatible
		if (codebaseIndexEmbedderProvider === "openai-compatible") {
			this.embedderProvider = "openai-compatible"
		} else if (codebaseIndexEmbedderProvider === "gemini") {
			this.embedderProvider = "gemini"
		} else {
			this.embedderProvider = "openai"
		}

		this.modelId = codebaseIndexEmbedderModelId || undefined

		this.openAiCompatibleOptions =
			openAiCompatibleBaseUrl && openAiCompatibleApiKey
				? {
					baseUrl: openAiCompatibleBaseUrl,
					apiKey: openAiCompatibleApiKey,
				}
				: undefined

		this.geminiOptions = geminiApiKey ? { apiKey: geminiApiKey } : undefined

		// Load vector storage configuration
		// If vectorStorageMode is "preset", convert it to the actual preset value for backward compatibility
		let effectiveMode: VectorStorageConfig["mode"] = (vectorStorageMode as VectorStorageConfig["mode"]) ?? "auto"
		if ((vectorStorageMode as string) === "preset" && vectorStoragePreset) {
			// Backward compatibility: convert old "preset" mode to actual preset
			effectiveMode = vectorStoragePreset as VectorStorageConfig["mode"]
		}

		// Ensure thresholds have all required fields
		const defaultThresholds = DEFAULT_VECTOR_STORAGE_CONFIG.thresholds ?? {
			tiny: 2000,
			small: 10000,
			medium: 100000,
			large: 1000000,
		}
		const savedThresholds = codebaseIndexConfig.vectorStorageThresholds
		this._vectorStorageConfig = {
			mode: effectiveMode,
			thresholds: {
				tiny: savedThresholds?.tiny ?? defaultThresholds.tiny,
				small: savedThresholds?.small ?? defaultThresholds.small,
				medium: savedThresholds?.medium ?? defaultThresholds.medium,
				large: savedThresholds?.large ?? defaultThresholds.large,
			},
		}
	}

	/**
	 * Loads persisted configuration from globalState.
	 */
	public async loadConfiguration(): Promise<{
		configSnapshot: PreviousConfigSnapshot
		currentConfig: {
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
		}
		requiresRestart: boolean
		requiresReindex: boolean
		configChangeResult: ConfigChangeResult
	}> {
		// Capture the ACTUAL previous state before loading new configuration
		const previousConfigSnapshot: PreviousConfigSnapshot = {
			enabled: this.codebaseIndexEnabled,
			configured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			modelDimension: this.modelDimension,
			openAiKey: this.openAiOptions?.openAiNativeApiKey ?? "",
			openAiCompatibleBaseUrl: this.openAiCompatibleOptions?.baseUrl ?? "",
			openAiCompatibleApiKey: this.openAiCompatibleOptions?.apiKey ?? "",
			geminiApiKey: this.geminiOptions?.apiKey ?? "",
			qdrantUrl: this.qdrantUrl ?? "",
			qdrantApiKey: this.qdrantApiKey ?? "",
			vectorStorageMode: this._vectorStorageConfig.mode,
		}

		// Refresh secrets from VSCode storage to ensure we have the latest values
		await this.contextProxy.refreshSecrets()

		// Load new configuration from storage and update instance variables
		this._loadAndSetConfiguration()

		// DEBUG: Log detailed configuration information
		console.log("[CodeIndexConfigManager] Configuration loaded:")
		console.log("  codebaseIndexEnabled:", this.codebaseIndexEnabled)
		console.log("  embedderProvider:", this.embedderProvider)
		console.log("  modelId:", this.modelId)
		console.log("  qdrantUrl:", this.qdrantUrl ? "****" + this.qdrantUrl.slice(-4) : "undefined")
		console.log("  qdrantApiKey:", this.qdrantApiKey ? "****" + this.qdrantApiKey.slice(-4) : "undefined")
		console.log("  openAiOptions.openAiNativeApiKey:", this.openAiOptions?.openAiNativeApiKey ? "****" + this.openAiOptions.openAiNativeApiKey.slice(-4) : "undefined")
		console.log("  openAiCompatibleOptions:", this.openAiCompatibleOptions ? {
			baseUrl: this.openAiCompatibleOptions.baseUrl,
			apiKey: this.openAiCompatibleOptions.apiKey ? "****" + this.openAiCompatibleOptions.apiKey.slice(-4) : "undefined"
		} : "undefined")
		console.log("  geminiOptions:", this.geminiOptions ? {
			apiKey: this.geminiOptions.apiKey ? "****" + this.geminiOptions.apiKey.slice(-4) : "undefined"
		} : "undefined")
		console.log("  isConfigured():", this.isConfigured())

		const configChangeResult = this.analyzeConfigChange(previousConfigSnapshot)

		return {
			configSnapshot: previousConfigSnapshot,
			currentConfig: {
				isConfigured: this.isConfigured(),
				embedderProvider: this.embedderProvider,
				modelId: this.modelId,
				modelDimension: this.modelDimension,
				openAiOptions: this.openAiOptions,
				openAiCompatibleOptions: this.openAiCompatibleOptions,
				geminiOptions: this.geminiOptions,
				qdrantUrl: this.qdrantUrl,
				qdrantApiKey: this.qdrantApiKey,
				searchMinScore: this.currentSearchMinScore,
			},
			requiresRestart: configChangeResult.requiresRestart,
			requiresReindex: configChangeResult.requiresReindex,
			configChangeResult,
		}
	}

	/**
	 * Checks if the service is properly configured based on the embedder type.
	 */
	public isConfigured(): boolean {
		if (this.embedderProvider === "openai") {
			const openAiKey = this.openAiOptions?.openAiNativeApiKey
			const qdrantUrl = this.qdrantUrl
			return !!(openAiKey && qdrantUrl)
		} else if (this.embedderProvider === "openai-compatible") {
			const baseUrl = this.openAiCompatibleOptions?.baseUrl
			const apiKey = this.openAiCompatibleOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(baseUrl && apiKey && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "gemini") {
			const apiKey = this.geminiOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(apiKey && qdrantUrl)
			return isConfigured
		}
		return false // Should not happen if embedderProvider is always set correctly
	}

	/**
	 * Analyzes configuration changes and determines what action is needed.
	 * This is an improved version that distinguishes between:
	 * - requiresReindex: Index data needs to be rebuilt (e.g., vector dimension changed)
	 * - requiresServiceRestart: Only service needs restart, index data can be preserved
	 * - requiresRestart: Any restart (either reindex or service restart)
	 *
	 * REINDEX REQUIRED (data incompatible):
	 * - Embedder provider changes (openai -> gemini, etc.)
	 * - Vector dimension changes (model changes that affect embedding size)
	 *
	 * SERVICE RESTART REQUIRED (data compatible):
	 * - Authentication changes (API keys)
	 * - Qdrant connection changes (URL, API key)
	 * - Feature enable/disable transitions
	 *
	 * NO RESTART NEEDED:
	 * - Search minimum score adjustments
	 * - UI-only settings
	 * - Vector storage mode changes (doesn't affect existing data)
	 */
	analyzeConfigChange(prev: PreviousConfigSnapshot): ConfigChangeResult {
		const nowConfigured = this.isConfigured()

		// Handle null/undefined values safely
		const prevEnabled = prev?.enabled ?? false
		const prevConfigured = prev?.configured ?? false
		const prevProvider = prev?.embedderProvider ?? "openai"
		const prevOpenAiKey = prev?.openAiKey ?? ""
		const prevOpenAiCompatibleBaseUrl = prev?.openAiCompatibleBaseUrl ?? ""
		const prevOpenAiCompatibleApiKey = prev?.openAiCompatibleApiKey ?? ""
		const prevModelDimension = prev?.modelDimension
		const prevGeminiApiKey = prev?.geminiApiKey ?? ""
		const prevQdrantUrl = prev?.qdrantUrl ?? ""
		const prevQdrantApiKey = prev?.qdrantApiKey ?? ""

		// 1. Transition from disabled/unconfigured to enabled/configured
		if ((!prevEnabled || !prevConfigured) && this.codebaseIndexEnabled && nowConfigured) {
			return {
				requiresRestart: true,
				requiresReindex: false,
				requiresServiceRestart: true,
				reason: "Feature enabled and configured",
			}
		}

		// 2. Transition from enabled to disabled
		if (prevEnabled && !this.codebaseIndexEnabled) {
			return {
				requiresRestart: true,
				requiresReindex: false,
				requiresServiceRestart: true,
				reason: "Feature disabled",
			}
		}

		// 3. If wasn't ready before and isn't ready now, no restart needed
		if ((!prevEnabled || !prevConfigured) && (!this.codebaseIndexEnabled || !nowConfigured)) {
			return {
				requiresRestart: false,
				requiresReindex: false,
				requiresServiceRestart: false,
			}
		}

		// 4. If feature is disabled, no restart needed
		if (!this.codebaseIndexEnabled) {
			return {
				requiresRestart: false,
				requiresReindex: false,
				requiresServiceRestart: false,
			}
		}

		// 5. REINDEX REQUIRED: Provider change (embeddings are incompatible)
		if (prevProvider !== this.embedderProvider) {
			return {
				requiresRestart: true,
				requiresReindex: true,
				requiresServiceRestart: true,
				reason: `Embedder provider changed from ${prevProvider} to ${this.embedderProvider}`,
			}
		}

		// 6. REINDEX REQUIRED: Vector dimension changed
		if (this._hasVectorDimensionChanged(prevProvider, prev?.modelId)) {
			return {
				requiresRestart: true,
				requiresReindex: true,
				requiresServiceRestart: true,
				reason: "Vector dimension changed",
			}
		}

		// 7. REINDEX REQUIRED: Model dimension explicitly changed
		const currentModelDimension = this.modelDimension
		if (prevModelDimension !== currentModelDimension) {
			return {
				requiresRestart: true,
				requiresReindex: true,
				requiresServiceRestart: true,
				reason: "Model dimension changed",
			}
		}

		// 8. SERVICE RESTART ONLY: Authentication changes (API keys)
		const currentOpenAiKey = this.openAiOptions?.openAiNativeApiKey ?? ""
		const currentOpenAiCompatibleBaseUrl = this.openAiCompatibleOptions?.baseUrl ?? ""
		const currentOpenAiCompatibleApiKey = this.openAiCompatibleOptions?.apiKey ?? ""
		const currentGeminiApiKey = this.geminiOptions?.apiKey ?? ""
		const currentQdrantUrl = this.qdrantUrl ?? ""
		const currentQdrantApiKey = this.qdrantApiKey ?? ""

		if (prevOpenAiKey !== currentOpenAiKey) {
			return {
				requiresRestart: true,
				requiresReindex: false,
				requiresServiceRestart: true,
				reason: "OpenAI API key changed",
			}
		}

		if (
			prevOpenAiCompatibleBaseUrl !== currentOpenAiCompatibleBaseUrl ||
			prevOpenAiCompatibleApiKey !== currentOpenAiCompatibleApiKey
		) {
			return {
				requiresRestart: true,
				requiresReindex: false,
				requiresServiceRestart: true,
				reason: "OpenAI-compatible configuration changed",
			}
		}

		if (prevGeminiApiKey !== currentGeminiApiKey) {
			return {
				requiresRestart: true,
				requiresReindex: false,
				requiresServiceRestart: true,
				reason: "Gemini API key changed",
			}
		}

		// 9. SERVICE RESTART ONLY: Qdrant connection changes
		if (prevQdrantUrl !== currentQdrantUrl || prevQdrantApiKey !== currentQdrantApiKey) {
			return {
				requiresRestart: true,
				requiresReindex: false,
				requiresServiceRestart: true,
				reason: "Qdrant connection configuration changed",
			}
		}

		// 10. NO RESTART: Vector storage mode changes (doesn't affect existing data)
		// This is a configuration optimization that only affects new collections
		const prevVectorStorageMode = prev?.vectorStorageMode ?? "auto"
		const currentVectorStorageMode = this._vectorStorageConfig.mode
		if (prevVectorStorageMode !== currentVectorStorageMode) {
			console.log(
				`[CodeIndexConfigManager] Vector storage mode changed from ${prevVectorStorageMode} to ${currentVectorStorageMode}, but no restart needed (only affects new collections)`,
			)
		}

		// No changes requiring restart
		return {
			requiresRestart: false,
			requiresReindex: false,
			requiresServiceRestart: false,
		}
	}

	/**
	 * Determines if a configuration change requires restarting the indexing process.
	 * @deprecated Use analyzeConfigChange() instead for more granular control
	 */
	doesConfigChangeRequireRestart(prev: PreviousConfigSnapshot): boolean {
		const result = this.analyzeConfigChange(prev)
		return result.requiresRestart
	}

	/**
	 * Checks if model changes result in vector dimension changes that require restart.
	 */
	private _hasVectorDimensionChanged(prevProvider: EmbedderProvider, prevModelId?: string): boolean {
		const currentProvider = this.embedderProvider
		const currentModelId = this.modelId ?? getDefaultModelId(this.embeddingModelProfiles, currentProvider)
		const resolvedPrevModelId = prevModelId ?? getDefaultModelId(this.embeddingModelProfiles, prevProvider)

		// If model IDs are the same and provider is the same, no dimension change
		if (prevProvider === currentProvider && resolvedPrevModelId === currentModelId) {
			return false
		}

		// Get vector dimensions for both models
		const prevDimension = getModelDimension(this.embeddingModelProfiles, prevProvider, resolvedPrevModelId ?? "")
		const currentDimension = getModelDimension(this.embeddingModelProfiles, currentProvider, currentModelId ?? "")

		// If we can't determine dimensions, be safe and restart
		if (prevDimension === undefined || currentDimension === undefined) {
			return true
		}

		// Only restart if dimensions actually changed
		return prevDimension !== currentDimension
	}

	/**
	 * Gets the current configuration state.
	 */
	public getConfig(): CodeIndexConfig {
		return {
			isConfigured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			modelDimension: this.modelDimension,
			openAiOptions: this.openAiOptions,
			openAiCompatibleOptions: this.openAiCompatibleOptions,
			geminiOptions: this.geminiOptions,
			qdrantUrl: this.qdrantUrl,
			qdrantApiKey: this.qdrantApiKey,
			searchMinScore: this.currentSearchMinScore,
			searchMaxResults: this.currentSearchMaxResults,
		}
	}

	/**
	 * Gets whether the code indexing feature is enabled
	 */
	public get isFeatureEnabled(): boolean {
		return this.codebaseIndexEnabled
	}

	/**
	 * Gets whether the code indexing feature is properly configured
	 */
	public get isFeatureConfigured(): boolean {
		return this.isConfigured()
	}

	/**
	 * Gets whether manual indexing only mode is enabled.
	 * When true, indexing only starts when user explicitly clicks "Start Indexing".
	 * When false (default), indexing starts automatically when extension activates.
	 */
	public get isManualIndexingOnly(): boolean {
		return this.codebaseIndexConfig?.manualIndexingOnly ?? false
	}

	/**
	 * Gets whether auto-update index is enabled.
	 * When true (default), index is automatically updated based on file changes via file watching.
	 * When false, index is only built at startup and not updated via file watching.
	 */
	public get isAutoUpdateIndex(): boolean {
		return this.codebaseIndexConfig?.autoUpdateIndex ?? true
	}

	/**
	 * Gets the current embedder type (openai or ollama)
	 */
	public get currentEmbedderProvider(): EmbedderProvider {
		return this.embedderProvider
	}

	/**
	 * Gets the current Qdrant configuration
	 */
	public get qdrantConfig(): { url?: string; apiKey?: string } {
		return {
			url: this.qdrantUrl,
			apiKey: this.qdrantApiKey,
		}
	}

	/**
	 * Gets the current model ID being used for embeddings.
	 */
	public get currentModelId(): string | undefined {
		return this.modelId
	}

	/**
	 * Gets the current model dimension being used for embeddings.
	 * Returns the model's built-in dimension if available, otherwise falls back to custom dimension.
	 */
	public get currentModelDimension(): number | undefined {
		// First try to get the model-specific dimension
		const modelId = this.modelId ?? getDefaultModelId(this.embeddingModelProfiles, this.embedderProvider)
		const modelDimension = modelId ? getModelDimension(this.embeddingModelProfiles, this.embedderProvider, modelId) : undefined

		// Only use custom dimension if model doesn't have a built-in dimension
		if (!modelDimension && this.modelDimension && this.modelDimension > 0) {
			return this.modelDimension
		}

		return modelDimension
	}

	/**
	 * Gets the configured minimum search score based on user setting, model-specific threshold, or fallback.
	 * Priority: 1) User setting, 2) Model-specific threshold, 3) Default DEFAULT_SEARCH_MIN_SCORE constant.
	 */
	public get currentSearchMinScore(): number {
		// First check if user has configured a custom score threshold
		if (this.searchMinScore !== undefined) {
			return this.searchMinScore
		}

		// Fall back to model-specific threshold
		const currentModelId = this.modelId ?? getDefaultModelId(this.embeddingModelProfiles, this.embedderProvider)
		const modelSpecificThreshold = currentModelId
			? getModelScoreThreshold(this.embeddingModelProfiles, this.embedderProvider, currentModelId)
			: undefined
		return modelSpecificThreshold ?? DEFAULT_SEARCH_MIN_SCORE
	}

	/**
	 * Gets the configured maximum search results.
	 * Returns user setting if configured, otherwise returns default.
	 */
	public get currentSearchMaxResults(): number {
		return this.searchMaxResults ?? DEFAULT_MAX_SEARCH_RESULTS
	}

	/**
	 * Gets the current vector storage configuration
	 */
	public get vectorStorageConfig(): VectorStorageConfig {
		return this._vectorStorageConfig
	}

	/**
	 * Checks if a workspace path is in the allowed projects list.
	 * Returns true if the list is empty/undefined (all projects allowed) or if the path is in the list.
	 * @param workspacePath - The workspace path to check
	 */
	public isProjectAllowed(workspacePath: string): boolean {
		// If no allowed projects list or empty list, all projects are allowed
		if (!this.allowedProjects || this.allowedProjects.length === 0) {
			return true
		}
		return this.allowedProjects.includes(workspacePath)
	}

	/**
	 * Gets the allowed projects list
	 */
	public getAllowedProjects(): string[] {
		return this.allowedProjects ?? []
	}

	/**
	 * Gets the user-defined embedding model profiles
	 */
	public getEmbeddingModelProfiles(): EmbeddingModelProfiles {
		return this.embeddingModelProfiles
	}
}
