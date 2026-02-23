/**
 * 标准化的代码定义类型（使用联合类型）
 */
export type StandardDefinitionType =
	// 核心类型
	| "class"
	| "interface"
	| "function"
	| "method"
	// 其他类型
	| "enum"
	| "type"
	| "namespace"
	| "module"
	// 特殊类型
	| "constructor"
	| "destructor"
	| "operator"
	| "accessor"
	| "property"
	// C/C++特定
	| "struct"
	| "union"
	| "template"
	| "macro"
	// 其他
	| "variable"
	| "other"

/**
 * 标准化的代码定义
 */
export interface StandardCodeDefinition {
	/** 标准化类型 */
	type: StandardDefinitionType
	/** 定义名称 */
	name: string
	/** 起始行号（1-based） */
	startLine: number
	/** 结束行号（1-based） */
	endLine: number
	/** 原始语言特定类型 */
	originalType: string
	/** 语言 */
	language: string
	/** 可选的完整签名 */
	signature?: string
	/** 可选的元数据 */
	metadata?: {
		isExported?: boolean
		isAsync?: boolean
		isAbstract?: boolean
		isStatic?: boolean
		visibility?: "public" | "private" | "protected"
		[key: string]: any
	}
}