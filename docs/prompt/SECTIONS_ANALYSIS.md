# src/core/prompts/sections 目录文件分析

## 概述
`src/core/prompts/sections` 目录包含了提示词（system prompt）的各个组成部分。这些文件通过 `src/core/prompts/system.ts` 中的 `generatePrompt()` 函数按照特定的顺序组装，形成最终的系统提示词。

---

## 各文件加载条件详细分析

### 1. **markdown-formatting.ts** - 总是添加 ✓
**函数**: `markdownFormattingSection()`
**何时添加**: 在 `generatePrompt()` 的第87行，无条件加载

**内容**: 
- 定义所有响应中代码和文件名必须使用可点击的Markdown格式：`[filename](path:line)`

**触发条件**: 
- **总是加载**，不依赖任何配置或状态

---

### 2. **tool-use.ts** - 总是添加 ✓
**函数**: `getSharedToolUseSection()`
**何时添加**: 在 `generatePrompt()` 的第89行，无条件加载

**内容**:
- 告诉AI有工具调用能力
- 提示使用native tool-calling机制
- 建议在单个响应中调用多个相关工具

**触发条件**: 
- **总是加载**，不依赖任何配置或状态

---

### 3. **tool-use-guidelines.ts** - 总是添加 ✓
**函数**: `getToolUseGuidelinesSection()`
**何时添加**: 在 `generatePrompt()` 的第91行，无条件加载

**内容**:
- 工具使用的3个指导原则
- 重点强调使用最合适的工具、迭代决策、不假设结果

**触发条件**: 
- **总是加载**，不依赖任何配置或状态

---

### 4. **capabilities.ts** - 有条件添加 ⚠️
**函数**: `getCapabilitiesSection(cwd, mcpHub?)`
**何时添加**: 在 `generatePrompt()` 的第93行，始终调用但内容可变

**内容**:
- 列举AI拥有的能力（执行命令、列出文件、搜索、读写文件等）
- **MCP服务器部分是条件性的**

**触发条件**: 
```typescript
const shouldIncludeMcp = hasMcpGroup && hasMcpServers
// hasMcpGroup: 当前mode配置中是否有"mcp"分组
// hasMcpServers: mcpHub是否有活跃的MCP服务器
```

**何时包含MCP内容**:
1. 当前Mode的配置（ModeConfig）的groups中包含"mcp"分组
2. **且** mcpHub不为undefined且有活跃的MCP服务器（`mcpHub.getServers().length > 0`）

---

### 5. **modes.ts** - 有条件添加 ⚠️
**函数**: `getModesSection(context)`
**何时添加**: 在 `generatePrompt()` 的第77-78行，异步加载

**内容**:
- 列举所有可用的模式（modes）及其描述
- 包括内置模式和用户自定义的模式

**触发条件**: 
- **总是加载**（内容来自 `getAllModesWithPrompts(context)` 的结果）
- 内容来自以下来源：
  - 内置modes（在 `shared/modes` 中定义）
  - 用户在extension state中保存的模式覆盖

**何时变化**:
- 用户添加或删除自定义模式时
- 用户修改某个模式的配置时

---

### 6. **skills.ts** - 有条件添加 ⚠️
**函数**: `getSkillsSection(skillsManager, currentMode, skillsEnabled, disabledSkills)`
**何时添加**: 在 `generatePrompt()` 的第77-80行，异步加载

**内容**:
- 列举当前模式可用的skills
- 包含skill applicability check流程说明

**触发条件**: 
```typescript
// 所有条件都必须满足才会包含skills部分
if (skillsEnabled === false || !skillsManager || !currentMode) {
    return "" // 空内容
}

// 获取当前模式的enabled skills
const skills = skillsManager.getEnabledSkillsForMode(currentMode, disabledSkills)
if (skills.length === 0) return "" // 没有skill时返回空
```

**何时包含skills**:
1. `skillsEnabled !== false`（skills功能全局启用，默认为true）
2. `skillsManager` 不为undefined（skills管理器已初始化）
3. `currentMode` 不为undefined（提供了当前模式）
4. 当前模式有至少一个enabled的skill

**何时变化**:
- 全局skills功能被禁用时
- 用户禁用特定的skill时
- 用户安装新的skill时
- Mode改变时（不同mode可能有不同的可用skills）

---

### 7. **rules.ts** - 总是添加 ✓
**函数**: `getRulesSection(cwd, settings?)`
**何时添加**: 在 `generatePrompt()` 的第97行，无条件加载

**内容**:
- 项目基础目录信息
- Shell特定的命令链接操作符（PowerShell用`;`，Unix用`&&`）
- 文件路径相对性规则
- 模式文件编辑限制
- 工具使用规则
- Vendor confidentiality（可选，基于 `settings?.isStealthModel`）

**触发条件**: 
- **总是加载**

**何时变化**:
- 根据当前shell类型（PowerShell vs Unix）动态生成
- 当 `settings?.isStealthModel === true` 时，额外添加Vendor Confidentiality部分

---

### 8. **system-info.ts** - 总是添加 ✓
**函数**: `getSystemInfoSection(cwd)`
**何时添加**: 在 `generatePrompt()` 的第99行，无条件加载

**内容**:
- 操作系统信息
- 默认Shell
- Home目录
- 当前工作空间目录

**触发条件**: 
- **总是加载**，内容来自系统检测

---

### 9. **objective.ts** - 总是添加 ✓
**函数**: `getObjectiveSection()`
**何时添加**: 在 `generatePrompt()` 的第101行，无条件加载

**内容**:
- AI的目标和工作方式
- 5个步骤：分析任务、顺序工作、利用工具、完成任务、接收反馈

**触发条件**: 
- **总是加载**，是静态内容

---

### 10. **custom-instructions.ts** - 有条件添加 ⚠️
**函数**: `addCustomInstructions(modeCustomInstructions, globalCustomInstructions, cwd, mode, options)`
**何时添加**: 在 `generatePrompt()` 的第103-107行，异步加载

**内容**: 如果有任何以下内容，则包含"USER'S CUSTOM INSTRUCTIONS"部分：
- 语言偏好设置
- 全局自定义指令（globalCustomInstructions）
- Mode特定指令（modeCustomInstructions）
- 规则（Rules）- 来自多个来源

**触发条件**: 

#### 语言偏好 - 有条件
- 当 `options.language` 不为undefined时添加

#### 全局自定义指令 - 有条件
- 当 `globalCustomInstructions` 是非空字符串时添加

#### Mode特定指令 - 有条件
- 当 `modeCustomInstructions` 是非空字符串时添加

#### 规则部分 - 复杂的分层加载（见下）

**规则的详细加载流程**:

##### A. Mode特定规则（优先级1）
```typescript
// 检查 .roo/rules-${mode}/ 目录 或 .roo/rules-${mode}/ 递归目录
// 若enableSubfolderRules=true: 同时检查子目录中的 .roo/rules-${mode}/
// 或 fallback to .roorules-${mode} / .clinerules-${mode} 文件
```

##### B. rooIgnoreInstructions（优先级2）
- 当 `options.rooIgnoreInstructions` 存在时添加

##### C. AGENTS.md 文件（优先级3，可禁用）
**条件**: `options.settings?.useAgentRules !== false`（默认加载）
```typescript
// 加载来源（根据 enableSubfolderRules 设置）:
// 1. 项目根目录的 AGENTS.md 或 AGENT.md（及其 .local.md 版本）
// 2. 若 enableSubfolderRules=true: 也加载所有子目录中有 .roo 的目录下的 AGENTS.md
```

##### D. 通用规则（优先级4）
```typescript
// 加载 .roo/rules/ 目录中的所有文件
// 或 .roo/rules/ 递归目录（若enableSubfolderRules=true）
// 或 fallback to .roorules / .clinerules 文件
```

**何时整个section为空** (不添加):
- 上述所有内容都不存在或为空时

**何时变化**:
1. **全局配置改变**: 
   - 用户修改globalCustomInstructions
   - 用户更改language设置
   
2. **项目文件改变**:
   - .roo/rules/ 目录的文件被修改/添加/删除
   - .roo/rules-${mode}/ 目录的文件被修改/添加/删除
   - AGENTS.md / AGENTS.local.md 被修改/添加/删除
   - .roorules / .clinerules 等旧格式文件被修改
   
3. **设置改变**:
   - enableSubfolderRules 被启用/禁用
   - useAgentRules 被禁用/启用
   - 当前mode改变（可能影响mode特定规则）

---

## 加载顺序（在最终prompt中的顺序）

```
1. roleDefinition (来自当前mode)
2. baseInstructions (来自当前mode或custom prompt)
3. markdown-formatting.ts → Markdown Rules
4. tool-use.ts → Tool Use
5. tool-use-guidelines.ts → Tool Use Guidelines
6. capabilities.ts → Capabilities (±MCP部分)
7. modes.ts → Modes (列出所有可用模式)
8. skills.ts → Available Skills (如果有)
9. rules.ts → Rules
10. system-info.ts → System Information
11. objective.ts → Objective
12. custom-instructions.ts → User's Custom Instructions (如果有)
```

---

## 关键配置源

| 源 | 类型 | 默认值 |
|---|---|---|
| `settings?.skillsEnabled` | boolean | true |
| `settings?.useAgentRules` | boolean | true |
| `settings?.enableSubfolderRules` | boolean | false |
| `settings?.isStealthModel` | boolean | false |
| `globalCustomInstructions` | string | "" |
| `mode` | Mode | "default" |
| `mcpHub` | McpHub? | undefined |
| `skillsManager` | SkillsManager? | undefined |

---

## 小结：哪些部分是动态的？

| 文件 | 是否动态 | 触发因素 |
|---|---|---|
| markdown-formatting | ❌ 静态 | - |
| tool-use | ❌ 静态 | - |
| tool-use-guidelines | ❌ 静态 | - |
| capabilities | ✅ 部分动态 | MCP配置、mcpHub状态 |
| modes | ✅ 动态 | 用户定义模式、mode配置 |
| skills | ✅ 动态 | skillsEnabled、当前mode、已安装skills |
| rules | ✅ 部分动态 | Shell类型、isStealthModel设置 |
| system-info | ❌ 静态（运行时生成） | 系统环境 |
| objective | ❌ 静态 | - |
| custom-instructions | ✅ 高度动态 | 自定义指令、规则文件、language、mode |

