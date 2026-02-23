import type { StandardDefinitionType } from "../types"

/**
 * OCaml 类型映射规则
 */
export const ocamlMapping: Record<string, StandardDefinitionType> = {
	// 模块定义
	"name.definition.module": "module",

	// 类型定义
	"name.definition.type": "type",

	// 函数定义
	"name.definition.function": "function",

	// 类定义
	"name.definition.class": "class",

	// 方法定义
	"name.definition.method": "method",

	// 值绑定
	"name.definition.value": "variable",
}

/**
 * 将 OCaml 特定类型映射到标准类型
 */
export function mapType(originalType: string): StandardDefinitionType {
	return ocamlMapping[originalType] || "other"
}