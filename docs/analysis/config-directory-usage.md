# Config Directory Usage Analysis

**Date:** 2026-02-27  
**Purpose:** Analyze the actual usage of the `config/` directory in the monorepo

---

## Directory Structure

```
config/
├── eslint/
│   ├── base.js      # Shared ESLint configuration
│   └── react.js     # React-specific ESLint configuration
└── typescript/
    ├── base.json         # Base TypeScript config (strict mode)
    ├── cjs.json          # CommonJS module config
    └── vscode-library.json  # VSCode library config (extends base)
```

---

## Configuration Files Detail

### ESLint Configurations

#### `config/eslint/base.js`
Shared ESLint configuration for TypeScript projects:
- Uses `@eslint/js`, `typescript-eslint`, `eslint-plugin-turbo`, `eslint-plugin-only-warn`
- Rules:
  - `turbo/no-undeclared-env-vars`: off
  - `@typescript-eslint/no-unused-vars`: error (ignores `_` prefixed variables)
- Ignores: `dist/**`

#### `config/eslint/react.js`
React-specific ESLint configuration (extends `base.js`):
- Adds `eslint-plugin-react`, `eslint-plugin-react-hooks`
- React version: detect
- Rules:
  - `react/react-in-jsx-scope`: off
  - All react-hooks recommended rules

### TypeScript Configurations

#### `config/typescript/base.json`
Base TypeScript configuration:
- Module: NodeNext (ES modules)
- Target: ES2022
- Strict mode: enabled
- Declaration maps: enabled
- Incremental: false

#### `config/typescript/cjs.json`
CommonJS module configuration:
- Module: CommonJS
- Target: ES2022
- Source maps: enabled
- `useUnknownInCatchVariables`: false

#### `config/typescript/vscode-library.json`
VSCode library configuration (extends `base.json`):
- Module: esnext
- Module resolution: Bundler
- Types: vitest/globals
- `noUncheckedIndexedAccess`: false
- `useUnknownInCatchVariables`: false

---

## Usage Map

| Config File | Referenced By |
|-------------|---------------|
| `config/typescript/base.json` | `src/tsconfig.json`, `packages/types/tsconfig.json`, `packages/ipc/tsconfig.json`, `packages/core/tsconfig.json` |
| `config/eslint/base.js` | `packages/types/eslint.config.mjs`, `packages/ipc/eslint.config.mjs`, `packages/core/eslint.config.mjs` |
| `config/eslint/react.js` | `webview-ui/eslint.config.mjs` |
| `config/typescript/cjs.json` | ⚠️ **No references found** |
| `config/typescript/vscode-library.json` | ⚠️ **No references found** |

---

## Referenced Files (Code Search Results)

### TypeScript Config References
```
src/tsconfig.json:              "extends": "../config/typescript/base.json"
packages/types/tsconfig.json:   "extends": "../../config/typescript/base.json"
packages/ipc/tsconfig.json:     "extends": "../../config/typescript/base.json"
packages/core/tsconfig.json:    "extends": "../../config/typescript/base.json"
```

### ESLint Config References
```
webview-ui/eslint.config.mjs:   import { reactConfig } from "../config/eslint/react.js"
packages/types/eslint.config.mjs:  import { config } from "../../config/eslint/base.js"
packages/ipc/eslint.config.mjs:    import { config } from "../../config/eslint/base.js"
packages/core/eslint.config.mjs:   import { config } from "../../config/eslint/base.js"
```

### Documentation References
```
AGENTS.md:  "Strict TypeScript enabled via config/typescript/base.json"
QWEN.md:    "Strict TypeScript enabled via config/typescript/base.json"
```

---

## Findings

### ✅ Actively Used (3 files)

1. **`config/typescript/base.json`** - Core TypeScript config for all packages
2. **`config/eslint/base.js`** - Core ESLint config for all packages
3. **`config/eslint/react.js`** - React ESLint config for webview-ui

### ⚠️ Unused (2 files)

1. **`config/typescript/cjs.json`** - CommonJS config, no current references
   - May be legacy or prepared for future use
   
2. **`config/typescript/vscode-library.json`** - VSCode library config, no current references
   - May be prepared for future VSCode extension library projects

---

## Recommendations

1. **Keep actively used configs** - They provide excellent centralized configuration

2. **Review unused configs**:
   - Investigate if `cjs.json` and `vscode-library.json` are needed
   - If not needed, consider removing to reduce confusion
   - If planned for future use, add documentation comments

3. **Consider adding documentation** - Add README.md in config/ directory explaining:
   - Purpose of each config file
   - Which packages should use which config
   - Guidelines for extending configs

---

## Summary

The `config/` directory serves as a **centralized configuration hub** for the monorepo:

- **5 total config files** (2 ESLint + 3 TypeScript)
- **3 actively used** across src, packages, and webview-ui
- **2 unused** (cjs.json, vscode-library.json)
- Enables **consistent linting and TypeScript rules** across all packages
- Supports the **Turbo monorepo build system**
