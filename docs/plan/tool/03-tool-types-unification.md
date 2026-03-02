# 工具类型完全统一方案

## 概述

本文档描述**完全统一**工具类型定义位置的计划,将分散的工具相关类型集中到 `packages/types/src/` 中,**删除所有并行的架构和遗留代码**。

**重要说明:**
- ❌ **不保留任何向后兼容层**
- ❌ **不保留任何遗留代码**
- ✅ **完成所有迁移任务**
- ✅ **删除所有并行的架构**
- ✅ **统一所有类型定义位置**

## 背景

### 当前状态

工具相关的类型定义分散在多个位置:

| 位置 | 类型 | 状态 |
|------|------|------|
| `packages/types/src/tool.ts` | `ToolName`, `ToolGroup` | 保留 |
| `packages/types/src/tool-params.ts` | `ReadFileParams`, `GenerateImageParams` | 需要扩展 |
| `src/core/tools/schemas/*.ts` | `ReadFileParamsSchema`, `WriteToFileParamsSchema` | 需要迁移参数类型 |
| `src/core/tools/schemas/registry.ts` | `ToolParamsMap`, `ToolRegistry` | 需要迁移到 packages/types |
| `src/shared/tools.ts` | `ToolUse`, `NativeToolArgs`, `ToolResponse` | **完全删除** |
| `src/core/assistant-message/types.ts` | `ToolUse`, `McpToolUse` | 迁移到 packages/types |

**问题:**
1. 类型定义分散,难以查找和维护
2. 存在重复定义 (如 `ToolUse`)
3. 多个并行架构,职责不清
4. 导入路径混乱

### 目标状态

**所有工具类型统一在 `packages/types/src/`:**

```
packages/types/src/
├── tool.ts                 # 工具基本类型 (ToolName, ToolGroup)
├── tool-params.ts          # 工具参数类型 (所有工具的参数类型)
├── tool-registry.ts        # 工具注册相关类型 (ToolRegistry, ToolParamsMap)
├── tool-use.ts             # 工具调用类型 (ToolUse, McpToolUse)
├── tool-response.ts        # 工具响应类型 (ToolResponse, ToolProgressStatus)
└── index.ts                # 统一导出
```

**删除的文件/代码:**
- ❌ `src/shared/tools.ts` - **完全删除**
- ❌ `src/core/assistant-message/types.ts` 中的工具类型 - **删除**
- ❌ `src/core/tools/schemas/*.ts` 中的参数类型定义 - **删除,保留 schema**

## 迁移计划

### 阶段 1: 创建新模块结构 (2-3天)

#### 1.1 创建 tool-params.ts

**文件:** `packages/types/src/tool-params.ts`

**完整内容:**

```typescript
/**
 * Tool parameter types
 *
 * This module contains all tool parameter types.
 * Each type corresponds to a specific tool and defines the structure
 * of its parameters.
 */

// ─── Read Operations ────────────────────────────────────────────────────────

/**
 * Parameters for the read_file tool.
 */
export interface ReadFileParams {
	path: string
	mode?: "slice" | "indentation"
	offset?: number
	limit?: number
	indentation?: IndentationParams
}

/**
 * Indentation-mode configuration for the read_file tool.
 */
export interface IndentationParams {
	anchor_line?: number
	max_levels?: number
	include_siblings?: boolean
	include_header?: boolean
	max_lines?: number
}

/**
 * Parameters for the codebase_search tool.
 */
export interface CodebaseSearchParams {
	queries: Array<string | { query: string; path?: string }>
}

/**
 * Parameters for the list_files tool.
 */
export interface ListFilesParams {
	path: string
	recursive?: boolean
}

/**
 * Parameters for the search_files tool.
 */
export interface SearchFilesParams {
	path: string
	regex: string
	file_pattern?: string | null
}

// ─── Write Operations ───────────────────────────────────────────────────────

/**
 * Parameters for the write_to_file tool.
 */
export interface WriteToFileParams {
	path: string
	content: string
}

/**
 * Parameters for the apply_diff tool.
 */
export interface ApplyDiffParams {
	path: string
	diff: string
}

/**
 * Parameters for the edit tool.
 */
export interface EditParams {
	file_path: string
	old_string: string
	new_string: string
	replace_all?: boolean
}

/**
 * Parameters for the search_replace tool.
 */
export interface SearchReplaceParams {
	file_path: string
	old_string: string
	new_string: string
}

/**
 * Parameters for the edit_file tool.
 */
export interface EditFileParams {
	file_path: string
	old_string: string
	new_string: string
	expected_replacements?: number
}

/**
 * Parameters for the apply_patch tool.
 */
export interface ApplyPatchParams {
	patch: string
}

// ─── Command Operations ───────────────────────────────────────────────────────

/**
 * Parameters for the execute_command tool.
 */
export interface ExecuteCommandParams {
	command: string
	cwd?: string | null
}

/**
 * Parameters for the read_command_output tool.
 */
export interface ReadCommandOutputParams {
	artifact_id: string
	search?: string
	offset?: number
	limit?: number
}

// ─── MCP Operations ─────────────────────────────────────────────────────────

/**
 * Parameters for the use_mcp_tool tool.
 */
export interface UseMcpToolParams {
	server_name: string
	tool_name: string
	arguments?: Record<string, unknown>
}

/**
 * Parameters for the access_mcp_resource tool.
 */
export interface AccessMcpResourceParams {
	server_name: string
	uri: string
}

// ─── Mode Operations ─────────────────────────────────────────────────────────

/**
 * Parameters for the ask_followup_question tool.
 */
export interface AskFollowupQuestionParams {
	question: string
	follow_up: Array<{ text: string; mode?: string | null }>
}

/**
 * Parameters for the attempt_completion tool.
 */
export interface AttemptCompletionParams {
	result: string
}

/**
 * Parameters for the switch_mode tool.
 */
export interface SwitchModeParams {
	mode_slug: string
	reason: string
}

/**
 * Parameters for the new_task tool.
 */
export interface NewTaskParams {
	mode: string
	message: string
	todos?: string
}

/**
 * Parameters for the update_todo_list tool.
 */
export interface UpdateTodoListParams {
	todos: string
}

/**
 * Parameters for the run_slash_command tool.
 */
export interface RunSlashCommandParams {
	command: string
	args?: string | null
}

/**
 * Parameters for the skill tool.
 */
export interface SkillParams {
	skill: string
	args?: string | null
}

// ─── Image Operations ────────────────────────────────────────────────────────

/**
 * Parameters for the generate_image tool.
 */
export interface GenerateImageParams {
	prompt: string
	path: string
	image?: string
}
```

#### 1.2 创建 tool-registry.ts

**文件:** `packages/types/src/tool-registry.ts`

**完整内容:**

```typescript
/**
 * Tool registry types
 *
 * This module contains types related to tool registration and management.
 */

import type { ZodType } from "zod"
import type { ToolName, ToolGroup } from "./tool"
import type {
	ReadFileParams,
	WriteToFileParams,
	ExecuteCommandParams,
	ReadCommandOutputParams,
	ApplyDiffParams,
	EditParams,
	SearchReplaceParams,
	EditFileParams,
	ApplyPatchParams,
	ListFilesParams,
	NewTaskParams,
	AskFollowupQuestionParams,
	AttemptCompletionParams,
	CodebaseSearchParams,
	UpdateTodoListParams,
	AccessMcpResourceParams,
	UseMcpToolParams,
	RunSlashCommandParams,
	SkillParams,
	SwitchModeParams,
	SearchFilesParams,
	GenerateImageParams,
} from "./tool-params"

/**
 * Interface for a tool definition in the registry.
 */
export interface ToolDefinition<TSchema extends ZodType, TOptions = unknown> {
	name: ToolName
	schema: TSchema
	description: string
	aliases?: string[]
	group?: ToolGroup
	createTool: (options?: TOptions) => any
}

/**
 * Map of tool names to their parameter types.
 */
export interface ToolParamsMap {
	read_file: { params: ReadFileParams; schema: ZodType<ReadFileParams> }
	write_to_file: { params: WriteToFileParams; schema: ZodType<WriteToFileParams> }
	execute_command: { params: ExecuteCommandParams; schema: ZodType<ExecuteCommandParams> }
	read_command_output: { params: ReadCommandOutputParams; schema: ZodType<ReadCommandOutputParams> }
	attempt_completion: { params: AttemptCompletionParams; schema: ZodType<AttemptCompletionParams> }
	apply_diff: { params: ApplyDiffParams; schema: ZodType<ApplyDiffParams> }
	edit: { params: EditParams; schema: ZodType<EditParams> }
	search_replace: { params: SearchReplaceParams; schema: ZodType<SearchReplaceParams> }
	edit_file: { params: EditFileParams; schema: ZodType<EditFileParams> }
	apply_patch: { params: ApplyPatchParams; schema: ZodType<ApplyPatchParams> }
	list_files: { params: ListFilesParams; schema: ZodType<ListFilesParams> }
	new_task: { params: NewTaskParams; schema: ZodType<NewTaskParams> }
	ask_followup_question: { params: AskFollowupQuestionParams; schema: ZodType<AskFollowupQuestionParams> }
	codebase_search: { params: CodebaseSearchParams; schema: ZodType<CodebaseSearchParams> }
	update_todo_list: { params: UpdateTodoListParams; schema: ZodType<UpdateTodoListParams> }
	access_mcp_resource: { params: AccessMcpResourceParams; schema: ZodType<AccessMcpResourceParams> }
	use_mcp_tool: { params: UseMcpToolParams; schema: ZodType<UseMcpToolParams> }
	run_slash_command: { params: RunSlashCommandParams; schema: ZodType<RunSlashCommandParams> }
	skill: { params: SkillParams; schema: ZodType<SkillParams> }
	search_files: { params: SearchFilesParams; schema: ZodType<SearchFilesParams> }
	switch_mode: { params: SwitchModeParams; schema: ZodType<SwitchModeParams> }
	generate_image: { params: GenerateImageParams; schema: ZodType<GenerateImageParams> }
}
```

#### 1.3 创建 tool-use.ts

**文件:** `packages/types/src/tool-use.ts`

**完整内容:**

```typescript
/**
 * Tool use types
 *
 * This module contains types related to tool invocation and usage.
 */

import type { ToolName } from "./tool"

/**
 * Complete list of all possible tool parameter names.
 */
export const toolParamNames = [
	"command",
	"path",
	"content",
	"regex",
	"file_pattern",
	"recursive",
	"action",
	"url",
	"coordinate",
	"text",
	"server_name",
	"tool_name",
	"arguments",
	"uri",
	"question",
	"result",
	"diff",
	"mode_slug",
	"reason",
	"line",
	"mode",
	"message",
	"cwd",
	"follow_up",
	"task",
	"size",
	"query",
	"queries",
	"args",
	"skill",
	"start_line",
	"end_line",
	"todos",
	"prompt",
	"image",
	"operations",
	"patch",
	"file_path",
	"old_string",
	"new_string",
	"replace_all",
	"expected_replacements",
	"artifact_id",
	"search",
	"offset",
	"limit",
	"indentation",
	"anchor_line",
	"max_levels",
	"include_siblings",
	"include_header",
	"max_lines",
	"files",
	"line_ranges",
] as const

/**
 * Tool parameter name type.
 */
export type ToolParamName = (typeof toolParamNames)[number]

/**
 * Generic ToolUse interface.
 */
export interface ToolUse<TName extends ToolName = ToolName> {
	type: "tool_use"
	id?: string
	name: TName
	originalName?: string
	params: Partial<Record<ToolParamName, string>>
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

#### 1.4 创建 tool-response.ts

**文件:** `packages/types/src/tool-response.ts`

**完整内容:**

```typescript
/**
 * Tool response types
 *
 * This module contains types related to tool responses and progress.
 */

import type { ToolUse } from "./tool-use"

/**
 * Tool response type.
 */
export type ToolResponse = string | Array<any>

/**
 * Tool progress status.
 */
export type ToolProgressStatus =
	| { type: "progress"; progress: number }
	| { type: "complete"; result: string }
	| { type: "error"; error: string }
```

#### 1.5 更新 packages/types/src/index.ts

**完整内容:**

```typescript
// Core modules
export * from "./api"
export * from "./codebase-index"
export * from "./checkpoint"
export * from "./context-management"
export * from "./context-mentions"
export * from "./cookie-consent"
export * from "./custom-tool"
export * from "./errors/index"
export * from "./events"
export * from "./experiment"
export * from "./followup"
export * from "./git"
export * from "./global-settings"
export * from "./history"
export * from "./image-generation"
export * from "./ipc"
export * from "./mcp"
export * from "./message"
export * from "./mode"
export * from "./model"
export * from "./provider-settings/index"
export * from "./task"
export * from "./todo"
export * from "./skills"
export * from "./terminal"
export * from "./language"
export * from "./tool"
export * from "./tool-params"
export * from "./tool-registry"
export * from "./tool-use"
export * from "./tool-response"
export * from "./vscode"
export * from "./worktree"

// Token statistics module
export * from "./token-stats"

// Refactored modules (new directory structure)
export * from "./embedding/index"
export * from "./streaming/index"
export * from "./vscode-extension-host/index"
```

### 阶段 2: 更新 src/core/tools/schemas/*.ts (2-3天)

#### 2.1 删除参数类型定义

**从每个 schema 文件中删除:**

```typescript
// 删除这些行
export type XxxParams = z.infer<typeof XxxParamsSchema>
```

**保留:**

```typescript
// 保留 schema 定义
export const XxxParamsSchema = z.object({...})

// 保留工具创建函数
export function createXxxTool() {...}

// 保留默认工具实例
export const xxxTool = createXxxTool()
```

#### 2.2 更新导入

**在每个 schema 文件顶部添加:**

```typescript
import type { XxxParams } from "@coder/types"
```

### 阶段 3: 删除 src/shared/tools.ts (1天)

#### 3.1 完全删除文件

```bash
rm src/shared/tools.ts
```

#### 3.2 更新所有引用

```bash
# 搜索引用 src/shared/tools 的文件
grep -r "from.*shared/tools" src --include="*.ts" --include="*.tsx" -l

# 逐个文件更新导入
```

**更新示例:**

```typescript
// 修改前
import type { ToolResponse, ToolUse } from "@coder/shared/tools"

// 修改后
import type { ToolResponse, ToolUse } from "@coder/types"
```

### 阶段 4: 删除 src/core/assistant-message/types.ts 中的工具类型 (1天)

#### 4.1 删除工具类型定义

**从 `src/core/assistant-message/types.ts` 中删除:**

```typescript
// 删除这些定义
export interface ToolUse<TName extends ToolName = ToolName> {...}
export interface McpToolUse {...}
```

#### 4.2 更新导入

```typescript
// 修改前
import type { ToolUse, McpToolUse } from "./types"

// 修改后
import type { ToolUse, McpToolUse } from "@coder/types"
```

### 阶段 5: 更新所有引用文件 (3-5天)

#### 5.1 全局搜索并替换

```bash
# 搜索所有需要更新的导入
grep -r "from.*shared/tools\|from.*assistant-message/types" src --include="*.ts" --include="*.tsx"

# 逐个文件更新
```

**更新规则:**

| 旧导入 | 新导入 |
|--------|--------|
| `from "@coder/shared/tools"` | `from "@coder/types"` |
| `from "../shared/tools"` | `from "@coder/types"` |
| `from "./types"` (工具类型) | `from "@coder/types"` |

#### 5.2 更新 src/core/tools/schemas/registry.ts

```typescript
// 删除 ToolParamsMap 定义
// 改为从 @coder/types 导入
import type { ToolParamsMap } from "@coder/types"
```

### 阶段 6: 验证和测试 (2-3天)

#### 6.1 运行测试套件

```bash
# 运行所有测试
npm test

# 运行类型检查
npm run type-check

# 运行 lint
npm run lint
```

**所有测试必须通过,无任何错误。**

#### 6.2 构建验证

```bash
# 运行构建
npm run build

# 确保构建成功
```

#### 6.3 验证没有遗留引用

```bash
# 确认没有文件再引用旧路径
grep -r "shared/tools\|assistant-message/types" src --include="*.ts" --include="*.tsx"

# 应该返回空结果
```

### 阶段 7: 清理和文档 (1天)

#### 7.1 更新所有文档

**更新文件:**
- `README.md` - 更新类型定义文档
- `docs/api/` - 更新所有 API 文档
- `docs/plan/` - 更新计划文档

**删除文档:**
- 删除所有引用 `src/shared/tools.ts` 的文档
- 删除所有引用 `src/core/assistant-message/types.ts` 中工具类型的文档

#### 7.2 创建迁移完成文档

**文件:** `docs/migration/tool-types-unification.md`

```markdown
# Tool Types Unification - Completed

## Summary

All tool types have been unified in `packages/types/src/`.

## Changes

### Deleted
- `src/shared/tools.ts` - Completely removed
- Tool types from `src/core/assistant-message/types.ts` - Removed
- Parameter type definitions from `src/core/tools/schemas/*.ts` - Removed

### Created/Updated
- `packages/types/src/tool-params.ts` - All tool parameter types
- `packages/types/src/tool-registry.ts` - Tool registry types
- `packages/types/src/tool-use.ts` - Tool use types
- `packages/types/src/tool-response.ts` - Tool response types

## New Imports

```typescript
// All tool types now imported from @coder/types
import type {
	ToolName,
	ToolGroup,
	ReadFileParams,
	WriteToFileParams,
	ToolUse,
	McpToolUse,
	ToolResponse,
	// ... other types
} from "@coder/types"
```

## No Backward Compatibility

There is no backward compatibility layer. All imports must be updated.
```

## 验证清单

### 代码验证

- [ ] `src/shared/tools.ts` 已完全删除
- [ ] `src/core/assistant-message/types.ts` 中的工具类型已删除
- [ ] `src/core/tools/schemas/*.ts` 中的参数类型定义已删除
- [ ] 所有导入已更新为 `from "@coder/types"`
- [ ] 没有遗留的 `shared/tools` 引用
- [ ] 没有遗留的 `assistant-message/types` 引用
- [ ] 没有向后兼容层
- [ ] 没有遗留代码

### 测试验证

- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 类型检查无错误
- [ ] Lint 检查无错误
- [ ] 构建成功

### 文档验证

- [ ] README.md 已更新
- [ ] API 文档已更新
- [ ] 迁移文档已创建
- [ ] 没有遗留文档引用旧路径

## 风险评估

### 高风险

- **类型不一致** - 新类型可能与旧类型不完全一致
  - **缓解措施:** 在阶段1仔细验证类型一致性

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

- ✅ `src/shared/tools.ts` 已完全删除
- ✅ `src/core/assistant-message/types.ts` 中的工具类型已删除
- ✅ `src/core/tools/schemas/*.ts` 中的参数类型定义已删除
- ✅ 所有导入已更新为 `from "@coder/types"`
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

- ✅ 在 12-18 天内完成迁移
- ✅ 每个阶段按时完成

## 后续行动

迁移完成后,**不进行任何后续优化**,因为:
- 架构已经统一
- 没有并行架构
- 没有遗留代码需要清理

## 时间表

| 阶段 | 任务 | 预计时间 | 负责人 |
|------|------|---------|--------|
| 1 | 创建新模块结构 | 2-3天 | - |
| 2 | 更新 schemas 文件 | 2-3天 | - |
| 3 | 删除 src/shared/tools.ts | 1天 | - |
| 4 | 删除 assistant-message/types 中的工具类型 | 1天 | - |
| 5 | 更新所有引用文件 | 3-5天 | - |
| 6 | 验证和测试 | 2-3天 | - |
| 7 | 清理和文档 | 1天 | - |
| **总计** | | **12-18天** | |

## 参考资料

- [packages/types/src/](../../packages/types/src/)
- [src/core/tools/schemas/](../../src/core/tools/schemas/)
