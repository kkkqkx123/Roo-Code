import * as path from "path"
import { extractFoldingItems, FoldingItem } from "./name-extractor"
import { mergeFunctionBlocks, formatMergedSections, MergedSection } from "./function-merger"
import { applyRandomDrop, estimateAvgTokensPerSection } from "./random-dropper"
import { extractFoldingData, ParsedDefinitionLine } from "./definition-parser"
import { formatFoldedFile, FormatOptions, formatSectionsWithOriginalContent } from "./formatter"
import { tiktoken } from "../../utils/tiktoken"
import { RooIgnoreController } from "../ignore/RooIgnoreController"

/**
 * Result of folding files.
 */
export interface FoldFilesResult {
	/** The formatted string containing all folded file definitions (joined) */
	content: string
	/** Individual file sections, each in its own <system-reminder> block */
	sections: string[]
	/** Number of files successfully processed */
	filesProcessed: number
	/** Number of files that failed or were skipped */
	filesSkipped: number
	/** Total token count of the folded content */
	totalTokens: number
	/** Number of sections dropped due to token limit */
	sectionsDropped: number
}

/**
 * Options for folding files.
 */
export interface FoldFilesOptions {
	/** Maximum total tokens for the folded content (default: 10000) */
	maxTokens?: number
	/** The current working directory for resolving relative paths */
	cwd: string
	/** Optional RooIgnoreController for file access validation */
	rooIgnoreController?: RooIgnoreController
	/** Whether to merge function blocks (default: true) */
	mergeFunctions?: boolean
	/** Maximum line span before interrupting function merging (default: 100) */
	maxLineSpan?: number
	/** Format mode: 'detailed' (full content) or 'minimal' (names only, no 'other' types) */
	mode?: "detailed" | "minimal"
}

/**
 * Represents a folded file with its sections.
 */
interface FoldedFile {
	filePath: string
	sections: MergedSection[]
	content: string
	tokens: number
}

/**
 * Folds multiple files into a minimal representation.
 * This function:
 * 1. Extracts minimal definitions (class names, interface names, function names) from each file
 * 2. Merges function blocks to reduce line span boilerplate
 * 3. Calculates total tokens using tiktoken
 * 4. Applies random drop if token count exceeds threshold
 * 5. Wraps each file in its own <system-reminder> block
 *
 * @param filePaths - Array of file paths to process (relative to cwd)
 * @param options - Configuration options
 * @returns FoldFilesResult with the formatted content and statistics
 *
 * @example
 * ```typescript
 * const result = await foldFiles(
 *   ['src/utils/helpers.ts', 'src/api/client.ts'],
 *   { cwd: '/project', maxTokens: 10000 }
 * )
 * // result.content contains individual <system-reminder> blocks for each file
 * ```
 */
export async function foldFiles(
	filePaths: string[],
	options: FoldFilesOptions,
): Promise<FoldFilesResult> {
	const {
		maxTokens = 10000,
		cwd,
		rooIgnoreController,
		mergeFunctions = true,
		maxLineSpan = 100,
		mode = "detailed",
	} = options

	const result: FoldFilesResult = {
		content: "",
		sections: [],
		filesProcessed: 0,
		filesSkipped: 0,
		totalTokens: 0,
		sectionsDropped: 0,
	}

	if (filePaths.length === 0) {
		return result
	}

	const foldedFiles: FoldedFile[] = []
	const failedFiles: string[] = []

	// Step 1: Extract and merge definitions for each file
	for (const filePath of filePaths) {
		try {
			// Resolve to absolute path for tree-sitter
			const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)

			// Extract folding items
			const definitions = await extractFoldingItems(absolutePath, rooIgnoreController)

			if (!definitions || definitions.length === 0) {
				result.filesSkipped++
				continue
			}

			// Merge function blocks if enabled
			let sections: MergedSection[]
			if (mergeFunctions) {
				sections = mergeFunctionBlocks(definitions, { maxLineSpan })
			} else {
				// Convert definitions to sections without merging
				// Note: 'other' types are filtered out during extraction
				sections = definitions.map((def) => ({
					type: def.type === "function" ? "functions" : def.type,
					names: [def.name],
					startLine: def.lineNumber,
				})) as MergedSection[]
			}

			// Format sections to content based on mode
			let content: string
			if (mode === "detailed") {
				// In detailed mode, we need parsed lines to show full content
				const foldingData = await extractFoldingData(absolutePath, rooIgnoreController)
				if (foldingData) {
					content = formatSectionsWithOriginalContent(sections, foldingData.parsedLines, "detailed")
				} else {
					content = formatMergedSections(sections)
				}
			} else {
				// Minimal mode: use simplified format
				content = formatMergedSections(sections)
			}

			// Calculate tokens for this file
			const fileContent = `<system-reminder>
## File Context: ${filePath}
${content}
</system-reminder>`
			const tokens = await tiktoken([{ type: "text", text: fileContent }])

			foldedFiles.push({
				filePath,
				sections,
				content: fileContent,
				tokens,
			})

			result.filesProcessed++
		} catch (error) {
			failedFiles.push(filePath)
			result.filesSkipped++
		}
	}

	// Log failed files as a single batch summary
	if (failedFiles.length > 0) {
		console.warn(
			`File folding: skipped ${failedFiles.length} file(s) due to errors: ${failedFiles.slice(0, 5).join(", ")}${failedFiles.length > 5 ? ` and ${failedFiles.length - 5} more` : ""}`,
		)
	}

	if (foldedFiles.length === 0) {
		return result
	}

	// Step 2: Calculate total tokens
	let totalTokens = foldedFiles.reduce((sum, file) => sum + file.tokens, 0)

	// Step 3: Check if we need to apply random drop
	if (totalTokens > maxTokens) {
		// Flatten all sections from all files
		const allSections: Array<{ section: MergedSection; fileIndex: number }> = []
		for (let i = 0; i < foldedFiles.length; i++) {
			const file = foldedFiles[i]!
			for (const section of file.sections) {
				allSections.push({ section, fileIndex: i })
			}
		}

		// Estimate average tokens per section
		const avgTokensPerSection = await estimateAvgTokensPerSection(
			allSections.map((item) => item.section),
			(section) => formatMergedSections([section]),
		)

		// Apply random drop
		const dropResult = applyRandomDrop(allSections.map((item) => item.section), {
			maxTokens,
			currentTokens: totalTokens,
			avgTokensPerSection,
		})

		// Rebuild files with kept sections
		const newFoldedFiles: FoldedFile[] = []
		const keptSectionIndices = new Set<number>()

		// Mark kept sections
		for (let i = 0; i < dropResult.keptSections.length; i++) {
			const keptSection = dropResult.keptSections[i]!
			// Find the original index
			const originalIndex = allSections.findIndex(
				(item) =>
					item.section.type === keptSection.type &&
					item.section.names.length === keptSection.names.length &&
					item.section.names.every((name, idx) => name === keptSection.names[idx]),
			)
			if (originalIndex !== -1) {
				keptSectionIndices.add(originalIndex)
			}
		}

		// Rebuild files
		for (let i = 0; i < foldedFiles.length; i++) {
			const file = foldedFiles[i]!
			const keptSectionsForFile: MergedSection[] = []

			for (let j = 0; j < allSections.length; j++) {
				const item = allSections[j]!
				if (item.fileIndex === i && keptSectionIndices.has(j)) {
					keptSectionsForFile.push(item.section)
				}
			}

			// Only include files that have at least one section
			if (keptSectionsForFile.length > 0) {
				// Format sections to content based on mode
				let content: string
				if (mode === "detailed") {
					// In detailed mode, we need parsed lines to show full content
					const foldingData = await extractFoldingData(
						path.isAbsolute(file.filePath) ? file.filePath : path.resolve(cwd, file.filePath),
						rooIgnoreController,
					)
					if (foldingData) {
						content = formatSectionsWithOriginalContent(keptSectionsForFile, foldingData.parsedLines, "detailed")
					} else {
						content = formatMergedSections(keptSectionsForFile)
					}
				} else {
					// Minimal mode: use simplified format
					content = formatMergedSections(keptSectionsForFile)
				}

				const fileContent = `<system-reminder>
## File Context: ${file.filePath}
${content}
</system-reminder>`
				const tokens = await tiktoken([{ type: "text", text: fileContent }])

				newFoldedFiles.push({
					filePath: file.filePath,
					sections: keptSectionsForFile,
					content: fileContent,
					tokens,
				})
			}
		}

		// Update result
		result.sectionsDropped = dropResult.droppedCount
		result.filesProcessed = newFoldedFiles.length
		result.filesSkipped += foldedFiles.length - newFoldedFiles.length

		// Update folded files
		foldedFiles.length = 0
		foldedFiles.push(...newFoldedFiles)

		// Recalculate total tokens
		totalTokens = foldedFiles.reduce((sum, file) => sum + file.tokens, 0)
	}

	// Step 4: Build final result
	if (foldedFiles.length > 0) {
		result.sections = foldedFiles.map((file) => file.content)
		result.content = result.sections.join("\n")
		result.totalTokens = totalTokens
	}

	return result
}

// Export all public types and functions
export { extractFoldingItems } from "./name-extractor"
export type { FoldingItem } from "./name-extractor"
export { mergeFunctionBlocks, formatMergedSections } from "./function-merger"
export type { MergedSection } from "./function-merger"
export {
	applyRandomDrop,
	estimateAvgTokensPerSection,
	calculateExcessRatio,
	calculateBatchSize,
	shuffleArray,
} from "./random-dropper"
export type { RandomDropResult, RandomDropOptions } from "./random-dropper"
export {
	extractFoldingItemsFromString,
	extractParsedDefinitionLines,
	extractFoldingData,
	convertDefinitionsToFoldingItems,
	convertDefinitionsToParsedLines,
	isTreeSitterErrorString,
} from "./definition-parser"
export type { ParsedDefinitionLine } from "./definition-parser"
export {
	formatFoldedFile,
	formatMultipleFoldedFiles,
	joinFormattedFiles,
	formatSectionsWithOriginalContent,
} from "./formatter"
export type { FormatOptions } from "./formatter"

/**
 * Result of folding a single file.
 */
export interface FoldSingleFileResult {
	/** The formatted string containing the folded file definitions */
	content: string
	/** The merged sections */
	sections: MergedSection[]
	/** The original parsed lines */
	parsedLines: ParsedDefinitionLine[]
	/** Token count of the folded content */
	tokens: number
}

/**
 * Options for folding a single file.
 */
export interface FoldSingleFileOptions {
	/** Whether to merge function blocks (default: true) */
	mergeFunctions?: boolean
	/** Maximum line span before interrupting function merging (default: 100) */
	maxLineSpan?: number
	/** Format options for the output */
	formatOptions?: FormatOptions
}

/**
 * Folds a single file into a minimal representation.
 * This function:
 * 1. Extracts definitions from the file using parseSourceCodeDefinitionsForFile
 * 2. Converts the string output to FoldingItem and ParsedDefinitionLine arrays
 * 3. Merges function blocks if enabled
 * 4. Formats the output with optional wrapping
 *
 * @param filePath - Path to the file to process (absolute or relative to cwd)
 * @param rooIgnoreController - Optional controller for file access validation
 * @param options - Configuration options
 * @returns FoldSingleFileResult with the formatted content and data
 *
 * @example
 * ```typescript
 * const result = await foldSingleFile(
 *   'src/utils/helpers.ts',
 *   rooIgnoreController,
 *   { mergeFunctions: true }
 * )
 * // result.content contains the folded file with <system-reminder> block
 * ```
 */
export async function foldSingleFile(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
	options: FoldSingleFileOptions = {},
): Promise<FoldSingleFileResult | null> {
	const { mergeFunctions = true, maxLineSpan = 100, formatOptions } = options

	try {
		// Extract folding items and parsed lines from the same definitions string
		const foldingData = await extractFoldingData(filePath, rooIgnoreController)

		if (!foldingData) {
			return null
		}

		const { foldingItems, parsedLines } = foldingData

		// Merge function blocks if enabled
		let sections: MergedSection[]
		if (mergeFunctions) {
			sections = mergeFunctionBlocks(foldingItems, { maxLineSpan })
		} else {
			// Convert folding items to sections without merging
			sections = foldingItems.map((item) => ({
				type: item.type === "function" ? "functions" : item.type,
				names: [item.name],
				startLine: item.lineNumber,
			})) as MergedSection[]
		}

		// Format the content
		const content = formatFoldedFile(sections, parsedLines, {
			filePath,
			wrapInSystemReminder: true,
			...formatOptions,
		})

		// Calculate tokens
		const tokens = await tiktoken([{ type: "text", text: content }])

		return {
			content,
			sections,
			parsedLines,
			tokens,
		}
	} catch (error) {
		console.error(`Error folding file ${filePath}:`, error)
		return null
	}
}

/**
 * Folds multiple files individually without cross-file processing.
 * This is useful when you want to process each file independently.
 *
 * @param filePaths - Array of file paths to process
 * @param rooIgnoreController - Optional controller for file access validation
 * @param options - Configuration options
 * @returns Array of FoldSingleFileResult (null for failed files)
 *
 * @example
 * ```typescript
 * const results = await foldMultipleFilesIndividually(
 *   ['src/utils/helpers.ts', 'src/api/client.ts'],
 *   rooIgnoreController,
 *   { mergeFunctions: true }
 * )
 * ```
 */
export async function foldMultipleFilesIndividually(
	filePaths: string[],
	rooIgnoreController?: RooIgnoreController,
	options: FoldSingleFileOptions = {},
): Promise<Array<FoldSingleFileResult | null>> {
	const results: Array<FoldSingleFileResult | null> = []

	for (const filePath of filePaths) {
		const result = await foldSingleFile(filePath, rooIgnoreController, options)
		results.push(result)
	}

	return results
}