import type { StandardDefinitionType } from "../types"

/**
 * TypeScript 类型映射规则
 */
export const typescriptMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 接口定义
	"name.definition.interface": "interface",

	// 函数定义
	"name.definition.function": "function",
	"name.definition.async_function": "function",
	"name.definition.async_arrow": "function",
	"name.definition.lambda": "function",

	// 方法定义
	"name.definition.method": "method",

	// 枚举定义
	"name.definition.enum": "enum",

	// 类型别名
	"name.definition.type": "type",
	"name.definition.utility_type": "type",

	// 命名空间和模块
	"name.definition.namespace": "namespace",
	"name.definition.module": "module",

	// 属性定义
	"name.definition.property": "property",

	// 构造函数
	"name.definition.constructor": "constructor",

	// 访问器
	"name.definition.accessor": "accessor",
}

/**
 * 将 TypeScript 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return typescriptMapping[originalType] || "other"
}