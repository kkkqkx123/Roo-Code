# NativeToolArgs 完全迁移方案

## 概述

本文档描述将 `NativeToolArgs` 类型定义从 `src/shared/tools.ts` **完全迁移**到 `src/core/tools/schemas/registry.ts` 的详细计划。

**重要说明:**
- ❌ **不保留任何向后兼容层**
- ❌ **不保留任何遗留代码**
- ✅ **完成所有迁移任务**
- ✅ **删除所有并行的架构**

## 背景

### 当前状态

- **位置:** `src/shared/tools.ts:94-124`
- **职责:** 定义每个工具的参数类型映射
- **问题:** 与新的 schema 架构重复,维护两套类型定义

### 目标状态

- **位置:** `src/core/tools/schemas/registry.ts:303-317` (ToolParamsMap)
- **职责:** 统一的工具参数类型映射
- **行动:** 删除 `src/shared/tools.ts` 中的 `NativeToolArgs` 定义

## 迁移计划

### 阶段 1: 准备阶段 (1天)

#### 1.1 分析依赖关系

```bash
# 搜索所有使用 NativeToolArgs 的文件
grep -r "NativeToolArgs" src --include="*.ts" --include="*.tsx" -l
```

**预期结果:**
- `src/shared/tools.ts` - 定义 (将被删除)
- `src/core/assistant-message/NativeToolCallParser.ts` - 使用
- `src/core/task/Task.ts` - 使用
- `src/core/metrics/MetricsService.ts` - 使用

#### 1.2 验证 ToolParamsMap 完整性

确认 `src/core/tools/schemas/registry.ts` 中的 `ToolParamsMap` 包含所有工具:

```typescript
export interface ToolParamsMap {
	access_mcp_resource: AccessMcpResourceParams
	read_file: ReadFileParams
	read_command_output: ReadCommandOutputParams
	attempt_completion: AttemptCompletionParams
	execute_command: ExecuteCommandParams
	apply_diff: ApplyDiffParams
	edit: EditParams
	search_replace: SearchReplaceParams
	edit_file: EditFileParams
	apply_patch: ApplyPatchParams
	list_files: ListFilesParams
	new_task: NewTaskParams
	ask_followup_question: AskFollowupQuestionParams
	codebase_search: CodebaseSearchParams
	generate_image: GenerateImageParams
	run_slash_command: RunSlashCommandParams
	skill: SkillParams
	search_files: SearchFilesParams
	switch_mode: SwitchModeParams
	update_todo_list: UpdateTodoListParams
	use_mcp_tool: UseMcpToolParams
	write_to_file: WriteToFileParams
}
```

**如果缺少任何工具,立即添加。**

### 阶段 2: 更新引用文件 (2-3天)

#### 2.1 更新 src/core/assistant-message/NativeToolCallParser.ts

```typescript
// 修改前
import type { NativeToolArgs } from "@coder/shared/tools"

// 修改后
import type { ToolParamsMap } from "../tools/schemas/registry"

// 更新所有使用 NativeToolArgs 的地方
// 将 NativeToolArgs 替换为 ToolParamsMap
```

#### 2.2 更新 src/core/task/Task.ts

```typescript
// 修改前
import type { NativeToolArgs } from "@coder/shared/tools"

// 修改后
import type { ToolParamsMap } from "../tools/schemas/registry"

// 更新所有使用 NativeToolArgs 的地方
// 将 NativeToolArgs 替换为 ToolParamsMap
```

#### 2.3 更新 src/core/metrics/MetricsService.ts

```typescript
// 修改前
import type { NativeToolArgs } from "@coder/shared/tools"

// 修改后
import type { ToolParamsMap } from "../tools/schemas/registry"

// 更新所有使用 NativeToolArgs 的地方
// 将 NativeToolArgs 替换为 ToolParamsMap
```

#### 2.4 全局搜索并替换

```bash
# 搜索所有其他使用 NativeToolArgs 的文件
grep -r "NativeToolArgs" src --include="*.ts" --include="*.tsx"

# 逐个文件更新导入和类型引用
```

### 阶段 3: 删除遗留代码 (1天)

#### 3.1 从 src/shared/tools.ts 删除 NativeToolArgs

**完全删除以下内容:**

```typescript
// 删除这部分代码 (第94-124行)
/**
 * Type map defining the native (typed) argument structure for each tool.
 * Tools not listed here will fall back to `any` for backward compatibility.
 */
export type NativeToolArgs = {
	access_mcp_resource: { server_name: string; uri: string }
	read_file: import("@coder/types").ReadFileToolParams
	read_command_output: { artifact_id: string; search?: string; offset?: number; limit?: number }
	attempt_completion: { result: string }
	execute_command: { command: string; cwd?: string }
	apply_diff: { path: string; diff: string }
	edit: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }
	search_and_replace: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }
	search_replace: { file_path: string; old_string: string; new_string: string }
	edit_file: { file_path: string; old_string: string; new_string: string; expected_replacements?: number }
	apply_patch: { patch: string }
	list_files: { path: string; recursive?: boolean }
	new_task: { mode: string; message: string; todos?: string }
	ask_followup_question: {
		question: string
		follow_up: Array<{ text: string; mode?: string }>
	}
	codebase_search: {
		queries: Array<string | { query: string; path?: string }>
	}
	generate_image: GenerateImageParams
	run_slash_command: { command: string; args?: string }
	skill: { skill: string; args?: string }
	search_files: { path: string; regex: string; file_pattern?: string | null }
	switch_mode: { mode_slug: string; reason: string }
	update_todo_list: { todos: string }
	use_mcp_tool: { server_name: string; tool_name: string; arguments?: Record<string, unknown> }
	write_to_file: { path: string; content: string }
}
```

#### 3.2 验证没有遗留引用

```bash
# 确认没有文件再引用 NativeToolArgs
grep -r "NativeToolArgs" src --include="*.ts" --include="*.tsx"

# 应该返回空结果
```

### 阶段 4: 验证和测试 (2-3天)

#### 4.1 运行测试套件

```bash
# 运行所有测试
npm test

# 运行类型检查
npm run type-check

# 运行 lint
npm run lint
```

**所有测试必须通过,无任何错误。**

#### 4.2 构建验证

```bash
# 运行构建
npm run build

# 确保构建成功
```

#### 4.3 功能验证

手动测试以下功能:
- 工具调用
- 工具参数验证
- 工具响应处理

### 阶段 5: 清理和文档 (1天)

#### 5.1 更新文档

**更新文件:**
- `README.md` - 移除 NativeToolArgs 相关文档
- `docs/api/tools.md` - 更新 API 文档,删除 NativeToolArgs
- `MIGRATION.md` - 添加迁移完成说明

**文档更新示例:**

```markdown
## Removed

- `NativeToolArgs` - Use `ToolParamsMap` from `@coder/core/tools/schemas/registry` instead

## Migration

NativeToolArgs has been removed. If you were using it, update your imports:

```typescript
// Before
import type { NativeToolArgs } from "@coder/shared/tools"

// After
import type { ToolParamsMap } from "@coder/core/tools/schemas/registry"
```
```

#### 5.2 更新导出

**从 src/shared/tools.ts 的导出列表中删除:**

```typescript
// 删除这一行
export type { ToolName } from "@coder/types"

// 如果有其他导出,确保只保留仍然需要的
```

## 验证清单

### 代码验证

- [ ] 所有 `NativeToolArgs` 引用已更新为 `ToolParamsMap`
- [ ] `src/shared/tools.ts` 中的 `NativeToolArgs` 定义已完全删除
- [ ] 没有任何遗留的 `NativeToolArgs` 引用
- [ ] 没有向后兼容层
- [ ] 没有遗留代码

### 测试验证

- [ ] 所有相关单元测试通过
- [ ] 类型检查无错误
- [ ] 构建成功

### 文档验证

- [ ] README.md 已更新
- [ ] API 文档已更新
- [ ] 迁移文档已更新
- [ ] 没有遗留文档引用 NativeToolArgs

## 风险评估

### 高风险

- **类型不匹配** - `ToolParamsMap` 可能与 `NativeToolArgs` 不完全一致
  - **缓解措施:** 在阶段1仔细验证类型一致性,确保所有工具参数类型匹配

### 中风险

- **遗漏引用** - 可能遗漏某些文件中的引用
  - **缓解措施:** 使用全局搜索确保找到所有引用

## 成功标准

### 强制要求

- ✅ `NativeToolArgs` 定义已完全删除
- ✅ 没有 `NativeToolArgs` 的任何引用
- ✅ 没有向后兼容层
- ✅ 没有遗留代码
- ✅ 所有测试通过

### 质量标准

- ✅ 代码审查通过
- ✅ 文档完整更新
- ✅ 无类型错误
- ✅ 无构建错误

### 时间标准

- ✅ 在 5-7 天内完成迁移
- ✅ 每个阶段按时完成

## 后续行动

迁移完成后,**不进行任何后续优化**,因为:
- 架构已经统一
- 没有并行架构
- 没有遗留代码需要清理

## 时间表

| 阶段 | 任务 | 预计时间 | 负责人 |
|------|------|---------|--------|
| 1 | 准备阶段 | 1天 | - |
| 2 | 更新引用文件 | 2-3天 | - |
| 3 | 删除遗留代码 | 1天 | - |
| 4 | 验证和测试 | 2-3天 | - |
| 5 | 清理和文档 | 1天 | - |
| **总计** | | **7-9天** | |

## 参考资料

- [src/core/tools/schemas/registry.ts](../../src/core/tools/schemas/registry.ts)
- [src/shared/tools.ts](../../src/shared/tools.ts)
