# 工具执行器注册模块方案

## 目标

创建统一的工具执行器注册模块，将分散的工具执行器实例统一管理，简化工具调度逻辑。

## 背景

### 当前问题

1. **工具执行器分散导出**
   - 每个工具在各自文件末尾导出单例实例
   - `presentAssistantMessage.ts` 需要逐个导入 20+ 个工具

2. **调度使用大型 switch-case**
   - `presentAssistantMessage.ts:693-926` 使用约 230 行 switch-case
   - 每添加新工具都需要修改调度代码

3. **两套注册机制不统一**
   - Schema 注册：`ToolRegistry`（在 `schemas/registry.ts`）
   - 执行器注册：分散的单例导出

### 现有架构

```
工具定义（Schema 层）          工具执行（执行层）
─────────────────────────     ─────────────────────────
schemas/registry.ts           *Tool.ts 文件
├── ToolRegistry              ├── ReadFileTool
│   ├── read_file             ├── WriteToFileTool
│   ├── write_to_file    →    ├── ...（20+ 个文件）
│   └── ...                   └── 各自导出单例
└── getAllNativeTools()
                                      ↓
                              presentAssistantMessage.ts
                              ├── import { readFileTool }
                              ├── import { writeToFileTool }
                              ├── ...（20+ 个导入）
                              └── switch(block.name) { ... }
```

## 设计方案

### 新架构

```
工具定义（Schema 层）          工具执行（执行层）
─────────────────────────     ─────────────────────────
schemas/registry.ts           ToolExecutorRegistry.ts
├── ToolRegistry              ├── ToolExecutorRegistry
│   ├── read_file             │   ├── register()
│   ├── write_to_file    ←────│   ├── get()
│   └── ...                   │   ├── has()
└── getAllNativeTools()       │   └── execute()
                              │
                              └── 自动注册所有工具
                                      ↓
                              presentAssistantMessage.ts
                              ├── import { toolExecutorRegistry }
                              └── toolExecutorRegistry.get(name).handle()
```

### 核心组件

#### 1. ToolExecutorRegistry 类

```typescript
// src/core/tools/ToolExecutorRegistry.ts

import type { ToolName } from "@coder/types"
import type { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import type { BaseTool, ToolCallbacks } from "./core/BaseTool"

/**
 * 工具执行器注册表
 * 统一管理所有工具执行器实例
 */
class ToolExecutorRegistry {
    private executors = new Map<ToolName, BaseTool<any>>()

    /**
     * 注册工具执行器
     */
    register<T extends ToolName>(name: T, executor: BaseTool<T>): void {
        if (this.executors.has(name)) {
            console.warn(`[ToolExecutorRegistry] Tool "${name}" is already registered, overwriting`)
        }
        this.executors.set(name, executor)
    }

    /**
     * 获取工具执行器
     */
    get<T extends ToolName>(name: T): BaseTool<T> | undefined {
        return this.executors.get(name)
    }

    /**
     * 检查工具是否已注册
     */
    has(name: string): boolean {
        return this.executors.has(name as ToolName)
    }

    /**
     * 获取所有已注册的工具名称
     */
    getNames(): ToolName[] {
        return Array.from(this.executors.keys())
    }

    /**
     * 统一执行入口
     */
    async execute(
        name: ToolName,
        task: Task,
        block: ToolUse<any>,
        callbacks: ToolCallbacks
    ): Promise<void> {
        const executor = this.executors.get(name)
        if (!executor) {
            throw new Error(`Unknown tool: ${name}`)
        }
        return executor.handle(task, block, callbacks)
    }
}

export const toolExecutorRegistry = new ToolExecutorRegistry()
```

#### 2. 工具注册入口

```typescript
// src/core/tools/index.ts

// 导出注册表
export { toolExecutorRegistry } from "./ToolExecutorRegistry"

// 导出基类和类型
export { BaseTool, type ToolCallbacks } from "./core/BaseTool"

// 导出 schema 相关
export * from "./schemas"

// 注册所有内置工具
import { toolExecutorRegistry } from "./ToolExecutorRegistry"
import { readFileTool } from "./ReadFileTool"
import { writeToFileTool } from "./WriteToFileTool"
// ... 其他工具导入

// 自动注册
toolExecutorRegistry.register("read_file", readFileTool)
toolExecutorRegistry.register("write_to_file", writeToFileTool)
// ... 其他工具注册
```

#### 3. 简化后的调度代码

```typescript
// src/core/assistant-message/presentAssistantMessage.ts

import { toolExecutorRegistry } from "../tools"

// ... 其他代码

case "tool_use": {
    // ... 验证逻辑

    // 使用注册表获取执行器
    const executor = toolExecutorRegistry.get(block.name)

    if (executor) {
        await executor.handle(cline, block, {
            askApproval,
            handleError,
            pushToolResult,
        })
    } else {
        // 处理未知工具或自定义工具
        // ... 自定义工具处理逻辑
    }
    break
}
```

## 实施步骤

### 第一步：创建 ToolExecutorRegistry

1. 创建 `src/core/tools/ToolExecutorRegistry.ts`
2. 实现 `ToolExecutorRegistry` 类
3. 导出单例实例 `toolExecutorRegistry`

### 第二步：创建统一导出文件

1. 创建 `src/core/tools/index.ts`
2. 导入所有工具执行器
3. 注册所有内置工具
4. 导出公共 API

### 第三步：修改调度代码

1. 修改 `presentAssistantMessage.ts`
2. 移除 20+ 个工具导入
3. 移除大型 switch-case
4. 使用 `toolExecutorRegistry.get()` 获取执行器

### 第四步：更新测试

1. 添加 `ToolExecutorRegistry` 单元测试
2. 更新相关集成测试

## 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/core/tools/ToolExecutorRegistry.ts` | 工具执行器注册表 |
| `src/core/tools/index.ts` | 统一导出和注册入口 |
| `src/core/tools/__tests__/ToolExecutorRegistry.spec.ts` | 注册表测试 |

### 修改文件

| 文件 | 变更说明 |
|------|----------|
| `src/core/assistant-message/presentAssistantMessage.ts` | 简化工具调度逻辑 |

## 优势

1. **代码简化**
   - 减少 `presentAssistantMessage.ts` 约 200 行代码
   - 移除 20+ 个工具导入

2. **易于扩展**
   - 添加新工具只需在 `index.ts` 中注册
   - 无需修改调度代码

3. **统一管理**
   - Schema 和执行器在同一模块注册
   - 便于实现工具的动态启用/禁用

4. **为未来打基础**
   - 支持插件化工具系统
   - 支持运行时工具注册

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 循环依赖 | 中 | 仔细设计模块依赖关系 |
| 类型安全 | 低 | 使用泛型保证类型安全 |
| 性能影响 | 低 | Map 查找 O(1) 复杂度 |

## 成功标准

- [ ] `ToolExecutorRegistry` 类实现完成
- [ ] 所有内置工具已注册
- [ ] `presentAssistantMessage.ts` 简化完成
- [ ] 所有测试通过
- [ ] 类型检查无错误
- [ ] 构建成功

## 变更历史

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|---------|------|
| 2024-XX-XX | 1.0 | 初始版本 | CodeArts |
