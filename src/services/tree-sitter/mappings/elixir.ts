import type { StandardDefinitionType } from "../types"

/**
 * Elixir 类型映射规则
 */
export const elixirMapping: Record<string, StandardDefinitionType> = {
	// 模块定义
	"name.definition.module": "module",

	// 函数定义
	"name.definition.function": "function",

	// 宏定义
	"name.definition.macro": "macro",

	// 结构体定义（映射到类）
	"name.definition.struct": "class",

	// 守卫定义
	"name.definition.guard": "other",

	// 行为回调（映射到接口）
	"name.definition.behaviour": "interface",

	// 测试定义
	"name.definition.test": "function",

	// 模块属性
	"name.definition.attribute": "other",
}

/**
 * 将 Elixir 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return elixirMapping[originalType] || "other"
}