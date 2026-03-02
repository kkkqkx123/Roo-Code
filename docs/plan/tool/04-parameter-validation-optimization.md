# 参数验证完全优化方案

## 概述

本文档描述**完全移除**静态参数验证机制,改用基于 schema 的动态验证的计划,**删除所有遗留代码和向后兼容层**。

**重要说明:**
- ❌ **不保留任何向后兼容层**
- ❌ **不保留任何遗留代码**
- ✅ **完成所有迁移任务**
- ✅ **删除所有并行的架构**
- ✅ **完全移除静态参数列表**

## 背景

### 当前状态

**静态参数名称列表:**

```typescript
// src/shared/tools.ts
export const toolParamNames = [
	"command",
	"path",
	"content",
	// ... 86 个参数名称
] as const

export type ToolParamName = (typeof toolParamNames)[number]
```

**问题:**
1. 维护负担 - 需要手动更新列表
2. 容易遗漏 - 可能忘记添加新参数
3. 同步困难 - 需要保持与 schema 定义同步
4. 类型限制 - 静态列表限制了灵活性

### 目标状态

**完全删除静态列表,使用动态验证:**

```typescript
// 从 schema 自动提取参数名称
export function getToolParamNames(toolName: ToolName): string[] {
	const schema = getToolSchema(toolName)
	if (!schema) return []
	return Object.keys(schema.shape)
}
```

**删除的内容:**
- ❌ `src/shared/tools.ts` 中的 `toolParamNames` 常量
- ❌ `src/shared/tools.ts` 中的 `ToolParamName` 类型
- ❌ 所有使用静态列表的验证逻辑
- ❌ 所有向后兼容层

## 迁移计划

### 阶段 1: 创建动态验证模块 (2-3天)

#### 1.1 创建验证模块

**文件:** `src/core/tools/validation.ts`

**完整内容:**

```typescript
/**
 * Tool parameter validation utilities
 *
 * This module provides utilities for validating and filtering tool parameters.
 * All validation is based on schema definitions, no static lists are maintained.
 */

import type { ToolName } from "@coder/types"
import { getToolSchema } from "./schemas/registry"

/**
 * Get parameter names for a specific tool.
 *
 * @param toolName - The name of the tool
 * @returns Array of parameter names for the tool
 *
 * @example
 * ```typescript
 * const params = getToolParamNames("read_file")
 * // Returns: ["path", "mode", "offset", "limit", "indentation"]
 * ```
 */
export function getToolParamNames(toolName: ToolName): string[] {
	const schema = getToolSchema(toolName)
	if (!schema) return []

	// Extract parameter names from Zod schema
	if ('shape' in schema && typeof schema.shape === 'object') {
		return Object.keys(schema.shape)
	}

	return []
}

/**
 * Validate parameter names for a tool.
 *
 * @param toolName - The name of the tool
 * @param params - The parameters to validate
 * @returns Object containing validation result and errors
 *
 * @example
 * ```typescript
 * const result = validateToolParams("read_file", {
 *   path: "file.txt",
 *   invalid_param: "value"
 * })
 * // Returns: { valid: false, errors: ["Invalid parameter: invalid_param"] }
 * ```
 */
export function validateToolParams(
	toolName: ToolName,
	params: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
	const validNames = new Set(getToolParamNames(toolName))
	const paramNames = Object.keys(params)
	const errors: string[] = []

	for (const name of paramNames) {
		if (!validNames.has(name)) {
			errors.push(`Invalid parameter: ${name}`)
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}

/**
 * Filter valid parameters for a tool.
 *
 * @param toolName - The name of the tool
 * @param params - The parameters to filter
 * @returns Filtered parameters containing only valid ones
 *
 * @example
 * ```typescript
 * const filtered = filterToolParams("read_file", {
 *   path: "file.txt",
 *   invalid_param: "value"
 * })
 * // Returns: { path: "file.txt" }
 * ```
 */
export function filterToolParams<TName extends ToolName>(
	toolName: TName,
	params: Record<string, unknown>,
): Record<string, unknown> {
	const validNames = new Set(getToolParamNames(toolName))

	const filtered: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(params)) {
		if (validNames.has(key)) {
			filtered[key] = value
		}
	}

	return filtered
}

/**
 * Check if a parameter name is valid for a tool.
 *
 * @param toolName - The name of the tool
 * @param paramName - The parameter name to check
 * @returns True if the parameter name is valid
 */
export function isValidToolParam(
	toolName: ToolName,
	paramName: string,
): boolean {
	const validNames = getToolParamNames(toolName)
	return validNames.includes(paramName)
}

/**
 * Get all parameter names across all tools.
 *
 * @returns Set of all unique parameter names
 */
export function getAllToolParamNames(): Set<string> {
	const allNames = new Set<string>()

	const toolNames = getToolNames()
	for (const toolName of toolNames) {
		const paramNames = getToolParamNames(toolName)
		for (const name of paramNames) {
			allNames.add(name)
		}
	}

	return allNames
}

/**
 * Check if a parameter name is used by any tool.
 *
 * @param paramName - The parameter name to check
 * @returns True if the parameter name is used by any tool
 */
export function isParamNameUsed(paramName: string): boolean {
	const allNames = getAllToolParamNames()
	return allNames.has(paramName)
}

// Helper function to get all tool names
function getToolNames(): ToolName[] {
	// Import from registry to avoid circular dependency
	const { getToolNames: _getToolNames } = require("./schemas/registry")
	return _getToolNames()
}
```

### 阶段 2: 更新 packages/types/src/tool-use.ts (1天)

#### 2.1 完全重写 tool-use.ts

**文件:** `packages/types/src/tool-use.ts`

**完整内容:**

```typescript
/**
 * Tool use types
 *
 * This module contains types related to tool invocation and usage.
 * Parameter names are dynamically derived from schema definitions.
 */

import type { ToolName } from "./tool"

/**
 * Dynamic parameter name type based on tool.
 * This type is derived from the schema definition for each tool.
 */
export type ToolParamName<TName extends ToolName = ToolName> =
	TName extends keyof import("./tool-registry").ToolParamsMap
		? keyof import("./tool-registry").ToolParamsMap[TName]["params"]
		: string

/**
 * Generic ToolUse interface.
 */
export interface ToolUse<TName extends ToolName = ToolName> {
	type: "tool_use"
	id?: string
	name: TName
	originalName?: string
	params: Partial<Record<ToolParamName<TName>, string>>
	partial: boolean
	nativeArgs?: any
	usedLegacyFormat?: boolean
}

/**
 * Represents a native MCP tool call.
 */
export interface McpToolUse {
	type: "mcp_tool_use"
	id?: string
	name: string
	serverName: string
	toolName: string
	arguments: Record<string, unknown>
	partial: boolean
}
```

**注意:** 删除了 `toolParamNames` 常量和静态的 `ToolParamName` 类型。

### 阶段 3: 更新所有使用场景 (2-3天)

#### 3.1 搜索所有使用 toolParamNames 的文件

```bash
# 搜索使用情况
grep -r "toolParamNames\|ToolParamName" src --include="*.ts" --include="*.tsx" -l
```

#### 3.2 更新每个使用场景

**场景 1: 类型注解**

```typescript
// 修改前
interface ToolUse {
	params: Partial<Record<ToolParamName, string>>
}

// 修改后
import type { ToolName } from "@coder/types"

interface ToolUse<TName extends ToolName = ToolName> {
	params: Partial<Record<ToolParamName<TName>, string>>
}
```

**场景 2: 参数验证**

```typescript
// 修改前
import { toolParamNames } from "@coder/shared/tools"

function validateParams(params: Record<string, unknown>) {
	const validNames = new Set(toolParamNames)
	// 验证逻辑...
}

// 修改后
import { validateToolParams } from "@coder/core/tools/validation"

function validateParams(toolName: ToolName, params: Record<string, unknown>) {
	const result = validateToolParams(toolName, params)
	return result.valid
}
```

**场景 3: 参数过滤**

```typescript
// 修改前
import { toolParamNames } from "@coder/shared/tools"

function filterParams(params: Record<string, unknown>) {
	const validNames = new Set(toolParamNames)
	// 过滤逻辑...
}

// 修改后
import { filterToolParams } from "@coder/core/tools/validation"

function filterParams(toolName: ToolName, params: Record<string, unknown>) {
	return filterToolParams(toolName, params)
}
```

### 阶段 4: 删除遗留代码 (1天)

#### 4.1 从 src/shared/tools.ts 删除

**完全删除以下内容:**

```typescript
// 删除整个导出常量
export const toolParamNames = [
	"command",
	"path",
	"content",
	// ... 所有 86 个参数名称
] as const

// 删除整个类型定义
export type ToolParamName = (typeof toolParamNames)[number]
```

#### 4.2 验证没有遗留引用

```bash
# 确认没有文件再引用 toolParamNames 或 ToolParamName
grep -r "toolParamNames\|ToolParamName" src --include="*.ts" --include="*.tsx"

# 应该返回空结果
```

### 阶段 5: 测试和验证 (2-3天)

#### 5.1 创建测试套件

**文件:** `src/core/tools/validation/__tests__/index.test.ts`

```typescript
import {
	getToolParamNames,
	validateToolParams,
	filterToolParams,
	isValidToolParam,
	getAllToolParamNames,
	isParamNameUsed,
} from "../index"

describe("Tool Parameter Validation", () => {
	describe("getToolParamNames", () => {
		test("should return parameter names for read_file", () => {
			const names = getToolParamNames("read_file")
			expect(names).toContain("path")
			expect(names).toContain("mode")
			expect(names).toContain("offset")
			expect(names).toContain("limit")
		})

		test("should return parameter names for write_to_file", () => {
			const names = getToolParamNames("write_to_file")
			expect(names).toContain("path")
			expect(names).toContain("content")
		})

		test("should return empty array for unknown tool", () => {
			const names = getToolParamNames("unknown_tool" as any)
			expect(names).toEqual([])
		})
	})

	describe("validateToolParams", () => {
		test("should validate valid parameters", () => {
			const result = validateToolParams("read_file", {
				path: "file.txt",
				mode: "slice",
			})
			expect(result.valid).toBe(true)
			expect(result.errors).toHaveLength(0)
		})

		test("should detect invalid parameters", () => {
			const result = validateToolParams("read_file", {
				path: "file.txt",
				invalid_param: "value",
			})
			expect(result.valid).toBe(false)
			expect(result.errors).toContain("Invalid parameter: invalid_param")
		})
	})

	describe("filterToolParams", () => {
		test("should filter valid parameters", () => {
			const filtered = filterToolParams("read_file", {
				path: "file.txt",
				invalid_param: "value",
			})
			expect(filtered).toEqual({ path: "file.txt" })
		})

		test("should return empty object if no valid parameters", () => {
			const filtered = filterToolParams("read_file", {
				invalid_param: "value",
			})
			expect(filtered).toEqual({})
		})
	})

	describe("isValidToolParam", () => {
		test("should return true for valid parameter", () => {
			const isValid = isValidToolParam("read_file", "path")
			expect(isValid).toBe(true)
		})

		test("should return false for invalid parameter", () => {
			const isValid = isValidToolParam("read_file", "invalid_param")
			expect(isValid).toBe(false)
		})
	})

	describe("getAllToolParamNames", () => {
		test("should return all unique parameter names", () => {
			const allNames = getAllToolParamNames()
			expect(allNames).toBeInstanceOf(Set)
			expect(allNames.size).toBeGreaterThan(0)
			expect(allNames.has("path")).toBe(true)
		})
	})

	describe("isParamNameUsed", () => {
		test("should return true for used parameter name", () => {
			const isUsed = isParamNameUsed("path")
			expect(isUsed).toBe(true)
		})

		test("should return false for unused parameter name", () => {
			const isUsed = isParamNameUsed("invalid_param")
			expect(isUsed).toBe(false)
		})
	})
})
```

#### 5.2 运行测试

```bash
# 运行验证测试
npm test -- validation

# 运行所有测试
npm test

# 运行类型检查
npm run type-check

# 运行 lint
npm run lint
```

**所有测试必须通过,无任何错误。**

### 阶段 6: 清理和文档 (1天)

#### 6.1 更新文档

**创建文件:** `docs/api/validation.md`

```markdown
# Tool Parameter Validation

## Overview

Tool parameter validation provides utilities for validating and filtering tool parameters.
All validation is based on schema definitions, no static lists are maintained.

## Functions

### getToolParamNames

Get parameter names for a specific tool.

```typescript
import { getToolParamNames } from "@coder/core/tools/validation"

const params = getToolParamNames("read_file")
// Returns: ["path", "mode", "offset", "limit", "indentation"]
```

### validateToolParams

Validate parameter names for a tool.

```typescript
import { validateToolParams } from "@coder/core/tools/validation"

const result = validateToolParams("read_file", {
	path: "file.txt",
	invalid_param: "value"
})
// Returns: { valid: false, errors: ["Invalid parameter: invalid_param"] }
```

### filterToolParams

Filter valid parameters for a tool.

```typescript
import { filterToolParams } from "@coder/core/tools/validation"

const filtered = filterToolParams("read_file", {
	path: "file.txt",
	invalid_param: "value"
})
// Returns: { path: "file.txt" }
```

## Type Annotations

Use dynamic parameter types:

```typescript
import type { ToolName, ToolParamName } from "@coder/types"

interface ToolUse<TName extends ToolName = ToolName> {
	params: Partial<Record<ToolParamName<TName>, string>>
}
```

## Removed

The following have been removed:
- `toolParamNames` static list
- `ToolParamName` static type
- All static parameter validation logic
```

#### 6.2 创建迁移完成文档

**文件:** `docs/migration/parameter-validation.md`

```markdown
# Parameter Validation Migration - Completed

## Summary

Static parameter validation has been completely removed and replaced with dynamic validation based on schema definitions.

## Changes

### Deleted
- `toolParamNames` constant from `src/shared/tools.ts`
- `ToolParamName` type from `src/shared/tools.ts`
- All static parameter validation logic
- All backward compatibility layers

### Created
- `src/core/tools/validation.ts` - Dynamic parameter validation utilities
- Updated `packages/types/src/tool-use.ts` - Dynamic parameter types

## New Imports

```typescript
// Use dynamic validation functions
import {
	getToolParamNames,
	validateToolParams,
	filterToolParams,
} from "@coder/core/tools/validation"

// Use dynamic parameter types
import type { ToolName, ToolParamName } from "@coder/types"

interface ToolUse<TName extends ToolName = ToolName> {
	params: Partial<Record<ToolParamName<TName>, string>>
}
```

## No Backward Compatibility

There is no backward compatibility layer. All code must be updated to use dynamic validation.
```

## 验证清单

### 代码验证

- [ ] `toolParamNames` 常量已完全删除
- [ ] `ToolParamName` 类型已完全删除
- [ ] 所有静态验证逻辑已删除
- [ ] 所有使用场景已更新为动态验证
- [ ] 没有遗留的 `toolParamNames` 引用
- [ ] 没有遗留的 `ToolParamName` 引用
- [ ] 没有向后兼容层
- [ ] 没有遗留代码

### 测试验证

- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 类型检查无错误
- [ ] Lint 检查无错误
- [ ] 构建成功

### 文档验证

- [ ] API 文档已更新
- [ ] 迁移文档已创建
- [ ] 没有遗留文档引用静态列表

## 风险评估

### 高风险

- **性能影响** - 动态提取可能比静态列表慢
  - **缓解措施:** 添加缓存机制,缓存提取结果

### 中风险

- **遗漏引用** - 可能遗漏某些文件中的引用
  - **缓解措施:** 使用全局搜索确保找到所有引用

### 低风险

- **文档更新延迟** - 文档可能未及时更新
  - **缓解措施:** 在迁移过程中同步更新文档

## 回滚计划

如果迁移失败:

1. **立即回滚:** 恢复所有更改的文件
2. **问题分析:** 识别失败原因
3. **修复后重试:** 解决问题后重新开始迁移

## 成功标准

### 强制要求

- ✅ `toolParamNames` 常量已完全删除
- ✅ `ToolParamName` 类型已完全删除
- ✅ 所有静态验证逻辑已删除
- ✅ 所有使用场景已更新
- ✅ 没有遗留引用
- ✅ 没有向后兼容层
- ✅ 没有遗留代码
- ✅ 所有测试通过

### 质量标准

- ✅ 代码审查通过
- ✅ 文档完整更新
- ✅ 无类型错误
- ✅ 无构建错误

### 时间标准

- ✅ 在 9-12 天内完成迁移
- ✅ 每个阶段按时完成

## 后续优化

迁移完成后,**不进行任何后续优化**,因为:
- 架构已经统一
- 没有并行架构
- 没有遗留代码需要清理

## 时间表

| 阶段 | 任务 | 预计时间 | 负责人 |
|------|------|---------|--------|
| 1 | 创建动态验证模块 | 2-3天 | - |
| 2 | 更新 packages/types | 1天 | - |
| 3 | 更新所有使用场景 | 2-3天 | - |
| 4 | 删除遗留代码 | 1天 | - |
| 5 | 测试和验证 | 2-3天 | - |
| 6 | 清理和文档 | 1天 | - |
| **总计** | | **9-12天** | |

## 参考资料

- [src/core/tools/validation/](../../src/core/tools/validation/)
- [packages/types/src/tool-use.ts](../../packages/types/src/tool-use.ts)
