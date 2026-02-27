import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { RooIgnoreController } from "../ignore/RooIgnoreController"
import { FoldingItem } from "./name-extractor"

/**
 * Represents a parsed definition line with its original content.
 * This preserves the original format for output formatting.
 */
export interface ParsedDefinitionLine {
	/** The start line number */
	startLine: number
	/** The end line number (if range) */
	endLine?: number
	/** The original code content */
	content: string
	/** The type of definition */
	type: "class" | "interface" | "function" | "type" | "other"
	/** The name of the definition */
	name: string
}

/**
 * Checks if a definitions string is actually an error message from tree-sitter
 * rather than valid code definitions. These error strings should not be embedded
 * in the folded file context - instead, the file should be skipped.
 */
export function isTreeSitterErrorString(definitions: string): boolean {
	// These are known error messages from parseSourceCodeDefinitionsForFile
	const errorPatterns = ["This file does not exist", "do not have permission", "Unsupported file type:"]
	return errorPatterns.some((pattern) => definitions.includes(pattern))
}

/**
 * Parses a definition line from parseSourceCodeDefinitionsForFile output.
 * Expected format: "startLine--endLine | code content"
 * or "startLine | code content" (for single line)
 *
 * @param line - A single line from the definitions string
 * @returns ParsedDefinitionLine or null if parsing fails
 */
export function parseDefinitionLine(line: string): ParsedDefinitionLine | null {
	const trimmedLine = line.trim()
	if (!trimmedLine) {
		return null
	}

	// Skip header lines (starting with #)
	if (trimmedLine.startsWith("#")) {
		return null
	}

	// Parse line range format: "startLine--endLine | content" or "startLine | content"
	const rangeMatch = trimmedLine.match(/^(\d+)(?:--(\d+))?\s*\|\s*(.+)$/)
	if (!rangeMatch?.[1]) {
		return null
	}

	const startLine = parseInt(rangeMatch[1], 10)
	const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined
	const content = rangeMatch[3] || ""

	// Extract type and name from content
	const typeAndName = extractTypeAndName(content)
	if (!typeAndName) {
		return null
	}

	return {
		startLine,
		endLine,
		content,
		type: typeAndName.type,
		name: typeAndName.name,
	}
}

/**
 * Extracts type and name from a code definition line.
 *
 * @param content - The code content line
 * @returns Object with type and name, or null if not found
 */
function extractTypeAndName(
	content: string,
): { type: "class" | "interface" | "function" | "type" | "other"; name: string } | null {
	const trimmedContent = content.trim()

	// Match class definitions
	const classMatch = trimmedContent.match(/(?:^|\s)class\s+(\w+)/)
	if (classMatch?.[1]) {
		return { type: "class", name: classMatch[1] }
	}

	// Match interface definitions
	const interfaceMatch = trimmedContent.match(/(?:^|\s)interface\s+(\w+)/)
	if (interfaceMatch?.[1]) {
		return { type: "interface", name: interfaceMatch[1] }
	}

	// Match type definitions
	const typeMatch = trimmedContent.match(/(?:^|\s)type\s+(\w+)/)
	if (typeMatch?.[1]) {
		return { type: "type", name: typeMatch[1] }
	}

	// Match function definitions (including async, export, etc.)
	const functionMatch = trimmedContent.match(/(?:^|\s)(?:async\s+)?function\s+(\w+)/)
	if (functionMatch?.[1]) {
		return { type: "function", name: functionMatch[1] }
	}

	// Match arrow functions with const/let/var
	const arrowMatch = trimmedContent.match(/(?:^|\s)(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/)
	if (arrowMatch?.[1]) {
		return { type: "function", name: arrowMatch[1] }
	}

	// Match const/let/var declarations (treat as 'other' type for now)
	const constMatch = trimmedContent.match(/(?:^|\s)(?:const|let|var)\s+(\w+)/)
	if (constMatch?.[1]) {
		return { type: "other", name: constMatch[1] }
	}

	// Match method definitions (inside classes)
	const methodMatch = trimmedContent.match(/^\s*(?:async\s+)?(\w+)\s*\(/)
	if (methodMatch?.[1]) {
		return { type: "function", name: methodMatch[1] }
	}

	// Match Python function definitions
	const pythonFunctionMatch = trimmedContent.match(/(?:^|\s)def\s+(\w+)/)
	if (pythonFunctionMatch?.[1]) {
		return { type: "function", name: pythonFunctionMatch[1] }
	}

	// If no specific type matched, try to extract any identifier
	const identifierMatch = trimmedContent.match(/(\w+)/)
	if (identifierMatch?.[1]) {
		return { type: "other", name: identifierMatch[1] }
	}

	return null
}

/**
 * Converts parseSourceCodeDefinitionsForFile string output to FoldingItem array.
 *
 * @param definitions - The definitions string from parseSourceCodeDefinitionsForFile
 * @returns Array of FoldingItem, or null if parsing fails
 */
export function convertDefinitionsToFoldingItems(definitions: string): FoldingItem[] | null {
	if (!definitions || isTreeSitterErrorString(definitions)) {
		return null
	}

	const lines = definitions.split("\n")
	const items: FoldingItem[] = []

	for (const line of lines) {
		const parsed = parseDefinitionLine(line)
		if (parsed) {
			items.push({
				type: parsed.type,
				name: parsed.name,
				lineNumber: parsed.startLine,
			})
		}
	}

	// Keep all items including 'other' type for const/let/var declarations
	// These will be handled separately in the output formatting
	return items
}

/**
 * Converts parseSourceCodeDefinitionsForFile string output to ParsedDefinitionLine array.
 * This preserves the original content for output formatting.
 *
 * @param definitions - The definitions string from parseSourceCodeDefinitionsForFile
 * @returns Array of ParsedDefinitionLine, or null if parsing fails
 */
export function convertDefinitionsToParsedLines(definitions: string): ParsedDefinitionLine[] | null {
	if (!definitions || isTreeSitterErrorString(definitions)) {
		return null
	}

	const lines = definitions.split("\n")
	const parsedLines: ParsedDefinitionLine[] = []

	for (const line of lines) {
		const parsed = parseDefinitionLine(line)
		if (parsed) {
			parsedLines.push(parsed)
		}
	}

	// Filter out 'other' type items EXCEPT for const/let/var declarations
	// These are useful for understanding the file structure
	return parsedLines.filter((item) => item.type !== "other" || item.content.match(/(?:^|\s)(?:const|let|var)\s+/))
}

/**
 * Extracts folding items from a file using tree-sitter.
 * This function uses parseSourceCodeDefinitionsForFile and converts the result.
 *
 * @param filePath - Path to the file to analyze
 * @param rooIgnoreController - Optional controller for file access validation
 * @returns Array of folding items, or null if file cannot be parsed
 */
export async function extractFoldingItemsFromString(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<FoldingItem[] | null> {
	try {
		const definitions = await parseSourceCodeDefinitionsForFile(filePath, rooIgnoreController)

		if (!definitions || isTreeSitterErrorString(definitions)) {
			return null
		}

		return convertDefinitionsToFoldingItems(definitions)
	} catch (error) {
		console.error(`Error extracting folding items from ${filePath}:`, error)
		return null
	}
}

/**
 * Extracts parsed definition lines from a file using tree-sitter.
 * This function uses parseSourceCodeDefinitionsForFile and converts the result.
 *
 * @param filePath - Path to the file to analyze
 * @param rooIgnoreController - Optional controller for file access validation
 * @returns Array of parsed definition lines, or null if file cannot be parsed
 */
export async function extractParsedDefinitionLines(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<ParsedDefinitionLine[] | null> {
	try {
		const definitions = await parseSourceCodeDefinitionsForFile(filePath, rooIgnoreController)

		if (!definitions || isTreeSitterErrorString(definitions)) {
			return null
		}

		return convertDefinitionsToParsedLines(definitions)
	} catch (error) {
		console.error(`Error extracting parsed definition lines from ${filePath}:`, error)
		return null
	}
}

/**
 * Extracts both folding items and parsed definition lines from a file using tree-sitter.
 * This function calls parseSourceCodeDefinitionsForFile only once and returns both results.
 *
 * @param filePath - Path to the file to analyze
 * @param rooIgnoreController - Optional controller for file access validation
 * @returns Object with folding items and parsed definition lines, or null if file cannot be parsed
 */
export async function extractFoldingData(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<{ foldingItems: FoldingItem[]; parsedLines: ParsedDefinitionLine[] } | null> {
	try {
		const definitions = await parseSourceCodeDefinitionsForFile(filePath, rooIgnoreController)

		if (!definitions || isTreeSitterErrorString(definitions)) {
			return null
		}

		const foldingItems = convertDefinitionsToFoldingItems(definitions)
		const parsedLines = convertDefinitionsToParsedLines(definitions)

		if (!foldingItems || foldingItems.length === 0 || !parsedLines || parsedLines.length === 0) {
			return null
		}

		return { foldingItems, parsedLines }
	} catch (error) {
		console.error(`Error extracting folding data from ${filePath}:`, error)
		return null
	}
}