import type { StandardDefinitionType } from "../types"

/**
 * Kotlin 类型映射规则
 */
export const kotlinMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",
	"name.definition.data_class": "class",
	"name.definition.abstract_class": "class",
	"name.definition.sealed_class": "class",

	// 枚举类
	"name.definition.enum_class": "enum",

	// 接口定义
	"name.definition.interface": "interface",

	// 函数定义
	"name.definition.function": "function",
	"name.definition.suspend_function": "function",

	// 扩展函数
	"name.definition.extension_function": "method",

	// 对象声明
	"name.definition.object": "class",
	"name.definition.companion_object": "class",

	// 注解类
	"name.definition.annotation_class": "other",

	// 构造函数
	"name.definition.primary_constructor": "constructor",
	"name.definition.secondary_constructor": "constructor",

	// 属性定义
	"name.definition.property": "property",

	// 类型别名
	"name.definition.type_alias": "type",
}

/**
 * 将 Kotlin 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return kotlinMapping[originalType] || "other"
}