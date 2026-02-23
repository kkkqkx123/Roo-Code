import type { StandardDefinitionType } from "../types"

/**
 * Swift 类型映射规则
 */
export const swiftMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// Protocol 定义（映射到接口）
	"name.definition.interface": "interface",

	// 方法定义
	"name.definition.method": "method",
	"name.definition.static_method": "method",

	// 初始化器
	"name.definition.initializer": "constructor",
	"name.definition.convenience_initializer": "constructor",

	// 反初始化器
	"name.definition.deinitializer": "destructor",

	// 下标
	"name.definition.subscript": "accessor",

	// 属性定义
	"name.definition.property": "property",
	"name.definition.computed_property": "property",

	// 类型别名
	"name.definition.type_alias": "type",

	// 协议属性
	"name.definition.protocol_property": "property",

	// 协议方法
	"name.definition.protocol_method": "method",
}

/**
 * 将 Swift 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return swiftMapping[originalType] || "other"
}