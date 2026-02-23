import type { StandardDefinitionType } from "../types"

/**
 * Scala 类型映射规则
 */
export const scalaMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 对象定义
	"name.definition.object": "class",

	// Trait 定义（映射到接口）
	"name.definition.trait": "interface",

	// 方法定义
	"name.definition.method": "method",

	// 变量定义
	"name.definition.variable": "variable",

	// 类型定义
	"name.definition.type": "type",

	// 包定义
	"name.definition.namespace": "namespace",
}

/**
 * 将 Scala 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return scalaMapping[originalType] || "other"
}