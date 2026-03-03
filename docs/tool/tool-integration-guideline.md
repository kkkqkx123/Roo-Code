# 新工具实现完整流程文档

本文档详细说明了在 Roo-Code 项目中实现新工具的完整流程。每个工具需要完成 **7 个关键步骤** 才能正常工作。

## 目录
1. [概述](#概述)
2. [集成检查清单](#集成检查清单)
3. [实现步骤详解](#实现步骤详解)
4. [关键文件说明](#关键文件说明)
5. [工具实现示例](#工具实现示例)
6. [常见问题与注意事项](#常见问题与注意事项)
7. [附录：文件路径速查表](#附录文件路径速查表)

---

## 概述

**流程说明：**
1. **API 请求**：接收外部调用。
2. **NativeToolCallParser**：解析原始参数。
3. **ToolExecutorRegistry**：根据名称查找对应的执行器。
4. **BaseTool.handle()**：统一的入口逻辑。
5. **Tool.execute()**：具体的业务逻辑实现。
6. **pushToolResult()**：将执行结果返回给系统。

---

## 集成检查清单

### ✅ 必须完成的 7 个步骤

| 步骤 | 文件位置 | 说明 |
| :--- | :--- | :--- |
| **1. 类型定义** | `packages/types/src/tool.ts` | 添加工具名称到 `toolNames` 数组 |
| **2. Schema 定义** | `src/core/tools/schemas/{tool_name}.ts` | 定义 Zod schema 和 OpenAI tool |
| **3. Schema 注册** | `src/core/tools/schemas/registry.ts` | 注册到 `ToolRegistry` 对象 |
| **4. Schema 导出** | `src/core/tools/schemas/index.ts` | 导出 schema 类型和创建函数 |
| **5. 执行器实现** | `src/core/tools/{ToolName}Tool.ts` | 继承 `BaseTool` 实现执行逻辑 |
| **6. 执行器注册** | `src/core/tools/index.ts` | 调用 `toolExecutorRegistry.register()` |
| **7. 工具组配置** | `src/shared/tools.ts` | 添加到 `TOOL_GROUPS` 对应分组 |

### ❌ 常见遗漏

**最容易被忽略的步骤是第 7 步：将工具添加到 `TOOL_GROUPS`。**

**问题影响链路：**
```text
工具未添加到 TOOL_GROUPS
    ↓
filterNativeToolsForMode() 过滤时被排除
    ↓
buildNativeToolsArray() 不包含该工具
    ↓
API 调用中无此工具定义
    ↓
系统提示词中不可见
```

---

## 实现步骤详解

### 步骤 1: 添加类型定义

*   **文件**: `packages/types/src/tool.ts`
*   **操作**: 在 `toolNames` 数组中添加新工具名称。

```typescript
export const toolNames = [
    // ... 现有工具
    "your_new_tool",  // 添加新工具名称
] as const

export type ToolName = z.infer<typeof toolNamesSchema>
```

> **注意事项**:
> *   工具名称使用 `snake_case` 命名规范。
> *   名称一旦添加不应轻易修改，会影响向后兼容性。
> *   关键代码位置通常在文件的第 24-49 行。

### 步骤 2: 定义 Schema

*   **文件**: `src/core/tools/schemas/{tool_name}.ts`
*   **操作**: 定义参数结构并创建 OpenAI 工具定义。

```typescript
import { z } from "zod"
import type OpenAI from "openai"
import { createOpenAITool } from "./base"

// 1. 定义参数 Schema
export const YourNewToolParamsSchema = z.object({
    param1: z.string().describe("参数 1 的描述"),
    param2: z.number().optional().describe("可选参数 2 的描述"),
})

// 2. 导出类型
export type YourNewToolParams = z.infer<typeof YourNewToolParamsSchema>

// 3. 创建 OpenAI tool 定义
export function createYourNewToolTool(): OpenAI.Chat.ChatCompletionTool {
    return createOpenAITool({
        name: "your_new_tool",
        description: "工具的详细描述，LLM 会根据此描述决定是否使用该工具",
        schema: YourNewToolParamsSchema,
        strict: true,
    })
}

// 4. 导出默认实例
export const yourNewToolTool = createYourNewToolTool()
```

> **关键点**:
> *   使用 `zod` 定义参数 schema。
> *   每个参数必须有 `.describe()` 提供描述。
> *   使用 `createOpenAITool()` 创建符合 OpenAI 格式的工具定义。

### 步骤 3: 注册 Schema

*   **文件**: `src/core/tools/schemas/registry.ts`
*   **操作**: 导入新工具并在 `ToolRegistry` 和 `ToolParamsMap` 中注册。

**1. 添加 import (文件顶部):**
```typescript
import {
    createYourNewToolTool,
    YourNewToolParamsSchema,
    type YourNewToolParams,
} from "./your_new_tool"
```

**2. 添加到 ToolRegistry 对象:**
```typescript
export const ToolRegistry = {
    // ... 现有工具
    
    your_new_tool: {
        name: "your_new_tool" as const,
        schema: YourNewToolParamsSchema,
        description: "工具的简短描述",
        group: "read" as ToolGroup,  // 选择合适的分组：read/edit/command/mcp/modes
        createTool: () => createYourNewToolTool(),
    },
} as const
```

**3. 添加到 ToolParamsMap 接口:**
```typescript
export interface ToolParamsMap {
    // ... 现有工具
    your_new_tool: YourNewToolParams
}
```

### 步骤 4: 导出 Schema

*   **文件**: `src/core/tools/schemas/index.ts`
*   **操作**: 导出新工具相关的类型和函数。

```typescript
// your_new_tool
export {
    YourNewToolParamsSchema,
    createYourNewToolTool,
    yourNewToolTool,
    type YourNewToolParams,
} from "./your_new_tool"
```

### 步骤 5: 实现执行器

*   **文件**: `src/core/tools/YourNewToolTool.ts`
*   **操作**: 继承 `BaseTool` 并实现 `execute` 方法。

```typescript
import type { YourNewToolParams } from "@coder/types"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./core/BaseTool"
import {
    MissingParameterError,
    // 其他需要的错误类型
} from "../errors/tools/index.js"

export class YourNewToolTool extends BaseTool<"your_new_tool"> {
    readonly name = "your_new_tool" as const

    async execute(
        params: YourNewToolParams,
        task: Task,
        callbacks: ToolCallbacks
    ): Promise<void> {
        const { pushToolResult, askApproval, handleError } = callbacks

        try {
            // 1. 参数验证
            if (!params.param1) {
                const error = new MissingParameterError("your_new_tool", "param1")
                task.recordToolError("your_new_tool", error.toLogEntry())
                pushToolResult(formatResponse.toolErrorFromInstance(error.toLLMMessage()))
                return
            }

            // 2. 请求用户批准 (如果需要)
            const approved = await askApproval("tool", JSON.stringify({
                tool: "yourNewTool",
                // 相关信息
            }))
            
            if (!approved) {
                task.didRejectTool = true
                pushToolResult(formatResponse.toolDenied())
                return
            }

            // 3. 执行核心逻辑
            const result = await this.doWork(params, task)

            // 4. 返回结果
            pushToolResult(result)

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            await handleError("executing your_new_tool", error instanceof Error ? error : new Error(errorMsg))
        }
    }

    private async doWork(params: YourNewToolParams, task: Task): Promise<string> {
        // 实现具体逻辑
        return "操作成功完成"
    }

    // 可选：处理流式部分消息
    override async handlePartial(task: Task, block: ToolUse<"your_new_tool">): Promise<void> {
        // 显示流式 UI 更新
        const partialMessage = JSON.stringify({
            tool: "yourNewTool",
            // 部分信息
        })
        await task.ask("tool", partialMessage, block.partial).catch(() => {})
    }
}

export const yourNewToolTool = new YourNewToolTool()
```

### 步骤 6: 注册执行器

*   **文件**: `src/core/tools/index.ts`
*   **操作**: 导入执行器并注册到 `toolExecutorRegistry`。

**1. 添加 import:**
```typescript
import { yourNewToolTool } from "./YourNewToolTool"
```

**2. 注册工具:**
```typescript
// Read group (如果工具属于 read 分组)
toolExecutorRegistry.register("your_new_tool", yourNewToolTool)
```

**3. 添加 re-export:**
```typescript
export { yourNewToolTool } from "./YourNewToolTool"
```

### 步骤 7: 添加到工具组配置 ⚠️ 关键步骤

*   **文件**: `src/shared/tools.ts`
*   **操作**: 将工具名称添加到 `TOOL_GROUPS` 的对应分组中。

```typescript
export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
    read: {
        tools: [
            "read_file",
            "search_files",
            "list_files",
            "codebase_search",
            "your_new_tool",  // 添加到这里 (如果是读取类工具)
        ],
    },
    edit: {
        tools: ["apply_diff", "write_to_file", "generate_image", "apply_patch"],
        customTools: ["edit", "search_replace", "edit_file"],
    },
    command: {
        tools: ["execute_command", "read_command_output"],
    },
    mcp: {
        tools: ["use_mcp"],
    },
    modes: {
        tools: ["switch_mode", "new_task"],
        alwaysAvailable: true,
    },
}
```

**工具分组说明:**

| 分组 | 说明 | 典型工具 |
| :--- | :--- | :--- |
| **read** | 读取操作，无副作用 | `read_file`, `list_files`, `search_files` |
| **edit** | 编辑操作，修改文件 | `write_to_file`, `apply_patch` |
| **command** | 命令执行 | `execute_command` |
| **mcp** | MCP 相关 | `use_mcp` |
| **modes** | 模式切换、任务管理 | `switch_mode`, `new_task` |

---

## 关键文件说明

### 1. BaseTool 基类
*   **文件**: `src/core/tools/core/BaseTool.ts`
*   **核心方法**:
    ```typescript
    abstract class BaseTool<TName extends ToolName> {
        abstract readonly name: TName
        
        // 核心执行方法 (必须实现)
        abstract execute(
            params: ToolParams<TName>,
            task: Task,
            callbacks: ToolCallbacks
        ): Promise<void>
        
        // 处理流式部分消息 (可选覆盖)
        async handlePartial(task: Task, block: ToolUse<TName>): Promise<void>
        
        // 统一入口点 (不要覆盖)
        async handle(task: Task, block: ToolUse<TName>, callbacks: ToolCallbacks): Promise<void>
    }
    ```
*   **ToolCallbacks 接口**:
    ```typescript
    export interface ToolCallbacks {
        askApproval: AskApproval      // 请求用户批准
        handleError: HandleError      // 处理错误
        pushToolResult: PushToolResult // 推送结果
        toolCallId?: string           // 工具调用 ID
    }
    ```

### 2. NativeToolCallParser
*   **文件**: `src/core/assistant-message/NativeToolCallParser.ts`
*   **作用**: 解析 LLM 返回的原生工具调用，将 JSON 参数转换为类型化的 `nativeArgs`。
*   **关键方法**:
    *   `parseToolCall`: 解析完整的工具调用。
    *   `processStreamingChunk`: 处理流式 chunk。
    *   `finalizeStreamingToolCall`: 完成流式解析。
*   **注意**: 添加新工具时，可能需要在此文件中添加对应的 `partial` 解析逻辑。

### 3. ToolExecutorRegistry
*   **文件**: `src/core/tools/ToolExecutorRegistry.ts`
*   **作用**: 工具执行器的中央注册表。
*   **核心 API**:
    *   `register(name, executor)`: 注册工具。
    *   `get(name)`: 获取执行器。
    *   `has(name)`: 检查是否注册。
    *   `execute(...)`: 执行工具。

---

## 工具实现示例

### 简单工具示例：ListFilesTool

```typescript
// src/core/tools/ListFilesTool.ts
export class ListFilesTool extends BaseTool<"list_files"> {
    readonly name = "list_files" as const

    async execute(params: ListFilesParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { pushToolResult } = callbacks
        const { path: dirPath, recursive } = params

        // 验证路径
        const accessAllowed = task.rooIgnoreController?.validateAccess(dirPath)
        if (!accessAllowed) {
            pushToolResult(formatResponse.toolError("Access denied by .rooignore"))
            return
        }

        // 列出文件
        const files = await listFiles(dirPath, recursive)
        pushToolResult(files.join("\n"))
    }
}
```

### 复杂工具示例：ReadFileTool
参考 `src/core/tools/ReadFileTool.ts`，通常包含：
*   多种读取模式支持
*   用户批准流程
*   完善的错误处理
*   流式 UI 更新

---

## 常见问题与注意事项

**Q1: 工具已实现但 LLM 不调用**
*   **检查清单**:
    *   ✅ 是否添加到 `TOOL_GROUPS`?
    *   ✅ Schema 是否正确注册到 `ToolRegistry`?
    *   ✅ 执行器是否注册到 `toolExecutorRegistry`?

**Q2: 参数解析失败**
*   **可能原因**:
    *   Schema 定义与实际参数不匹配。
    *   `NativeToolCallParser` 中缺少对应的解析逻辑。

**Q3: 工具调用报错 "Unknown tool"**
*   **检查**:
    *   `toolExecutorRegistry.register()` 是否被调用？
    *   工具名称是否与 `ToolName` 类型完全匹配（包括大小写和下划线）？

**Q4: 流式显示不工作**
*   **解决**: 需要实现 `handlePartial` 方法。
    ```typescript
    override async handlePartial(task: Task, block: ToolUse<"your_tool">): Promise<void> {
        // 实现流式 UI 更新
    }
    ```

---

## 附录：文件路径速查表

| 组件 | 文件路径 |
| :--- | :--- |
| **类型定义** | `packages/types/src/tool.ts` |
| **Schema 定义** | `src/core/tools/schemas/{tool_name}.ts` |
| **Schema 注册** | `src/core/tools/schemas/registry.ts` |
| **Schema 导出** | `src/core/tools/schemas/index.ts` |
| **执行器实现** | `src/core/tools/{ToolName}Tool.ts` |
| **执行器注册** | `src/core/tools/index.ts` |
| **工具组配置** | `src/shared/tools.ts` |
| **基类定义** | `src/core/tools/core/BaseTool.ts` |
| **参数解析器** | `src/core/assistant-message/NativeToolCallParser.ts` |
| **执行器注册表** | `src/core/tools/ToolExecutorRegistry.ts` |