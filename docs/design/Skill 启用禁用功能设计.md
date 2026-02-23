# Skill 启用/禁用功能设计方案

## 问题描述

当前 Skill 系统缺乏像 MCP 一样的启用/禁用配置选项，导致：

1. **Token 浪费**：即使不需要使用 Skill，系统提示词中也会固定占用 1000-2000 token
2. **缺乏灵活性**：用户无法根据项目需求动态启用/禁用 Skill 功能
3. **不一致的体验**：MCP 服务器支持 `enabledForPrompt` 和 `disabledTools` 配置，而 Skill 没有类似机制

## 设计目标

1. **按需启用**：允许用户在全局或项目级别启用/禁用 Skill 功能
2. **细粒度控制**：支持禁用单个 Skill 或全部 Skill
3. **Token 优化**：当 Skill 功能禁用时，系统提示词中不包含 Skill 相关内容
4. **向后兼容**：默认行为与当前一致，不影响现有用户
5. **UI 一致性**：与 MCP 工具启用/禁用 UI 保持一致的用户体验

## 设计方案

### 方案概述

效仿 MCP 的启用/禁用机制，实现以下功能：

```
┌─────────────────────────────────────────────────────────────┐
│                    Skill 启用控制层级                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Level 1: 全局开关 (Global Toggle)                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ settings.skillsEnabled: boolean (默认：true)         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  Level 2: 全局禁用列表 (Global Disabled List)               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ settings.disabledSkills: string[] (默认：[])         │   │
│  │  - 支持禁用特定 Skill (通过 skill name)               │   │
│  │  - 支持禁用全部 Skill (特殊值："*")                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  Level 3: Skill 元数据标记 (Skill Metadata Flag)            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SKILL.md frontmatter:                               │   │
│  │   enabledForPrompt?: boolean (默认：true/undefined)  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

#### 1. 配置 Schema 扩展

**文件**: `packages/types/src/global-settings.ts`

在现有配置中添加：

- `skillsEnabled`: 全局 Skill 功能开关
  - 类型：`boolean`
  - 默认值：`true`（向后兼容）
  - 作用：完全启用/禁用 Skill 功能

- `disabledSkills`: 禁用的 Skill 列表
  - 类型：`string[]`
  - 默认值：`[]`
  - 特殊值：`["*"]` 表示禁用所有 Skill
  - 元素：Skill name（与 SKILL.md 中的 name 字段匹配）

#### 2. Skill 元数据扩展

**文件**: `src/shared/skills.ts` / SKILL.md frontmatter

在 `SkillMetadata` 接口中添加：

- `enabledForPrompt`: 单个 Skill 的启用标记
  - 类型：`boolean | undefined`
  - 默认值：`true`（或 `undefined` 表示启用）
  - 位置：SKILL.md 的 frontmatter
  - 作用：允许 Skill 作者标记某些 Skill 默认不启用

示例 SKILL.md：

```markdown
---
name: my-skill
description: 这是一个示例 Skill
modeSlugs:
  - code
enabledForPrompt: false  # 默认不启用，需要用户手动开启
---

Skill instructions...
```

#### 3. SkillsManager 扩展

**文件**: `src/services/skills/SkillsManager.ts`

新增方法：

- `getEnabledSkillsForMode(currentMode: string): SkillMetadata[]`
  - 在 `getSkillsForMode` 基础上增加启用状态过滤
  - 检查 `disabledSkills` 配置
  - 检查 `skillsEnabled` 全局开关
  - 检查 `enabledForPrompt` 标记

- `isSkillEnabled(skillName: string): boolean`
  - 检查单个 Skill 是否启用
  - 优先级：全局禁用列表 > enabledForPrompt 标记

- `toggleSkillEnabledForPrompt(skillName: string, isEnabled: boolean): Promise<void>`
  - 切换单个 Skill 的启用状态
  - 更新 `disabledSkills` 配置
  - 触发配置保存和 UI 更新

#### 4. 系统提示词生成优化

**文件**: `src/core/prompts/sections/skills.ts`

修改 `getSkillsSection` 函数：

```typescript
export async function getSkillsSection(
    skillsManager: SkillsManagerLike | undefined,
    currentMode: string | undefined,
    skillsEnabled: boolean,  // 新增参数
): Promise<string> {
    // 如果 Skill 功能全局禁用，直接返回空字符串
    if (!skillsEnabled || !skillsManager || !currentMode) {
        return ""
    }

    // 获取已启用的 Skill（过滤掉禁用的）
    const skills = skillsManager.getEnabledSkillsForMode(currentMode)
    
    // 如果没有启用的 Skill，返回空字符串（不占用 token）
    if (skills.length === 0) {
        return ""
    }

    // ... 生成 Skill XML
}
```

#### 5. 工具过滤集成

**文件**: `src/core/task/build-tools.ts` / `src/core/prompts/tools/filter-tools-for-mode.ts`

在工具过滤逻辑中：

- 检查 `skillsEnabled` 配置
- 如果禁用，从可用工具列表中排除 `skill` 工具
- 确保模型无法调用 `skill` 工具

#### 6. MCP Hub 模式实现

**文件**: `src/services/mcp/McpHub.ts`

参考 `toggleToolEnabledForPrompt` 实现：

```typescript
async toggleSkillEnabledForPrompt(
    skillName: string,
    isEnabled: boolean,
): Promise<void> {
    try {
        // 当 isEnabled 为 true 时，从 disabledSkills 列表中移除
        // 当 isEnabled 为 false 时，添加到 disabledSkills 列表
        const addSkillToDisabledList = !isEnabled
        await this.updateDisabledSkillsList(
            skillName, 
            addSkillToDisabledList
        )
    } catch (error) {
        this.showErrorMessage(
            `Failed to update enabled state for skill ${skillName}`, 
            error
        )
        throw error
    }
}

private async updateDisabledSkillsList(
    skillName: string,
    addToDisabled: boolean,
): Promise<void> {
    // 获取当前配置
    const config = await this.provider.getGlobalState<{
        disabledSkills: string[]
    }>()
    
    const disabledSkills = config?.disabledSkills ?? []
    
    if (addToDisabled) {
        // 添加到禁用列表（如果不存在）
        if (!disabledSkills.includes(skillName)) {
            disabledSkills.push(skillName)
        }
    } else {
        // 从禁用列表中移除
        const index = disabledSkills.indexOf(skillName)
        if (index !== -1) {
            disabledSkills.splice(index, 1)
        }
    }
    
    // 保存配置
    await this.provider.updateGlobalState("disabledSkills", disabledSkills)
    
    // 通知配置变更
    this.provider.postMessage({
        type: "disabledSkills",
        disabledSkills,
    })
}
```

#### 7. Webview 消息处理

**文件**: `src/core/webview/webviewMessageHandler.ts`

新增消息类型处理：

```typescript
case "toggleSkillEnabledForPrompt": {
    await provider.getMcpHub()?.toggleSkillEnabledForPrompt(
        message.skillName,
        message.isEnabled,
    )
    break
}

case "getEnabledSkills": {
    const skills = provider.getSkillsManager()?.getEnabledSkillsForMode(
        provider.getCurrentMode()
    )
    provider.postMessage({
        type: "enabledSkills",
        skills,
    })
    break
}
```

新增消息类型定义：

**文件**: `packages/types/src/vscode-extension-host.ts`

```typescript
export type WebviewMessage = {
    type: 
        | "toggleSkillEnabledForPrompt"
        | "getEnabledSkills"
        | "skillsEnabled"
        // ... 现有类型
}
```

#### 8. UI 组件实现

**文件**: `webview-ui/src/components/settings/SkillSettings.tsx`（新建）

实现类似 MCP 工具启用的 UI：

- Skill 启用开关（全局）
- Skill 列表（显示所有可用 Skill）
- 每个 Skill 的启用/禁用切换按钮
- 显示已禁用 Skill 数量
- 支持"全部启用"/"全部禁用"快捷操作

### 启用状态判断逻辑

```
判断 Skill 是否启用的优先级顺序：

1. 全局开关检查
   └─ skillsEnabled === false → 禁用所有 Skill
   
2. 全局禁用列表检查
   └─ disabledSkills.includes("*") → 禁用所有 Skill
   └─ disabledSkills.includes(skillName) → 禁用该 Skill
   
3. Skill 元数据检查
   └─ enabledForPrompt === false → 禁用该 Skill
   
4. 默认启用
   └─ 以上都不满足 → 启用
```

### Token 优化效果

| 场景 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| Skill 功能禁用 | ~1500 tokens | 0 tokens | 100% |
| 部分 Skill 禁用 | ~1500 tokens | ~500-1000 tokens | 33-66% |
| 全部 Skill 启用 | ~1500 tokens | ~1500 tokens | 0% |

### 配置持久化

配置存储位置：

- **全局配置**: VSCode GlobalState / Settings
  - `skillsEnabled`: boolean
  - `disabledSkills`: string[]

- **项目配置**: `.roomodes` 文件（可选）
  - 支持项目级别的 Skill 启用/禁用配置
  - 优先级高于全局配置

- **Skill 元数据**: SKILL.md frontmatter
  - `enabledForPrompt`: boolean
  - 作为 Skill 定义的一部分持久化

### 默认行为

为了保持向后兼容性：

- `skillsEnabled` 默认为 `true`
- `disabledSkills` 默认为 `[]`
- `enabledForPrompt` 默认为 `true`（或 `undefined`）
- 现有用户升级后，所有 Skill 保持启用状态

## 实现步骤

### Phase 1: 基础架构（核心功能）

1. **配置 Schema 扩展**
   - 在 `packages/types/src/global-settings.ts` 添加 `skillsEnabled` 和 `disabledSkills`
   - 更新默认配置

2. **SkillsManager 扩展**
   - 实现 `getEnabledSkillsForMode()` 方法
   - 实现 `isSkillEnabled()` 方法
   - 修改 `getSkillsForMode()` 或创建新方法

3. **系统提示词优化**
   - 修改 `getSkillsSection()` 接受 `skillsEnabled` 参数
   - 当 Skill 禁用时返回空字符串

4. **工具过滤集成**
   - 在 `filterNativeToolsForMode()` 中检查 `skillsEnabled`
   - 禁用时排除 `skill` 工具

### Phase 2: 用户交互

5. **MCP Hub 模式方法**
   - 实现 `toggleSkillEnabledForPrompt()`
   - 实现配置持久化逻辑

6. **Webview 消息处理**
   - 添加新的消息类型处理
   - 更新类型定义

7. **UI 组件实现**
   - 创建 Skill 设置面板
   - 实现启用/禁用切换功能
   - 集成到现有设置 UI

### Phase 3: 高级功能

8. **项目级别配置**
   - 支持 `.roomodes` 中的 Skill 配置
   - 实现配置优先级逻辑

9. **Skill 元数据支持**
   - 支持 SKILL.md 中的 `enabledForPrompt`
   - 更新 Skill 发现逻辑

10. **批量操作**
    - "全部启用"/"全部禁用"功能
    - 按模式批量启用/禁用

### Phase 4: 测试与优化

11. **单元测试**
    - SkillsManager 方法测试
    - 启用状态判断逻辑测试
    - 配置持久化测试

12. **集成测试**
    - 系统提示词生成测试
    - UI 交互测试
    - 端到端流程测试

13. **性能优化**
    - 缓存启用状态检查结果
    - 优化配置读取频率

## 与 MCP 启用机制的对比

| 特性 | MCP 工具 | Skill（设计） |
|------|----------|---------------|
| 全局开关 | `mcpEnabled` | `skillsEnabled` |
| 禁用列表 | `disabledTools` | `disabledSkills` |
| 单个启用标记 | `tool.enabledForPrompt` | `skill.enabledForPrompt` |
| 切换方法 | `toggleToolEnabledForPrompt()` | `toggleSkillEnabledForPrompt()` |
| 配置存储 | GlobalState | GlobalState |
| UI 位置 | MCP 服务器面板 | Skill 设置面板 |
| 作用域 | 全局 + 项目 | 全局 + 项目 |
| 默认状态 | 启用 | 启用（向后兼容） |

## 风险与缓解

### 风险 1: 配置冲突

**问题**: 全局配置与项目配置可能冲突

**缓解**: 
- 明确定义优先级：项目配置 > 全局配置
- 在 UI 中清晰显示当前生效的配置来源

### 风险 2: 用户困惑

**问题**: 多层级的启用控制可能让用户困惑

**缓解**:
- UI 设计清晰直观
- 提供"一键启用全部"/"一键禁用全部"快捷操作
- 添加帮助文档和提示

### 风险 3: 向后兼容性

**问题**: 现有用户可能依赖默认行为

**缓解**:
- 默认值保持启用状态
- 升级时不修改现有配置
- 提供迁移指南

## 预期收益

1. **Token 节省**: 禁用 Skill 功能可节省 1000-2000 tokens
2. **灵活性**: 用户可根据项目需求灵活控制
3. **一致性**: 与 MCP 工具启用机制保持一致
4. **可扩展性**: 为未来更多细粒度控制奠定基础

## 相关文件索引

| 文件 | 修改内容 |
|------|----------|
| `packages/types/src/global-settings.ts` | 添加配置 Schema |
| `packages/types/src/vscode-extension-host.ts` | 添加消息类型 |
| `src/shared/skills.ts` | 扩展 SkillMetadata |
| `src/services/skills/SkillsManager.ts` | 启用状态管理方法 |
| `src/core/prompts/sections/skills.ts` | 支持禁用时返回空 |
| `src/core/task/build-tools.ts` | 工具过滤集成 |
| `src/services/mcp/McpHub.ts` | 切换方法实现 |
| `src/core/webview/webviewMessageHandler.ts` | 消息处理 |
| `webview-ui/src/components/settings/` | 新增 UI 组件 |
