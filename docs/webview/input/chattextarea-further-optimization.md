# ChatTextArea 进一步性能优化方案

## 背景

在移除输入高亮功能后（见 `webview-input-optimization.md`），ChatTextArea 组件的输入卡顿问题已得到显著改善。但分析表明，当前实现仍存在进一步优化空间。

## 当前架构分析

### 受控组件模式

```typescript
<DynamicTextArea
  value={inputValue}           // 受控于 React state
  onChange={(e) => {
    handleInputChange(e)       // 每次输入触发 state 更新
  }}
/>
```

### 每次输入触发的状态更新

| 状态 | 更新频率 | 用途 |
|------|----------|------|
| `inputValue` | 每次按键 | 存储输入文本 |
| `cursorPosition` | 每次按键 | 跟踪光标位置 |
| `showContextMenu` | 每次按键 | 控制菜单显示 |
| `searchQuery` | 每次按键 | 菜单搜索词 |
| `selectedMenuIndex` | 条件触发 | 菜单选中项 |
| `fileSearchResults` | 防抖 200ms | 文件搜索结果 |

### 核心功能依赖

以下功能**必须**保持受控模式：

1. **@mention 自动补全**：实时解析 `@` 后文本
2. **/command 插入**：在特定位置插入命令
3. **提及删除处理**：Backspace 检查提及后空格
4. **文件拖拽插入**：在 cursor 位置插入路径
5. **历史导航**：箭头键浏览历史消息

## 优化方案

### 方案 1：批量状态更新（推荐优先实施）

**目标**：减少 React 重渲染次数

**问题**：当前 `handleInputChange` 中多个 `setState` 调用会触发多次重渲染

**实现**：

```typescript
import { unstable_batchedUpdates } from 'react-dom'

const handleInputChange = useCallback(
  (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart

    // 批量所有状态更新
    unstable_batchedUpdates(() => {
      setInputValue(newValue)
      setCursorPosition(newCursorPosition)

      const showMenu = shouldShowContextMenu(newValue, newCursorPosition)
      setShowContextMenu(showMenu)

      if (showMenu) {
        if (newValue.startsWith("/") && !newValue.includes(" ")) {
          setSearchQuery(newValue)
          setSelectedMenuIndex(1)
          vscode.postMessage({ type: "requestCommands" })
        } else {
          const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
          const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
          setSearchQuery(query)

          if (query.length > 0) {
            setSelectedMenuIndex(0)
            // ... 文件搜索逻辑
          } else {
            setSelectedMenuIndex(3)
          }
        }
      } else {
        setSearchQuery("")
        setSelectedMenuIndex(-1)
        setFileSearchResults([])
      }
    })

    // 非紧急更新放到微任务
    queueMicrotask(() => {
      resetOnInputChange()
    })
  },
  [setInputValue, setSearchRequestId, setFileSearchResults, setSearchLoading, resetOnInputChange]
)
```

**预期效果**：
- 将 3-5 次重渲染合并为 1 次
- 减少约 60-70% 的渲染开销

**实施难度**：低

---

### 方案 2：React.memo 缓存子组件

**目标**：避免不必要的子组件重渲染

**问题**：`ContextMenu`、`ModeSelector` 等子组件在父组件每次输入时都重新渲染

**实现**：

```typescript
// 1. 缓存 ContextMenu
const MemoizedContextMenu = React.memo(
  ContextMenu,
  (prevProps, nextProps) => {
    // 仅在关键 props 变化时重新渲染
    return (
      prevProps.searchQuery === nextProps.searchQuery &&
      prevProps.selectedIndex === nextProps.selectedIndex &&
      prevProps.selectedType === nextProps.selectedType &&
      prevProps.loading === nextProps.loading &&
      prevProps.dynamicSearchResults === nextProps.dynamicSearchResults
    )
  }
)

// 2. 缓存 queryItems（已使用 useMemo，确保引用稳定）
const queryItems = useMemo(() => {
  return [
    { type: ContextMenuOptionType.Problems, value: "problems" },
    { type: ContextMenuOptionType.Terminal, value: "terminal" },
    ...gitCommits,
    // ...
  ]
}, [filePaths, gitCommits, openedTabs])

// 3. 在 JSX 中使用
<MemoizedContextMenu
  onSelect={handleMentionSelect}
  searchQuery={searchQuery}
  inputValue={inputValue}  // 移除不需要的 prop
  selectedIndex={selectedMenuIndex}
  // ...
/>
```

**预期效果**：
- 减少约 30-40% 的子组件渲染
- 降低整体渲染深度

**实施难度**：中

---

### 方案 3：光标位置状态延迟同步

**目标**：将非关键状态更新与输入解耦

**问题**：`cursorPosition` 状态在每次输入时立即更新，但实际仅在某些场景（如提及删除）需要精确值

**实现**：

```typescript
// 使用 Ref 存储实时光标位置（不触发重渲染）
const cursorPositionRef = useRef(0)

// 仅在需要时读取
const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  const currentCursorPos = textAreaRef.current?.selectionStart || 0
  cursorPositionRef.current = currentCursorPos

  // 使用 Ref 值而非 state
  if (event.key === "Backspace" && !isComposing) {
    const charBeforeCursor = inputValue[cursorPositionRef.current - 1]
    // ...
  }
}, [inputValue])

// 仅在必要时同步到 state（如提及删除后）
const updateCursorPositionState = useCallback(() => {
  if (textAreaRef.current) {
    setCursorPosition(textAreaRef.current.selectionStart)
    cursorPositionRef.current = textAreaRef.current.selectionStart
  }
}, [])

// 在关键事件中使用
onSelect={updateCursorPositionState}
onMouseUp={updateCursorPositionState}
```

**预期效果**：
- 减少约 20% 的状态更新
- 输入更流畅

**实施难度**：中

---

### 方案 4：输入值异步同步（高级方案）

**目标**：将 React 状态同步延迟到微任务，优先保证 DOM 响应

**核心思路**：
1. 输入事件不立即更新 `inputValue` state
2. 使用 `queueMicrotask` 延迟同步
3. 在需要同步值的场景（如发送消息）使用 Ref

**实现框架**：

```typescript
// 1. 添加 Ref 存储最新值
const inputValueRef = useRef("")

// 2. 修改 onChange 处理
onChange={(e) => {
  const value = e.target.value
  inputValueRef.current = value  // 立即更新 Ref

  // 延迟更新 state（触发重渲染）
  queueMicrotask(() => {
    setInputValue(value)
  })

  // 其他逻辑使用 Ref 值
  handleInputChangeImmediate(e, value)
}}

// 3. 发送消息时使用 Ref
const handleSendMessage = useCallback(() => {
  const text = inputValueRef.current.trim()  // 使用 Ref
  if (text) {
    vscode.postMessage({ type: "sendMessage", text })
    setInputValue("")
    inputValueRef.current = ""
  }
}, [])
```

**风险**：
- 可能导致 UI 与实际值短暂不同步
- 需要仔细审查所有 `inputValue` 使用位置
- 调试复杂度增加

**预期效果**：
- 输入响应延迟降低约 30-40%
- 感知流畅度显著提升

**实施难度**：高

---

### 方案 5：非受控组件模式（激进方案）

**目标**：完全放弃受控模式，使用原生 DOM 操作

**适用场景**：如果上述优化仍无法满足性能需求

**实现框架**：

```typescript
const ChatTextAreaUncontrolled: React.FC<Props> = ({
  onValueChange,  // 回调替代 state
  onSendMessage,
  // ...
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // 提及插入：直接操作 DOM
  const insertMention = useCallback((text: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    // 使用 setRangeText 增量更新
    textarea.setRangeText(text + " ", start, end, 'end')

    // 更新光标位置
    const newPos = start + text.length + 1
    textarea.setSelectionRange(newPos, newPos)
    textarea.focus()

    // 通知父组件（异步）
    queueMicrotask(() => {
      onValueChange?.(textarea.value)
    })
  }, [onValueChange])

  // 提及删除：监听 Backspace
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const textarea = textareaRef.current
    if (!textarea || e.key !== "Backspace") return

    const pos = textarea.selectionStart
    const value = textarea.value

    // 检查是否删除提及后的空格
    if (value[pos - 1] === " " || value[pos - 1] === "\n") {
      const beforeCursor = value.slice(0, pos - 1)
      if (mentionRegex.test(beforeCursor)) {
        e.preventDefault()
        // 删除整个提及
        const match = beforeCursor.match(mentionRegex)
        if (match) {
          const newPos = pos - 1 - match[0].length
          textarea.setRangeText("", newPos, pos - 1, 'end')
          textarea.setSelectionRange(newPos, newPos)
          onValueChange?.(textarea.value)
        }
      }
    }
  }, [onValueChange])

  // 发送消息：读取 DOM 值
  const handleSend = useCallback(() => {
    const text = textareaRef.current?.value.trim() || ""
    if (text) {
      onSendMessage?.(text)
      textareaRef.current!.value = ""
      onValueChange?.("")
    }
  }, [onSendMessage, onValueChange])

  return (
    <div>
      <textarea
        ref={textareaRef}
        onKeyDown={handleKeyDown}
        onChange={() => {
          // 不触发重渲染，仅通知
          queueMicrotask(() => {
            onValueChange?.(textareaRef.current!.value)
          })
        }}
        // ...
      />
      {/* ContextMenu 独立管理状态 */}
    </div>
  )
}
```

**优势**：
- 输入完全不触发 React 重渲染
- DOM 操作为增量式，性能最优

**劣势**：
- 需要完全重写交互逻辑
- 状态同步复杂，易引入 bug
- 与父组件集成成本高

**实施难度**：极高

---

## 推荐实施方案

### 第一阶段：快速优化（预期性能提升 40-50%）

1. **批量状态更新**（`unstable_batchedUpdates`）
   - 实施难度：低
   - 风险：低
   - 预期收益：高

2. **React.memo 缓存子组件**
   - 实施难度：中
   - 风险：低
   - 预期收益：中

### 第二阶段：深度优化（预期额外性能提升 20-30%）

3. **光标位置状态延迟同步**
   - 实施难度：中
   - 风险：中
   - 预期收益：中

4. **输入值异步同步**
   - 实施难度：高
   - 风险：中高
   - 预期收益：高

### 第三阶段：架构重构（仅在必要时）

5. **非受控组件模式**
   - 实施难度：极高
   - 风险：高
   - 预期收益：极高
   - **建议**：仅当前四阶段优化后仍无法满足性能需求时考虑

---

## 实施步骤

### 步骤 1：添加批量状态更新

修改 `ChatTextArea.tsx` 中的 `handleInputChange`：

```typescript
import { unstable_batchedUpdates } from 'react-dom'

// 在组件内部
const handleInputChange = useCallback(
  (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart

    unstable_batchedUpdates(() => {
      setInputValue(newValue)
      setCursorPosition(newCursorPosition)

      const showMenu = shouldShowContextMenu(newValue, newCursorPosition)
      setShowContextMenu(showMenu)

      // ... 其余逻辑
    })

    // 非紧急操作延迟
    queueMicrotask(() => {
      resetOnInputChange()
    })
  },
  [/* dependencies */]
)
```

### 步骤 2：缓存 ContextMenu

```typescript
// 在 ChatTextArea.tsx 外部
const MemoizedContextMenu = React.memo(
  ContextMenu,
  (prevProps, nextProps) => {
    return (
      prevProps.searchQuery === nextProps.searchQuery &&
      prevProps.selectedIndex === nextProps.selectedIndex &&
      prevProps.selectedType === nextProps.selectedType &&
      prevProps.loading === nextProps.loading &&
      prevProps.dynamicSearchResults === nextProps.dynamicSearchResults &&
      prevProps.commands === nextProps.commands
    )
  }
)

// 在 JSX 中替换
<MemoizedContextMenu {...props} />
```

### 步骤 3：测试验证

```bash
cd webview-ui
pnpm test -- src/components/chat/__tests__/ChatTextArea.spec.tsx
pnpm check-types
```

---

## 性能对比预期

| 优化阶段 | 重渲染次数 | 输入延迟 | 实施难度 |
|----------|------------|----------|----------|
| 当前（移除高亮后） | ~3-5 次/按键 | 中等 | - |
| 阶段 1（批量更新 + memo） | ~1-2 次/按键 | 低 | 低 |
| 阶段 2（光标延迟） | ~1 次/按键 | 很低 | 中 |
| 阶段 3（异步同步） | <1 次/按键（平均） | 极低 | 高 |
| 阶段 4（非受控） | 0 次/按键 | 原生级别 | 极高 |

---

## 风险评估

| 方案 | 风险等级 | 缓解措施 |
|------|----------|----------|
| 批量状态更新 | 低 | React 官方 API，广泛使用 |
| React.memo | 低 | 需确保 props 引用稳定 |
| 光标延迟同步 | 中 | 需全面测试提及删除场景 |
| 输入异步同步 | 中高 | 需审查所有 inputValue 使用位置 |
| 非受控模式 | 高 | 需完整回归测试 |

---

## 相关代码位置

| 文件 | 行号 | 说明 |
|------|------|------|
| `ChatTextArea.tsx` | 583-648 | `handleInputChange` 函数 |
| `ChatTextArea.tsx` | 947-963 | ContextMenu 渲染 |
| `ChatTextArea.tsx` | 274-293 | `queryItems` useMemo |
| `ChatTextArea.tsx` | 509-545 | `handleKeyDown` 提及删除 |
| `ChatView.tsx` | 132-133 | `inputValue` state 定义 |

---

## 参考文档

- [React unstable_batchedUpdates](https://react.dev/reference/react-dom/unstable_batchedUpdates)
- [React.memo](https://react.dev/reference/react/memo)
- [Controlled vs Uncontrolled Components](https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components)
- [React Performance Optimization](https://react.dev/learn/render-and-commit#react-skips-expensive-work)

---

## 更新历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-25 | 1.0 | 初始版本，基于移除高亮功能后的进一步优化方案 |
