import type { StandardDefinitionType } from "../types"

/**
 * C# 类型映射规则
 */
export const csharpMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 接口定义
	"name.definition.interface": "interface",

	// 结构体定义
	"name.definition.struct": "struct",

	// 枚举定义
	"name.definition.enum": "enum",

	// Record 定义（映射到类）
	"name.definition.record": "class",

	// 方法定义
	"name.definition.method": "method",

	// 属性定义
	"name.definition.property": "property",

	// 事件定义
	"name.definition.event": "other",

	// 委托定义
	"name.definition.delegate": "type",

	// 属性
	"name.definition.attribute": "other",

	// 类型参数
	"name.definition.type_parameter": "other",

	// 命名空间
	"name.definition.namespace": "namespace",
}

/**
 * 将 C# 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return csharpMapping[originalType] || "other"
}