# 差异处理类型重构方案

## 概述

本文档描述将差异处理相关类型 (`DiffResult`, `DiffItem`, `DiffStrategy`) 从 `src/shared/tools.ts` 迁移到专门的差异处理模块的计划。

## 背景

### 当前状态

- **位置:** `src/shared/tools.ts:346-389`
- **包含类型:**
  - `DiffResult` - 差异操作结果类型
  - `DiffItem` - 差异项类型
  - `DiffStrategy` - 差异策略接口
- **问题:**
  - 与工具类型混杂在一起,职责不清晰
  - 差异处理是独立的功能领域,应该有自己的模块
  - 不利于差异处理功能的扩展和维护

### 目标状态

- **位置:** `src/core/diff/types.ts`
- **职责:** 统一管理所有差异处理相关的类型定义
- **优势:**
  - 职责清晰,易于维护
  - 便于差异处理功能的扩展
  - 提高代码的可读性和可维护性

## 迁移计划

### 阶段 1: 准备阶段 (1天)

#### 1.1 分析依赖关系

```bash
# 搜索所有使用差异处理类型的文件
grep -r "DiffResult\|DiffItem\|DiffStrategy" src --include="*.ts" --include="*.tsx"
```

**预期结果:**
- `src/shared/tools.ts` - 定义
- `src/core/diff/*` - 差异策略实现
- `src/core/assistant-message/*` - 工具调用处理
- 测试文件

#### 1.2 创建新模块结构

```
src/core/diff/
├── types.ts           # 差异处理类型定义
├── strategies/
│   ├── index.ts       # 策略导出
│   ├── base.ts        # 基础策略类
│   ├── search.ts      # 搜索替换策略
│   └── patch.ts       # 补丁策略
└── __tests__/
    └── types.test.ts  # 类型测试
```

### 阶段 2: 迁移阶段 (2-3天)

#### 2.1 创建类型定义文件

**文件:** `src/core/diff/types.ts`

```typescript
/**
 * Diff handling types
 *
 * This module contains all type definitions related to diff operations.
 */

/**
 * Result type for diff operations.
 *
 * @remarks
 * A diff operation can either succeed or fail. When successful, it returns
 * the modified content. When it fails, it returns an error message and
 * optional details about why the diff couldn't be applied.
 */
export type DiffResult =
	| DiffSuccess
	| DiffFailure

/**
 * Successful diff result.
 */
export interface DiffSuccess {
	/** Indicates the diff was applied successfully */
	success: true
	/** The modified content after applying the diff */
	content: string
	/** Optional: parts of the diff that failed (for batch operations) */
	failParts?: DiffResult[]
}

/**
 * Failed diff result.
 */
export interface DiffFailure {
	/** Indicates the diff failed */
	success: false
	/** Optional: error message describing the failure */
	error?: string
	/** Optional: detailed information about why the diff failed */
	details?: DiffFailureDetails
	/** Optional: parts of the diff that failed (for batch operations) */
	failParts?: DiffResult[]
}

/**
 * Detailed information about a diff failure.
 */
export interface DiffFailureDetails {
	/** Similarity score between the search string and the best match */
	similarity?: number
	/** Threshold used for matching */
	threshold?: number
	/** The range of the best match found */
	matchedRange?: { start: number; end: number }
	/** The content that was searched */
	searchContent?: string
	/** The best match found */
	bestMatch?: string
}

/**
 * Item type for new diff format (array-based).
 *
 * @remarks
 * Used for the new array-based diff format where each item represents
 * a separate change. This format is more flexible and allows for
 * better handling of complex multi-part changes.
 */
export interface DiffItem {
	/** The content of the diff item */
	content: string
	/** Optional: the starting line number for this item */
	startLine?: number
}

/**
 * Interface for diff strategy implementations.
 *
 * @remarks
 * Diff strategies define how to apply changes to content. Different
 * strategies may use different algorithms and formats. The common
 * interface allows for easy swapping and testing of different approaches.
 */
export interface DiffStrategy {
	/**
	 * Get the name of this diff strategy.
	 *
	 * @returns The name of the strategy (e.g., "search-replace", "patch")
	 */
	getName(): string

	/**
	 * Apply a diff to the original content.
	 *
	 * @param originalContent - The original file content
	 * @param diffContent - The diff content in the strategy's format
	 * @param startLine - Optional line number where the search block starts
	 * @param endLine - Optional line number where the search block ends
	 * @returns A DiffResult object containing either the successful result or error details
	 *
	 * @remarks
	 * The diffContent can be either a string (for legacy formats) or an
	 * array of DiffItem (for the new array-based format). The strategy
	 * should handle both formats appropriately.
	 */
	applyDiff(
		originalContent: string,
		diffContent: string | DiffItem[],
		startLine?: number,
		endLine?: number,
	): Promise<DiffResult>

	/**
	 * Get the progress status for a diff operation.
	 *
	 * @param toolUse - The tool use that triggered this diff
	 * @param result - Optional result from the diff operation
	 * @returns The progress status for the operation
	 *
	 * @remarks
	 * This is an optional method that allows strategies to provide
	 * custom progress information. If not implemented, the default
	 * progress handling will be used.
	 */
	getProgressStatus?(toolUse: ToolUse, result?: any): ToolProgressStatus
}

// Re-export types that are needed by other modules
export type {
	ToolUse,
} from "../assistant-message/types"

export type {
	ToolProgressStatus,
} from "@coder/types"
```

#### 2.2 更新 src/shared/tools.ts

```typescript
// ─── Diff Handling Types ─────────────────────────────────────────────────────────

/**
 * Diff handling types.
 *
 * @deprecated Import from `@coder/core/diff` instead.
 * This type is kept for backward compatibility and will be removed in a future version.
 *
 * Migration guide:
 * 1. Replace import: `import type { DiffResult } from "@coder/shared/tools"`
 * 2. With: `import type { DiffResult } from "@coder/core/diff"`
 */
export type {
	DiffResult,
	DiffItem,
	DiffStrategy,
} from "../core/diff/types"
```

#### 2.3 更新引用文件

**文件:** `src/core/diff/strategies/base.ts`

```typescript
// 修改前
import type { DiffResult, DiffStrategy, DiffItem } from "@coder/shared/tools"

// 修改后
import type { DiffResult, DiffStrategy, DiffItem } from "../types"
```

**文件:** `src/core/diff/strategies/search.ts`

```typescript
// 修改前
import type { DiffResult, DiffStrategy, DiffItem } from "@coder/shared/tools"

// 修改后
import type { DiffResult, DiffStrategy, DiffItem } from "../types"
```

**文件:** `src/core/diff/strategies/patch.ts`

```typescript
// 修改前
import type { DiffResult, DiffStrategy, DiffItem } from "@coder/shared/tools"

// 修改后
import type { DiffResult, DiffStrategy, DiffItem } from "../types"
```

**文件:** `src/core/assistant-message/*.ts`

```typescript
// 修改前
import type { DiffResult } from "@coder/shared/tools"

// 修改后
import type { DiffResult } from "../diff/types"
```

### 阶段 3: 验证阶段 (2天)

#### 3.1 创建类型测试

**文件:** `src/core/diff/__tests__/types.test.ts`

```typescript
import type { DiffResult, DiffSuccess, DiffFailure, DiffItem, DiffStrategy } from "../types"

describe("Diff Types", () => {
	describe("DiffResult", () => {
		test("should accept success result", () => {
			const result: DiffResult = {
				success: true,
				content: "modified content",
			}
			expect(result.success).toBe(true)
		})

		test("should accept failure result", () => {
			const result: DiffResult = {
				success: false,
				error: "Failed to apply diff",
			}
			expect(result.success).toBe(false)
		})

		test("should accept failure with details", () => {
			const result: DiffResult = {
				success: false,
				details: {
					similarity: 0.8,
					threshold: 0.9,
				},
			}
			expect(result.success).toBe(false)
		})
	})

	describe("DiffItem", () => {
		test("should accept item with content only", () => {
			const item: DiffItem = {
				content: "new content",
			}
			expect(item.content).toBe("new content")
		})

		test("should accept item with start line", () => {
			const item: DiffItem = {
				content: "new content",
				startLine: 10,
			}
			expect(item.startLine).toBe(10)
		})
	})

	describe("DiffStrategy", () => {
		test("should implement required methods", () => {
			const strategy: DiffStrategy = {
				getName: () => "test-strategy",
				applyDiff: async () => ({
					success: true,
					content: "result",
				}),
			}
			expect(strategy.getName()).toBe("test-strategy")
		})

		test("should optionally implement getProgressStatus", () => {
			const strategy: DiffStrategy = {
				getName: () => "test-strategy",
				applyDiff: async () => ({
					success: true,
					content: "result",
				}),
				getProgressStatus: () => ({ type: "progress", progress: 0.5 }),
			}
			expect(strategy.getProgressStatus).toBeDefined()
		})
	})
})
```

#### 3.2 运行测试

```bash
# 运行差异处理相关测试
npm test -- diff

# 运行类型检查
npm run type-check

# 运行 lint
npm run lint
```

### 阶段 4: 清理阶段 (1天)

#### 4.1 移除重复定义

**文件:** `src/shared/tools.ts`

```typescript
// 移除 DiffResult、DiffItem、DiffStrategy 的完整定义
// 保留重导出作为向后兼容层

/**
 * @deprecated Import from `@coder/core/diff` instead
 */
export type {
	DiffResult,
	DiffItem,
	DiffStrategy,
} from "../core/diff/types"
```

#### 4.2 更新文档

**更新文件:**
- `README.md` - 更新差异处理文档
- `docs/api/diff.md` - 更新 API 文档
- `MIGRATION.md` - 添加迁移指南

#### 4.3 发布说明

```markdown
## Breaking Changes

- Diff handling types (`DiffResult`, `DiffItem`, `DiffStrategy`) are now exported from `@coder/core/diff` instead of `@coder/shared/tools`.

## Migration Guide

```typescript
// Before
import type { DiffResult, DiffItem, DiffStrategy } from "@coder/shared/tools"

// After
import type { DiffResult, DiffItem, DiffStrategy } from "@coder/core/diff"
```

## Backward Compatibility

The types are still re-exported from `@coder/shared/tools` for backward compatibility.
```

## 风险评估

### 高风险

- **无** - 所有更改都是类型级别的,不影响运行时行为

### 中风险

- **循环依赖** - 新模块可能引入循环依赖
  - **缓解措施:** 仔细设计模块依赖关系,使用类型重导出

### 低风险

- **文档更新延迟** - 文档可能未及时更新
  - **缓解措施:** 在迁移过程中同步更新文档

## 成功标准

### 技术标准

- ✅ 所有测试通过
- ✅ 类型检查无错误
- ✅ 无循环依赖
- ✅ 向后兼容性保持

### 质量标准

- ✅ 代码审查通过
- ✅ 文档完整更新
- ✅ 迁移指南清晰
- ✅ 类型定义清晰完整

### 时间标准

- ✅ 在 1 周内完成迁移
- ✅ 每个阶段按时完成

## 回滚计划

如果迁移过程中遇到严重问题:

1. **立即回滚:** 恢复所有更改的文件
2. **问题分析:** 识别失败原因
3. **修复后重试:** 解决问题后重新开始迁移

## 后续优化

迁移完成后,可以考虑:

1. **移除向后兼容层** - 在下一个主要版本中移除重导出
2. **添加更多策略** - 实现更多差异策略
3. **性能优化** - 优化大型文件的差异处理性能
4. **可视化工具** - 添加差异预览和可视化功能

## 时间表

| 阶段 | 任务 | 预计时间 | 负责人 |
|------|------|---------|--------|
| 1 | 准备阶段 | 1天 | - |
| 2 | 迁移阶段 | 2-3天 | - |
| 3 | 验证阶段 | 2天 | - |
| 4 | 清理阶段 | 1天 | - |
| **总计** | | **6-7天** | |

## 参考资料

- [src/core/diff/](../../src/core/diff/)
- [src/shared/tools.ts](../../src/shared/tools.ts)
- [差异处理最佳实践](https://www.google.com/search?q=diff+handling+best+practices)
