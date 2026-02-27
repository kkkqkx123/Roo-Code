# ToolExecutionResult 集成分析

**日期**: 2026-02-27  
**状态**: 待实施  
**相关文件**: `src/core/errors/tools/result.ts`

---

## 一、ToolExecutionResult 设计概述

### 1.1 目的

`ToolExecutionResult` 用于批量操作场景，允许：
1. **收集多个错误** - LLM 可以一次性看到所有问题
2. **独立跟踪成功/失败** - 部分失败不影响整体处理
3. **统一报告格式** - 为 LLM 和日志系统提供结构化输出

### 1.2 核心接口

```typescript
interface ToolExecutionResult<T> {
  successes: T[]           // 成功处理的结果
  errors: ToolError[]      // 收集的错误
  
  hasErrors(): boolean
  toLLMReport(): string    // LLM 导向的统一报告
  toLogEntries(): LogEntry[] // 日志/遥测导向
  successRate(): number    // 成功率统计
}
```

### 1.3 使用模式

```typescript
// 方式 1: 可变构建器
const result = createMutableToolResult<FileContent>()
files.forEach(file => {
  try {
    result.addSuccess(readFile(file))
  } catch (e) {
    result.addError(new FileNotFoundToolError("read_file", file))
  }
})

// 方式 2: 批量处理
const result = await partitionResultsAsync(
  files,
  async (f) => readFile(f),
  (f, e) => new FileNotFoundToolError("read_file", f)
)

// 输出
if (result.hasErrors()) {
  task.recordToolErrors(result.toLogEntries())
}
pushToolResult(result.toLLMReport())
```

---

## 二、工具集成分析

### 2.1 需要集成的工具（高优先级）

#### 📁 ReadFileTool

**当前问题：**
- 支持读取多个文件（legacy 格式）
- 每个文件错误单独处理
- LLM 无法一次性看到所有问题

**改进收益：**
```
当前: File: a.txt [error] ... File: b.txt [error] ... (分散)
改进后: ❌ Errors (2):
        1. File not found: a.txt
           💡 Suggestion: Verify the file path...
        2. File not found: b.txt
           💡 Suggestion: Verify the file path...
        📊 Success rate: 0%
```

**集成位置：** `executeLegacy()` 方法中的多文件处理循环

**代码位置：** `src/core/tools/ReadFileTool.ts:681-826`

---

#### 📝 ApplyPatchTool

**当前问题：**
- 一个 patch 文件可能包含多个文件操作
- 部分文件失败时，后续文件仍可继续
- 当前遇到第一个错误就停止

**改进收益：**
- 一次报告所有失败的文件
- LLM 可以同时修复多个问题

**集成位置：** 多文件 patch 处理逻辑

**代码位置：** `src/core/tools/ApplyPatchTool.ts`

---

#### 🔍 SearchFilesTool

**当前问题：**
- 可能搜索多个目录
- 每个目录的权限问题分散报告

**改进收益：**
- 统一报告哪些目录可访问、哪些被拒绝

**代码位置：** `src/core/tools/SearchFilesTool.ts`

---

#### 📂 ListFilesTool

**当前问题：**
- 列出多个目录时，权限问题分散

**改进收益：**
- 统一报告可访问和被拒绝的目录

**代码位置：** `src/core/tools/ListFilesTool.ts`

---

### 2.2 可选集成的工具（中优先级）

#### ⚡ ExecuteCommandTool

**场景：**
- 执行一系列命令（如果有批量执行功能）
- 当前是单命令执行

**建议：**
- 暂不集成，除非添加批量命令功能

**代码位置：** `src/core/tools/ExecuteCommandTool.ts`

---

#### ✏️ EditFileTool

**场景：**
- 可能同时编辑多个文件
- 当前是单文件编辑

**建议：**
- 如果添加批量编辑功能，则需要集成

**代码位置：** `src/core/tools/EditFileTool.ts`

---

#### 🔧 UseMcpToolTool

**场景：**
- 可能调用多个 MCP 工具
- 当前是单工具调用

**建议：**
- 如果添加批量 MCP 调用功能，则需要集成

**代码位置：** `src/core/tools/UseMcpToolTool.ts`

---

### 2.3 不需要集成的工具

以下工具处理单一操作，错误处理已经很清晰：

| 工具 | 原因 |
|------|------|
| `WriteToFileTool` | 单文件写入 |
| `ApplyDiffTool` | 单文件 diff 应用 |
| `AskFollowupQuestionTool` | 单次交互 |
| `AttemptCompletionTool` | 单次完成 |
| `SwitchModeTool` | 单次切换 |
| `NewTaskTool` | 单任务创建 |
| `UpdateTodoListTool` | 单次更新 |

---

## 三、集成优先级矩阵

| 工具 | 批量操作 | 当前问题 | 集成价值 | 优先级 |
|------|---------|---------|---------|-------|
| ReadFileTool | ✅ 是 | 错误分散 | 高 | **P0** |
| ApplyPatchTool | ✅ 是 | 部分失败难追踪 | 高 | **P0** |
| SearchFilesTool | ⚠️ 潜在 | 权限问题分散 | 中 | **P1** |
| ListFilesTool | ⚠️ 潜在 | 权限问题分散 | 中 | **P1** |
| ExecuteCommandTool | ❌ 否 | - | 低 | P2 |
| EditFileTool | ❌ 否 | - | 低 | P2 |

---

## 四、ReadFileTool 集成示例

### 4.1 当前代码

```typescript
// src/core/tools/ReadFileTool.ts:700-739
for (const entry of fileEntries) {
  const relPath = entry.path
  
  // RooIgnore validation
  const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
  if (!accessAllowed) {
    const error = new RooIgnoreViolationError("read_file", relPath)
    await task.say("rooignore_error", relPath)
    task.recordToolError("read_file", error.toLogEntry())
    results.push(`File: ${relPath}\nError: ${llmMessage}`)
    continue  // ❌ 错误分散处理
  }
  
  // ... 更多处理
}
```

### 4.2 改进后代码

```typescript
import { createMutableToolResult, type ToolExecutionResult } from "../errors/tools/index.js"

interface FileReadSuccess {
  path: string
  content: string
  lineNumbered?: string
}

async executeLegacy(fileEntries: FileEntry[], task: Task, callbacks: ToolCallbacks): Promise<void> {
  const { pushToolResult } = callbacks
  const result = createMutableToolResult<FileReadSuccess>()
  
  for (const entry of fileEntries) {
    const relPath = entry.path
    
    // RooIgnore validation
    const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
    if (!accessAllowed) {
      result.addError(new RooIgnoreViolationError("read_file", relPath))
      await task.say("rooignore_error", relPath)
      continue
    }
    
    try {
      const content = await this.processFile(entry, task)
      result.addSuccess({ path: relPath, content })
    } catch (error) {
      const toolError = this.mapToToolError(error, relPath)
      result.addError(toolError)
      await task.say("error", `Error reading file ${relPath}: ${toolError.message}`)
    }
  }
  
  // 统一处理结果
  if (result.hasErrors()) {
    task.didToolFailInCurrentTurn = true
    result.errors.forEach(e => task.recordToolError("read_file", e.toLogEntry()))
  }
  
  // 生成统一报告
  const report = this.buildResultReport(result)
  pushToolResult(report)
}

private buildResultReport(result: ToolExecutionResult<FileReadSuccess>): string {
  const parts: string[] = []
  
  // 成功的文件内容
  if (result.hasSuccesses()) {
    const successContent = result.successes
      .map(s => `File: ${s.path}\n${s.content}`)
      .join("\n\n---\n\n")
    parts.push(successContent)
  }
  
  // 错误摘要
  if (result.hasErrors()) {
    parts.push("\n" + result.toLLMReport())
  }
  
  return parts.join("\n")
}
```

---

## 五、实施计划

### 阶段 1: 基础设施（已完成）
- [x] 创建 `ToolExecutionResult` 类型定义
- [x] 提供工厂函数和工具方法

### 阶段 2: P0 工具集成（已完成）
- [x] 集成 `ReadFileTool` - legacy 多文件读取
- [x] 集成 `ApplyPatchTool` - 多文件 patch

### 阶段 3: P1 工具集成（已完成）
- [x] 集成 `SearchFilesTool` - 结构化错误处理 + 多目录扩展点
- [x] 集成 `ListFilesTool` - 结构化错误处理 + 多目录扩展点

### 阶段 4: 测试与文档
- [ ] 添加单元测试
- [ ] 更新工具文档
- [ ] 性能基准测试

---

## 六、注意事项

### 6.1 向后兼容

集成 `ToolExecutionResult` 时需确保：
- LLM 接收的错误报告格式向后兼容
- 日志系统仍能正常工作
- 用户 UI 不受影响

### 6.2 Token 优化

对于大量错误，使用 `formatLLMReport()` 限制输出：
```typescript
// 最多显示 5 个错误，避免 token 爆炸
const report = formatLLMReport(result, { maxErrors: 5 })
```

### 6.3 性能考虑

- `ToolExecutionResult` 是轻量级对象
- `toLLMReport()` 按需生成，不预计算
- 内存占用与处理项数量成线性关系

---

## 七、相关文件

- 实现文件: `src/core/errors/tools/result.ts`
- 错误类型: `src/core/errors/tools/*.ts`
- 设计文档: `docs/design/error/error-architecture.md`
- 分析报告: `docs/analysis/tools-error-handling-analysis.md`
