import { FoldingItem } from "./name-extractor"

/**
 * Represents a merged section of definitions.
 * Can be a single class/interface/type or a merged group of functions.
 */
export interface MergedSection {
	/** The type of this section */
	type: "class" | "interface" | "functions" | "type"
	/** The names in this section (single for class/interface/type, multiple for functions) */
	names: string[]
	/** The starting line number */
	startLine: number
}

/**
 * Options for merging function blocks.
 */
export interface MergeFunctionOptions {
	/** Maximum line span before interrupting function merging (default: 100) */
	maxLineSpan?: number
}

/**
 * Merges function blocks to reduce line span boilerplate.
 * Classes, interfaces, and types are always displayed separately with line information.
 * Functions are merged together, but merging is interrupted when:
 * - A class, interface, or type definition is encountered
 * - The line span exceeds maxLineSpan (default: 100)
 *
 * Note: 'other' types are filtered out during extraction for compression purposes.
 *
 * @param definitions - Array of folding items to merge
 * @param options - Merge options
 * @returns Array of merged sections
 */
export function mergeFunctionBlocks(
	definitions: FoldingItem[],
	options: MergeFunctionOptions = {},
): MergedSection[] {
	const { maxLineSpan = 100 } = options

	if (definitions.length === 0) {
		return []
	}

	const mergedSections: MergedSection[] = []
	let currentFunctions: FoldingItem[] = []
	let functionStartLine = 0

	for (const def of definitions) {
		// class, interface, type are always separate sections
		if (def.type === "class" || def.type === "interface" || def.type === "type") {
			// Flush any pending functions first
			if (currentFunctions.length > 0) {
				mergedSections.push({
					type: "functions",
					names: currentFunctions.map((f) => f.name),
					startLine: functionStartLine,
				})
				currentFunctions = []
			}

			// Add class/interface/type as a separate section
			mergedSections.push({
				type: def.type,
				names: [def.name],
				startLine: def.lineNumber,
			})
		}
		// Functions are merged together
		else if (def.type === "function") {
			if (currentFunctions.length === 0) {
				// Start a new function group
				currentFunctions.push(def)
				functionStartLine = def.lineNumber
			} else {
				// Check if adding this function would exceed maxLineSpan
				const lastFunction = currentFunctions[currentFunctions.length - 1]!
				const lineSpan = def.lineNumber - functionStartLine

				if (lineSpan > maxLineSpan) {
					// Flush current functions and start a new group
					mergedSections.push({
						type: "functions",
						names: currentFunctions.map((f) => f.name),
						startLine: functionStartLine,
					})
					currentFunctions = [def]
					functionStartLine = def.lineNumber
				} else {
					// Add to current function group
					currentFunctions.push(def)
				}
			}
		}
	}

	// Flush remaining functions
	if (currentFunctions.length > 0) {
		mergedSections.push({
			type: "functions",
			names: currentFunctions.map((f) => f.name),
			startLine: functionStartLine,
		})
	}

	return mergedSections
}

/**
 * Formats merged sections into a string representation.
 * This is used to generate the final folded file content.
 *
 * @param sections - Array of merged sections
 * @returns Formatted string representation
 */
export function formatMergedSections(sections: MergedSection[]): string {
	const lines: string[] = []

	for (const section of sections) {
		if (section.type === "functions") {
			// Functions are merged together
			lines.push(`${section.startLine} | ${section.names.join(", ")}`)
		} else if (section.type === "type") {
			// Type definitions are displayed separately
			lines.push(`${section.startLine} | type ${section.names.join(", ")}`)
		} else {
			// Class, interface, other are displayed separately
			lines.push(`${section.startLine} | ${section.type} ${section.names.join(", ")}`)
		}
	}

	return lines.join("\n")
}