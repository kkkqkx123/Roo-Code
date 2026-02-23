import type { StandardDefinitionType } from "./types"

/**
 * 文件折叠使用的定义类型
 * 用于 file-folding 模块的高层抽象
 */
export type FoldingDefinitionType = "class" | "interface" | "function" | "type" | "other"

/**
 * 将标准类型映射到文件折叠类型
 *
 * 映射规则：
 * - function 相关：function, method, constructor, destructor, operator, accessor → function
 * - class 相关：class → class
 * - interface 相关：interface, struct → interface
 * - type 相关：type, enum, union, template, macro → type
 * - 其他：namespace, module, property, variable, other → other
 *
 * @param standardType - 标准类型
 * @returns 文件折叠类型
 */
export function mapToFoldingType(standardType: StandardDefinitionType): FoldingDefinitionType {
	// 函数相关类型
	if (
		standardType === "function" ||
		standardType === "method" ||
		standardType === "constructor" ||
		standardType === "destructor" ||
		standardType === "operator" ||
		standardType === "accessor"
	) {
		return "function"
	}

	// 类类型
	if (standardType === "class") {
		return "class"
	}

	// 接口相关类型（包括结构体，因为它们定义了数据结构）
	if (standardType === "interface" || standardType === "struct") {
		return "interface"
	}

	// 类型相关类型
	if (
		standardType === "type" ||
		standardType === "enum" ||
		standardType === "union" ||
		standardType === "template" ||
		standardType === "macro"
	) {
		return "type"
	}

	// 其他类型
	return "other"
}

/**
 * 文件折叠使用的定义接口
 */
export interface FoldingDefinition {
	/** 文件折叠类型 */
	type: FoldingDefinitionType
	/** 定义名称 */
	name: string
	/** 起始行号（1-based） */
	startLine: number
	/** 结束行号（1-based） */
	endLine: number
	/** 原始语言 */
	language: string
}

/**
 * 将标准定义转换为文件折叠定义
 *
 * @param standardDef - 标准定义
 * @returns 文件折叠定义
 */
export function convertToFoldingDefinition(standardDef: {
	type: StandardDefinitionType
	name: string
	startLine: number
	endLine: number
	language: string
}): FoldingDefinition {
	return {
		type: mapToFoldingType(standardDef.type),
		name: standardDef.name,
		startLine: standardDef.startLine,
		endLine: standardDef.endLine,
		language: standardDef.language,
	}
}

/**
 * 批量转换标准定义为文件折叠定义
 *
 * @param standardDefs - 标准定义数组
 * @returns 文件折叠定义数组
 */
export function convertToFoldingDefinitions(
	standardDefs: Array<{
		type: StandardDefinitionType
		name: string
		startLine: number
		endLine: number
		language: string
	}>,
): FoldingDefinition[] {
	return standardDefs.map(convertToFoldingDefinition)
}