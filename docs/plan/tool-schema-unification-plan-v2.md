# Tool Schema 统一化方案（修订版）

## 一、原方案问题分析

### 1.1 原方案架构回顾

原方案建议将 Zod Schema 定义放在 `packages/types/src/schemas/` 目录：

```
packages/types/src/schemas/
├── index.ts              # 统一导出
├── base.ts               # 基础类型和工具函数
├── read_file.ts          # read_file schema
├── write_to_file.ts      # write_to_file schema
└── ...
```

### 1.2 存在的核心问题

#### 问题1：职责边界混淆

`packages/types` 的定位是**平台无关的纯类型定义包**，作为 NPM 包 `@coder/types` 发布。其职责是：
- 提供跨平台共享的 TypeScript 类型定义
- 零运行时依赖，仅编译时使用
- 被其他包（`@coder/core`、`src/`）依赖

将 Zod Schema 放入 `packages/types` 会：
- **引入运行时依赖**：Zod 是运行时验证库，违背了 `@coder/types` 的纯类型定位
- **破坏包的轻量性**：`@coder/types` 需要保持最小依赖，便于跨平台复用
- **违反依赖方向**：`packages/types` 应该是最底层的基础包，不应包含业务逻辑

#### 问题2：与核心模块紧耦合

通过代码分析发现，Schema 定义与以下模块存在**强耦合关系**：

| 耦合模块 | 文件位置 | 耦合关系说明 |
|----------|----------|--------------|
| **流式解析** | `src/core/assistant-message/NativeToolCallParser.ts` | 直接使用 Schema 进行参数解析和类型转换 |
| **提示词构建** | `src/core/prompts/tools/native-tools/*.ts` | 生成 JSON Schema 用于 LLM API 调用 |
| **工具执行** | `src/core/tools/*.ts` | 使用参数类型执行具体操作 |
| **任务循环** | `src/core/task/*.ts` | 处理工具调用结果和状态管理 |

这些模块全部位于 `src/core/` 目录内，是 VSCode 扩展的核心业务逻辑。

#### 问题3：Schema 的实际使用场景

Schema 的三个核心用途：

1. **JSON Schema 生成**（`src/core/prompts/tools/native-tools/`）
   - 为 LLM API 提供工具定义
   - 需要访问 `OpenAI.Chat.ChatCompletionTool` 类型
   - 与提示词构建流程紧密关联

2. **流式参数解析**（`src/core/assistant-message/NativeToolCallParser.ts`）
   - 解析 LLM 返回的工具调用参数
   - 处理部分解析（streaming partial）
   - 执行类型强制转换（coercion）

3. **运行时验证**（`src/core/tools/*.ts`）
   - 验证工具输入参数
   - 提供类型安全的参数访问

**结论**：Schema 的所有使用场景都在 `src/core/` 内部，与 `packages/types` 的定位不符。

## 二、修订后的架构设计

### 2.1 设计原则

1. **职责分离**：`packages/types` 保持纯类型定义，不引入运行时依赖
2. **高内聚**：Schema 定义与其消费者放在同一模块内
3. **依赖方向**：`packages/types`（类型）→ `src/core/tools/schemas`（Schema）→ `src/core/tools`（执行）

### 2.2 新的目录结构

```
src/core/tools/
├── schemas/                      # Schema 定义目录（新增）
│   ├── index.ts                  # 统一导出
│   ├── base.ts                   # 基础工具函数
│   ├── registry.ts               # 工具注册表
│   ├── read_file.ts              # read_file schema
│   ├── write_to_file.ts          # write_to_file schema
│   ├── execute_command.ts        # execute_command schema
│   ├── apply_diff.ts             # apply_diff schema
│   ├── codebase_search.ts        # codebase_search schema
│   ├── ask_followup_question.ts  # ask_followup_question schema
│   ├── attempt_completion.ts     # attempt_completion schema
│   └── ...                       # 其他工具 schema
│
├── ReadFileTool.ts               # 工具实现（现有）
├── WriteToFileTool.ts
├── ...
│
└── core/
    └── BaseTool.ts               # 基类（现有）

packages/types/src/
├── tool.ts                       # ToolName 枚举（保持不变）
├── tool-params.ts                # 参数类型定义（从 schema 自动生成或手动维护）
└── ...                           # 其他类型定义
```

### 2.3 Schema 定义示例

```typescript
// src/core/tools/schemas/read_file.ts
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import type OpenAI from "openai"

// ─── 常量定义（从 prompts/tools/native-tools/read_file.ts 迁移）───
export const DEFAULT_LINE_LIMIT = 2000
export const MAX_LINE_LENGTH = 2000
export const DEFAULT_MAX_LEVELS = 0

// ─── Schema 定义 ───
export const IndentationParamsSchema = z.object({
    anchor_line: z.number()
        .describe("1-based line number to anchor the extraction"),
    max_levels: z.number().optional()
        .describe("Maximum indentation levels to include above anchor"),
    include_siblings: z.boolean().optional()
        .describe("Include sibling blocks at the same indentation level"),
    include_header: z.boolean().optional()
        .describe("Include file header content (imports, comments)"),
    max_lines: z.number().optional()
        .describe("Hard cap on lines returned for indentation mode"),
})

export const ReadFileModeSchema = z.enum(["slice", "indentation"])

export const ReadFileParamsSchema = z.object({
    path: z.string()
        .describe("Path to the file to read, relative to the workspace"),
    mode: ReadFileModeSchema.optional()
        .describe("Reading mode: 'slice' (default) or 'indentation'"),
    offset: z.number().optional()
        .describe("1-based line offset to start reading from (slice mode)"),
    limit: z.number().optional()
        .describe("Maximum number of lines to return (slice mode)"),
    indentation: IndentationParamsSchema.optional()
        .describe("Indentation mode options"),
})

// ─── 类型导出 ───
export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>
export type IndentationParams = z.infer<typeof IndentationParamsSchema>
export type ReadFileMode = z.infer<typeof ReadFileModeSchema>

// ─── JSON Schema 生成 ───
export interface ReadFileToolOptions {
    supportsImages?: boolean
}

export function createReadFileTool(options: ReadFileToolOptions = {}): OpenAI.Chat.ChatCompletionTool {
    const { supportsImages = false } = options
    // ... description 构建逻辑（从原文件迁移）
    
    return {
        type: "function",
        function: {
            name: "read_file",
            description: buildDescription(supportsImages),
            strict: true,
            parameters: zodToJsonSchema(ReadFileParamsSchema, {
                target: "openAiMode",
            }),
        },
    }
}
```

### 2.4 工具注册表

```typescript
// src/core/tools/schemas/registry.ts
import type { ZodType } from "zod"
import type { ToolName } from "@coder/types"
import { ReadFileParamsSchema, createReadFileTool } from "./read_file"
import { WriteToFileParamsSchema, createWriteToFileTool } from "./write_to_file"
// ... 其他导入

/**
 * 工具定义接口
 */
interface ToolDefinition<TSchema extends ZodType> {
    name: ToolName
    schema: TSchema
    description: string
    aliases?: string[]
    group?: ToolGroup
    createTool: (options?: unknown) => OpenAI.Chat.ChatCompletionTool
}

/**
 * 工具注册表
 * 统一管理所有工具的 Schema 定义和 JSON Schema 生成
 */
export const ToolRegistry = {
    read_file: {
        name: "read_file",
        schema: ReadFileParamsSchema,
        description: "Read a file and return its contents...",
        group: "read",
        createTool: createReadFileTool,
    },
    write_to_file: {
        name: "write_to_file",
        schema: WriteToFileParamsSchema,
        description: "Write content to a file...",
        aliases: ["write_file"],
        group: "edit",
        createTool: createWriteToFileTool,
    },
    // ... 其他工具
} as const satisfies Record<ToolName, ToolDefinition<ZodType>>

// 类型工具
export type ToolSchemaFor<TName extends ToolName> = 
    (typeof ToolRegistry)[TName]["schema"]

/**
 * 获取所有工具的 JSON Schema 定义
 */
export function getAllNativeTools(options?: Record<string, unknown>): OpenAI.Chat.ChatCompletionTool[] {
    return Object.values(ToolRegistry).map(tool => {
        const toolOptions = options?.[tool.name]
        return tool.createTool(toolOptions)
    })
}
```

### 2.5 NativeToolCallParser 重构

```typescript
// src/core/assistant-message/NativeToolCallParser.ts
import { ToolRegistry } from "../tools/schemas"

export class NativeToolCallParser {
    // ... 其他代码

    /**
     * 使用 Schema 进行统一的参数解析
     * 替代原有的 switch-case 硬编码
     */
    private static createPartialToolUse(
        id: string,
        name: ToolName,
        partialArgs: Record<string, unknown>,
        partial: boolean,
        originalName?: string,
    ): ToolUse | null {
        const toolDef = ToolRegistry[name]
        if (!toolDef) {
            // 处理未注册的工具（如 MCP 工具）
            return this.createLegacyToolUse(id, name, partialArgs, partial, originalName)
        }

        // 使用 Schema 进行部分解析
        const result = toolDef.schema.safeParse(partialArgs, {
            partial: true, // 支持流式部分解析
        })

        if (!result.success) {
            // 解析失败，返回 null 或降级处理
            return null
        }

        return {
            type: "tool_use",
            id,
            name,
            originalName,
            params: this.buildParams(partialArgs),
            nativeArgs: result.data,
            partial,
        }
    }

    // ... 其他代码
}
```

### 2.6 类型定义的同步策略

有两种策略保持 `packages/types` 中的类型定义与 Schema 同步：

#### 策略A：类型重导出（推荐）

```typescript
// packages/types/src/tool-params.ts
// 直接从 src/core/tools/schemas 重导出类型
export type {
    ReadFileParams,
    IndentationParams,
    ReadFileMode,
} from "../../src/core/tools/schemas/read_file"

// 注意：这需要构建工具支持跨目录类型导入
// 或者使用 TypeScript 的 path mapping
```

#### 策略B：手动维护 + 类型测试

```typescript
// packages/types/src/tool-params.ts
// 手动维护类型定义，但添加编译时类型检查

import type { ReadFileParams as SchemaReadFileParams } from "../../src/core/tools/schemas/read_file"

// 手动定义（保持向后兼容）
export interface ReadFileParams {
    path: string
    mode?: "slice" | "indentation"
    offset?: number
    limit?: number
    indentation?: IndentationParams
}

// 编译时类型检查，确保与 Schema 一致
type _CheckReadFileParams = SchemaReadFileParams extends ReadFileParams 
    ? ReadFileParams extends SchemaReadFileParams 
        ? true 
        : never 
    : never
```

## 三、迁移计划

### 阶段1：基础设施搭建

1. 安装依赖
   ```bash
   pnpm add zod zod-to-json-schema
   ```

2. 创建 `src/core/tools/schemas/` 目录结构

3. 实现 `base.ts` 工具函数
   - `createOpenAITool()` - JSON Schema 生成
   - `coerceOptionalNumber()` - 类型转换
   - `coerceOptionalBoolean()` - 类型转换

4. 实现 `registry.ts` 注册表

### 阶段2：迁移工具 Schema

按优先级迁移：

**高优先级**（参数复杂，问题明显）：
- `read_file` - 参数最多，问题最典型
- `write_to_file`
- `execute_command`

**中优先级**：
- `apply_diff`
- `codebase_search`
- `ask_followup_question`

**低优先级**（参数简单）：
- `attempt_completion`
- `update_todo_list`
- `switch_mode`

### 阶段3：重构消费者

1. **重构 NativeToolCallParser**
   - 移除 `createPartialToolUse` 中的 switch-case
   - 使用 `ToolRegistry` 进行统一解析

2. **重构 prompts/tools/native-tools/**
   - 删除原有的 JSON Schema 构建代码
   - 改为从 `ToolRegistry` 获取工具定义

3. **更新工具实现**
   - 使用 Schema 导出的类型
   - 利用 Schema 进行参数验证

### 阶段4：清理与优化

1. 移除 `src/shared/tools.ts` 中的 `ToolParamName` 扁平枚举
2. 更新 `NativeToolArgs` 类型映射
3. 同步 `packages/types` 中的类型定义
4. 更新文档和注释

## 四、架构对比

### 4.1 原方案 vs 修订方案

| 维度 | 原方案 | 修订方案 |
|------|--------|----------|
| Schema 位置 | `packages/types/src/schemas/` | `src/core/tools/schemas/` |
| 类型包职责 | 混合类型和运行时逻辑 | 保持纯类型定义 |
| 依赖方向 | `src/core` → `packages/types`（运行时） | `packages/types`（类型）← `src/core`（实现） |
| 耦合度 | Schema 与核心逻辑分离 | Schema 与核心逻辑高内聚 |
| 包大小 | 增加 Zod 依赖 | `@coder/types` 保持轻量 |

### 4.2 依赖关系图

```
原方案：
┌─────────────────────────────────────────────────────────────┐
│  packages/types                                              │
│  ├── types/ (纯类型)                                         │
│  └── schemas/ (Zod Schema + 运行时逻辑)  ← 引入运行时依赖    │
└─────────────────────────────────────────────────────────────┘
         ↑
         │ 运行时依赖
         │
┌────────┴────────────────────────────────────────────────────┐
│  src/core                                                    │
│  ├── tools/                                                  │
│  ├── assistant-message/                                      │
│  └── prompts/                                                │
└─────────────────────────────────────────────────────────────┘

修订方案：
┌─────────────────────────────────────────────────────────────┐
│  packages/types                                              │
│  └── 纯类型定义（零运行时依赖）                              │
└─────────────────────────────────────────────────────────────┘
         ↑
         │ 类型导入（编译时）
         │
┌────────┴────────────────────────────────────────────────────┐
│  src/core                                                    │
│  ├── tools/                                                  │
│  │   ├── schemas/ (Zod Schema + 运行时逻辑)  ← 高内聚       │
│  │   └── *Tool.ts                                            │
│  ├── assistant-message/                                      │
│  └── prompts/                                                │
└─────────────────────────────────────────────────────────────┘
```

## 五、预期收益

### 5.1 架构清晰度

- **职责明确**：`packages/types` 保持纯类型，`src/core/tools/schemas` 负责运行时
- **高内聚**：Schema 定义与其消费者在同一模块内
- **依赖正确**：类型包不依赖运行时库

### 5.2 维护成本降低

- 新增工具只需在 `src/core/tools/schemas/` 添加一个文件
- Schema、类型、JSON Schema 三者统一维护
- 减少跨包同步的复杂性

### 5.3 开发体验改善

- IDE 自动补全和类型检查
- 重构时自动更新所有引用
- 更清晰的代码组织

## 六、风险评估

### 6.1 兼容性风险

- **缓解措施**：保留 legacy 格式支持，渐进式迁移

### 6.2 类型同步风险

- **缓解措施**：使用编译时类型检查确保 `packages/types` 与 Schema 一致

### 6.3 性能影响

- Zod 运行时验证有轻微性能开销
- **缓解措施**：在关键路径使用 `safeParse` 而非 `parse`

## 七、总结

原方案将 Schema 放入 `packages/types/src/schemas/` 存在以下问题：

1. **违反职责边界**：`@coder/types` 应保持纯类型定义，不应引入运行时依赖
2. **耦合方向错误**：Schema 与 `src/core/` 内部模块紧耦合，不应放在外部包
3. **依赖关系混乱**：会导致核心逻辑依赖类型包的运行时功能

修订方案将 Schema 放入 `src/core/tools/schemas/` 目录，实现了：

1. **职责分离**：类型包保持轻量，Schema 与核心逻辑高内聚
2. **依赖正确**：`packages/types`（类型）→ `src/core/tools/schemas`（Schema）→ `src/core/tools`（执行）
3. **维护便捷**：Schema 定义与其消费者在同一模块，便于统一维护

建议按阶段渐进式实施，优先迁移问题最明显的工具（如 `read_file`），验证方案可行性后再全面推广。
