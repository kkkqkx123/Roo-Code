# Webview VSIX 打包问题 - 深入分析

## 问题现象

打包为 VSIX 后，webview 加载失败，出现以下错误：

```
index.html:1 Uncaught TypeError: Failed to resolve module specifier "path". 
Relative references must start with either "/", "./", or "../".

webviewElement.ts:489 An iframe which has both allow-scripts and allow-same-origin 
for its sandbox attribute can escape its sandboxing.
```

## 根本原因分析

### 1. Node.js 模块被引入浏览器环境

**问题文件**：

| 文件路径 | 导入的 Node.js 模块 | 是否被 webview-ui 引用 |
|---------|-------------------|---------------------|
| `@packages/core/src/custom-tools/esbuild-runner.ts` | `path`, `fs`, `module`, `url` | ❌ 否 |
| `@packages/core/src/debug-log/index.ts` | `fs`, `path`, `os` | ❌ 否 |
| `@packages/types/src/custom-tool.ts` | 无（纯类型） | ⚠️ 间接 |
| `@packages/types/src/worktree.ts` | 无（纯类型） | ⚠️ 间接 |

**webview-ui 中的引用**：

```typescript
// webview-ui/src/components/chat/utils/fileChangesFromMessages.ts
import { safeJsonParse } from "@coder/core/browser"
```

`@coder/core/browser` 导出链：
```
@coder/core/browser.ts
  └── exports from ./message-utils/index.js
      ├── consolidateTokenUsage.js (浏览器安全)
      ├── consolidateApiRequests.js (浏览器安全)
      ├── consolidateCommands.js (浏览器安全)
      └── safeJsonParse.js (浏览器安全) ✅
```

### 2. Vite 配置问题

**当前配置** (`webview-ui/vite.config.ts`)：

```typescript
rollupOptions: {
  external: ["vscode", "esbuild", "fs", "path", "os", "crypto", "child_process", "util", "module", "url"],
  // ...
}
```

**问题分析**：

1. `external` 选项告诉 Rollup **不要打包**这些模块，期望它们在运行时可用
2. 在浏览器环境中，`fs`、`path` 等 Node.js 内置模块**不存在**
3. 如果任何被引用的代码导入了这些模块，构建后的代码会保留 `import "path"` 语句
4. 浏览器无法解析这些模块，导致 `Failed to resolve module specifier "path"` 错误

### 3. @coder/core 包结构问题

**`packages/core/package.json`**：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./cli": "./src/cli.ts",
    "./browser": "./src/browser.ts"
  }
}
```

**`packages/core/src/index.ts`**：

```typescript
export * from "./custom-tools/index.js"  // ❌ 包含 Node.js 模块依赖
export * from "./debug-log/index.js"     // ❌ 包含 Node.js 模块依赖
export * from "./message-utils/index.js" // ✅ 浏览器安全
export * from "./worktree/index.js"      // ⚠️ 可能包含 Node.js 模块依赖
```

**问题**：主入口 (`"."`) 导出了所有模块，包括依赖 Node.js 内置模块的代码。

### 4. Vite 别名配置

**`webview-ui/vite.config.ts`**：

```typescript
resolve: {
  alias: {
    "@coder/core": resolve(__dirname, "../packages/core/src"),
    "@coder/core/browser": resolve(__dirname, "../packages/core/src/browser.ts"),
    // ...
  }
}
```

**问题**：当代码使用 `import { something } from "@coder/core"` 时，Vite 会解析到 `packages/core/src/index.ts`，这会导出所有模块，包括依赖 Node.js 的模块。

## 已应用的修复

### 修复 1: `.vscodeignore` 配置

**文件**: `src/.vscodeignore`

```diff
- !**/*.map
- !webview-ui/audio
- !webview-ui/build/assets/*.js
- !webview-ui/build/assets/*.ttf
- !webview-ui/build/assets/*.css
- !webview-ui/build/assets/fonts/*.woff
- !webview-ui/build/assets/fonts/*.woff2
- !webview-ui/build/assets/fonts/*.ttf
+ # Include the built webview - use recursive pattern to include all hashed chunk files
+ !webview-ui/**
```

### 修复 2: `localResourceRoots` 配置

**文件**: `src/core/webview/ClineProvider.ts`, `src/activate/registerCommands.ts`

```typescript
const resourceRoots = [
    this.contextProxy.extensionUri,
    vscode.Uri.joinPath(this.contextProxy.extensionUri, 'webview-ui', 'build'),
    vscode.Uri.joinPath(this.contextProxy.extensionUri, 'webview-ui', 'audio'),
    vscode.Uri.joinPath(this.contextProxy.extensionUri, 'assets'),
]
```

### 修复 3: CSP 配置改进

**文件**: `src/core/webview/ClineProvider.ts`

添加了 `media-src` 和 `worker-src` 指令。

### 修复 4: 文件存在性检查

**文件**: `src/core/webview/ClineProvider.ts`

添加了运行时验证所有必需文件是否存在的检查。

## 待解决的问题

### 问题 1: Vite `external` 配置与 Node.js 模块

**当前状态**: Vite 配置将 `fs`、`path` 等设为 `external`，但这些模块在浏览器中不可用。

**可能的解决方案**:

1. **移除 `external` 配置**：让 Vite/Rollup 尝试打包所有依赖
   - 风险：可能会打包不应该打包的 Node.js 模块
   - 需要确保没有代码直接引用这些模块

2. **使用 polyfill**：为浏览器环境提供 Node.js 模块的 polyfill
   - 不推荐：增加包体积，且某些模块无法 polyfill

3. **修复代码引用**：确保 webview-ui 代码不引用依赖 Node.js 模块的代码
   - 需要检查是否有间接引用

### 问题 2: @coder/core 包结构

**当前状态**: 主入口导出所有模块，包括依赖 Node.js 的代码。

**建议修复**:

1. 确保 `@coder/core/browser` 只导出浏览器安全的代码（已完成）
2. 检查 `@coder/core` 主入口是否可以安全地用于 webview-ui
3. 考虑在 `packages/core/package.json` 中添加 `browser` 字段

### 问题 3: 构建产物中的 Node.js 导入

**需要验证**: 构建后的 `index.js` 文件中是否包含 `import "path"` 或类似的语句。

**调试步骤**:

```bash
# 检查构建产物中是否有 Node.js 模块导入
grep -n "from [\"']path[\"']" src/webview-ui/build/assets/index.js
grep -n "from [\"']fs[\"']" src/webview-ui/build/assets/index.js
grep -n "from [\"']os[\"']" src/webview-ui/build/assets/index.js
```

## 下一步行动

1. ~~**检查构建产物**：确认 `index.js` 中是否有 Node.js 模块导入~~ ✅ 已完成
2. ~~**追踪导入链**：找出是什么代码导入了 Node.js 模块~~ ✅ 已完成
3. ~~**修复 Vite 配置**：移除或调整 `external` 配置~~ ✅ 已修复
4. **修复代码引用**：确保 webview-ui 不引用依赖 Node.js 的代码

## 已应用的修复

### 修复 5: Vite `external` 配置

**文件**: `webview-ui/vite.config.ts`

**问题**: Vite 配置将 `fs`、`path`、`os` 等 Node.js 模块设为 `external`，期望这些模块在运行时可用。但在浏览器环境中，这些模块不存在，导致 `Failed to resolve module specifier "path"` 错误。

**修复**:

```diff
rollupOptions: {
-  external: ["vscode", "esbuild", "fs", "path", "os", "crypto", "child_process", "util", "module", "url"],
+  // Externalize vscode module only - it's not available in the browser context
+  // Node.js modules (fs, path, os, etc.) should NOT be externalized for webview
+  // because they don't exist in browser environment. If any code imports these,
+  // Rollup will fail and we can identify and fix the problematic imports.
+  external: ["vscode"],
}
```

**原理**:
- 移除 Node.js 模块的 `external` 配置后，Rollup 会尝试打包这些模块的导入
- 如果有任何代码引用了这些模块，Rollup 会报错，这样可以准确找到问题代码
- 如果代码没有引用这些模块，Rollup 会成功构建，且不会在产物中包含 `import "path"` 语句

## 相关文件

- `webview-ui/vite.config.ts` - Vite 构建配置
- `webview-ui/tsconfig.json` - TypeScript 配置
- `packages/core/package.json` - @coder/core 包配置
- `packages/core/src/browser.ts` - 浏览器安全导出
- `packages/core/src/index.ts` - 主入口导出
- `src/.vscodeignore` - VSIX 打包排除配置
- `src/core/webview/ClineProvider.ts` - Webview HTML 生成
