# TTS 触发机制深度分析

**文档版本**: 1.0  
**分析日期**: 2026 年 2 月 24 日  
**基于代码版本**: Roo-Code-3.50.0

---

## 一、触发流程总览

TTS（Text-to-Speech）功能的触发是一个**前端监听 + 后端执行**的完整链路：

```
┌─────────────────────────────────────────────────────────────────┐
│  1. 后端 Task 生成消息                                           │
│     src/core/task/Task.ts: say()                               │
│     - 类型："text" 或 "completion_result"                        │
│     - 调用 addToClineMessages()                                │
│     - 发送 messageUpdated 事件到 Webview                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 前端接收消息                                                 │
│     webview-ui/src/components/chat/ChatView.tsx                │
│     - useEffect 监听 [isStreaming, lastMessage, ...]           │
│     - 检查条件：                                                │
│       ✓ messages.length > 1                                    │
│       ✓ lastMessage.say === "text" | "completion_result"       │
│       ✓ !lastMessage.partial (非部分消息)                       │
│       ✓ !text.startsWith("{") (非 JSON 对象)                     │
│       ✓ text !== lastTtsRef.current (非重复消息)                │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 前端文本预处理                                               │
│     - 移除 Mermaid 图表：/```mermaid[\s\S]*?```/g                │
│     - 移除 Markdown 格式：removeMd()                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 发送 TTS 播放请求到后端                                       │
│     vscode.postMessage({ type: "playTts", text })              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 后端处理播放请求                                             │
│     src/core/webview/webviewMessageHandler.ts:1154-1165        │
│     case "playTts":                                            │
│       playTts(message.text, {                                  │
│         onStart: () => postMessageToWebview({ type: "ttsStart" }) │
│         onStop: () => postMessageToWebview({ type: "ttsStop" })   │
│       })                                                       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. TTS 队列处理                                                 │
│     src/utils/tts.ts: processQueue()                           │
│     - 检查 isTtsEnabled && !sayInstance                         │
│     - 从队列取出消息                                            │
│     - 调用 say.speak(text, undefined, speed, callback)         │
│     - 跨平台实现：                                              │
│       • macOS: say 命令                                         │
│       • Windows: PowerShell SpeechSynthesizer                  │
│       • Linux: festival/espeak                                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. 状态同步回前端                                               │
│     - ttsStart: 前端设置 isTtsPlaying = true                   │
│     - ttsStop: 前端设置 isTtsPlaying = false                   │
│     - 递归处理队列中的下一条消息                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、核心触发条件

### 2.1 前端触发条件（ChatView.tsx:1058-1084）

TTS 播放需要**同时满足**以下所有条件：

| 条件 | 代码检查 | 说明 |
|------|----------|------|
| **消息存在** | `lastMessage && messages.length > 1` | 确保有最后一条消息且非首条 |
| **文本类型** | `lastMessage.say === "text" \| "completion_result"` | 仅朗读文本类消息 |
| **完整消息** | `!lastMessage.partial` | 不朗读部分/流式消息 |
| **非 JSON** | `!text.startsWith("{")` | 排除 JSON 对象 |
| **非重复** | `text !== lastTtsRef.current` | 避免重复朗读同一条消息 |
| **TTS 启用** | `isTtsEnabled === true` | 后端检查全局开关 |

### 2.2 后端执行条件（tts.ts:29-35）

```typescript
export const playTts = async (message: string, options: PlayTtsOptions = {}) => {
	if (!isTtsEnabled) {
		return
	}
	try {
		queue.push({ message, options })
		await processQueue()
	} catch (error) { }
}
```

| 条件 | 说明 |
|------|------|
| **全局启用** | `isTtsEnabled === true` |
| **队列可用** | 无并发播放实例 (`!sayInstance`) |

---

## 三、核心代码位置

### 3.1 消息生成层

| 组件 | 文件路径 | 关键函数 | 行号 |
|------|----------|----------|------|
| **消息生成** | `src/core/task/Task.ts` | `say()` | L1737 |
| **消息分发** | `src/core/task/Task.ts` | `updateClineMessage()` | L1182 |
| **消息持久化** | `src/core/task/Task.ts` | `addToClineMessages()` | - |

### 3.2 前端监听层

| 组件 | 文件路径 | 关键函数 | 行号 |
|------|----------|----------|------|
| **消息监听** | `webview-ui/src/components/chat/ChatView.tsx` | `useEffect` | L1058 |
| **TTS 发送** | `webview-ui/src/components/chat/ChatView.tsx` | `playTts()` | L250 |
| **状态管理** | `webview-ui/src/context/ExtensionStateContext.tsx` | TTS 状态 | - |

### 3.3 后端处理层

| 组件 | 文件路径 | 关键函数 | 行号 |
|------|----------|----------|------|
| **消息处理** | `src/core/webview/webviewMessageHandler.ts` | `case "playTts"` | L1154 |
| **TTS 播放** | `src/utils/tts.ts` | `playTts()` | L29 |
| **队列处理** | `src/utils/tts.ts` | `processQueue()` | L44 |
| **状态同步** | `src/core/webview/ClineProvider.ts` | `postMessageToWebview()` | L1041 |

### 3.4 系统 API 层

| 组件 | 文件路径 | 关键函数 |
|------|----------|----------|
| **跨平台封装** | `say` npm 包 | `say.speak()` |
| **macOS** | 系统命令 | `say` |
| **Windows** | PowerShell | `SpeechSynthesizer` |
| **Linux** | 外部工具 | `festival` / `espeak` |

---

## 四、消息类型与 TTS 触发

### 4.1 触发 TTS 的消息类型

```typescript
// Task.ts 中调用 say() 的类型
await this.say("text", task, images)              // 任务描述
await this.say("completion_result", result)       // 完成结果
```

### 4.2 不触发 TTS 的消息类型

| 类型 | 说明 |
|------|------|
| `api_req_started` | API 请求开始 |
| `api_req_finished` | API 请求结束 |
| `error` | 错误消息 |
| `reasoning` | 推理过程 |
| `tool_use` | 工具使用 |
| `partial: true` | 部分/流式消息 |

---

## 五、文本预处理流程

### 5.1 移除 Mermaid 图表

```typescript
// ChatView.tsx:1070
const mermaidRegex = /```mermaid[\s\S]*?```/g
text = text.replace(mermaidRegex, "")
```

**目的**: 避免朗读 Mermaid 代码块内容

### 5.2 移除 Markdown 格式

```typescript
// ChatView.tsx:1072
text = removeMd(text)
```

**目的**: 移除 `**bold**`, `_italic_`, `# heading` 等格式标记

### 5.3 removeMd 函数实现

位于 `webview-ui/src/utils/removeMd.ts`，处理常见 Markdown 语法。

---

## 六、队列管理机制

### 6.1 队列数据结构

```typescript
// src/utils/tts.ts:13-15
type QueueItem = {
	message: string
	options: PlayTtsOptions
}
let queue: QueueItem[] = []
```

### 6.2 队列处理逻辑

```typescript
// src/utils/tts.ts:44-81
const processQueue = async (): Promise<void> => {
	// 1. 检查是否启用且当前无播放实例
	if (!isTtsEnabled || sayInstance) {
		return
	}

	// 2. 取出队列中的下一个项目
	const item = queue.shift()
	if (!item) {
		return
	}

	// 3. 调用系统 API 播放
	try {
		await new Promise<void>((resolve, reject) => {
			const say: Say = require("say")
			sayInstance = say
			options.onStart?.()

			say.speak(nextUtterance, undefined, speed, (err) => {
				options.onStop?.()
				if (err) {
					reject(new Error(err))
				} else {
					resolve()
				}
				sayInstance = undefined
			})
		})

		// 4. 递归处理下一个队列项目
		await processQueue()
	} catch (error: any) {
		sayInstance = undefined
		await processQueue() // 出错后继续处理下一个
	}
}
```

### 6.3 设计优势

| 特性 | 说明 |
|------|------|
| **串行播放** | 避免多个语音同时播放 |
| **错误容错** | 单条失败不影响后续 |
| **状态重置** | 出错后重置 `sayInstance`，避免死锁 |
| **递归处理** | 自动播放队列中所有消息 |

---

## 七、状态管理与持久化

### 7.1 全局状态变量

```typescript
// src/utils/tts.ts:16-25
let isTtsEnabled = false      // TTS 开关状态
let speed = 1.0               // 语速（0.5-2.0）
let sayInstance: Say | undefined = undefined  // 当前播放实例
let queue: QueueItem[] = []   // 播放队列
```

### 7.2 VSCode 设置集成

| 设置项 | 类型 | 默认值 | 存储位置 |
|--------|------|--------|----------|
| `ttsEnabled` | boolean | false | `context.globalState` |
| `ttsSpeed` | number | 1.0 | `context.globalState` |

### 7.3 设置变更流程

```typescript
// webviewMessageHandler.ts:1142-1153
case "ttsEnabled":
	const ttsEnabled = message.bool ?? true
	await updateGlobalState("ttsEnabled", ttsEnabled)
	setTtsEnabled(ttsEnabled)
	await provider.postStateToWebview()
	break

case "ttsSpeed":
	const ttsSpeed = message.value ?? 1.0
	await updateGlobalState("ttsSpeed", ttsSpeed)
	setTtsSpeed(ttsSpeed)
	await provider.postStateToWebview()
	break
```

---

## 八、跨平台实现细节

### 8.1 macOS

**底层命令**:
```bash
say -v ?  # 列出可用语音
say "Hello" -v Alex -r 200  # 使用 Alex 语音，速率 200 词/分钟
```

**Node.js 调用**:
```javascript
const { exec } = require('child_process')
exec(`say "${text}"`, callback)
```

### 8.2 Windows

**PowerShell 脚本**:
```powershell
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Speak("Hello World")
```

**Node.js 调用**:
```javascript
const { exec } = require('child_process')
const psScript = `
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = ${speed * 10 - 10}
  $synth.Speak("${text}")
`
exec(`powershell -Command "${psScript}"`, callback)
```

### 8.3 Linux

**依赖要求**:
- Debian/Ubuntu: `apt-get install festival`
- 或：`apt-get install espeak`

**命令调用**:
```bash
festival --tts <(echo "Hello World")  # Festival
espeak "Hello World" -s 150  # eSpeak，速度 150 词/分钟
```

---

## 九、错误处理与容错

### 9.1 错误处理机制

```typescript
// src/utils/tts.ts:77-80
catch (error: any) {
	sayInstance = undefined
	await processQueue()  // 出错后继续处理下一个
}
```

### 9.2 常见错误场景

| 场景 | 原因 | 处理方式 |
|------|------|----------|
| **命令未找到** | Linux 未安装 festival/espeak | 静默失败，继续下一条 |
| **特殊字符** | 文本包含 shell 特殊字符 | 捕获错误，继续队列 |
| **权限不足** | 无法执行系统命令 | 静默失败 |

### 9.3 容错设计

1. **静默失败**: 所有错误被 catch，不抛出异常
2. **队列继续**: 单个文本播放失败不影响后续文本
3. **状态重置**: 出错后重置 `sayInstance`，避免死锁

---

## 十、性能与限制

### 10.1 性能特点

| 优点 | 缺点 |
|------|------|
| 直接调用系统 API，延迟低 | 语音质量受限于系统 TTS 引擎 |
| 无需网络请求，离线可用 | 无法自定义语音模型 |
| 不消耗额外 API 配额 | 跨平台体验不一致 |

### 10.2 使用限制

**平台限制**:
- Linux 需要手动安装 TTS 软件
- Windows 需要.NET Framework 支持
- macOS 语音选择有限

**功能限制**:
- 不支持 SSML 标记语言
- 无法调整音调（pitch）
- 不支持情感表达

---

## 十一、调试与测试

### 11.1 调试技巧

1. **检查 TTS 状态**:
```typescript
// 在浏览器控制台（Webview DevTools）
console.log('TTS Enabled:', ttsEnabled)
console.log('TTS Speed:', ttsSpeed)
```

2. **监听 TTS 事件**:
```typescript
// ChatView.tsx 中添加
useEffect(() => {
	const handler = (e: MessageEvent) => {
		if (e.data.type === 'ttsStart') {
			console.log('TTS started:', e.data.text)
		} else if (e.data.type === 'ttsStop') {
			console.log('TTS stopped:', e.data.text)
		}
	}
	window.addEventListener('message', handler)
	return () => window.removeEventListener('message', handler)
}, [])
```

### 11.2 测试用例

位于 `src/utils/__tests__/tts-debug.spec.ts`:

```typescript
describe('playTts', () => {
	it('should play text-to-speech when enabled', async () => {
		setTtsEnabled(true)
		await playTts('Hello World', {
			onStart: () => console.log('started'),
			onStop: () => console.log('stopped'),
		})
	})
})
```

---

## 十二、扩展建议

### 12.1 短期改进

1. **添加语音选择功能**:
```typescript
interface Say {
	getInstalledVoices?: (callback: (err?: string, voices?: string[]) => void) => void
}
```

2. **添加预览功能**:
```typescript
// NotificationSettings 组件中
const handleTestTts = () => {
	vscode.postMessage({
		type: "playTts",
		text: "This is a test of text to speech."
	})
}
```

### 12.2 中期改进

1. **平台特定优化**:
   - macOS: 添加语音选择 UI
   - Windows: 调整语速映射
   - Linux: 自动检测可用引擎

2. **错误提示优化**:
```typescript
catch (error: any) {
	if (error.message.includes('command not found')) {
		vscode.window.showWarningMessage(
			'TTS requires festival or espeak to be installed.'
		)
	}
	await processQueue()
}
```

### 12.3 长期改进

1. **云端 TTS 集成**: 作为可选项支持 Azure/Google/AWS TTS
2. **SSML 支持**: 支持语音合成标记语言
3. **多语言自动检测**: 根据文本语言自动选择语音

---

## 十三、总结

### 13.1 架构优势

| 特性 | 说明 |
|------|------|
| **解耦设计** | 前端仅发送消息，后端处理具体 TTS 逻辑 |
| **队列管理** | 支持连续播放，避免并发问题 |
| **状态同步** | 前后端状态通过消息机制保持一致 |
| **跨平台兼容** | 通过 `say` 模块屏蔽平台差异 |

### 13.2 触发机制核心

TTS 触发是一个**条件驱动**的过程：

1. **后端生成** → `say("text" | "completion_result")`
2. **前端监听** → `useEffect` 检查触发条件
3. **文本预处理** → 移除 Mermaid 和 Markdown
4. **消息回传** → `vscode.postMessage({ type: "playTts" })`
5. **队列播放** → `processQueue()` 串行处理
6. **状态同步** → `ttsStart`/`ttsStop` 事件

### 13.3 适用场景

**适合**:
- 简单的通知和提示音
- 开发环境内的辅助功能
- 离线使用场景

**不适合**:
- 需要高质量语音的应用
- 多语言复杂场景
- 需要自定义语音品牌的场景

---

## 附录：相关文件索引

| 文件 | 路径 | 作用 |
|------|------|------|
| `tts.ts` | `src/utils/tts.ts` | TTS 核心实现 |
| `webviewMessageHandler.ts` | `src/core/webview/webviewMessageHandler.ts` | 消息路由处理 |
| `ChatView.tsx` | `webview-ui/src/components/chat/ChatView.tsx` | 前端消息监听与触发 |
| `Task.ts` | `src/core/task/Task.ts` | 消息生成源头 |
| `ClineProvider.ts` | `src/core/webview/ClineProvider.ts` | Webview 通信桥接 |
| `NotificationSettings.tsx` | `webview-ui/src/components/settings/NotificationSettings.tsx` | TTS 设置 UI |

---

**参考文档**:
- [TTS 系统 API 集成深度分析](./tts-system-api-integration.md)
- [Say npm 包文档](https://www.npmjs.com/package/say)
