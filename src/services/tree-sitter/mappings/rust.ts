import type { StandardDefinitionType } from "../types"

/**
 * Rust 类型映射规则
 */
export const rustMapping: Record<string, StandardDefinitionType> = {
	// 函数定义
	"name.definition.function": "function",

	// 结构体定义
	"name.definition.struct": "struct",

	// 枚举定义
	"name.definition.enum": "enum",

	// Trait 定义（映射到接口）
	"name.definition.trait": "interface",

	// Impl 块
	"name.definition.impl": "other",
	"name.definition.impl_trait": "other",
	"name.definition.impl_for": "other",

	// 模块定义
	"name.definition.module": "module",

	// 宏定义
	"name.definition.macro": "macro",

	// 属性宏
	"name.definition.attribute": "other",

	// 类型别名
	"name.definition.type_alias": "type",

	// 常量
	"name.definition.constant": "variable",

	// 静态变量
	"name.definition.static": "variable",

	// 方法定义
	"name.definition.method": "method",
}

/**
 * 将 Rust 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return rustMapping[originalType] || "other"
}