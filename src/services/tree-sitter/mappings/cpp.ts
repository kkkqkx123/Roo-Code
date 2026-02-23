import type { StandardDefinitionType } from "../types"

/**
 * C++ 类型映射规则
 */
export const cppMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 函数定义
	"name.definition.function": "function",

	// 方法定义
	"name.definition.method": "method",

	// 类型定义
	"name.definition.type": "type",

	// 枚举定义
	"name.definition.enum": "enum",

	// 命名空间
	"name.definition.namespace": "namespace",

	// 模板定义
	"name.definition.template.class": "template",

	// 宏定义
	"name.definition.macro": "macro",

	// 变量定义
	"name.definition.variable": "variable",

	// 构造函数
	"name.definition.constructor": "constructor",

	// 析构函数
	"name.definition.destructor": "destructor",

	// 运算符重载
	"name.definition.operator": "operator",
}

/**
 * 将 C++ 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return cppMapping[originalType] || "other"
}