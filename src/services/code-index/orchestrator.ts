import * as vscode from "vscode"
import * as path from "path"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager, IndexingState } from "./state-manager"
import { IFileWatcher, IVectorStore, BatchProcessingSummary } from "./interfaces"
import { DirectoryScanner } from "./processors"
import { CacheManager } from "./cache-manager"
import { TokenBasedSizeEstimator } from "./token-based-size-estimator"
import { t } from "../../i18n"
import { QdrantConnectionError } from "@coder/types"

/**
 * Manages the code indexing workflow, coordinating between different services and managers.
 */
export class CodeIndexOrchestrator {
	private _fileWatcherSubscriptions: vscode.Disposable[] = []
	private _isProcessing: boolean = false
	private _abortController: AbortController | null = null

	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly stateManager: CodeIndexStateManager,
		private readonly workspacePath: string,
		private readonly cacheManager: CacheManager,
		private readonly vectorStore: IVectorStore,
		private readonly scanner: DirectoryScanner,
		private readonly fileWatcher: IFileWatcher,
	) { }

	/**
	 * Starts the file watcher if not already running.
	 */
	private async _startWatcher(): Promise<void> {
		if (!this.configManager.isFeatureConfigured) {
			throw new Error("Cannot start watcher: Service not configured.")
		}

		// Check if auto-update index is enabled
		if (!this.configManager.isAutoUpdateIndex) {
			console.log("[CodeIndexOrchestrator] Auto-update index is disabled, skipping file watcher initialization")
			this.stateManager.setSystemState("Indexed", "Index built. File watcher disabled by configuration.")
			return
		}

		this.stateManager.setSystemState("Indexing", "Initializing file watcher...")

		try {
			await this.fileWatcher.initialize()

			this._fileWatcherSubscriptions = [
				this.fileWatcher.onDidStartBatchProcessing((filePaths: string[]) => { }),
				this.fileWatcher.onBatchProgressUpdate(({ processedInBatch, totalInBatch, currentFile }) => {
					if (totalInBatch > 0 && this.stateManager.state !== "Indexing") {
						this.stateManager.setSystemState("Indexing", "Processing file changes...")
					}
					this.stateManager.reportFileQueueProgress(
						processedInBatch,
						totalInBatch,
						currentFile ? path.basename(currentFile) : undefined,
					)
					if (processedInBatch === totalInBatch) {
						// Covers (N/N) and (0/0)
						if (totalInBatch > 0) {
							// Batch with items completed
							this.stateManager.setSystemState("Indexed", "File changes processed. Index up-to-date.")
						} else {
							if (this.stateManager.state === "Indexing") {
								// Only transition if it was "Indexing"
								this.stateManager.setSystemState("Indexed", "Index up-to-date. File queue empty.")
							}
						}
					}
				}),
				this.fileWatcher.onDidFinishBatchProcessing((summary: BatchProcessingSummary) => {
					if (summary.batchError) {
						console.error(`[CodeIndexOrchestrator] Batch processing failed:`, summary.batchError)
					} else {
						const successCount = summary.processedFiles.filter(
							(f: { status: string }) => f.status === "success",
						).length
						const errorCount = summary.processedFiles.filter(
							(f: { status: string }) => f.status === "error" || f.status === "local_error",
						).length
					}
				}),
			]
		} catch (error) {
			console.error("[CodeIndexOrchestrator] Failed to start file watcher:", error)
			throw error
		}
	}

	/**
	 * Updates the status of a file in the state manager.
	 */

	/**
	 * Initiates the indexing process (initial scan and starts watcher).
	 * @param isRetryAfterError Whether this is a retry after an error state (default: false)
	 */
	public async startIndexing(isRetryAfterError: boolean = false): Promise<void> {
		console.log("[CodeIndexOrchestrator] startIndexing called, isRetryAfterError:", isRetryAfterError)

		// Check if workspace is available first
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			this.stateManager.setSystemState("Error", t("embeddings:orchestrator.indexingRequiresWorkspace"))
			console.warn("[CodeIndexOrchestrator] Start rejected: No workspace folder open.")
			return
		}
		console.log("[CodeIndexOrchestrator] Workspace check passed")

		if (!this.configManager.isFeatureConfigured) {
			this.stateManager.setSystemState("Standby", "Missing configuration. Save your settings to start indexing.")
			console.warn("[CodeIndexOrchestrator] Start rejected: Missing configuration.")
			return
		}
		console.log("[CodeIndexOrchestrator] Configuration check passed")

		// Check if current workspace is in the allowed projects list
		if (!this.configManager.isProjectAllowed(this.workspacePath)) {
			this.stateManager.setSystemState(
				"Standby",
				`Project not in allowed list. Add "${this.workspacePath}" to allowed projects to enable indexing.`,
			)
			console.warn(
				`[CodeIndexOrchestrator] Start rejected: Workspace "${this.workspacePath}" is not in the allowed projects list.`,
			)
			return
		}
		console.log("[CodeIndexOrchestrator] Project allowlist check passed")

		if (
			this._isProcessing ||
			(this.stateManager.state !== "Standby" &&
				this.stateManager.state !== "Error" &&
				this.stateManager.state !== "Indexed")
		) {
			console.warn(
				`[CodeIndexOrchestrator] Start rejected: Already processing or in state ${this.stateManager.state}.`,
			)
			return
		}
		console.log("[CodeIndexOrchestrator] State check passed, current state:", this.stateManager.state)

		// Try fast start first - check if we can skip the scan
		const fastStartResult = await this._tryFastStart()
		if (fastStartResult) {
			console.log("[CodeIndexOrchestrator] Fast start successful, skipping full scan")
			return
		}

		this._isProcessing = true
		this._abortController = new AbortController()
		const signal = this._abortController.signal
		this.stateManager.setSystemState("Indexing", "Initializing services...")
		console.log("[CodeIndexOrchestrator] Processing started, state set to Indexing")

		// Track whether we successfully connected to Qdrant and started indexing
		// This helps us decide whether to preserve cache on error
		let indexingStarted = false
		let hasExistingData = false

		try {
			// Check collection existence and data if retrying after error
			if (isRetryAfterError) {
				try {
					const collectionExists = await this.vectorStore.collectionExists()

					if (collectionExists) {
						hasExistingData = await this.vectorStore.hasIndexedData()
						if (hasExistingData) {
							console.log(
								"[CodeIndexOrchestrator] Error retry: Collection exists with indexed data. Reusing existing collection for incremental scan.",
							)
							this.stateManager.setSystemState("Indexing", "Reusing existing collection...")
						} else {
							console.log(
								"[CodeIndexOrchestrator] Error retry: Collection exists but has no indexed data. Will perform full scan.",
							)
						}
					} else {
						console.log(
							"[CodeIndexOrchestrator] Error retry: Collection does not exist. Will create new collection and perform full scan.",
						)
					}
				} catch (error) {
					if (error instanceof QdrantConnectionError) {
						console.error("[CodeIndexOrchestrator] Failed to connect to Qdrant:", error.message)
						this.stateManager.setSystemState(
							"Error",
							t("embeddings:orchestrator.failedToConnect", {
								errorMessage: error.message,
							}),
						)
						this._isProcessing = false
						return
					}
					throw error
				}
			}

			const collectionCreated = await this.vectorStore.initialize()

			// Successfully connected to Qdrant
			indexingStarted = true

			if (collectionCreated) {
				await this.cacheManager.clearCacheFile()

				// Estimate collection size for new collections and set appropriate configuration
				console.log("[CodeIndexOrchestrator] New collection created, estimating collection size...")
				try {
					const sizeEstimator = new TokenBasedSizeEstimator()
					const estimation = await sizeEstimator.estimateCollectionSize(this.workspacePath)
					console.log(
						`[CodeIndexOrchestrator] Estimated ${estimation.estimatedVectorCount} vectors from ${estimation.fileCount} files (${estimation.estimatedTokenCount} tokens)`,
					)

					// Set collection configuration based on estimation
					if (this.vectorStore.setCollectionConfigFromEstimation) {
						await this.vectorStore.setCollectionConfigFromEstimation(estimation)
					}
				} catch (error) {
					console.warn("[CodeIndexOrchestrator] Failed to estimate collection size, using default config:", error)
					// Continue with default configuration
				}
			}

			// Check if the collection already has indexed data
			// If it does, we can skip the full scan and just start the watcher
			// When retrying after error, we already checked this above
			if (!isRetryAfterError) {
				hasExistingData = await this.vectorStore.hasIndexedData()
			}

			if (hasExistingData && !collectionCreated) {
				// Collection exists with data - run incremental scan to catch any new/changed files
				// This handles files added while workspace was closed or Qdrant was inactive
				console.log(
					"[CodeIndexOrchestrator] Collection already has indexed data. Running incremental scan for new/changed files...",
				)
				this.stateManager.setSystemState("Indexing", "Checking for new or modified files...")

				// Mark as incomplete at the start of incremental scan
				await this.vectorStore.markIndexingIncomplete()

				let cumulativeBlocksIndexed = 0
				let cumulativeBlocksFoundSoFar = 0
				let batchErrors: Error[] = []

				const handleFileParsed = (fileBlockCount: number) => {
					cumulativeBlocksFoundSoFar += fileBlockCount
					this.stateManager.reportBlockIndexingProgress(cumulativeBlocksIndexed, cumulativeBlocksFoundSoFar)
				}

				const handleBlocksIndexed = (indexedCount: number) => {
					cumulativeBlocksIndexed += indexedCount
					this.stateManager.reportBlockIndexingProgress(cumulativeBlocksIndexed, cumulativeBlocksFoundSoFar)
				}

				// Run incremental scan - scanner will skip unchanged files using cache
				const result = await this.scanner.scanDirectory(
					this.workspacePath,
					(batchError: Error) => {
						console.error(
							`[CodeIndexOrchestrator] Error during incremental scan batch: ${batchError.message}`,
							batchError,
						)
						batchErrors.push(batchError)
					},
					handleBlocksIndexed,
					handleFileParsed,
					signal,
				)

				if (signal.aborted) {
					await this.cacheManager.flush()
					this.stopWatcher()
					this.stateManager.setSystemState("Standby", t("embeddings:orchestrator.indexingStopped"))
					return
				}

				if (!result) {
					throw new Error("Incremental scan failed, is scanner initialized?")
				}

				// If new files were found and indexed, log the results
				if (cumulativeBlocksFoundSoFar > 0) {
					console.log(
						`[CodeIndexOrchestrator] Incremental scan completed: ${cumulativeBlocksIndexed} blocks indexed from new/changed files`,
					)
				} else {
					console.log("[CodeIndexOrchestrator] No new or changed files found")
				}

				await this._startWatcher()

				// Mark indexing as complete after successful incremental scan
				// Use enhanced metadata method if available
				if (this.vectorStore.markIndexingCompleteWithMetadata) {
					await this.vectorStore.markIndexingCompleteWithMetadata({
						vector_dimension: this.configManager.currentModelDimension,
						embedder_provider: this.configManager.currentEmbedderProvider,
						model_id: this.configManager.currentModelId,
					})
				} else {
					await this.vectorStore.markIndexingComplete()
				}

				this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"))
			} else {
				// No existing data or collection was just created - do a full scan
				this.stateManager.setSystemState("Indexing", "Services ready. Starting workspace scan...")

				// Mark as incomplete at the start of full scan
				await this.vectorStore.markIndexingIncomplete()

				let cumulativeBlocksIndexed = 0
				let cumulativeBlocksFoundSoFar = 0
				let batchErrors: Error[] = []

				const handleFileParsed = (fileBlockCount: number) => {
					cumulativeBlocksFoundSoFar += fileBlockCount
					this.stateManager.reportBlockIndexingProgress(cumulativeBlocksIndexed, cumulativeBlocksFoundSoFar)
				}

				const handleBlocksIndexed = (indexedCount: number) => {
					cumulativeBlocksIndexed += indexedCount
					this.stateManager.reportBlockIndexingProgress(cumulativeBlocksIndexed, cumulativeBlocksFoundSoFar)
				}

				const result = await this.scanner.scanDirectory(
					this.workspacePath,
					(batchError: Error) => {
						console.error(
							`[CodeIndexOrchestrator] Error during initial scan batch: ${batchError.message}`,
							batchError,
						)
						batchErrors.push(batchError)
					},
					handleBlocksIndexed,
					handleFileParsed,
					signal,
				)

				if (signal.aborted) {
					await this.cacheManager.flush()
					this.stopWatcher()
					this.stateManager.setSystemState("Standby", t("embeddings:orchestrator.indexingStopped"))
					return
				}

				if (!result) {
					throw new Error("Scan failed, is scanner initialized?")
				}

				const { stats } = result

				// Check if any blocks were actually indexed successfully
				// If no blocks were indexed but blocks were found, it means all batches failed
				if (cumulativeBlocksIndexed === 0 && cumulativeBlocksFoundSoFar > 0) {
					if (batchErrors.length > 0) {
						// Use the first batch error as it's likely representative of the main issue
						const firstError = batchErrors[0]
						if (firstError) {
							throw new Error(`Indexing failed: ${firstError.message}`)
						}
					}
					throw new Error(t("embeddings:orchestrator.indexingFailedNoBlocks"))
				}

				// Check for partial failures - if a significant portion of blocks failed
				const failureRate = (cumulativeBlocksFoundSoFar - cumulativeBlocksIndexed) / cumulativeBlocksFoundSoFar
				if (batchErrors.length > 0 && failureRate > 0.1) {
					// More than 10% of blocks failed to index
					const firstError = batchErrors[0]
					if (firstError) {
						throw new Error(
							`Indexing partially failed: Only ${cumulativeBlocksIndexed} of ${cumulativeBlocksFoundSoFar} blocks were indexed. ${firstError.message}`,
						)
					}
				}

				// CRITICAL: If there were ANY batch errors and NO blocks were successfully indexed,
				// this is a complete failure regardless of the failure rate calculation
				if (batchErrors.length > 0 && cumulativeBlocksIndexed === 0) {
					const firstError = batchErrors[0]
					if (firstError) {
						throw new Error(`Indexing failed completely: ${firstError.message}`)
					}
				}

				// Final sanity check: If we found blocks but indexed none and somehow no errors were reported,
				// this is still a failure
				if (cumulativeBlocksFoundSoFar > 0 && cumulativeBlocksIndexed === 0) {
					throw new Error(t("embeddings:orchestrator.indexingFailedCritical"))
				}

				await this._startWatcher()

				// Mark indexing as complete after successful full scan
				// Use enhanced metadata method if available
				if (this.vectorStore.markIndexingCompleteWithMetadata) {
					await this.vectorStore.markIndexingCompleteWithMetadata({
						vector_dimension: this.configManager.currentModelDimension,
						embedder_provider: this.configManager.currentEmbedderProvider,
						model_id: this.configManager.currentModelId,
					})
				} else {
					await this.vectorStore.markIndexingComplete()
				}

				this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"))
			}
		} catch (error: any) {
			// Handle abort gracefully — not an error, just a user-initiated stop
			if (error?.name === "AbortError" || signal.aborted) {
				console.log("[CodeIndexOrchestrator] Indexing aborted by user.")
				await this.cacheManager.flush()
				this.stopWatcher()
				this.stateManager.setSystemState("Standby", t("embeddings:orchestrator.indexingStopped"))
				return
			}

			console.error("[CodeIndexOrchestrator] Error during indexing:", error)
			if (indexingStarted) {
				try {
					await this.vectorStore.clearCollection()
				} catch (cleanupError) {
					console.error("[CodeIndexOrchestrator] Failed to clean up after error:", cleanupError)
				}
			}

			// Only clear cache if indexing had started (Qdrant connection succeeded)
			// If we never connected to Qdrant, preserve cache for incremental scan when it comes back
			if (indexingStarted) {
				// Indexing started but failed mid-way - clear cache to avoid cache-Qdrant mismatch
				await this.cacheManager.clearCacheFile()
				console.log(
					"[CodeIndexOrchestrator] Indexing failed after starting. Clearing cache to avoid inconsistency.",
				)
			} else {
				// Never connected to Qdrant - preserve cache for future incremental scan
				console.log(
					"[CodeIndexOrchestrator] Failed to connect to Qdrant. Preserving cache for future incremental scan.",
				)
			}

			this.stateManager.setSystemState(
				"Error",
				t("embeddings:orchestrator.failedDuringInitialScan", {
					errorMessage: error.message || t("embeddings:orchestrator.unknownError"),
				}),
			)
			this.stopWatcher()
		} finally {
			this._isProcessing = false
			this._abortController = null
		}
	}

	/**
	 * Stops any in-progress indexing by aborting the scan and stopping the file watcher.
	 */
	public stopIndexing(): void {
		if (this._abortController) {
			this.stateManager.setSystemState("Stopping", t("embeddings:orchestrator.indexingStoppedPartial"))
			this._abortController.abort()
			this._abortController = null
		}
		this.stopWatcher()
		// Reset the processing flag to allow indexing to be restarted
		this._isProcessing = false
	}

	/**
	 * Stops the file watcher and cleans up resources.
	 */
	public stopWatcher(): void {
		this.fileWatcher.dispose()
		this._fileWatcherSubscriptions.forEach((sub) => sub.dispose())
		this._fileWatcherSubscriptions = []

		if (this.stateManager.state !== "Error" && this.stateManager.state !== "Stopping") {
			this.stateManager.setSystemState("Standby", t("embeddings:orchestrator.fileWatcherStopped"))
		}
		this._isProcessing = false
	}

	/**
	 * Clears all index data by stopping the watcher, clearing the vector store,
	 * and resetting the cache file.
	 */
	public async clearIndexData(): Promise<void> {
		this._isProcessing = true

		try {
			await this.stopWatcher()

			try {
				if (this.configManager.isFeatureConfigured) {
					await this.vectorStore.deleteCollection()
				} else {
					console.warn("[CodeIndexOrchestrator] Service not configured, skipping vector collection clear.")
				}
			} catch (error: any) {
				console.error("[CodeIndexOrchestrator] Failed to clear vector collection:", error)
				this.stateManager.setSystemState("Error", `Failed to clear vector collection: ${error.message}`)
			}

			await this.cacheManager.clearCacheFile()

			if (this.stateManager.state !== "Error") {
				this.stateManager.setSystemState("Standby", "Index data cleared successfully.")
			}
		} finally {
			this._isProcessing = false
		}
	}

	/**
	 * Gets the current state of the indexing system.
	 */
	public get state(): IndexingState {
		return this.stateManager.state
	}

	/**
	 * Attempts a fast start by checking if the existing index is complete and valid.
	 * If successful, starts the file watcher without performing a full scan.
	 * @returns true if fast start was successful, false otherwise
	 */
	private async _tryFastStart(): Promise<boolean> {
		try {
			console.log("[CodeIndexOrchestrator] Attempting fast start...")

			// Check if collection exists
			const collectionExists = await this.vectorStore.collectionExists()
			if (!collectionExists) {
				console.log("[CodeIndexOrchestrator] Fast start: Collection does not exist")
				return false
			}

			// Get index metadata
			const metadata = await this.vectorStore.getIndexMetadata()
			if (!metadata) {
				console.log("[CodeIndexOrchestrator] Fast start: No metadata found")
				return false
			}

			// Check if indexing is complete
			if (!metadata.indexing_complete) {
				console.log("[CodeIndexOrchestrator] Fast start: Indexing was not complete")
				return false
			}

			// Check if configuration matches (if metadata has config info)
			if (metadata.vector_dimension && metadata.vector_dimension !== this.configManager.currentModelDimension) {
				console.log(
					`[CodeIndexOrchestrator] Fast start: Vector dimension mismatch (stored: ${metadata.vector_dimension}, current: ${this.configManager.currentModelDimension})`,
				)
				return false
			}

			// Check if embedder provider matches (if metadata has provider info)
			if (metadata.embedder_provider && metadata.embedder_provider !== this.configManager.currentEmbedderProvider) {
				console.log(
					`[CodeIndexOrchestrator] Fast start: Embedder provider mismatch (stored: ${metadata.embedder_provider}, current: ${this.configManager.currentEmbedderProvider})`,
				)
				return false
			}

			// All checks passed - we can do a fast start
			console.log(
				`[CodeIndexOrchestrator] Fast start: Index is complete and valid. Last completed at: ${metadata.completed_at ? new Date(metadata.completed_at).toISOString() : 'unknown'}`,
			)

			// Start the file watcher directly
			await this._startWatcher()

			// Set state to Indexed
			this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"))

			return true
		} catch (error) {
			// If any error occurs during fast start, fall back to normal start
			console.warn("[CodeIndexOrchestrator] Fast start failed, falling back to normal start:", error)
			return false
		}
	}
}
