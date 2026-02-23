import type { StandardDefinitionType } from "../types"

/**
 * Ruby 类型映射规则
 */
export const rubyMapping: Record<string, StandardDefinitionType> = {
	// 方法定义
	"name.definition.method": "method",

	// 类定义
	"name.definition.class": "class",

	// 模块定义
	"name.definition.module": "module",

	// 常量定义
	"name.definition.constant": "variable",

	// Mixin（映射到接口）
	"name.definition.mixin": "interface",

	// 属性访问器
	"name.definition.attr_accessor": "property",
	"name.definition.attr_reader": "property",
	"name.definition.attr_writer": "property",
}

/**
 * 将 Ruby 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return rubyMapping[originalType] || "other"
}