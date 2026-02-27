import * as fs from "fs/promises"
import * as path from "path"
import { LanguageParser, loadRequiredLanguageParsers } from "./languageParser"
import { fileExistsAtPath } from "../../utils/fs"
import { parseMarkdown } from "./markdownParser"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { QueryCapture, Node } from "web-tree-sitter"
import type { StandardCodeDefinition } from "./types"
import { mapToStandardType } from "./mappings"
import { convertToFoldingDefinitions, type FoldingDefinition } from "./folding-mapping"

// Private constant
const DEFAULT_MIN_COMPONENT_LINES_VALUE = 4

// Getter function for MIN_COMPONENT_LINES (for easier testing)
let currentMinComponentLines = DEFAULT_MIN_COMPONENT_LINES_VALUE

/**
 * Get the current minimum number of lines for a component to be included
 */
export function getMinComponentLines(): number {
	return currentMinComponentLines
}

/**
 * Set the minimum number of lines for a component (for testing)
 */
export function setMinComponentLines(value: number): void {
	currentMinComponentLines = value
}

const extensions = [
	"tla",
	"js",
	"jsx",
	"ts",
	"vue",
	"tsx",
	"py",
	// Rust
	"rs",
	"go",
	// C
	"c",
	"h",
	// C++
	"cpp",
	"hpp",
	// C#
	"cs",
	// Ruby
	"rb",
	"java",
	"php",
	"swift",
	// Solidity
	"sol",
	// Kotlin
	"kt",
	"kts",
	// Elixir
	"ex",
	"exs",
	// Elisp
	"el",
	// HTML
	"html",
	"htm",
	// Markdown
	"md",
	"markdown",
	// JSON
	"json",
	// CSS
	"css",
	// SystemRDL
	"rdl",
	// OCaml
	"ml",
	"mli",
	// Lua
	"lua",
	// Scala
	"scala",
	// TOML
	"toml",
	// Zig
	"zig",
	// Elm
	"elm",
	// Embedded Template
	"ejs",
	"erb",
	// Visual Basic .NET
	"vb",
].map((e) => `.${e}`)

export { extensions }

export async function parseSourceCodeDefinitionsForFile(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<string | undefined> {
	// check if the file exists
	const fileExists = await fileExistsAtPath(path.resolve(filePath))
	if (!fileExists) {
		return "This file does not exist or you do not have permission to access it."
	}

	// Get file extension to determine parser
	const ext = path.extname(filePath).toLowerCase()
	// Check if the file extension is supported
	if (!extensions.includes(ext)) {
		return undefined
	}

	// Special case for markdown files
	if (ext === ".md" || ext === ".markdown") {
		// Check if we have permission to access this file
		if (rooIgnoreController && !rooIgnoreController.validateAccess(filePath)) {
			return undefined
		}

		// Read file content
		const fileContent = await fs.readFile(filePath, "utf8")

		// Split the file content into individual lines
		const lines = fileContent.split("\n")

		// Parse markdown content to get captures
		const markdownCaptures = parseMarkdown(fileContent)

		// Process the captures
		const markdownDefinitions = processCaptures(markdownCaptures, lines, "markdown")

		if (markdownDefinitions) {
			return `# ${path.basename(filePath)}\n${markdownDefinitions}`
		}
		return undefined
	}

	// For other file types, load parser and use tree-sitter
	const languageParsers = await loadRequiredLanguageParsers([filePath])

	// Parse the file if we have a parser for it
	const definitions = await parseFile(filePath, languageParsers, rooIgnoreController)
	if (definitions) {
		return `# ${path.basename(filePath)}\n${definitions}`
	}

	return undefined
}

/*
Parsing files using tree-sitter

1. Parse the file content into an AST (Abstract Syntax Tree) using the appropriate language grammar (set of rules that define how the components of a language like keywords, expressions, and statements can be combined to create valid programs).
2. Create a query using a language-specific query string, and run it against the AST's root node to capture specific syntax elements.
    - We use tag queries to identify named entities in a program, and then use a syntax capture to label the entity and its name. A notable example of this is GitHub's search-based code navigation.
	- Our custom tag queries are based on tree-sitter's default tag queries, but modified to only capture definitions.
3. Sort the captures by their position in the file, output the name of the definition, and format by i.e. adding "|----\n" for gaps between captured sections.

This approach allows us to focus on the most relevant parts of the code (defined by our language-specific queries) and provides a concise yet informative view of the file's structure and key elements.

- https://github.com/tree-sitter/node-tree-sitter/blob/master/test/query_test.js
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/helper.js
- https://tree-sitter.github.io/tree-sitter/code-navigation-systems
*/
/**
 * Parse a file and extract code definitions using tree-sitter
 *
 * @param filePath - Path to the file to parse
 * @param languageParsers - Map of language parsers
 * @param rooIgnoreController - Optional controller to check file access permissions
 * @returns A formatted string with code definitions or null if no definitions found
 */

/**
 * Process captures from tree-sitter or markdown parser
 *
 * @param captures - The captures to process
 * @param lines - The lines of the file
 * @param minComponentLines - Minimum number of lines for a component to be included
 * @returns A formatted string with definitions
 */
function processCaptures(captures: QueryCapture[], lines: string[], language: string): string | null {
	// Determine if HTML filtering is needed for this language
	const needsHtmlFiltering = ["jsx", "tsx"].includes(language)

	// Filter function to exclude HTML elements if needed
	const isNotHtmlElement = (line: string): boolean => {
		if (!needsHtmlFiltering) return true
		// Common HTML elements pattern
		const HTML_ELEMENTS = /^[^A-Z]*<\/?(?:div|span|button|input|h[1-6]|p|a|img|ul|li|form)\b/
		const trimmedLine = line.trim()
		return !HTML_ELEMENTS.test(trimmedLine)
	}

	// No definitions found
	if (captures.length === 0) {
		return null
	}

	let formattedOutput = ""

	// Sort captures by their start position
	captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

	// Track already processed lines to avoid duplicates
	const processedLines = new Set<string>()

	// First pass - categorize captures by type
	captures.forEach((capture) => {
		const { node, name } = capture

		// Skip captures that don't represent definitions
		if (!name.includes("definition") && !name.includes("name")) {
			return
		}

		// Get the parent node that contains the full definition
		const definitionNode = name.includes("name") ? node.parent : node
		if (!definitionNode) return

		// Get the start and end lines of the full definition
		const startLine = definitionNode.startPosition.row
		const endLine = definitionNode.endPosition.row
		const lineCount = endLine - startLine + 1

		// Skip components that don't span enough lines
		if (lineCount < getMinComponentLines()) {
			return
		}

		// Create unique key for this definition based on line range
		// This ensures we don't output the same line range multiple times
		const lineKey = `${startLine}-${endLine}`

		// Skip already processed lines
		if (processedLines.has(lineKey)) {
			return
		}

		// Check if this is a valid component definition (not an HTML element)
		const startLineContent = lines[startLine]?.trim() || ""

		// Special handling for component name definitions
		if (name.includes("name.definition")) {
			// Extract component name
			const componentName = node.text

			// Add component name to output regardless of HTML filtering
			if (!processedLines.has(lineKey) && componentName) {
				formattedOutput += `${startLine + 1}--${endLine + 1} | ${lines[startLine]}\n`
				processedLines.add(lineKey)
			}
		}
		// For other component definitions
		else if (isNotHtmlElement(startLineContent)) {
			formattedOutput += `${startLine + 1}--${endLine + 1} | ${lines[startLine]}\n`
			processedLines.add(lineKey)

			// If this is part of a larger definition, include its non-HTML context
			if (node.parent && node.parent.lastChild) {
				const contextEnd = node.parent.lastChild.endPosition.row
				const contextSpan = contextEnd - node.parent.startPosition.row + 1

				// Only include context if it spans multiple lines
				if (contextSpan >= getMinComponentLines()) {
					// Add the full range first
					const rangeKey = `${node.parent.startPosition.row}-${contextEnd}`
					if (!processedLines.has(rangeKey)) {
						formattedOutput += `${node.parent.startPosition.row + 1}--${contextEnd + 1} | ${lines[node.parent.startPosition.row]}\n`
						processedLines.add(rangeKey)
					}
				}
			}
		}
	})

	if (formattedOutput.length > 0) {
		return formattedOutput
	}

	return null
}

/**
 * Parse a file and extract code definitions using tree-sitter
 *
 * @param filePath - Path to the file to parse
 * @param languageParsers - Map of language parsers
 * @param rooIgnoreController - Optional controller to check file access permissions
 * @returns A formatted string with code definitions or null if no definitions found
 */
async function parseFile(
	filePath: string,
	languageParsers: LanguageParser,
	rooIgnoreController?: RooIgnoreController,
): Promise<string | null> {
	// Check if we have permission to access this file
	if (rooIgnoreController && !rooIgnoreController.validateAccess(filePath)) {
		return null
	}

	// Read file content
	const fileContent = await fs.readFile(filePath, "utf8")
	const extLang = path.extname(filePath).toLowerCase().slice(1)

	// Check if we have a parser for this file type
	const { parser, query } = languageParsers[extLang] || {}
	if (!parser || !query) {
		return `Unsupported file type: ${filePath}`
	}

	try {
		// Parse the file content into an Abstract Syntax Tree (AST)
		const tree = parser.parse(fileContent)

		// Apply the query to the AST and get the captures
		const captures = tree ? query.captures(tree.rootNode) : []

		// Split the file content into individual lines
		const lines = fileContent.split("\n")

		// Process the captures
		return processCaptures(captures, lines, extLang)
	} catch (error) {
		console.log(`Error parsing file: ${error}\n`)
		// Return null on parsing error to avoid showing error messages in the output
		return null
	}
}

/**
	* 解析文件并返回结构化的代码定义
	*
	* @param filePath - 文件路径
	* @param rooIgnoreController - 可选的文件访问控制器
	* @returns 标准化的代码定义数组，如果解析失败返回null
	*/
export async function parseSourceCodeDefinitionsForFileStructured(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<StandardCodeDefinition[] | null> {
	// 1. 检查文件是否存在
	const fileExists = await fileExistsAtPath(path.resolve(filePath))
	if (!fileExists) {
		return null
	}

	// 2. 获取文件扩展名
	const ext = path.extname(filePath).toLowerCase()
	if (!extensions.includes(ext)) {
		return null
	}

	// 3. 检查文件访问权限
	if (rooIgnoreController && !rooIgnoreController.validateAccess(filePath)) {
		return null
	}

	// 4. 读取文件内容
	const fileContent = await fs.readFile(filePath, "utf8")
	const extLang = path.extname(filePath).toLowerCase().slice(1)

	// 5. 加载语言解析器
	const languageParsers = await loadRequiredLanguageParsers([filePath])
	const { parser, query } = languageParsers[extLang] || {}
	if (!parser || !query) {
		return null
	}

	// 6. 解析AST
	const tree = parser.parse(fileContent)
	const captures = tree ? query.captures(tree.rootNode) : []
	const lines = fileContent.split("\n")

	// 7. 转换为标准化定义
	const definitions: StandardCodeDefinition[] = []
	const processedLines = new Set<string>()

	for (const capture of captures) {
		const { node, name } = capture

		// 提取类型和名称
		if (!name) continue
		
		const typeMatch = name.match(/name\.definition\.(.+)/)
		if (!typeMatch?.[1]) continue

		const originalType = typeMatch[1]
		const standardType = mapToStandardType(extLang, originalType)

		// 提取名称
		const nameNode = node.type === "identifier" || node.type === "type_identifier" || node.type === "property_identifier"
			? node
			: node.childForFieldName("name")

		if (!nameNode) continue

		const definitionName = nameNode.text
		const startLine = node.startPosition.row + 1
		const endLine = node.endPosition.row + 1

		// 避免重复
		const lineKey = `${startLine}-${endLine}-${definitionName}`
		if (processedLines.has(lineKey)) continue
		processedLines.add(lineKey)

		// 提取元数据
		const metadata = extractMetadata(node, lines, extLang)

		definitions.push({
			type: standardType,
			name: definitionName,
			startLine,
			endLine,
			originalType,
			language: extLang,
			signature: lines[startLine - 1]?.trim() ?? "",
			metadata: metadata ?? undefined,
		})
	}

	return definitions.length > 0 ? definitions : null
}

/**
	* 从AST节点提取元数据
	*/
function extractMetadata(
	node: Node,
	lines: string[],
	language: string,
): StandardCodeDefinition["metadata"] {
	const metadata: StandardCodeDefinition["metadata"] = {}

	// 获取节点所在行
	const line = lines[node.startPosition.row] || ""

	// 检查是否导出
	metadata.isExported = line.includes("export") || line.includes("public")

	// 检查是否异步
	metadata.isAsync = line.includes("async") || line.includes("suspend")

	// 检查是否抽象
	metadata.isAbstract = line.includes("abstract")

	// 检查是否静态
	metadata.isStatic = line.includes("static")

	// 检查可见性
	if (line.includes("private")) {
		metadata.visibility = "private"
	} else if (line.includes("protected")) {
		metadata.visibility = "protected"
	} else {
		metadata.visibility = "public"
	}

	return metadata
}

/**
	* 解析文件并返回用于文件折叠的定义
	*
	* @param filePath - 文件路径
	* @param rooIgnoreController - 可选的文件访问控制器
	* @returns 文件折叠定义数组，如果解析失败返回null
	*/
export async function parseSourceCodeDefinitionsForFileFolding(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<FoldingDefinition[] | null> {
	const standardDefs = await parseSourceCodeDefinitionsForFileStructured(filePath, rooIgnoreController)

	if (!standardDefs) {
		return null
	}

	return convertToFoldingDefinitions(standardDefs)
}
