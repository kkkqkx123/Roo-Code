# 语音播放与 VSCode 弹窗分析

本文档分析项目的语音播放机制，以及如何在扩展中添加 VSCode 原生弹窗（警告/错误/信息提示）。

---

## 1. 语音播放机制分析

当前项目的语音播放分为两部分：**TTS (Text-to-Speech)** 和 **音效播放**

### 1.1 TTS (文本转语音)

**实现位置:** `src/utils/tts.ts`

**核心特性:**
- 使用 `say` npm 包实现系统级 TTS
- 通过队列机制管理多个 TTS 请求（防止语音重叠）
- 支持语速调节和启停控制

**调用链路:**
```
Webview (ChatView.tsx)
  → vscode.postMessage({ type: "playTts", text })
  → src/core/webview/webviewMessageHandler.ts (case "playTts")
  → playTts() from src/utils/tts.ts
  → say.speak() 系统级 TTS
```

**关键代码:**
```typescript
// src/utils/tts.ts
export const playTts = async (message: string, options: PlayTtsOptions = {}) => {
  if (!isTtsEnabled) {
    return
  }
  queue.push({ message, options })
  await processQueue()
}

// src/core/webview/webviewMessageHandler.ts
case "playTts":
  if (message.text) {
    playTts(message.text, {
      onStart: () => provider.postMessageToWebview({ type: "ttsStart", text: message.text }),
      onStop: () => provider.postMessageToWebview({ type: "ttsStop", text: message.text }),
    })
  }
  break
```

**关键配置:**
| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `ttsEnabled` | boolean | false | 是否启用 TTS |
| `ttsSpeed` | number | 1.0 | 语速倍率 |

**相关文件:**
- `src/utils/tts.ts` - TTS 核心实现
- `packages/types/src/global-settings.ts` - TTS 配置定义
- `src/core/webview/ClineProvider.ts` - TTS 状态管理

---

### 1.2 音效播放 (Notification/Celebration/Progress)

**实现位置:** `webview-ui/src/components/chat/ChatView.tsx`

**核心特性:**
- 使用 `use-sound` 库在 webview 中直接播放音频文件
- 支持音量调节和防抖机制

**音效类型:**
| 音效类型 | 触发场景 | 音频文件 |
|----------|----------|----------|
| `notification` | 收到新消息/通知 | `notification.wav` |
| `celebration` | 任务完成 | `celebration.wav` |
| `progress_loop` | 长时间等待/加载中 | `progress_loop.wav` |

**关键代码:**
```typescript
// webview-ui/src/components/chat/ChatView.tsx
import useSound from "use-sound"

const volume = typeof soundVolume === "number" ? soundVolume : 0.5
const [playNotification] = useSound(`${audioBaseUri}/notification.wav`, { 
  volume, 
  soundEnabled, 
  interrupt: true 
})
const [playCelebration] = useSound(`${audioBaseUri}/celebration.wav`, { 
  volume, 
  soundEnabled, 
  interrupt: true 
})
const [playProgressLoop] = useSound(`${audioBaseUri}/progress_loop.wav`, { 
  volume, 
  soundEnabled, 
  interrupt: true 
})

// 播放函数
const playSound = useCallback(
  (audioType: AudioType) => {
    if (!soundEnabled) return
    
    // 防抖：100ms 内不重复播放
    const now = Date.now()
    const lastPlayed = lastPlayedRef.current[audioType] ?? 0
    if (now - lastPlayed < 100) return
    lastPlayedRef.current[audioType] = now

    switch (audioType) {
      case "notification":
        playNotification()
        break
      case "celebration":
        playCelebration()
        break
      case "progress_loop":
        playProgressLoop()
        break
    }
  },
  [soundEnabled, playNotification, playCelebration, playProgressLoop]
)
```

**控制参数:**
- `soundEnabled`: 是否启用音效
- `soundVolume`: 音量 (0-1，默认 0.5)
- 防抖间隔：100ms

**相关文件:**
- `webview-ui/src/components/chat/ChatView.tsx` - 音效播放实现
- `packages/types/src/vscode-extension-host.ts` - AudioType 定义

---

## 2. VSCode 原生弹窗 API

### 2.1 API 类型总览

VSCode 提供以下原生弹窗 API，通过 `vscode.window` 访问：

| API | 用途 | 图标 | 使用场景 |
|-----|------|------|----------|
| `showInformationMessage` | 信息提示 | ℹ️ | 一般通知、确认操作 |
| `showWarningMessage` | 警告提示 | ⚠️ | 潜在问题提醒 |
| `showErrorMessage` | 错误提示 | ❌ | 错误报告 |
| `showInputBox` | 文本输入 | - | 获取用户输入 |
| `showOpenDialog` | 文件选择 | - | 选择文件/文件夹 |
| `showSaveDialog` | 保存文件 | - | 选择保存位置 |
| `showQuickPick` | 快速选择 | - | 下拉选择菜单 |
| `showTextDocument` | 打开文档 | - | 在编辑器中打开文件 |

---

### 2.2 信息/警告/错误弹窗

#### 基础用法

```typescript
import * as vscode from 'vscode'

// 信息提示（非模态）
vscode.window.showInformationMessage('操作成功！')

// 警告提示
vscode.window.showWarningMessage('此操作可能导致数据丢失')

// 错误提示
vscode.window.showErrorMessage('发生错误：文件不存在')
```

#### 带按钮的确认对话框

```typescript
// 模态对话框 + 确认/取消按钮
const result = await vscode.window.showInformationMessage(
  '确定要删除此配置吗？',
  { modal: true },  // 模态对话框（阻止其他操作）
  '删除',          // 按钮 1
  '取消'           // 按钮 2
)

if (result === '删除') {
  // 执行删除操作
} else {
  // 用户取消
}
```

#### 返回值说明

- 用户点击按钮：返回按钮文本（string）
- 用户点击外部关闭：返回 `undefined`
- 用户按 ESC 键：返回 `undefined`

---

### 2.3 输入框

```typescript
const input = await vscode.window.showInputBox({
  prompt: '请输入配置名称',
  placeHolder: '例如：my-config',
  value: '默认配置',  // 默认值
  validateInput: (value) => {
    if (!value || value.trim() === '') {
      return '配置名称不能为空'
    }
    if (value.length > 50) {
      return '配置名称不能超过 50 个字符'
    }
    return null  // 验证通过返回 null
  }
})

if (input !== undefined) {
  // 用户输入了内容（可能为空字符串）
  console.log('用户输入:', input)
} else {
  // 用户取消了输入（按 ESC 或点击外部）
  console.log('用户取消了输入')
}
```

---

### 2.4 文件对话框

#### 打开文件对话框

```typescript
const fileUris = await vscode.window.showOpenDialog({
  canSelectFiles: true,
  canSelectFolders: false,
  canSelectMany: false,
  title: '选择配置文件',
  openLabel: '选择',
  filters: {
    'JSON 文件': ['json'],
    '所有文件': ['*']
  }
})

if (fileUris && fileUris.length > 0) {
  const filePath = fileUris[0].fsPath
  // 处理选中的文件
}
```

#### 保存文件对话框

```typescript
const saveUri = await vscode.window.showSaveDialog({
  saveLabel: '保存',
  filters: {
    'JSON 文件': ['json'],
    'YAML 文件': ['yml', 'yaml']
  },
  defaultUri: vscode.Uri.file('/path/to/default.json')
})

if (saveUri) {
  // 用户选择了保存位置
  await fs.writeFile(saveUri.fsPath, content)
}
```

---

### 2.5 快速选择面板

```typescript
const items: vscode.QuickPickItem[] = [
  { label: '选项 1', description: '描述 1', detail: '详细信息 1' },
  { label: '选项 2', description: '描述 2', detail: '详细信息 2' },
  { label: '选项 3', description: '描述 3', detail: '详细信息 3' }
]

const selected = await vscode.window.showQuickPick(items, {
  placeHolder: '请选择一个选项',
  canPickMany: false,  // 是否允许多选
  matchOnDescription: true,
  matchOnDetail: true
})

if (selected) {
  console.log('用户选择:', selected.label)
}
```

---

## 3. 在项目中添加 VSCode 弹窗

### 3.1 调用位置

VSCode 弹窗 API **只能在扩展宿主环境**中调用，不能在 webview 中直接调用。

**正确架构:**
```
Webview (React)
  ↓ postMessage
Extension Host (vscode.window.show*)
  ↓ postMessage
Webview (更新 UI)
```

### 3.2 实现步骤

#### 步骤 1: Webview 发送消息

```typescript
// webview-ui/src/components/xxx/YourComponent.tsx
import { vscode } from '../utils/vscode'

const handleDelete = () => {
  vscode.postMessage({ 
    type: "deleteConfig",
    configId: "123"
  })
}
```

#### 步骤 2: 扩展宿主处理消息

```typescript
// src/core/webview/webviewMessageHandler.ts
case "deleteConfig": {
  const { configId } = message
  
  // 显示确认对话框
  const confirm = await vscode.window.showInformationMessage(
    t("mcp:confirmation.delete_server", { serverName: configId }),
    { modal: true },
    t("common:answers.delete"),
    t("common:answers.cancel")
  )
  
  if (confirm !== t("common:answers.delete")) {
    return  // 用户取消
  }
  
  // 执行删除操作
  try {
    await deleteConfig(configId)
    vscode.window.showInformationMessage(t("mcp:info.server_deleted"))
  } catch (error) {
    vscode.window.showErrorMessage(
      t("mcp:errors.delete_failed", { error: error.message })
    )
  }
  
  break
}
```

#### 步骤 3: 添加国际化文本

```json
// webview-ui/src/i18n/locales/zh/mcp.json
{
  "confirmation": {
    "delete_server": "确定要删除服务器 \"{{serverName}}\" 吗？此操作不可恢复。"
  },
  "info": {
    "server_deleted": "服务器已删除"
  },
  "errors": {
    "delete_failed": "删除失败：{{error}}"
  }
}
```

---

### 3.3 项目现有示例

#### 示例 1: 重置状态确认 (`src/core/webview/ClineProvider.ts:2344`)

```typescript
async resetState() {
  const answer = await vscode.window.showInformationMessage(
    t("common:confirmation.reset_state"),
    { modal: true },
    t("common:answers.yes"),
  )

  if (answer !== t("common:answers.yes")) {
    return
  }

  await this.contextProxy.resetAllState()
  // ...
}
```

#### 示例 2: MCP 服务器错误处理 (`src/services/mcp/McpHub.ts:280`)

```typescript
private showErrorMessage(message: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  vscode.window.showErrorMessage(`${message}: ${errorMessage}`)
}

// 使用示例
this.showErrorMessage(`Failed to update server ${serverName} state`, error)
```

#### 示例 3: 文件选择对话框 (`src/core/webview/webviewMessageHandler.ts:1817`)

```typescript
case "importMode": {
  const fileUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'JSON': ['json'] }
  })
  
  if (fileUri && fileUri[0]) {
    // 处理导入
  }
  break
}
```

#### 示例 4: 输入框 (`src/utils/storage.ts:99`)

```typescript
const result = await vscode.window.showInputBox({
  prompt: t("common:prompts.enter_custom_path"),
  placeHolder: t("common:placeholders.custom_path"),
  validateInput: (value) => {
    if (!value || value.trim() === '') {
      return t("common:errors.path_required")
    }
    return null
  }
})
```

---

## 4. 最佳实践

### 4.1 弹窗使用建议

| 弹窗类型 | 使用场景 | 注意事项 |
|----------|----------|----------|
| `showInformationMessage` | 成功提示、一般通知、确认操作 | 避免频繁使用，防止打扰用户 |
| `showWarningMessage` | 潜在风险、非阻塞性问题 | 说明可能的后果 |
| `showErrorMessage` | 操作失败、系统错误 | 提供清晰的错误信息和解决建议 |
| `showInputBox` | 需要用户输入 | 提供合理的默认值和验证 |
| `showQuickPick` | 多选一场景 | 选项不宜过多（建议<20 个） |

### 4.2 模态 vs 非模态

```typescript
// 模态对话框 - 阻塞用户其他操作
vscode.window.showInformationMessage('重要确认', { modal: true }, '确认')

// 非模态对话框 - 用户可继续其他操作
vscode.window.showInformationMessage('操作完成', '查看', '关闭')
```

**使用建议:**
- 需要用户确认的重要操作 → 使用 `modal: true`
- 一般通知/提示 → 不使用 modal

### 4.3 错误处理模式

```typescript
try {
  await riskyOperation()
  vscode.window.showInformationMessage(t("common:info.operation_success"))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  vscode.window.showErrorMessage(
    t("common:errors.operation_failed", { error: message })
  )
}
```

### 4.4 国际化

始终使用 `t()` 函数包裹弹窗文本：

```typescript
// ✅ 正确
vscode.window.showErrorMessage(t("common:errors.save_failed"))

// ❌ 错误（硬编码中文）
vscode.window.showErrorMessage("保存失败")
```

---

## 5. 相关文件索引

| 文件路径 | 说明 |
|----------|------|
| `src/utils/tts.ts` | TTS 核心实现 |
| `src/core/webview/webviewMessageHandler.ts` | Webview 消息处理（含弹窗调用） |
| `src/core/webview/ClineProvider.ts` | Provider 主类（含弹窗调用） |
| `src/services/mcp/McpHub.ts` | MCP 服务（错误处理示例） |
| `src/utils/storage.ts` | 存储工具（输入框示例） |
| `packages/types/src/vscode-extension-host.ts` | 消息类型定义 |
| `packages/types/src/global-settings.ts` | 全局配置定义（含 TTS 配置） |
| `webview-ui/src/components/chat/ChatView.tsx` | 音效播放实现 |

---

## 6. 快速参考

### 添加新弹窗的最小代码示例

```typescript
// 1. 在 webview 中触发
// webview-ui/src/components/MyComponent.tsx
vscode.postMessage({ type: "myAction" })

// 2. 在扩展中处理
// src/core/webview/webviewMessageHandler.ts
case "myAction":
  const result = await vscode.window.showWarningMessage(
    t("my:warning_message"),
    { modal: true },
    t("common:answers.confirm"),
    t("common:answers.cancel")
  )
  
  if (result === t("common:answers.confirm")) {
    // 执行操作
  }
  break
```

---

**文档更新日期:** 2026 年 2 月 24 日
**项目版本:** Roo-Code-3.50.0
