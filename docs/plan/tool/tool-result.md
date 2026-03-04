## 项目工具调用结果显示分析

### 当前显示方式

#### 1. **MCP 工具调用** ([`McpExecution.tsx`](webview-ui/src/components/chat/McpExecution.tsx:1))
- ✅ **已实现展开功能**：
  - 参数部分：始终可见，以 JSON 代码块形式显示
  - 响应部分：可折叠/展开，通过下拉箭头按钮控制
  - 支持 JSON 格式化显示（完整响应时自动解析）
  - 状态指示器：显示运行中/完成/错误状态

#### 2. **命令执行** ([`CommandExecution.tsx`](webview-ui/src/components/chat/CommandExecution.tsx:1))
- ✅ **已实现展开功能**：
  - 命令本身始终可见
  - 输出内容可折叠/展开
  - 支持流式输出显示

#### 3. **文件操作工具** ([`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:599))
- ❌ **未实现展开功能**：
  - `readFile`：仅显示文件路径，点击可打开文件
  - `editedExistingFile`/`appliedDiff`：显示 diff 统计，但无法展开查看具体 diff 内容
  - `listFiles`：仅显示目录信息

#### 4. **其他工具** ([`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:1404))
- `runSlashCommand`：显示命令名、参数和描述，无展开功能
- `skill`：可展开显示参数和描述
- `generateImage`：显示图片路径，无展开功能
- `codebaseSearch`：有独立的搜索结果展示组件

### 需要改进的地方

| 工具类型 | 当前状态 | 建议改进 |
|---------|---------|---------|
| **readFile** | 仅显示路径 | 添加展开功能，显示读取的文件内容预览 |
| **editedExistingFile/appliedDiff** | 仅显示统计 | 添加展开功能，显示完整的 diff 内容 |
| **listFiles** | 仅显示目录 | 添加展开功能，显示完整的文件列表 |
| **runSlashCommand** | 仅显示基本信息 | 可选：添加展开显示详细执行结果 |

### 核心问题

当前 `ClineSayTool` 类型 ([`cline-types.ts`](packages/types/src/vscode-extension-host/cline-types.ts:18)) 中已经包含了一些可用于展开的内容字段：
- `diff?: string` - 用于 diff 内容
- `content?: string` - 用于文件内容
- `batchDiffs` / `batchFiles` - 用于批量操作

但这些字段在 UI 层并未被充分利用来提供展开查看功能。

### 建议实施方案

1. **为 readFile 添加内容预览**：当 `content` 字段存在时，允许用户展开查看文件内容
2. **为 diff 操作添加完整 diff 查看**：利用 `diff` 字段展示完整的差异内容
3. **统一展开交互模式**：参考 `McpExecution` 的展开设计，保持一致的用户体验

是否需要我实施这些改进？