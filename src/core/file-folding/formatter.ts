import { MergedSection } from "./function-merger"
import { ParsedDefinitionLine } from "./definition-parser"

/**
 * Format options for file folding output.
 */
export interface FormatOptions {
	/** The file path to include in the header */
	filePath?: string
	/** Whether to wrap content in <system-reminder> block (default: true) */
	wrapInSystemReminder?: boolean
	/** Custom header format (default: "## File Context: {filePath}") */
	headerFormat?: string
}

/**
 * Formats merged sections using original code line format.
 * This preserves the original "startLine--endLine | code content" format.
 *
 * @param sections - Array of merged sections
 * @param parsedLines - Original parsed lines to extract content from
 * @returns Formatted string representation
 */
export function formatSectionsWithOriginalContent(
	sections: MergedSection[],
	parsedLines: ParsedDefinitionLine[],
): string {
	const lines: string[] = []

	// Create a map of (type, name) to parsed lines for quick lookup
	const lineMap = new Map<string, ParsedDefinitionLine>()
	for (const parsed of parsedLines) {
		const key = `${parsed.type}:${parsed.name}`
		lineMap.set(key, parsed)
	}

	// First, output all 'other' type items (const/let/var declarations) in order
	for (const parsed of parsedLines) {
		if (parsed.type === "other") {
			const range = parsed.endLine ? `${parsed.startLine}--${parsed.endLine}` : `${parsed.startLine}`
			lines.push(`${range} | ${parsed.content}`)
		}
	}

	// Then output merged sections
	for (const section of sections) {
		if (section.type === "functions") {
			// Functions are merged together - collect all function names
			const functionLines: string[] = []
			for (const name of section.names) {
				const key = `function:${name}`
				const parsed = lineMap.get(key)
				if (parsed) {
					const range = parsed.endLine ? `${parsed.startLine}--${parsed.endLine}` : `${parsed.startLine}`
					functionLines.push(`${range} | ${parsed.content}`)
				}
			}
			if (functionLines.length > 0) {
				lines.push(functionLines.join("\n"))
			}
		} else {
			// Class, interface, type are displayed separately
			const name = section.names[0]
			const key = `${section.type}:${name}`
			const parsed = lineMap.get(key)
			if (parsed) {
				const range = parsed.endLine ? `${parsed.startLine}--${parsed.endLine}` : `${parsed.startLine}`
				lines.push(`${range} | ${parsed.content}`)
			}
		}
	}

	return lines.join("\n")
}

/**
 * Formats a single file's folded content with optional wrapping.
 *
 * @param sections - Array of merged sections
 * @param parsedLines - Original parsed lines for formatting
 * @param options - Format options
 * @returns Formatted string with optional wrapping
 */
export function formatFoldedFile(
	sections: MergedSection[],
	parsedLines: ParsedDefinitionLine[],
	options: FormatOptions = {},
): string {
	const { filePath, wrapInSystemReminder = true, headerFormat = "## File Context: {filePath}" } = options

	// Format the sections
	const content = formatSectionsWithOriginalContent(sections, parsedLines)

	// If no wrapping requested, return content as-is
	if (!wrapInSystemReminder) {
		return content
	}

	// Build the wrapped content
	let wrappedContent = "<system-reminder>\n"

	// Add header if filePath is provided
	if (filePath) {
		const header = headerFormat.replace("{filePath}", filePath)
		wrappedContent += `${header}\n`
	}

	// Add content
	wrappedContent += `${content}\n`
	wrappedContent += "</system-reminder>"

	return wrappedContent
}

/**
 * Formats multiple files' folded content.
 *
 * @param files - Array of file data with sections and parsed lines
 * @param options - Format options (applied to all files)
 * @returns Array of formatted file contents
 */
export function formatMultipleFoldedFiles(
	files: Array<{
		sections: MergedSection[]
		parsedLines: ParsedDefinitionLine[]
		filePath?: string
	}>,
	options: FormatOptions = {},
): string[] {
	return files.map((file) =>
		formatFoldedFile(file.sections, file.parsedLines, {
			...options,
			filePath: file.filePath || options.filePath,
		}),
	)
}

/**
 * Joins multiple formatted file contents into a single string.
 *
 * @param formattedFiles - Array of formatted file contents
 * @param separator - Separator between files (default: "\n")
 * @returns Joined string
 */
export function joinFormattedFiles(formattedFiles: string[], separator: string = "\n"): string {
	return formattedFiles.join(separator)
}