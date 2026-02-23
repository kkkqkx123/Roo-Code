import type { StandardDefinitionType } from "../types"

/**
 * Python 类型映射规则
 */
export const pythonMapping: Record<string, StandardDefinitionType> = {
	// 类定义
	"name.definition.class": "class",

	// 函数定义
	"name.definition.function": "function",

	// Lambda 表达式
	"name.definition.lambda": "function",

	// 生成器函数
	"name.definition.generator": "function",

	// 推导式
	"name.definition.comprehension": "other",

	// 类型注解
	"name.definition.type": "type",

	// 导入语句
	"name.definition.import": "other",
}

/**
 * 将 Python 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return pythonMapping[originalType] || "other"
}