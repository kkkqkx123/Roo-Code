import type { StandardDefinitionType } from "../types"

/**
 * Go 类型映射规则
 */
export const goMapping: Record<string, StandardDefinitionType> = {
	// 函数定义
	"name.definition.function": "function",

	// 方法定义
	"name.definition.method": "method",

	// 类型定义（包括接口、结构体）
	"name.definition.type": "type",

	// 变量定义
	"name.definition.var": "variable",

	// 常量定义
	"name.definition.const": "variable",

	// 包定义
	"name.definition.package": "namespace",

	// 导入声明
	"name.definition.import": "other",
}

/**
 * 将 Go 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return goMapping[originalType] || "other"
}