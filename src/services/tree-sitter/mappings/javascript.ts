import type { StandardDefinitionType } from "../types"

/**
 * JavaScript 类型映射规则
 */
export const javascriptMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 函数定义
	"name.definition.function": "function",

	// 方法定义
	"name.definition.method": "method",

	// 变量定义
	"name.definition.variable": "variable",

	// JSON 属性
	"property.name.definition": "property",
}

/**
 * 将 JavaScript 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return javascriptMapping[originalType] || "other"
}