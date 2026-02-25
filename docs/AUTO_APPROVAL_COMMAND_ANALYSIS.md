# 命令执行自动批准检查逻辑分析

## 1. 概述

本文档分析了 Roo-Code 项目中命令执行工具的自动批准（auto-approval）检查逻辑，并探讨了现有体系在处理复杂命令模式时存在的问题及解决方案。

## 2. 核心架构

### 2.1 主要组件

```
src/core/auto-approval/
├── index.ts              # 主入口，checkAutoApproval 函数
├── commands.ts           # 命令批准逻辑核心
├── AutoApprovalHandler.ts # 处理请求数和成本限制
├── tools.ts              # 工具批准逻辑
└── mcp.ts                # MCP 服务器批准逻辑

src/core/tools/
└── ExecuteCommandTool.ts  # 命令执行工具实现

src/shared/
└── parse-command.ts       # 命令解析器
```

### 2.2 调用流程

```
用户请求 → ExecuteCommandTool.execute()
         ↓
    askApproval("command", command)
         ↓
    checkAutoApproval({ ask: "command", text: command, state })
         ↓
    getCommandDecision(command, allowedCommands, deniedCommands)
         ↓
    返回："auto_approve" | "auto_deny" | "ask_user"
```

## 3. 命令批准逻辑详解

### 3.1 决策函数 `getCommandDecision`

位置：`src/core/auto-approval/commands.ts`

```typescript
function getCommandDecision(
  command: string,
  allowedCommands: string[],
  deniedCommands?: string[]
): CommandDecision
```

**返回值：**
- `"auto_approve"`: 所有子命令明确允许，无危险模式
- `"auto_deny"`: 至少一个子命令明确拒绝
- `"ask_user"`: 无匹配、混合匹配或含危险模式

**决策流程：**

1. **危险子句检查**：检查命令是否包含危险的参数扩展模式
2. **命令解析**：将命令链拆分为子命令（按 `&&`, `||`, `;`, `|`, `&` 和换行符）
3. **逐个验证**：对每个子命令应用"最长前缀匹配"规则
4. **聚合决策**：采用"任何拒绝则全部拒绝"原则

### 3.2 危险参数扩展检测 `containsDangerousSubstitution`

以下模式**永远不会**自动批准，始终需要用户明确批准：

| 模式 | 示例 | 风险 |
|------|------|------|
| `${var@P}` | 提示字符串扩展 | 解释转义序列并执行嵌入命令 |
| `${var@Q}` | 引号移除 | 可能导致命令注入 |
| `${var@E}` | 转义序列扩展 | 执行嵌入命令 |
| `${var@A}` | 赋值语句 | 执行嵌入命令 |
| `${var@a}` | 属性标志 | 执行嵌入命令 |
| `${var=value}` 含转义 | `\140`, `\x60`, `\u0060` | 可嵌入命令 |
| `${!var}` | 间接变量引用 | 可执行命令 |
| `<<<$(...)` | Here-string 含命令替换 | 执行命令 |
| `<<<\`...\`` | Here-string 含反引号 | 执行命令 |
| `=(...)` | Zsh 进程替换 | 执行命令 |
| `*(e:...:)` | Zsh glob 限定符 | 执行代码 |

### 3.3 最长前缀匹配规则

**核心函数：** `findLongestPrefixMatch`

```typescript
// 示例
findLongestPrefixMatch("git push origin", ["git", "git push"])
// 返回 "git push" (更长的匹配)

findLongestPrefixMatch("npm install", ["*", "npm"])
// 返回 "npm" (具体匹配优先于通配符)
```

**冲突解决策略：**

| 允许列表匹配 | 拒绝列表匹配 | 结果 | 原因 |
|-------------|-------------|------|------|
| 是 | 否 | auto_approve | 仅允许列表匹配 |
| 否 | 是 | auto_deny | 仅拒绝列表匹配 |
| 是 (更长) | 是 (更短) | auto_approve | 允许列表更具体 |
| 是 (更短/相等) | 是 (更长/相等) | auto_deny | 拒绝列表更具体或相等 |
| 否 | 否 | ask_user | 无规则适用 |

### 3.4 命令解析器 `parseCommand`

位置：`src/shared/parse-command.ts`

**功能：** 将命令字符串拆分为独立的子命令

**处理的模式：**
- 链式操作符：`&&`, `||`, `;`, `|`, `&`
- 换行符（支持 Windows/Unix/Mac 格式）
- PowerShell 重定向：`2>&1`
- 子 shell：`$(cmd)`, `` `cmd` ``
- 进程替换：`<(cmd)`, `>(cmd)`
- 参数扩展：`${var}`, `${var:-default}` 等
- 算术表达式：`$((...))`, `$[...]`
- 引号字符串：保留完整性

**实现技巧：** 使用占位符替换复杂模式，再用 `shell-quote` 库解析，最后恢复原内容。

## 4. 复杂命令模式处理问题分析

### 4.1 问题示例

用户提供的复杂 PowerShell 命令：

```powershell
cd src && (Get-ChildItem -Recurse -Filter "*.ts" -Exclude "*.spec.ts" | 
  Select-String -Pattern '\.say\([^)]+,' | 
  Where-Object { $_.Line -notmatch '\.say\("[^"]+", \{' } | 
  Select-Object -First 15 Path, LineNumber, Line)
```

### 4.2 现有问题

#### 问题 1：PowerShell 管道命令解析不完整

**现状：** `parseCommand` 主要面向 bash/shell 设计，对 PowerShell 管道命令的处理可能不够精确。

**影响：** 复杂管道命令可能被错误拆分，导致每个子命令单独检查时丢失上下文。

#### 问题 2：正则表达式模式中的特殊字符

**现状：** 命令中包含复杂的正则表达式模式（如 `'\.say\([^)]+,'`），这些模式中的括号可能被误解析为子 shell。

**当前处理：** `parseCommand` 使用占位符替换 `$(...)` 和 `` `...` ``，但 PowerShell 的单引号字符串内的内容理论上应被保留。

#### 问题 3：命令前缀匹配对复杂命令效果有限

**现状：** 自动批准基于命令前缀匹配（如 `"git"`, `"npm install"`）。

**问题：** 对于复杂 PowerShell 命令，用户很难预先配置所有可能的前缀变体。例如：
- `Get-ChildItem -Recurse -Filter "*.ts"`
- `Get-ChildItem -Path src`
- `Select-String -Pattern "..."`

每个变体都需要单独配置，否则落入 `"ask_user"` 类别。

#### 问题 4：危险模式检测可能误报

虽然当前检测主要针对 bash/zsh 特性，但 PowerShell 也有类似的风险模式：
- `Invoke-Expression` / `iex`
- `& { scriptblock }`
- `Start-Process` 带动态参数

这些在当前的 `containsDangerousSubstitution` 中未被检测。

### 4.3 解决方案建议

#### 方案 1：增强 PowerShell 命令解析

**目标：** 识别 PowerShell 特有的语法结构

```typescript
// 建议添加 PowerShell 特定处理
function parsePowerShellCommand(command: string): string[] {
  // 1. 先处理 PowerShell 字符串（单引号、双引号、here-string）
  // 2. 处理 PowerShell 管道 |
  // 3. 处理 PowerShell 命令分隔符 ; 和 &
  // 4. 处理 PowerShell 重定向 >, >>, 2>&1, *>
  // 5. 识别 PowerShell cmdlet 模式：Verb-Noun
}
```

#### 方案 2：引入命令模式匹配（而非简单前缀）

**现状：** 仅支持前缀匹配

```typescript
// 当前
allowedCommands: ["git", "npm install", "Get-ChildItem"]

// 建议：支持通配符和正则模式
allowedCommands: [
  "git .*",           // 所有 git 命令
  "Get-ChildItem.*",  // 所有 Get-ChildItem 变体
  "/^Select-(Object|String).*/"  // 正则模式
]
```

#### 方案 3：添加 PowerShell 危险命令检测

```typescript
function containsDangerousPowerShellCommand(source: string): boolean {
  const dangerousCmdlets = [
    'Invoke-Expression',
    'Invoke-Command',
    'Start-Process',
    'Invoke-WebRequest',
    'Invoke-RestMethod',
    '\\biex\\b',       // iex 别名
    '\\biwr\\b',       // iwr 别名
  ]
  
  return dangerousCmdlets.some(pattern => 
    new RegExp(pattern, 'i').test(source)
  )
}
```

#### 方案 4：命令链上下文感知

**问题：** 当前将 `cd src && complex-pipeline` 拆分为两个独立命令检查。

**建议：** 对于 `cd` 命令，应识别其意图是改变工作目录，后续命令应在新的上下文中评估。

```typescript
// 建议：识别 cd 命令并调整上下文
if (command.startsWith('cd ') || command.startsWith('Set-Location ')) {
  // cd 命令本身通常是安全的
  // 后续命令应在新目录上下文中评估
  return "auto_approve" // 对于 cd 本身
}
```

#### 方案 5：命令复杂度评分

对于过于复杂的命令（管道层数过多、参数过多），即使前缀匹配也应要求用户确认。

```typescript
function calculateCommandComplexity(command: string): number {
  let score = 0
  
  // 管道数量
  score += (command.match(/\|/g) || []).length * 2
  
  // 子 shell 数量
  score += (command.match(/\$\(/g) || []).length * 3
  
  // 参数数量
  score += (command.match(/\s-\w+/g) || []).length * 0.5
  
  // 命令链长度
  score += (command.match(/&&|\|\|/g) || []).length * 2
  
  return score
}

// 复杂度超过阈值时要求用户确认
if (calculateCommandComplexity(command) > COMPLEXITY_THRESHOLD) {
  return "ask_user"
}
```

## 5. 配置建议

### 5.1 推荐的允许列表配置

```json
{
  "allowedCommands": [
    // 版本控制
    "git ",
    "svn ",
    
    // 包管理
    "npm install",
    "npm run ",
    "pnpm install",
    "pnpm run ",
    "yarn ",
    
    // 构建工具
    "tsc ",
    "webpack ",
    "vite ",
    "rollup ",
    
    // 代码质量
    "eslint ",
    "prettier ",
    "lint-staged ",
    
    // 测试
    "vitest ",
    "jest ",
    "npm test",
    "pnpm test",
    
    // 文件操作（安全子集）
    "ls ",
    "dir ",
    "Get-ChildItem ",
    "cat ",
    "type ",
    "Get-Content ",
    "Select-String ",
    "Select-Object ",
    "Where-Object ",
    "Sort-Object ",
    "Group-Object ",
    "Measure-Object ",
    
    // 导航
    "cd ",
    "pwd",
    "Get-Location",
    
    // 通配符（谨慎使用）
    "*"
  ],
  
  "deniedCommands": [
    // 危险命令
    "rm -rf /",
    "del /F /S /Q",
    "Remove-Item -Recurse -Force",
    "format ",
    "fdisk ",
    "Invoke-Expression ",
    "iex ",
    "Invoke-Command ",
    "Start-Process ",
    "curl ",
    "wget ",
    "Invoke-WebRequest ",
    "Invoke-RestMethod ",
    "nc ",
    "netcat ",
    "ncat ",
    "ssh ",
    "telnet ",
    "powershell -enc ",
    "powershell -EncodedCommand "
  ]
}
```

### 5.2 安全最佳实践

1. **最小权限原则**：默认拒绝，仅明确允许已知安全的命令
2. **具体优先**：使用具体命令前缀而非通配符 `*`
3. **分层防御**：结合允许列表、拒绝列表和危险模式检测
4. **审计日志**：记录所有自动批准的命令以便审计
5. **定期审查**：定期审查允许/拒绝列表的有效性

## 6. 测试覆盖

当前测试文件：`src/core/auto-approval/__tests__/commands.spec.ts`

**已覆盖场景：**
- Zsh 进程替换检测
- 危险参数扩展检测
- 最长前缀匹配
- 命令链处理
- Node.js 单行代码误报修复

**建议补充测试：**
- PowerShell 管道命令解析
- PowerShell 危险 cmdlet 检测
- 复杂正则表达式模式处理
- 命令复杂度评分
- 混合 shell（bash + PowerShell）场景

## 7. 总结

### 当前优势

1. ✅ 完善的危险模式检测（bash/zsh）
2. ✅ 合理的最长前缀匹配策略
3. ✅ 命令链的"任何拒绝则全部拒绝"原则
4. ✅ 使用 `shell-quote` 库进行可靠的词法分析

### 待改进领域

1. ⚠️ PowerShell 命令支持有限
2. ⚠️ 仅支持前缀匹配，不支持模式匹配
3. ⚠️ 复杂命令的上下文丢失
4. ⚠️ 缺少命令复杂度评估

### 优先级建议

| 改进项 | 优先级 | 工作量 |
|--------|--------|--------|
| PowerShell 危险命令检测 | 高 | 低 |
| 命令复杂度评分 | 中 | 中 |
| PowerShell 命令解析增强 | 中 | 高 |
| 正则模式匹配支持 | 低 | 高 |
| 命令链上下文感知 | 低 | 高 |
