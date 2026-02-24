# TTS 流式输出问题分析报告

**问题描述**: 在 LLM 流式输出过程中，即使已启用 TTS，语音合成功能也始终没有发挥作用。

**分析日期**: 2026 年 2 月 24 日

---

## 一、问题根本原因

### 1.1 核心问题

**TTS 触发条件与流式消息状态冲突**：前端 TTS 触发逻辑中有一个关键检查条件，导致流式输出期间的消息永远无法触发 TTS。

### 1.2 问题代码位置

**前端触发条件** (`webview-ui/src/components/chat/ChatView.tsx:1065`):

```typescript
useEffect(() => {
	if (lastMessage && messages.length > 1) {
		if (
			typeof lastMessage.text === "string" &&
			(lastMessage.say === "text" || lastMessage.say === "completion_result") &&
			!lastMessage.partial && // ❌ 关键问题：流式消息始终为 partial: true
			!lastMessage.text.startsWith("{")
		) {
			// TTS 触发逻辑
			playTts(text)
		}
	}
}, [isStreaming, lastMessage, wasStreaming, messages.length])
```

**后端流式发送** (`src/core/assistant-message/presentAssistantMessage.ts:292`):

```typescript
case "text": {
	let content = block.content
	if (content) {
		content = content.replace(/<thinking>\s?/g, "")
		content = content.replace(/\s?<\/thinking>/g, "")
	}
	// ❌ 关键问题：流式期间始终以 partial: true 发送
	await cline.say("text", content, undefined, block.partial)
	break
}
```

---

## 二、流式输出流程分析

### 2.1 流式消息生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│  1. API 开始流式响应                                             │
│     Task.ts: isStreaming = true                                 │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 接收文本块 (chunk)                                          │
│     presentAssistantMessage.ts:292                             │
│     await cline.say("text", content, undefined, block.partial) │
│     - block.partial = true (流式进行中)                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 创建/更新 partial 消息                                       │
│     Task.ts: say() (L1737)                                     │
│     - partial: true                                             │
│     - 发送到前端：updateClineMessage()                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 前端接收消息                                                 │
│     ChatView.tsx useEffect 触发                                │
│     检查：!lastMessage.partial → ❌ false (不触发 TTS)           │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 流式继续...重复步骤 2-4                                      │
│     每次 chunk 都更新同一个 partial 消息                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. 流式结束                                                     │
│     Task.ts:3436                                                │
│     partialBlocks.forEach((block) => (block.partial = false))   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. 更新消息为 complete                                          │
│     Task.ts: say() (L1798) - isUpdatingPreviousPartial 路径    │
│     lastMessage.partial = false                                 │
│     updateClineMessage(lastMessage)                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. 前端再次接收消息                                             │
│     ChatView.tsx useEffect 触发                                │
│     检查：!lastMessage.partial → ✓ true                        │
│     检查：text !== lastTtsRef.current → ?                      │
│     ⚠️ 问题：此时 text 可能已被前端预处理过                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 消息状态变化

| 阶段 | `partial` 状态 | TTS 触发条件 | 结果 |
|------|---------------|-------------|------|
| 流式中 | `true` | `!lastMessage.partial` = false | ❌ 不触发 |
| 流式结束 | `false` | `!lastMessage.partial` = true | ✓ 条件满足 |
| 重复检查 | `false` | `text !== lastTtsRef.current` | ⚠️ 可能失败 |

---

## 三、问题详细分析

### 3.1 流式期间的消息更新机制

**后端行为** (`presentAssistantMessage.ts:287-293`):

```typescript
// Native tool calling: text chunks are plain text.
// Create or update a text content block directly
const lastBlock = this.assistantMessageContent[this.assistantMessageContent.length - 1]
if (lastBlock?.type === "text" && lastBlock.partial) {
	lastBlock.content = assistantMessage
} else {
	this.assistantMessageContent.push({
		type: "text",
		content: assistantMessage,
		partial: true,  // ← 流式期间始终为 true
	})
	this.userMessageContentReady = false
}
presentAssistantMessage(this)
```

**每次 chunk 都会调用** `presentAssistantMessage(this)`，进而触发：

```typescript
// Task.ts: say()
await cline.say("text", content, undefined, block.partial)
// block.partial = true (流式进行中)
```

### 3.2 前端的 partial 检查

**ChatView.tsx:1065**:

```typescript
!lastMessage.partial && // not a partial message
```

这个检查的目的是**避免朗读部分消息**，因为：
- 流式期间消息内容不完整
- 朗读半句话没有意义
- 可能会重复朗读相同内容

### 3.3 流式结束后的问题

当流式结束时 (`Task.ts:3436`):

```typescript
const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
partialBlocks.forEach((block) => (block.partial = false))
```

然后调用 `say()` 更新消息 (`Task.ts:1798`):

```typescript
if (isUpdatingPreviousPartial) {
	lastMessage.text = text
	lastMessage.images = images
	lastMessage.partial = false  // ← 设置为 false
	await this.saveClineMessages()
	this.updateClineMessage(lastMessage)  // ← 发送更新到前端
}
```

**此时前端会收到更新**，但存在以下问题：

1. **依赖数组问题** (`ChatView.tsx:1089`):
```typescript
}, [isStreaming, lastMessage, wasStreaming, messages.length])
```
当 `lastMessage.partial` 从 `true` 变为 `false` 时，`lastMessage` 的引用发生变化，useEffect 会触发。

2. **重复检查可能失败**:
```typescript
if (text !== lastTtsRef.current) {
	playTts(text)
	lastTtsRef.current = text
}
```
如果 `lastTtsRef.current` 在之前的某次检查中已被设置，则不会触发 TTS。

---

## 四、触发条件对比

### 4.1 当前触发条件（存在问题）

| 条件 | 流式期间 | 流式结束后 |
|------|---------|-----------|
| `lastMessage` 存在 | ✓ | ✓ |
| `messages.length > 1` | ✓ | ✓ |
| `lastMessage.say === "text"` | ✓ | ✓ |
| `!lastMessage.partial` | ❌ **false** | ✓ |
| `!text.startsWith("{")` | ✓ | ✓ |
| `text !== lastTtsRef.current` | ? | ⚠️ 可能失败 |

**结论**: 流式期间永远无法触发，流式结束后可能因重复检查失败。

### 4.2 理想触发时机

| 时机 | 优点 | 缺点 |
|------|------|------|
| **流式期间实时朗读** | 用户体验好，听到完整内容 | 实现复杂，需要增量朗读 |
| **流式结束后朗读** | 实现简单，内容完整 | 用户需要等待 |
| **按句子朗读** | 平衡体验和实现复杂度 | 需要句子分割逻辑 |

---

## 五、解决方案建议

### 方案一：流式结束后触发（推荐，简单有效）

**修改前端逻辑**，在 `wasStreaming` 变为 `false` 时触发：

```typescript
// ChatView.tsx:1058
useEffect(() => {
	// 新增：检测从 streaming 到 non-streaming 的转变
	const wasPreviouslyStreaming = wasStreaming === true
	const isNowComplete = isStreaming === false && wasPreviouslyStreaming
	
	if (isNowComplete && lastMessage && messages.length > 1) {
		if (
			typeof lastMessage.text === "string" &&
			(lastMessage.say === "text" || lastMessage.say === "completion_result") &&
			!lastMessage.partial &&
			!lastMessage.text.startsWith("{")
		) {
			let text = lastMessage?.text || ""
			const mermaidRegex = /```mermaid[\s\S]*?```/g
			text = text.replace(mermaidRegex, "")
			text = removeMd(text)

			if (text !== lastTtsRef.current) {
				try {
					playTts(text)
					lastTtsRef.current = text
				} catch (error) {
					console.error("Failed to execute text-to-speech:", error)
				}
			}
		}
	}

	setWasStreaming(isStreaming)
}, [isStreaming, lastMessage, wasStreaming, messages.length])
```

**优点**:
- 实现简单，只需修改前端
- 确保内容完整后朗读
- 避免流式期间的重复触发

**缺点**:
- 用户需要等待流式结束才能听到

### 方案二：移除 partial 检查（不推荐）

```typescript
// 移除 !lastMessage.partial 检查
if (
	typeof lastMessage.text === "string" &&
	(lastMessage.say === "text" || lastMessage.say === "completion_result") &&
	// !lastMessage.partial &&  ← 移除
	!lastMessage.text.startsWith("{")
)
```

**问题**:
- 会导致流式期间频繁触发 TTS
- 每次 chunk 更新都会朗读
- 用户体验极差

### 方案三：增量朗读（复杂，体验最佳）

实现句子级别的增量朗读：

1. 后端按句子分割流式内容
2. 每收到一个完整句子就触发 TTS
3. 使用队列管理多个句子的朗读

**优点**: 最佳用户体验
**缺点**: 实现复杂度高，需要大量修改

---

## 六、推荐修复方案

### 6.1 修复代码

**文件**: `webview-ui/src/components/chat/ChatView.tsx`

**修改位置**: L1058-1089

```typescript
useEffect(() => {
	// This ensures the first message is not read, future user messages are
	// labeled as `user_feedback`.
	if (lastMessage && messages.length > 1) {
		// Check if streaming just completed (transition from streaming to non-streaming)
		const wasPreviouslyStreaming = wasStreaming === true
		const isNowComplete = isStreaming === false && wasPreviouslyStreaming
		
		// Only trigger TTS when streaming completes to avoid partial reads
		if (isNowComplete) {
			if (
				typeof lastMessage.text === "string" && // has text (must be string for startsWith)
				(lastMessage.say === "text" || lastMessage.say === "completion_result") && // is a text message
				!lastMessage.partial && // not a partial message
				!lastMessage.text.startsWith("{") // not a json object
			) {
				let text = lastMessage?.text || ""
				const mermaidRegex = /```mermaid[\s\S]*?```/g
				// remove mermaid diagrams from text
				text = text.replace(mermaidRegex, "")
				// remove markdown from text
				text = removeMd(text)

				// ensure message is not a duplicate of last read message
				if (text !== lastTtsRef.current) {
					try {
						playTts(text)
						lastTtsRef.current = text
					} catch (error) {
						console.error("Failed to execute text-to-speech:", error)
					}
				}
			}
		}
	}

	// Update previous value.
	setWasStreaming(isStreaming)
}, [isStreaming, lastMessage, wasStreaming, messages.length])
```

### 6.2 关键改动

1. **添加流式完成检测**:
```typescript
const wasPreviouslyStreaming = wasStreaming === true
const isNowComplete = isStreaming === false && wasPreviouslyStreaming
```

2. **仅在流式完成时触发**:
```typescript
if (isNowComplete) {
	// TTS 触发逻辑
}
```

### 6.3 测试场景

| 场景 | 预期行为 |
|------|---------|
| 正常流式输出 | 流式结束后朗读完整内容 |
| 用户打断流式 | 不触发 TTS |
| 连续多条消息 | 每条消息流式结束后依次朗读 |
| 工具调用场景 | 工具执行后的文本消息正常朗读 |

---

## 七、相关文件索引

| 文件 | 路径 | 作用 |
|------|------|------|
| **前端触发逻辑** | `webview-ui/src/components/chat/ChatView.tsx` | TTS 触发条件检查 (L1058-1089) |
| **后端流式发送** | `src/core/assistant-message/presentAssistantMessage.ts` | 流式消息发送 (L292) |
| **消息状态管理** | `src/core/task/Task.ts` | partial 状态管理 (L1737, L3436) |
| **TTS 核心实现** | `src/utils/tts.ts` | TTS 播放队列 (L29, L44) |
| **消息处理** | `src/core/webview/webviewMessageHandler.ts` | playTts 消息处理 (L1154) |

---

## 八、总结

### 问题根源

TTS 在流式输出期间无法触发的根本原因是：
1. **流式期间消息始终为 `partial: true`**
2. **前端检查条件 `!lastMessage.partial` 永远为 false**
3. **流式结束后，重复检查 `text !== lastTtsRef.current` 可能失败**

### 修复策略

采用**流式结束后触发**策略：
- 检测 `wasStreaming → !isStreaming` 的状态转变
- 确保消息内容完整后朗读
- 避免流式期间的频繁触发

### 预期效果

修复后：
- ✓ 流式输出结束后自动朗读
- ✓ 避免朗读部分消息
- ✓ 用户体验清晰可预期
