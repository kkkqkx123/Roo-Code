# 引入 Tree-sitter AST 解析的可行性分析

## 1. 背景

当前项目的命令自动批准检查基于**词法分析**（`shell-quote` 库）和**正则表达式匹配**，存在以下局限：

1. **Shell 类型不统一**：bash、PowerShell、cmd 各有不同的解析逻辑
2. **误报率高**：无法区分命令的"实体部分"和"非实体部分"（如字符串字面量内的内容）
3. **上下文丢失**：命令链拆分后丢失语法结构信息
4. **复杂模式处理困难**：如嵌套子 shell、管道链、重定向组合等

## 2. Tree-sitter 方案概述

### 2.1 什么是 Tree-sitter

Tree-sitter 是一个**增量解析库**，可以为多种编程语言生成**具体语法树（CST）**。特点：

- **多语言支持**：bash、PowerShell、cmd 等都有现成的 grammar
- **增量解析**：适合 IDE 场景，代码变化时只解析受影响部分
- **WebAssembly 支持**：可在浏览器/Node.js 中运行（`web-tree-sitter`）
- **查询语言**：类似 CSS 选择器，可精确匹配语法节点

### 2.2 项目已依赖相关包

```json
{
  "web-tree-sitter": "^0.25.6",
  "tree-sitter-wasms": "^0.1.12"
}
```

项目**已经具备**使用 Tree-sitter 的基础设施。

## 3. 当前实现 vs AST 方案对比

### 3.1 命令解析（`parseCommand`）

| 维度 | 当前实现（shell-quote） | AST 方案（Tree-sitter） |
|------|------------------------|------------------------|
| **输入** | 原始命令字符串 | 原始命令字符串 |
| **输出** | 字符串数组（子命令） | 语法树（保留完整结构） |
| **Shell 支持** | 主要 bash，PowerShell 支持有限 | bash、PowerShell、cmd 各有专用 grammar |
| **字符串处理** | 占位符替换，可能误判 | 精确识别字符串字面量节点 |
| **嵌套结构** | 递归替换，复杂场景易出错 | 天然支持嵌套（树形结构） |
| **错误恢复** | 解析失败时简单 fallback | 增量解析，部分错误可恢复 |

**示例对比：**

```bash
# 输入命令
cd src && (Get-ChildItem -Filter "*.ts" | Select-String '\.say\(')

# 当前实现输出
["cd src", "Get-ChildItem -Filter \"*.ts\"", "Select-String '\\.say\\('"]
# 问题：管道被拆分，括号被移除，上下文丢失

# AST 方案输出（简化）
Pipeline [
  Command: cd [Argument: src]
  Operator: &&
  Subshell [
    Pipeline [
      Command: Get-ChildItem [Argument: -Filter] [String: "*.ts"]
      Operator: |
      Command: Select-String [Argument: -Pattern] [String: '\.say\(']
    ]
  ]
]
# 优势：保留完整语法结构，可精确遍历
```

### 3.2 危险模式检测（`containsDangerousSubstitution`）

| 维度 | 当前实现（正则） | AST 方案 |
|------|-----------------|---------|
| **检测方式** | 正则匹配字符串模式 | 遍历语法树节点类型 |
| **误报场景** | 字符串内的相似模式 | 可区分字面量和代码 |
| **维护成本** | 每次新增模式需添加正则 | 新增节点类型检查 |
| **覆盖范围** | 主要 bash/zsh | 各 Shell 特有危险结构 |

**示例：**

```bash
# 输入
echo "这不是 ${var@P} 危险模式，只是字符串"
node -e "const fn = (x) => x * 2"

# 当前实现
# 需要复杂正则排除引号内内容，仍可能误报

# AST 方案
# 直接检查节点类型：
# - 如果是 StringContent 节点 → 跳过
# - 如果是 ParameterExpansion 节点且 operator == "@P" → 标记危险
```

### 3.3 命令前缀匹配（`findLongestPrefixMatch`）

| 维度 | 当前实现 | AST 方案 |
|------|---------|---------|
| **匹配对象** | 完整命令字符串 | 命令节点（CommandNode） |
| **参数感知** | 字符串前缀 | 可分离命令名和参数 |
| **别名处理** | 无法识别 | 可解析别名定义 |
| **通配符支持** | 简单字符串通配 | 可基于语法结构匹配 |

## 4. 统一 Shell 抽象层设计

### 4.1 目标

将 bash、PowerShell、cmd 的命令结构**统一映射**到中间表示（Intermediate Representation, IR）：

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Bash      │     │  PowerShell  │     │     cmd     │
│  Grammar    │     │   Grammar    │     │   Grammar   │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              Tree-sitter AST Parser                  │
└─────────────────────────────────────────────────────┘
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────┐
│            统一命令抽象层（Command IR）               │
│  - CommandNode (命令名 + 参数列表)                    │
│  - PipelineNode (管道连接)                           │
│  - ChainNode (&&、|| 连接)                          │
│  - StringNode (字符串字面量)                         │
│  - SubshellNode (子 shell)                          │
│  - RedirectionNode (重定向)                          │
└─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│              自动批准检查逻辑                        │
│  - 危险节点检测                                      │
│  - 前缀/模式匹配                                     │
│  - 复杂度评估                                        │
└─────────────────────────────────────────────────────┘
```

### 4.2 统一 IR 示例

```typescript
// 统一后的命令表示
interface CommandIR {
  type: "command" | "pipeline" | "chain" | "string" | "subshell"
  shellType: "bash" | "powershell" | "cmd"
  children: CommandIR[]
  metadata: {
    commandName?: string      // 如 "git", "Get-ChildItem"
    arguments?: string[]      // 参数列表
    isLiteral?: boolean       // 是否为字面量（非执行部分）
    sourceRange?: [number, number] // 源代码位置
  }
}
```

## 5. 用户自定义指令的 AST 处理

### 5.1 问题

用户可能配置自定义允许/拒绝指令：

```json
{
  "allowedCommands": [
    "git log --oneline",
    "Get-ChildItem -Recurse",
    "npm run build"
  ]
}
```

**当前问题：**
- 仅支持**字符串前缀匹配**
- 无法处理参数顺序变化（如 `git --oneline log`）
- 无法处理可选参数

### 5.2 AST 方案的优势

```typescript
// 配置可升级为结构化的"命令模式"
{
  "allowedCommands": [
    {
      "command": "git",
      "subcommand": "log",
      "flags": ["--oneline", "--graph"],  // 允许的 flag 集合
      "matchMode": "prefix" | "exact" | "regex"
    },
    {
      "command": "Get-ChildItem",
      "parameters": {
        "-Recurse": "optional",
        "-Filter": "any"  // 接受任意值
      }
    }
  ]
}
```

### 5.3 是否需要为自定义指令添加 AST 处理？

**建议：需要**

**原因：**
1. **一致性**：用户指令和内置危险模式检测使用同一套解析逻辑
2. **精确匹配**：避免 `git log` 匹配到 `git log --all --oneline --graph --decorate`
3. **参数感知**：可区分 `rm file` 和 `rm -rf /`
4. **可组合性**：支持"允许 git 但拒绝 git push"的细粒度控制

**实现思路：**
```typescript
// 用户配置编译为 AST 查询模式
const compiledPattern = compileCommandPattern("git log --oneline")

// 运行时匹配
function matchCommand(ir: CommandIR, pattern: CompiledPattern): boolean {
  // 遍历 IR 树，检查是否符合模式
  // 可处理参数顺序、可选参数等复杂场景
}
```

## 6. 收益与成本分析

### 6.1 收益

| 类别 | 具体收益 |
|------|---------|
| **准确性** | 减少误报（字符串内模式不误判） |
| **统一性** | bash/PowerShell/cmd 使用同一套检查逻辑 |
| **可维护性** | 新增危险模式 = 新增节点类型检查，无需复杂正则 |
| **可扩展性** | 支持更细粒度的命令控制（参数级） |
| **用户体验** | 减少不必要的用户确认，提升流畅度 |

### 6.2 成本

| 类别 | 具体成本 |
|------|---------|
| **开发工作量** | 需要重写 `parseCommand`、`containsDangerousSubstitution` 等核心函数 |
| **性能开销** | AST 解析比正则慢（但命令通常较短，影响有限） |
| **依赖风险** | 依赖 Tree-sitter grammar 的维护状态 |
| **学习曲线** | 团队需要熟悉 Tree-sitter API 和查询语言 |
| **兼容性** | 需要保持向后兼容，或提供迁移方案 |

### 6.3 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| Grammar 不支持某些 Shell 特性 | 中 | 中 | 保留 fallback 到当前实现 |
| 性能下降明显 | 低 | 中 | 缓存解析结果，增量解析 |
| 配置格式变更导致用户迁移困难 | 中 | 低 | 支持新旧格式共存 |

## 7. 实施建议

### 7.1 分阶段实施

**阶段 1：可行性验证（1-2 周）**
- 使用现有 `web-tree-sitter` 依赖
- 实现 bash 命令的 AST 解析原型
- 对比当前实现的准确率

**阶段 2：核心功能替换（4-6 周）**
- 实现统一 Command IR 层
- 替换 `parseCommand` 函数
- 替换 `containsDangerousSubstitution` 函数
- 添加 PowerShell 支持

**阶段 3：增强功能（2-4 周）**
- 支持用户自定义指令的 AST 匹配
- 添加 cmd 支持
- 性能优化和缓存

**阶段 4：迁移和文档（1-2 周）**
- 配置格式升级指南
- 向后兼容层
- 文档更新

### 7.2 关键决策点

| 决策 | 选项 | 建议 |
|------|------|------|
| **Grammar 来源** | 社区维护 vs 自研 | 优先使用社区成熟 grammar |
| **配置格式** | 保持字符串 vs 结构化 | 支持两种格式，逐步迁移 |
| **Fallback 策略** | 完全替换 vs 渐进 | 保留 fallback，AST 解析失败时用当前实现 |
| **性能优化** | 实时解析 vs 缓存 | 对常见命令缓存解析结果 |

## 8. 结论

**建议引入 Tree-sitter AST 解析**，理由：

1. ✅ 项目已有 `web-tree-sitter` 依赖，基础设施就绪
2. ✅ 可统一 bash/PowerShell/cmd 处理逻辑
3. ✅ 显著减少误报，提升用户体验
4. ✅ 支持更细粒度的命令控制
5. ✅ 长期可维护性更好

**建议采用渐进式替换策略**：
- 先实现原型验证准确率
- 保留当前实现作为 fallback
- 分阶段替换核心函数
- 提供配置迁移工具
