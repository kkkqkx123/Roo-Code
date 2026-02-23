# VSCode 扩展 ESM 集成配置分析

**文档版本**: 1.0  
**更新日期**: 2026 年 2 月 22 日  
**参考**: [VSCode ESM 支持文档](https://github.com/microsoft/vscode/issues/130367), [Writing a VS Code Extension in ES Modules (2025)](https://jan.miksovsky.com/posts/2025/03-17-vs-code-extension)

---

## 概述

本文档分析了当前项目中各个包的配置文件是否符合基于 ESM 的 TypeScript 项目集成 VSCode 的最佳实践。VSCode 扩展目前仍要求通过 `require()` 方式加载入口点，这意味着扩展必须使用 CommonJS 格式作为入口。

---

## 当前配置状态

### 1. 根目录 `package.json`

```json
{
  "name": "coder",
  "packageManager": "pnpm@10.8.1",
  "engines": {
    "node": "20.19.2"
  }
  // ⚠️ 缺少 "type" 字段
}
```

**问题**: 缺少 `"type"` 字段，应明确指定模块类型。

---

### 2. 主扩展 `src/package.json`

```json
{
  "name": "coder-roo",
  "version": "3.50.0",
  "type": "module",                    // ⚠️ 问题：VSCode 需要 CommonJS 入口
  "main": "./dist/extension.cjs",      // .cjs 但 type 是 module，存在矛盾
  "engines": {
    "vscode": "^1.84.0"
  }
}
```

**核心问题**:
- VSCode 使用 `require()` 加载扩展，要求入口点必须是 CommonJS 格式
- `"type": "module"` 会导致 Node.js 将所有 `.js` 文件视为 ESM
- `.cjs` 扩展名虽然强制 CommonJS，但与 `type: module` 混用会造成混淆

---

### 3. 构建配置 `src/esbuild.mjs`

```javascript
const buildOptions = {
  bundle: true,
  minify,
  sourcemap,
  format: "esm",                    // ⚠️ 输出 ESM 但 VSCode 需要 CJS
  sourcesContent: false,
  platform: "node",
}

const extensionConfig = {
  ...buildOptions,
  entryPoints: ["extension.ts"],
  outfile: "dist/extension.cjs",    // ⚠️ 扩展名.cjs 但 format 是 esm
  external: ["vscode", "esbuild", "global-agent"],
}
```

**问题**: 输出格式设置为 `"esm"` 但 VSCode 需要 CommonJS 格式。

---

### 4. TypeScript 配置 `src/tsconfig.json`

```json
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "Bundler",
    "target": "ES2022"
  }
}
```

**状态**: ✅ 源码配置正确，但最终打包输出需要是 CommonJS。

---

### 5. 内部包配置

#### @coder/core (`packages/core/package.json`)

```json
{
  "name": "@coder/core",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./cli": "./src/cli.ts",
    "./browser": "./src/browser.ts"
  }
}
```

**状态**: ✅ 正确 - 内部库使用 ESM，通过源码引用。

---

#### @coder/ipc (`packages/ipc/package.json`)

```json
{
  "name": "@coder/ipc",
  "type": "module",
  "exports": "./src/index.ts"
}
```

**状态**: ✅ 正确 - 内部库使用 ESM。

---

#### @coder/types (`packages/types/package.json`)

```json
{
  "name": "@coder/types",
  "type": "module",
  "main": "./dist/index.cjs",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  }
}
```

**状态**: ✅ 正确 - 实现了双模块发布 (Dual Package)，同时支持 ESM 和 CommonJS 消费者。

---

#### webview-ui (`webview-ui/package.json`)

```json
{
  "name": "@coder/vscode-webview",
  "type": "module",
  "scripts": {
    "build": "tsc -b && vite build"
  }
}
```

**状态**: ✅ 正确 - Webview 运行在浏览器环境，使用 ESM + Vite 打包是正确的。

---

## VSCode ESM 最佳实践 (2025)

### 推荐方案：CommonJS 包装器模式

由于 VSCode 尚未原生支持 ESM 扩展入口，推荐使用 **CommonJS 包装器模式**：

```
src/
├── extension.cjs      # CommonJS 包装器 (入口点)
├── extension.mjs      # 实际扩展代码 (ES 模块)
└── ...
```

### 1. package.json 配置

```json
{
  "name": "coder-roo",
  "type": "commonjs",
  "main": "./dist/extension.cjs",
  "engines": {
    "vscode": "^1.84.0"
  },
  "scripts": {
    "vscode:prepublish": "pnpm bundle --production",
    "bundle": "tsx esbuild.mjs"
  }
}
```

### 2. CommonJS 包装器 (`extension.cjs`)

```javascript
// src/extension.cjs
// 这是唯一的 CommonJS 文件 - 作为 VSCode require() 的入口

(async () => {
  // 动态导入 ES 模块
  const extension = await import('./extension.mjs');
  
  // 将 vscode 模块传递给 ES 模块 (通过 globalThis)
  globalThis.vscode = require('vscode');
  
  // 导出激活/停用处理函数
  module.exports = {
    activate: (...args) => extension.activate(...args),
    deactivate: () => extension.deactivate?.()
  };
})();
```

### 3. ES 模块扩展代码 (`extension.mjs`)

```javascript
// src/extension.mjs
// 所有实际扩展代码 - 使用现代 ES 模块语法

// 从 globalThis 访问 vscode (由 extension.cjs 传递)
const vscode = globalThis.vscode;

// 导入其他 ES 模块
import { SomeFeature } from './features/someFeature.mjs';

// 导入 CommonJS 包 - 导入整个模块然后解构
import languageClient from 'vscode-languageclient/node.js';
const { LanguageClient, ServerOptions } = languageClient;

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
  console.log('Extension is now active!');
  
  const disposable = vscode.commands.registerCommand(
    'coder-roo.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello from ES modules!');
    }
  );
  
  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log('Extension deactivated');
}
```

### 4. Esbuild 配置

```javascript
const extensionConfig = {
  bundle: true,
  format: "cjs",              // ✅ 输出 CommonJS
  platform: "node",
  entryPoints: ["extension.cjs"],  // ✅ 入口是包装器
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  minify: production,
  sourcemap: true,
}
```

---

## 配置对比表

| 组件 | 当前配置 | 推荐配置 | 状态 |
|------|----------|----------|------|
| `src/package.json` type | `"module"` | `"commonjs"` | ⚠️ 需修改 |
| `src/package.json` main | `"./dist/extension.cjs"` | `"./dist/extension.cjs"` | ✅ |
| 入口点格式 | ESM | CommonJS 包装器 + 动态 import() | ⚠️ 需修改 |
| esbuild format | `"esm"` | `"cjs"` | ⚠️ 需修改 |
| esbuild entryPoints | `["extension.ts"]` | `["extension.cjs"]` | ⚠️ 需修改 |
| `@coder/core` | ESM | ESM (内部库) | ✅ |
| `@coder/ipc` | ESM | ESM (内部库) | ✅ |
| `@coder/types` | 双模块 | 双模块 | ✅ |
| `webview-ui` | ESM + Vite | ESM + Vite | ✅ |

---

## 修改计划

### 阶段 1: 修改主扩展配置

1. ✅ 修改 `src/package.json` - `"type": "commonjs"`
2. ✅ 创建 `src/extension.cjs` - CommonJS 包装器
3. ✅ 重命名 `src/extension.ts` → `src/extension.mjs`
4. ✅ 修改 `src/esbuild.mjs` - `format: "cjs"`, 入口改为 `extension.cjs`

### 阶段 2: 更新 TypeScript 配置

1. ✅ 确保 `tsconfig.json` 支持 `.mjs` 文件
2. ✅ 配置模块解析以支持混合模块环境

### 阶段 3: 测试验证

1. ✅ 运行 `pnpm build` 验证构建
2. ✅ 运行 `pnpm vsix` 打包扩展
3. ✅ 在 VSCode 中测试扩展加载

---

## 未来展望

VSCode 1.94+ 已开始使用 ESM 构建，但扩展入口仍需要 CommonJS。关注以下问题以跟踪原生 ESM 支持进展:

- [microsoft/vscode#130367](https://github.com/microsoft/vscode/issues/130367) - Enable consuming of ES modules in extensions

当 VSCode 原生支持 ESM 扩展后，迁移路径:

1. 删除 `.cjs` 包装器文件
2. 将 `package.json` 改为 `"type": "module"`
3. 将 `.mjs` 文件重命名为 `.js`
4. 移除 `globalThis.vscode` 模式，直接使用 `import * as vscode from 'vscode'`

---

## 参考资料

- [VSCode Extension API - Working with Extensions](https://github.com/microsoft/vscode-docs/blob/main/api/working-with-extensions/bundling-extension.md)
- [Writing a VS Code Extension in ES Modules (2025)](https://jan.miksovsky.com/posts/2025/03-17-vs-code-extension)
- [VSCode 1.94 Release Notes - ESM Migration](https://code.visualstudio.com/updates/v1_94)
- [TypeScript in 2025 with ESM and CJS npm publishing](https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing)
