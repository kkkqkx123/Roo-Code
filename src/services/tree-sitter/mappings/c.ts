import type { StandardDefinitionType } from "../types"

/**
 * C 语言类型映射规则
 */
export const cMapping: Record<string, StandardDefinitionType> = {
	// 函数定义
	"name.definition.function": "function",

	// 结构体定义
	"name.definition.struct": "struct",

	// 联合体定义
	"name.definition.union": "union",

	// 枚举定义
	"name.definition.enum": "enum",

	// 类型定义
	"name.definition.type": "type",

	// 变量定义
	"name.definition.variable": "variable",

	// 宏定义
	"name.definition.macro": "macro",
}

/**
 * 将 C 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return cMapping[originalType] || "other"
}