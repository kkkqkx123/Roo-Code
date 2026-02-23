import type { StandardDefinitionType } from "../types"

/**
 * Java 类型映射规则
 */
export const javaMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 接口定义
	"name.definition.interface": "interface",

	// 枚举定义
	"name.definition.enum": "enum",

	// Record 定义（映射到类）
	"name.definition.record": "class",

	// 注解定义
	"name.definition.annotation": "other",

	// 构造函数
	"name.definition.constructor": "constructor",

	// 方法定义
	"name.definition.method": "method",

	// 内部类
	"name.definition.inner_class": "class",

	// 静态嵌套类
	"name.definition.static_nested_class": "class",

	// Lambda 表达式
	"name.definition.lambda": "function",

	// 字段定义
	"name.definition.field": "property",

	// 模块定义
	"name.definition.module": "module",

	// 包定义
	"name.definition.package": "namespace",
}

/**
 * 将 Java 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return javaMapping[originalType] || "other"
}