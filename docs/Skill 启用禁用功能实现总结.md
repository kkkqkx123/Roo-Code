# Skill 启用/禁用功能 - 实现总结

## 概述

本文档记录 Skill 启用/禁用功能的实现细节，该功能允许用户动态启用/禁用 Skill 功能，从而优化系统提示词的 Token 使用。

## 已实现功能

### 1. 配置 Schema 扩展

**文件**: `packages/types/src/global-settings.ts`

新增配置项：
- `skillsEnabled: boolean` - 全局 Skill 功能开关（默认：`true`）
- `disabledSkills: string[]` - 禁用的 Skill 列表（默认：`[]`）

### 2. Skill 元数据扩展

**文件**: `src/shared/skills.ts`

在 `SkillMetadata` 接口中添加：
- `enabledForPrompt?: boolean` - 单个 Skill 的启用标记（默认：`true/undefined`）

SKILL.md frontmatter 示例：
```markdown
---
name: my-skill
description: 这是一个示例 Skill
enabledForPrompt: false  # 默认不启用
---
```

### 3. SkillsManager 启用状态管理

**文件**: `src/services/skills/SkillsManager.ts`

新增方法：

```typescript
// 获取已启用的 Skill（过滤禁用的）
getEnabledSkillsForMode(currentMode: string, disabledSkills?: string[]): SkillMetadata[]

// 检查单个 Skill 是否启用
isSkillEnabled(skill: SkillMetadata, disabledSkills?: string[]): boolean

// 检查 Skill 功能是否全局启用
isSkillsEnabled(skillsEnabled?: boolean): boolean
```

**启用状态判断逻辑**：
1. 检查 `disabledSkills` 列表是否包含 skill name
2. 检查 `skill.enabledForPrompt` 是否为 `false`
3. 以上都不满足则返回 `true`（启用）

### 4. 系统提示词优化

**文件**: `src/core/prompts/sections/skills.ts`

修改 `getSkillsSection` 函数签名：
```typescript
export async function getSkillsSection(
    skillsManager: SkillsManagerLike | undefined,
    currentMode: string | undefined,
    skillsEnabled?: boolean,        // 新增
    disabledSkills?: string[],      // 新增
): Promise<string>
```

**优化逻辑**：
- 当 `skillsEnabled === false` 时，直接返回空字符串
- 当没有启用的 Skill 时，返回空字符串
- 空字符串不占用 Token

### 5. 工具过滤集成

**文件**: `src/core/prompts/tools/filter-tools-for-mode.ts`

在 `filterNativeToolsForMode` 函数中添加：
```typescript
// Conditionally exclude skill tool if skills functionality is disabled
if (settings?.skillsEnabled === false) {
    allowedToolNames.delete("skill")
}
```

当 Skill 功能禁用时，`skill` 工具将从可用工具列表中移除。

### 6. 类型定义更新

**文件**: `packages/types/src/vscode-extension-host.ts`

新增消息类型：
- `"toggleSkillEnabledForPrompt"` - 切换 Skill 启用状态
- `"getEnabledSkills"` - 获取已启用的 Skill 列表
- `"enabledSkills"` - 已启用的 Skill 列表响应

新增字段：
- `skillName?: string` - Skill 名称

### 7. Webview 消息处理

**文件**: `src/core/webview/webviewMessageHandler.ts`

#### 消息处理：`toggleSkillEnabledForPrompt`
```typescript
case "toggleSkillEnabledForPrompt": {
    // 从 disabledSkills 添加/移除 skill
    // 更新全局状态
    // 触发系统提示词更新
}
```

#### 消息处理：`getEnabledSkills`
```typescript
case "getEnabledSkills": {
    // 获取当前模式和禁用列表
    // 返回已启用的 Skill 列表
}
```

#### 设置更新：`skillsEnabled` 和 `disabledSkills`
```typescript
else if (key === "skillsEnabled") {
    // 更新全局状态并触发系统提示词更新
} else if (key === "disabledSkills") {
    // 更新全局状态并触发系统提示词更新
}
```

### 8. SYSTEM_PROMPT 调用更新

**文件**: `src/core/task/Task.ts`, `src/core/webview/generateSystemPrompt.ts`

更新 `SystemPromptSettings` 传递：
```typescript
{
    // ... 其他设置
    skillsEnabled: skillsEnabled ?? true,
    disabledSkills: disabledSkills ?? [],
}
```

## 配置层级

```
┌─────────────────────────────────────────┐
│ Level 1: 全局开关                        │
│ skillsEnabled: boolean (默认：true)      │
│ false = 禁用所有 Skill                   │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ Level 2: 全局禁用列表                    │
│ disabledSkills: string[] (默认：[])      │
│ ["*"] = 禁用所有 Skill                   │
│ ["skill-name"] = 禁用指定 Skill          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ Level 3: Skill 元数据                    │
│ enabledForPrompt: boolean               │
│ false = 该 Skill 默认不启用              │
└─────────────────────────────────────────┘
```

## Token 优化效果

| 场景 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| Skill 功能禁用 | ~1500 tokens | 0 tokens | 100% |
| 部分 Skill 禁用 | ~1500 tokens | ~500-1000 tokens | 33-66% |
| 全部 Skill 启用 | ~1500 tokens | ~1500 tokens | 0% |

## 默认行为（向后兼容）

- `skillsEnabled` 默认为 `true` - Skill 功能默认启用
- `disabledSkills` 默认为 `[]` - 没有禁用的 Skill
- `enabledForPrompt` 默认为 `undefined` - Skill 默认启用

现有用户升级后，所有 Skill 保持启用状态，不影响现有功能。

## 使用示例

### 禁用所有 Skill

通过设置界面将 `skillsEnabled` 设置为 `false`，或调用：
```typescript
await provider.updateGlobalState("skillsEnabled", false)
```

### 禁用特定 Skill

```typescript
const disabledSkills = ["skill-name-1", "skill-name-2"]
await provider.updateGlobalState("disabledSkills", disabledSkills)
```

### 切换单个 Skill 启用状态

从 Webview 发送消息：
```typescript
postMessage({
    type: "toggleSkillEnabledForPrompt",
    skillName: "my-skill",
    isEnabled: false,  // false = 禁用，true = 启用
})
```

### 获取已启用的 Skill

从 Webview 发送消息：
```typescript
postMessage({
    type: "getEnabledSkills",
})

// 接收响应
onMessage({
    type: "enabledSkills",
    skills: [...]  // 已启用的 Skill 列表
})
```

## 相关文件索引

| 文件 | 修改内容 |
|------|----------|
| `packages/types/src/global-settings.ts` | 添加 `skillsEnabled` 和 `disabledSkills` 配置 |
| `packages/types/src/vscode-extension-host.ts` | 添加消息类型和 `skillName` 字段 |
| `src/shared/skills.ts` | 扩展 `SkillMetadata` 接口 |
| `src/services/skills/SkillsManager.ts` | 添加启用状态管理方法 |
| `src/core/prompts/sections/skills.ts` | 支持禁用时返回空字符串 |
| `src/core/prompts/types.ts` | 扩展 `SystemPromptSettings` |
| `src/core/prompts/tools/filter-tools-for-mode.ts` | 禁用时排除 `skill` 工具 |
| `src/core/task/Task.ts` | 传递 `skillsEnabled` 和 `disabledSkills` |
| `src/core/webview/generateSystemPrompt.ts` | 传递 `skillsEnabled` 和 `disabledSkills` |
| `src/core/webview/webviewMessageHandler.ts` | 处理 Skill 启用切换消息 |

## 待实现功能

### Phase 3: 高级功能

1. **UI 组件实现**
   - Skill 设置面板
   - Skill 启用/禁用切换按钮
   - 批量操作（全部启用/全部禁用）

2. **项目级别配置**
   - 支持 `.roomodes` 中的 Skill 配置
   - 项目配置优先级高于全局配置

3. **测试与优化**
   - 单元测试
   - 集成测试
   - 性能优化

## 注意事项

1. **配置持久化**：配置存储在 VSCode GlobalState 中
2. **系统提示词更新**：配置变更会自动触发系统提示词重新生成
3. **工具过滤同步**：禁用 Skill 功能时，`skill` 工具也会从 API 工具列表中移除
4. **向后兼容**：默认行为与现有版本一致，不影响现有用户

## 测试建议

1. 测试禁用所有 Skill 时系统提示词不包含 Skill 内容
2. 测试禁用特定 Skill 时该 Skill 不出现在提示词中
3. 测试 `skill` 工具在禁用时无法调用
4. 测试配置变更后的系统提示词更新
5. 测试 SKILL.md 中 `enabledForPrompt: false` 的效果
