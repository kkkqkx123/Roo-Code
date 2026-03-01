# 工具调用参数格式详细分析

## 1. 工具定义格式 (提供给LLM)

### 1.1 整体结构 - OpenAI.Chat.ChatCompletionTool

```typescript
{
  type: "function",
  function: {
    name: string,                      // 工具名称 (如 "read_file")
    description: string,               // 详细描述和使用指南
    strict: boolean,                   // true = 强制遵守 JSON Schema
    parameters: {
      type: "object",
      properties: {
        [paramName]: {
          type: string,                // "string" | "integer" | "boolean" | "object" | "array"
          description: string,         // 参数说明
          enum?: unknown[],            // 可选: 枚举值
          properties?: Record<...>,    // 可选: 对象类型的子属性
          required?: string[],         // 可选: 必需的子属性
          additionalProperties?: boolean, // 是否允许额外属性
        }
      },
      required: string[],              // 必需参数列表
      additionalProperties: false,     // 禁止额外属性
    }
  }
}
```

### 1.2 具体工具参数示例

#### read_file 工具
```typescript
{
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file and return its contents with line numbers...",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read, relative to the workspace"
        },
        mode: {
          type: "string",
          enum: ["slice", "indentation"],
          description: "Reading mode: 'slice' (default) or 'indentation'"
        },
        offset: {
          type: "integer",
          description: "1-based line offset to start reading from (slice mode, default: 1)"
        },
        limit: {
          type: "integer",
          description: "Maximum number of lines to return (slice mode, default: 2000)"
        },
        indentation: {
          type: "object",
          description: "Indentation mode options. Only used when mode='indentation'.",
          properties: {
            anchor_line: { type: "integer", ... },
            max_levels: { type: "integer", ... },
            include_siblings: { type: "boolean", ... },
            include_header: { type: "boolean", ... },
            max_lines: { type: "integer", ... }
          },
          required: [],
          additionalProperties: false
        }
      },
      required: ["path"],
      additionalProperties: false
    }
  }
}
```

#### write_to_file 工具
```typescript
{
  type: "function",
  function: {
    name: "write_to_file",
    description: "Write content to create or overwrite a file...",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The path of the file to write to (relative to the workspace)"
        },
        content: {
          type: "string",
          description: "The content to write to the file..."
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    }
  }
}
```

#### execute_command 工具
```typescript
{
  type: "function",
  function: {
    name: "execute_command",
    description: "Execute a CLI command on the system...",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute"
        },
        cwd: {
          type: ["string", "null"],
          description: "Optional working directory for the command"
        }
      },
      required: ["command", "cwd"],
      additionalProperties: false
    }
  }
}
```

## 2. API 请求格式

### 2.1 发送给LLM的工具参数

```typescript
// Task.ts L4085-4098
const metadata = {
  taskId: string,
  suppressPreviousResponseId?: boolean,
  tools: ChatCompletionTool[],        // 工具定义数组
  tool_choice: "auto",                // 自动选择工具调用
  parallelToolCalls: boolean,         // true = 支持并行调用
  allowedFunctionNames?: string[]     // 仅Gemini: 限制可调用的工具
}
```

### 2.2 工具构建过程

1. **获取工具定义**
   - 原生工具: `getNativeTools()`
   - MCP工具: `getMcpServerTools()`
   - 自定义工具: `customToolRegistry.getAllSerialized()`

2. **按模式过滤**
   ```typescript
   filterNativeToolsForMode(nativeTools, mode, customModes, experiments, ...)
   filterMcpToolsForMode(mcpTools, mode, customModes, experiments)
   ```

3. **组合工具数组**
   ```typescript
   const allTools = [...filteredNativeTools, ...filteredMcpTools, ...customTools]
   ```

## 3. AI 响应格式 - Tool Use Block

### 3.1 消息结构

当AI决定调用工具时，其响应包含 `tool_use` 块:

```typescript
// 助手消息内容块
{
  type: "tool_use",
  id: string,                        // 唯一的工具调用ID (如 "toolu_abc123")
  name: string,                      // 工具名称 (可能是别名)
  input: Record<string, any>         // 工具参数 (键值对)
}
```

### 3.2 具体参数值示例

#### 调用 read_file 的参数
```json
{
  "type": "tool_use",
  "id": "toolu_01ABC123XYZ",
  "name": "read_file",
  "input": {
    "path": "src/main.ts",
    "mode": "slice",
    "offset": 1,
    "limit": 50
  }
}
```

或使用 indentation 模式:
```json
{
  "type": "tool_use",
  "id": "toolu_01ABC123XYZ",
  "name": "read_file",
  "input": {
    "path": "src/services/auth.ts",
    "mode": "indentation",
    "indentation": {
      "anchor_line": 42,
      "include_header": true,
      "include_siblings": false
    }
  }
}
```

#### 调用 write_to_file 的参数
```json
{
  "type": "tool_use",
  "id": "toolu_02DEF456UVW",
  "name": "write_to_file",
  "input": {
    "path": "src/components/Button.tsx",
    "content": "import React from 'react';\n\ninterface ButtonProps {\n  label: string;\n  onClick: () => void;\n}\n\nexport const Button: React.FC<ButtonProps> = ({ label, onClick }) => {\n  return <button onClick={onClick}>{label}</button>;\n};\n"
  }
}
```

#### 调用 execute_command 的参数
```json
{
  "type": "tool_use",
  "id": "toolu_03GHI789STU",
  "name": "execute_command",
  "input": {
    "command": "npm run build",
    "cwd": null
  }
}
```

## 4. Tool Result Block 格式

### 4.1 结构

```typescript
{
  type: "tool_result",
  tool_use_id: string,               // 必须对应上一个 tool_use.id
  content: string | ContentBlock[],  // 执行结果内容
  is_error?: boolean                 // true 表示工具执行失败
}
```

### 4.2 具体示例

#### 成功的 tool_result
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC123XYZ",
  "content": "1: import { readFileSync } from 'fs';\n2: import path from 'path';\n3: \n4: export function loadConfig(filePath: string) {\n5:   const fullPath = path.resolve(filePath);\n6:   const content = readFileSync(fullPath, 'utf-8');\n7:   return JSON.parse(content);\n8: }\n",
  "is_error": false
}
```

#### 包含图像的 tool_result
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC123XYZ",
  "content": [
    {
      "type": "text",
      "text": "File content preview:\n1: // Image file detected\n2: // [Image: diagram.png]"
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgo..."
      }
    }
  ],
  "is_error": false
}
```

#### 错误的 tool_result
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_03GHI789STU",
  "content": "Command failed with exit code 1: npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path /workspace/package.json\nnpm ERR! errno -2",
  "is_error": true
}
```

## 5. Token 计数序列化格式

系统在计算Token时会将块序列化为文本:

### 5.1 tool_use 序列化

```
Tool: read_file
Arguments: {"path":"src/main.ts","mode":"slice","offset":1,"limit":50}
```

### 5.2 tool_result 序列化

```
Tool Result (toolu_01ABC123XYZ)
[Error]
Command failed with exit code 1
```

或者:

```
Tool Result (toolu_01ABC123XYZ)
import { readFileSync } from 'fs';
import path from 'path';
...
```

## 6. 内部数据结构 - ToolUse 接口

### 6.1 TypeScript 定义

```typescript
export interface ToolUse<TName extends ToolName = ToolName> {
  type: "tool_use"
  id?: string                           // 工具调用ID
  name: TName                           // 规范化的工具名称
  originalName?: string                 // 别名使用时的原始名称
  params: Partial<Record<ToolParamName, string>>  // 原始参数 (字符串)
  partial: boolean                      // 是否为流式块
  nativeArgs?: TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : never
  usedLegacyFormat?: boolean            // 遗留格式标志
}
```

### 6.2 McpToolUse 接口

```typescript
export interface McpToolUse {
  type: "mcp_tool_use"
  id?: string
  name: string                          // 完整名称 "mcp_serverName_toolName"
  serverName: string                    // 提取的服务器名称
  toolName: string                      // 提取的工具名称
  arguments: Record<string, unknown>    // 强类型参数
  partial: boolean
}
```

## 7. 工具参数名称约定

### 7.1 定义的参数类型

```typescript
type ToolParamName = 
  | "path"
  | "command"
  | "cwd"
  | "query"
  | "content"
  | "new_name"
  | "original_path"
  | "new_path"
  | "old_text"
  | "new_text"
  | "offset"
  | "limit"
  | "mode"
  | "indentation"
  | "anchor_line"
  | "max_levels"
  | "include_siblings"
  | "include_header"
  | "max_lines"
  // ... 更多
```

## 8. 工具定义构建流程 (buildNativeToolsArrayWithRestrictions)

```typescript
async function buildNativeToolsArrayWithRestrictions(options: BuildToolsOptions): Promise<BuildToolsResult> {
  // 1. 获取三类工具
  const nativeTools = getNativeTools({ supportsImages })
  const mcpTools = getMcpServerTools(mcpHub)
  const customTools = customToolRegistry.getAllSerialized()
  
  // 2. 按模式和实验设置过滤
  const filteredNativeTools = filterNativeToolsForMode(...)
  const filteredMcpTools = filterMcpToolsForMode(...)
  
  // 3. 组合
  const filteredTools = [...filteredNativeTools, ...filteredMcpTools, ...customTools]
  
  // 4. 根据需要返回所有工具或仅返回过滤后的工具
  if (includeAllToolsWithRestrictions) {
    // Gemini: 返回所有工具定义 + 允许的函数名称列表
    return {
      tools: [...nativeTools, ...mcpTools, ...customTools],
      allowedFunctionNames: filteredTools.map(getToolName)
    }
  }
  
  // 其他提供商: 仅返回过滤后的工具
  return { tools: filteredTools }
}
```

## 总结表

| 阶段 | 数据结构 | 用途 | 示例 |
|------|--------|------|------|
| **定义** | OpenAI.Chat.ChatCompletionTool | 告诉LLM有哪些工具可用 | write_to_file 工具定义 |
| **请求** | { tools: [...], tool_choice: "auto" } | 发送给API | API 元数据 |
| **响应** | ToolUse (tool_use block) | LLM选择的工具和参数 | { name: "read_file", input: {...} } |
| **结果** | ToolResult (tool_result block) | 工具执行的结果 | 文件内容或错误信息 |
| **计数** | 序列化文本 | Token 计算 | "Tool: read_file\nArguments: {...}" |

## 关键文件位置

- **工具定义**: `src/core/prompts/tools/native-tools/*.ts`
- **工具构建**: `src/core/task/build-tools.ts`
- **工具过滤**: `src/core/prompts/tools/filter-tools-for-mode.ts`
- **API调用**: `src/core/task/Task.ts` L4085-4111
- **消息格式**: `src/shared/tools.ts` (ToolUse 接口)
- **序列化**: `src/utils/tiktoken.ts` L230-270
