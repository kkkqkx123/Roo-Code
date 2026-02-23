import { parseSourceCodeDefinitionsForFileFolding } from "../../services/tree-sitter"
import { RooIgnoreController } from "../ignore/RooIgnoreController"

/**
 * Represents a code definition item for file folding.
 * Contains the essential information needed for folding operations.
 */
export interface FoldingItem {
	/** The type of definition (class, interface, function, type, other) */
	type: "class" | "interface" | "function" | "type" | "other"
	/** The name of the definition */
	name: string
	/** The line number where this definition starts */
	lineNumber: number
}

/**
 * Extracts folding items from a file using tree-sitter.
 * This is the main entry point for the file-folding module.
 *
 * @param filePath - Path to the file to analyze
 * @param rooIgnoreController - Optional controller for file access validation
 * @returns Array of folding items, or null if file cannot be parsed
 */
export async function extractFoldingItems(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<FoldingItem[] | null> {
	try {
		const foldingDefs = await parseSourceCodeDefinitionsForFileFolding(filePath, rooIgnoreController)

		if (!foldingDefs) {
			return null
		}

		// Convert FoldingDefinition to FoldingItem and filter out 'other' type
		// File folding is for compression, so we only keep the most important types
		return foldingDefs
			.filter((def) => def.type !== "other")
			.map((def) => ({
				type: def.type,
				name: def.name,
				lineNumber: def.startLine,
			}))
	} catch (error) {
		console.error(`Error extracting folding items from ${filePath}:`, error)
		return null
	}
}