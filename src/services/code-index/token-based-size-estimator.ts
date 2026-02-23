import * as fs from "fs/promises"
import * as path from "path"
import { listFiles } from "../glob/list-files"
import { IgnoreMode, RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { MAX_LIST_FILES_LIMIT_CODE_INDEX } from "./constants"
import { scannerExtensions } from "./shared/supported-extensions"
import { isPathInIgnoredDirectory } from "../glob/ignore-utils"

/**
 * Result of size estimation
 */
export interface SizeEstimationResult {
	/** Estimated number of vectors */
	estimatedVectorCount: number
	/** Estimated total token count */
	estimatedTokenCount: number
	/** Number of files processed */
	fileCount: number
	/** Total file size in bytes */
	totalFileSize: number
}

/**
 * Estimates collection size based on token analysis
 * Used before indexing to predict collection size and allocate appropriate configuration
 */
export class TokenBasedSizeEstimator {
	/** Average tokens per vector (default: 100) */
	private readonly avgTokensPerVector: number = 100
	/** Average characters per token (default: 4) */
	private readonly avgCharsPerToken: number = 4
	/** Code text multiplier for token estimation (default: 1.2) */
	private readonly codeMultiplier: number = 1.2

	/**
	 * Estimates the collection size based on file analysis
	 * @param directoryPath The directory to analyze
	 * @returns SizeEstimationResult with estimated vector count and metadata
	 */
	async estimateCollectionSize(directoryPath: string): Promise<SizeEstimationResult> {
		// 1. List all files
		const [allPaths, _] = await listFiles(directoryPath, true, MAX_LIST_FILES_LIMIT_CODE_INDEX)
		const filePaths = allPaths.filter((p) => !p.endsWith("/"))

		// 2. Apply ignore rules filtering
		const ignoreController = new RooIgnoreController(directoryPath, IgnoreMode.Both)
		await ignoreController.initialize()
		const allowedPaths = ignoreController.filterPaths(filePaths)

		// 3. Filter by extension
		const supportedPaths = allowedPaths.filter((filePath) => {
			const ext = path.extname(filePath).toLowerCase()
			return scannerExtensions.includes(ext) && !isPathInIgnoredDirectory(filePath)
		})

		// 4. Iterate through files to calculate total token count
		let totalTokenCount = 0
		let totalFileSize = 0
		let processedFileCount = 0

		for (const filePath of supportedPaths) {
			try {
				const stats = await fs.stat(filePath)
				const content = await fs.readFile(filePath, "utf-8")
				const tokenCount = this.estimateTokenCount(content)
				totalTokenCount += tokenCount
				totalFileSize += stats.size
				processedFileCount++
			} catch (error) {
				// Skip files that can't be read
				console.warn(`[TokenBasedSizeEstimator] Failed to read file ${filePath}:`, error)
			}
		}

		// 5. Calculate estimated vector count
		const estimatedVectorCount = Math.ceil(totalTokenCount / this.avgTokensPerVector)

		return {
			estimatedVectorCount,
			estimatedTokenCount: totalTokenCount,
			fileCount: processedFileCount,
			totalFileSize,
		}
	}

	/**
	 * Estimates token count from text
	 * @param text The text to analyze
	 * @returns Estimated token count
	 */
	private estimateTokenCount(text: string): number {
		const charCount = text.trim().length
		const estimatedTokens = Math.ceil(charCount / this.avgCharsPerToken)
		return Math.floor(estimatedTokens * this.codeMultiplier)
	}

	/**
	 * Sets custom estimation parameters
	 * @param avgTokensPerVector Average tokens per vector
	 * @param avgCharsPerToken Average characters per token
	 * @param codeMultiplier Code text multiplier
	 */
	setEstimationParameters(
		avgTokensPerVector?: number,
		avgCharsPerToken?: number,
		codeMultiplier?: number,
	): void {
		if (avgTokensPerVector !== undefined) {
			this.avgTokensPerVector = avgTokensPerVector
		}
		if (avgCharsPerToken !== undefined) {
			this.avgCharsPerToken = avgCharsPerToken
		}
		if (codeMultiplier !== undefined) {
			this.codeMultiplier = codeMultiplier
		}
	}
}