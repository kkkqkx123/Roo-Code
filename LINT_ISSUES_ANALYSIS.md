# Lint Issues Analysis Report

## Overview

**Total Issues**: 56 warnings (0 errors)  
**Failed Package**: `@coder/vscode-webview`  
**Date**: 2026-03-03

All issues are in the `webview-ui` package. The main `coder-roo` package and shared packages (`@coder/core`, `@coder/ipc`, `@coder/types`) pass linting successfully.

---

## Issue Categories

### 1. `react-hooks/set-state-in-effect` (17 occurrences) ⚠️ **HIGH PRIORITY**

**Description**: Calling `setState` synchronously within an effect can trigger cascading renders.

**Affected Files**:
| File | Line | Issue |
|------|------|-------|
| `App.tsx` | 144 | `setShowAnnouncement(true)` |
| `ContextMenu.tsx` | 73 | `setMaterialIconsBaseUri(...)` |
| `FileChangesPanel.tsx` | 26 | `setExpandedPaths(new Set())` |
| `FollowUpSuggest.tsx` | 55 | `setCountdown(...)` |
| `McpExecution.tsx` | 170 | `setArgumentsText(text)` |
| `usePromptHistory.ts` | 74 | `setPromptHistory(...)`, `setHistoryIndex(-1)`, `setTempInput("")` |
| `DiffView.tsx` | 108 | `setProcessedHunks(hunks)` |
| `FormattedTextField.tsx` | 37 | `setRawInput(formatter.format(value))` |
| `MermaidBlock.tsx` | 100 | `setIsLoading(true)`, `setError(null)` |
| `Thumbnails.tsx` | 26 | `setHoveredIndex(null)` |
| `useTaskSearch.ts` | 18 | `setLastNonRelevantSort(...)`, `setSortOption(...)` |
| `ApiConfigManager.tsx` | 93 | `resetCreateState()`, `resetRenameState()` |
| `ApiOptions.tsx` | 75 | `setCustomHeaders(...)` |
| `CustomToolsSettings.tsx` | 43 | `setTools([])` |
| `SettingsSearch.tsx` | 83 | `setHighlightedResultId(undefined)` |
| `SettingsView.tsx` | 490 | `setActiveTab(...)` |
| `TemperatureControl.tsx` | 25 | `setIsCustomTemperature(...)`, `setInputValue(...)` |

**Root Cause**: Direct `setState` calls in `useEffect` bodies cause cascading renders.

**Fix Strategy**:
1. **Derive state from props/other state** instead of storing in separate state
2. **Use event handlers** instead of effects when possible
3. **Move state updates to callbacks** (e.g., `onMount`, `onChange`)
4. **Use `useLayoutEffect`** if the update must happen synchronously before paint
5. **Consider removing unnecessary state** and computing values directly

---

### 2. `react-hooks/refs` (8 occurrences) ⚠️ **HIGH PRIORITY**

**Description**: Accessing ref values (`.current`) during render can cause unexpected behavior.

**Affected Files**:
| File | Lines | Issue |
|------|-------|-------|
| `ChatView.tsx` | 956-1042 | Passing ref to `filter()` and `forEach()` during render |
| `MermaidButton.tsx` | 195-196 (×5) | Accessing `containerRef.current.innerHTML` in JSX |

**Root Cause**: Ref values are being read during the render phase, which violates React's rules.

**Fix Strategy**:
1. **Move ref access to effects** or event handlers
2. **Use state** if the value needs to trigger a re-render
3. **Use callbacks** to capture ref values outside render
4. **Store ref values in state** when they change

**Example Fix for ChatView.tsx**:
```tsx
// ❌ Bad: Accessing ref during render
const visibleMessages = useMemo(() => {
  return messages.filter(msg => !everVisibleMessagesTsRef.current.has(msg.ts))
}, [messages])

// ✅ Good: Move ref access to effect
useEffect(() => {
  messages.forEach(msg => {
    if (!everVisibleMessagesTsRef.current.has(msg.ts)) {
      everVisibleMessagesTsRef.current.set(msg.ts, true)
    }
  })
}, [messages])
```

---

### 3. `react-hooks/exhaustive-deps` (10 occurrences) ⚠️ **MEDIUM PRIORITY**

**Description**: React hooks have missing or unnecessary dependencies.

**Affected Files**:
| File | Lines | Missing Dependencies | Unnecessary Dependencies |
|------|-------|---------------------|-------------------------|
| `App.tsx` | 88 | - | `mdmCompliant` |
| `ChatView.tsx` | 458, 468, 579, 779, 828, 923 | `setPrimaryButtonText`, `setSecondaryButtonText`, `setClineAsk`, `setEnableButtons`, `setSendingDisabled` | `apiConfiguration.apiProvider` |
| `CodeIndexPopover.tsx` | 415 | `setOpen` | - |

**Root Cause**: Dependencies arrays are incomplete or include values that don't need to trigger re-creation.

**Fix Strategy**:
1. **Add missing setter functions** to dependency arrays (they are stable)
2. **Remove unnecessary dependencies** that don't affect the callback
3. **Use functional updates** (`setState(prev => ...)`) to avoid dependency on state values
4. **Consider using `useRef`** for values that shouldn't trigger re-creation

---

### 4. `react-hooks/preserve-manual-memoization` (3 occurrences) ⚠️ **MEDIUM PRIORITY**

**Description**: React Compiler cannot preserve existing manual memoization due to dependency mismatches.

**Affected Files**:
| File | Lines | Issue |
|------|-------|-------|
| `CodeIndexPopover.tsx` | 411 | `handlePopoverClose` - inferred dep: `setOpen`, source deps: `[checkUnsavedChanges]` |
| `McpExecution.tsx` | 95 | `argumentsData` - memoization could not be preserved (×2) |

**Root Cause**: Manual `useMemo`/`useCallback` dependencies don't match what React Compiler infers.

**Fix Strategy**:
1. **Fix the underlying dependency array** to include all required dependencies
2. **Remove manual memoization** and let React Compiler handle it
3. **Restructure the code** to make dependencies explicit

---

### 5. `react-hooks/immutability` (4 occurrences) ⚠️ **MEDIUM PRIORITY**

**Description**: Modifying variables defined outside a component/hook is not allowed.

**Affected Files**:
| File | Lines | Issue |
|------|-------|-------|
| `ChatView.scroll-debug-repro.spec.tsx` | 148-150 | Modifying `harness.followOutput`, `harness.initialTopMostItemIndex`, `harness.emitAtBottom` |
| `useScrollLifecycle.ts` | 188 | `finishHydrationWindow` accessed before declaration |

**Root Cause**: Test code modifies harness object properties directly; circular dependency in hook.

**Fix Strategy**:
1. **Use refs** for test harness modifications
2. **Reorder declarations** to avoid forward references
3. **Use effect callbacks** instead of direct assignments

---

### 6. `@typescript-eslint/no-unused-vars` (9 occurrences) ⚠️ **LOW PRIORITY**

**Description**: Variables are declared but never used.

**Affected Files**:
| File | Lines | Unused Variable |
|------|-------|-----------------|
| `CodeIndexPopover.tsx` | 177, 330 | `setOpenLocal`, `handleUpdateSetting` |
| `ChatView.tts-streaming.spec.tsx` | 4, 95 (×2) | `act`, `props`, `ref` |
| `TaskItemFooter.tsx` | 21 | `variant` (arg) |
| `ApiOptions.tsx` | 57, 64 | `uriScheme` (arg), `extensionState` |
| `ApiOptions.provider-filtering.spec.tsx` | 6-10 | `useExtensionState`, `useSelectedModel`, `MODELS_BY_PROVIDER`, `PROVIDERS` |
| `providerModelConfig.ts` | 1 | `ProviderSettings` |

**Fix Strategy**:
1. **Remove unused variables** if truly unnecessary
2. **Prefix with underscore** (`_varName`) if intentionally unused
3. **Use the variable** if it was meant to be used

---

### 7. Other Issues (3 occurrences) ⚠️ **LOW PRIORITY**

| File | Rule | Lines | Issue |
|------|------|-------|-------|
| `ChatView.tts-streaming.spec.tsx` | `@typescript-eslint/no-require-imports` | 83, 94 | `require()` style imports |
| `context-mentions.ts` | `no-useless-assignment` | 349 | Assigned value not used |

**Fix Strategy**:
1. **Replace `require()` with ES6 `import`**
2. **Remove useless assignments**

---

## Fix Priority Order

### Phase 1: Critical (Blocks Lint Pass)
1. **`set-state-in-effect`** (17 issues) - Most frequent, affects runtime behavior
2. **`refs`** (8 issues) - Can cause render bugs

### Phase 2: Important
3. **`exhaustive-deps`** (10 issues) - Can cause stale closures
4. **`preserve-manual-memoization`** (3 issues) - Performance impact
5. **`immutability`** (4 issues) - Test code and hook ordering

### Phase 3: Cleanup
6. **`no-unused-vars`** (9 issues) - Code cleanliness
7. **Other** (3 issues) - Minor fixes

---

## Recommended Fix Approach

### For `set-state-in-effect` Issues

**Pattern 1: Derive from props instead of state**
```tsx
// ❌ Before
const [isOpen, setIsOpen] = useState(false)
useEffect(() => {
  setIsOpen(shouldOpen)
}, [shouldOpen])

// ✅ After
const isOpen = shouldOpen // Derive directly
```

**Pattern 2: Use event handlers**
```tsx
// ❌ Before
useEffect(() => {
  setCountdown(Math.floor(timeoutMs / 1000))
}, [timeoutMs])

// ✅ After
useEffect(() => {
  const intervalId = setInterval(() => {
    setCountdown(prev => {
      const next = prev - 1
      return next <= 0 ? 0 : next
    })
  }, 1000)
  return () => clearInterval(intervalId)
}, [])
```

### For `refs` Issues

**Pattern: Move ref access to effect**
```tsx
// ❌ Before
<div>{containerRef.current?.innerHTML && <div dangerouslySetInnerHTML={{__html: containerRef.current.innerHTML}} />}</div>

// ✅ After
const [innerHTML, setInnerHTML] = useState('')
useEffect(() => {
  if (containerRef.current) {
    setInnerHTML(containerRef.current.innerHTML)
  }
}, [])
<div>{innerHTML && <div dangerouslySetInnerHTML={{__html: innerHTML}} />}</div>
```

### For `exhaustive-deps` Issues

```tsx
// ❌ Before
const handleClick = useCallback(() => {
  setSendingDisabled(true)
}, [])

// ✅ After
const handleClick = useCallback(() => {
  setSendingDisabled(true)
}, [setSendingDisabled]) // Setters are stable
```

---

## Estimated Effort

| Phase | Issues | Estimated Time |
|-------|--------|----------------|
| Phase 1 | 25 | 2-3 hours |
| Phase 2 | 17 | 1-2 hours |
| Phase 3 | 12 | 30 minutes |
| **Total** | **54** | **3.5-5.5 hours** |

---

## Next Steps

1. Start with Phase 1 fixes (highest impact)
2. Run lint after each file fix to verify
3. Run tests to ensure no regressions
4. Commit changes incrementally by category
