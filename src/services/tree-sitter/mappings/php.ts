import type { StandardDefinitionType } from "../types"

/**
 * PHP 类型映射规则
 */
export const phpMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",
	"name.definition.abstract_class": "class",
	"name.definition.final_class": "class",
	"name.definition.readonly_class": "class",

	// 接口定义
	"name.definition.interface": "interface",

	// Trait 定义（映射到接口）
	"name.definition.trait": "interface",

	// 枚举定义
	"name.definition.enum": "enum",

	// 函数定义
	"name.definition.function": "function",

	// 方法定义
	"name.definition.method": "method",
	"name.definition.static_method": "method",
	"name.definition.abstract_method": "method",
	"name.definition.final_method": "method",

	// 箭头函数
	"name.definition.arrow_function": "function",

	// 属性定义
	"name.definition.property": "property",
	"name.definition.static_property": "property",
	"name.definition.readonly_property": "property",
	"name.definition.promoted_property": "property",

	// 常量定义
	"name.definition.constant": "variable",

	// 命名空间
	"name.definition.namespace": "namespace",

	// Use 语句
	"name.definition.use": "other",

	// 属性
	"name.definition.attribute": "other",
}

/**
 * 将 PHP 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return phpMapping[originalType] || "other"
}