# TypeScript 类型检查与 Bundle 差异分析

## 问题背景

在项目开发过程中发现，有些类型错误在 `pnpm check-types`（TypeScript 编译器检查）中无法被发现，但在 `pnpm bundle`（esbuild 打包）过程中却能检测到。这种差异导致了开发阶段的类型安全错觉，增加了调试难度和维护成本。

## 核心问题

### 1. Export/Import 类型的关键差异

#### 问题代码示例

在 `src/core/task/streaming/types.ts` 中：

```typescript
// ❌ 错误：使用 export type 导出类
export type {
    StreamAbortedError,
    StreamProviderError,
    TokenError,
    // ... 其他错误类
} from "@shared/types/errors"
```

而在 `packages/types/src/errors.ts` 中：

```typescript
// ✅ 这些是实际的类定义（值）
export class StreamAbortedError extends StreamingError {
    constructor(readonly reason: string, context?: Record<string, any>) {
        super(`Stream aborted: ${reason}`, "STREAM_ABORTED", { reason, ...context })
    }
}

export class StreamProviderError extends StreamingError {
    constructor(
        message: string,
        readonly providerName?: string,
        readonly originalError?: Error
    ) {
        super(message, "STREAM_PROVIDER_ERROR", { providerName, originalError })
    }
}

export class TokenError extends StreamingError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, "TOKEN_ERROR", context)
    }
}
```

#### 使用这些类的代码

在 `src/core/task/streaming/StreamingErrorHandler.ts` 中：

```typescript
import {
    StreamAbortedError,  // ❌ 需要运行时值，但只导出了类型
    StreamProviderError, // ❌ 需要运行时值，但只导出了类型
    TokenError,          // ❌ 需要运行时值，但只导出了类型
} from "./types"
```

### 2. 为什么 TypeScript 编译器不报错？

TypeScript 编译器（`tsc --noEmit`）在类型检查时：

- **只关心类型是否正确**
- `export type` 导出的类在类型系统中是有效的
- TypeScript 允许通过 `export type` 重新导出类，因为类既有类型又有值
- 类型检查时，TypeScript 只需要验证类型存在即可，不关心运行时值

**TypeScript 的设计哲学**：类型系统是静态的，只在编译时存在。只要类型信息足够进行类型推断和检查，TypeScript 就认为代码是正确的。

### 3. 为什么 Bundle 报错？

esbuild 在打包时：

- **需要实际的值（runtime values）来进行打包**
- `export type` 只导出类型信息，不导出运行时值
- 当尝试导入这些类作为值使用时，esbuild 无法找到这些类的运行时定义

**错误信息**：
```
✘ [ERROR] No matching export in "core/task/streaming/types.ts" for import "StreamAbortedError"
✘ [ERROR] No matching export in "core/task/streaming/types.ts" for import "StreamProviderError"
✘ [ERROR] No matching export in "core/task/streaming/types.ts" for import "TokenError"
```

### 4. 代码质量问题：重复定义

在 `types.ts` 文件中还发现了大量的重复定义：

| 接口名称 | 第一次定义行号 | 第二次定义行号 |
|---------|--------------|--------------|
| `StreamingProcessorConfig` | 第 66 行 | 第 226 行 |
| `ApiHandler` | 第 78 行 | 第 238 行 |
| `DiffViewProvider` | 第 86 行 | 第 246 行 |
| `ChunkHandlerContext` | 第 94 行 | 第 254 行 |
| `StreamingStateManager` | 第 105 行 | 第 265 行 |
| `StreamingTokenManager` | 第 181 行 | 第 337 行 |
| `ChunkHandler` | 第 217 行 | 第 373 行 |

这些重复定义在 TypeScript 中是**合法的**（重复的接口声明会被合并），但：

- 增加了代码维护成本
- 容易导致不一致
- 降低了代码可读性
- 违反了 DRY（Don't Repeat Yourself）原则

## TypeScript 编译器 vs Bundler 的检查差异

| 特性 | TypeScript (tsc) | esbuild (bundle) |
|------|------------------|------------------|
| **检查范围** | 仅类型检查 | 类型 + 运行时值检查 |
| **export type** | ✅ 允许（类型有效） | ❌ 不允许（需要运行时值） |
| **重复定义** | ✅ 允许（接口合并） | ✅ 允许（接口合并） |
| **运行时依赖** | 不检查 | 严格检查 |
| **打包优化** | 不涉及 | Tree-shaking、代码压缩 |
| **检查时机** | 开发时（静态） | 打包时（静态 + 运行时） |
| **错误类型** | 类型错误 | 类型错误 + 模块解析错误 |

## 问题的本质

这是一个**类型系统与运行时系统的边界问题**：

### TypeScript 类型系统
- 关注静态类型安全
- 允许类型层面的抽象
- `export type` 只导出类型信息
- 类型检查在编译时完成

### JavaScript 运行时
- 需要实际的值和代码来执行
- 类、函数等需要运行时定义
- 模块导入需要实际的值

### 打包工具（esbuild）
- 桥接类型系统和运行时
- 需要确保所有导入都有对应的运行时值
- 执行代码转换和优化
- 必须验证模块依赖的正确性

## 为什么这种设计是危险的？

使用 `export type` 导出类会导致：

1. **类型检查通过**：开发时没有明显的错误提示
2. **运行时失败**：打包或运行时才发现问题
3. **调试困难**：错误发生在打包阶段，不易追溯
4. **维护成本高**：需要同时理解 TypeScript 和 JavaScript 的语义差异
5. **团队协作困难**：其他开发者可能不理解这种微妙的差异

## 正确的做法

### 方案 1：使用 `export` 直接导出类

```typescript
// ✅ 正确：使用 export 导出类（同时导出类型和值）
export {
    StreamAbortedError,
    StreamProviderError,
    TokenError,
    // ... 其他错误类
} from "@shared/types/errors"
```

### 方案 2：分别导出类型和值

如果只需要类型信息（例如在类型定义中）：

```typescript
// ✅ 正确：明确区分类型和值
export type {
    StreamingErrorType,
    ErrorHandlingResult,
} from "@shared/types/errors"

export {
    StreamAbortedError,
    StreamProviderError,
    TokenError,
} from "@shared/types/errors"
```

### 方案 3：使用 `import type` 导入类型

如果只导入类型：

```typescript
// ✅ 正确：只导入类型
import type { StreamingErrorType } from "./types"
```

如果需要运行时值：

```typescript
// ✅ 正确：导入值
import { StreamAbortedError } from "./types"
```

## 最佳实践建议

### 1. 明确区分类型和值

- **类型**：接口、类型别名、泛型类型
- **值**：类、函数、常量、枚举

### 2. 使用正确的导出方式

```typescript
// ✅ 导出类型
export type { MyType, MyInterface } from "./types"

// ✅ 导出值（包括类）
export { MyClass, myFunction, myConstant } from "./module"

// ❌ 不要用 export type 导出需要运行时使用的类
export type { MyClass } from "./module"  // 危险！
```

### 3. 避免重复定义

- 在代码审查中检查重复定义
- 使用 ESLint 规则检测重复定义
- 定期重构代码，消除冗余

### 4. 建立完整的测试流程

```bash
# 1. 类型检查
pnpm check-types

# 2. Lint 检查
pnpm lint

# 3. 打包测试
pnpm bundle

# 4. 运行测试
pnpm test
```

### 5. 使用工具辅助检测

- **ESLint**：配置规则检测 `export type` 的误用
- **TypeScript**：启用 `strict` 模式
- **Pre-commit hooks**：确保所有检查都通过

## 总结

**bundle 能发现而 tsc 不能发现的问题，本质上是：**

1. **类型导出与值导出的混淆**：`export type` 导出的类在类型检查时有效，但在运行时不可用
2. **静态检查 vs 运行时检查的差异**：TypeScript 只做静态类型检查，不验证运行时依赖
3. **打包工具的严格性**：esbuild 需要确保所有导入都有对应的运行时值，这是正确的做法

这是一个典型的"类型系统边界问题"，提醒我们在 TypeScript 开发中要区分**类型导出**和**值导出**的语义差异。

**关键要点**：

- TypeScript 的类型系统是静态的，不关心运行时
- 打包工具需要运行时值来完成打包
- 使用 `export type` 导出类是危险的，应该使用 `export`
- 重复定义虽然合法，但会增加维护成本
- 建立完整的测试流程，包括类型检查、Lint、打包和运行时测试

**行动计划**：

1. 修复 `export type` 的问题，改用 `export` 导出类
2. 删除重复的类型定义
3. 建立代码审查机制，防止类似问题再次出现
4. 在 CI/CD 流程中包含打包测试
5. 团队培训，确保所有开发者理解 TypeScript 的类型系统和运行时系统的差异
