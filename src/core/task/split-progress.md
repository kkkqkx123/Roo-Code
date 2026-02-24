# Task.ts 拆分进度报告

## 概述

本文档记录了 Task.ts 文件的拆分进度，基于 `task.md` 和 `split-plan.md` 文档进行拆分。

## 已完成的工作

### 1. 目录结构创建 ✅

```
src/core/task/
├── interfaces/
│   └── ITask.ts               # Task 接口定义
├── services/
│   ├── TaskMessageService.ts      # 消息历史管理
│   ├── TaskInteractionService.ts  # 用户交互（ask/say）
│   ├── TaskToolService.ts         # 工具调用管理
│   ├── TaskApiService.ts          # API 通信管理
│   ├── TaskContextService.ts      # 上下文管理（总结/截断）
│   ├── TaskMetricsService.ts      # 统计指标管理
│   ├── TaskCheckpointService.ts   # 检查点管理
│   ├── TaskSubtaskService.ts      # 子任务管理
│   └── TaskLifecycleService.ts    # 生命周期管理
├── managers/
│   └── TaskStateManager.ts        # 状态管理
└── factories/
    └── TaskFactory.ts          # Task 工厂类
```

### 2. 已创建的模块

#### ✅ ITask 接口 (`interfaces/ITask.ts`)
- 定义了 Task 类的公共接口
- 包含所有核心方法和属性
- 用于依赖注入和类型安全

#### ✅ TaskStateManager (`managers/TaskStateManager.ts`)
**职责**：集中管理所有任务状态
- 模式和 API 配置管理（`_taskMode`, `_taskApiConfigName`）
- 核心状态（`abort`, `isPaused`, `isInitialized`, `abandoned`）
- Ask 状态（`idleAsk`, `resumableAsk`, `interactiveAsk`）
- 流式状态（`isStreaming`, `isWaitingForFirstChunk`, `assistantMessageSavedToHistory`）
- 异步初始化方法（`initializeTaskMode`, `initializeTaskApiConfigName`）

#### ✅ TaskMessageService (`services/TaskMessageService.ts`)
**职责**：管理消息历史
- API 对话历史管理（`apiConversationHistory`）
- UI 消息历史管理（`clineMessages`）
- 消息添加、更新、覆盖方法
- 消息持久化（`saveApiConversationHistory`, `saveClineMessages`）
- 待处理工具结果刷新（`flushPendingToolResultsToHistory`）

#### ✅ TaskInteractionService (`services/TaskInteractionService.ts`)
**职责**：管理用户交互
- `ask()` 方法：向用户发起提问
- `say()` 方法：向用户发送通知
- `handleWebviewAskResponse()`：处理用户响应
- `submitUserMessage()`：提交用户消息
- 自动审批处理
- 消息队列处理

#### ✅ TaskToolService (`services/TaskToolService.ts`)
**职责**：管理工具调用和统计
- 工具使用统计（`toolUsage`）
- 连续错误计数（`consecutiveMistakeCount`）
- 特定文件错误计数（`consecutiveMistakeCountForApplyDiff`, `consecutiveMistakeCountForEditFile`）
- 工具结果推送（`pushToolResultToUserContent`）
- 错误限制检查

#### ✅ TaskMetricsService (`services/TaskMetricsService.ts`)
**职责**：管理统计指标
- Token 使用量计算（`getTokenUsage`）
- 工具使用量统计（`getToolUsage`）
- 防抖的 token 使用量更新（`debouncedEmitTokenUsage`）
- 快照管理（`tokenUsageSnapshot`, `toolUsageSnapshot`）

#### ✅ TaskCheckpointService (`services/TaskCheckpointService.ts`)
**职责**：管理检查点功能
- 检查点保存（`checkpointSave`）
- 检查点恢复（`checkpointRestore`）
- 检查点差异查看（`checkpointDiff`）
- 检查点服务初始化和销毁

#### ✅ TaskSubtaskService (`services/TaskSubtaskService.ts`)
**职责**：管理子任务
- 启动子任务（`startSubtask`）
- 委托后恢复（`resumeAfterDelegation`）
- 子任务 ID 管理

#### ✅ TaskContextService (`services/TaskContextService.ts`)
**职责**：管理上下文
- 上下文总结（`condenseContext`）
- 上下文窗口超出错误处理（`handleContextWindowExceededError`）
- 上下文使用情况查询
- 文件读取跟踪

#### ✅ TaskApiService (`services/TaskApiService.ts`)
**职责**：管理 API 通信
- `attemptApiRequest()` - 执行 API 请求（带重试和错误处理）
- `getSystemPrompt()` - 获取系统提示词
- `buildCleanConversationHistory()` - 构建干净的消息历史
- `updateApiConfiguration()` - 更新 API 配置
- `cancelCurrentRequest()` - 取消当前请求
- `maybeWaitForProviderRateLimit()` - 等待提供商速率限制
- `backoffAndAnnounce()` - 指数退避重试
- `handleContextWindowExceededError()` - 处理上下文窗口超出错误
- `getCurrentProfileId()` - 获取当前配置文件 ID
- 流式响应处理
- 上下文管理集成

**复杂度**：⭐⭐⭐⭐⭐（最高）
**原因**：包含核心的 API 通信逻辑，涉及流式处理、错误处理、重试机制、上下文管理等

**Task.ts 委派状态**：✅ 已完成
- 所有公共方法已通过 Task.ts 委派
- 所有公共属性（`apiConfiguration`, `api`, `currentRequestAbortController`）已通过 getter/setter 委派
- TaskApiService 构造函数已修改为通过参数接收 API 配置，不再依赖 Task 实例的属性

#### ✅ TaskLifecycleService (`services/TaskLifecycleService.ts`)
**职责**：管理任务生命周期
- `start()` - 手动启动新任务
- `startTask()` - 启动新任务
- `resumeTaskFromHistory()` - 从历史恢复任务
- `abortTask()` - 中止任务
- `dispose()` - 销毁任务
- `initiateTaskLoop()` - 启动任务循环
- `getEnabledMcpToolsCount()` - 获取启用的 MCP 工具数量

**复杂度**：⭐⭐⭐⭐（高）
**原因**：涉及任务的生命周期管理，需要协调多个服务

#### ✅ TaskFactory (`factories/TaskFactory.ts`)
**职责**：创建 Task 实例
- `create()` - 创建任务实例并返回启动 Promise
- `createInstance()` - 创建任务实例（不自动启动）
- `createAndStart()` - 创建并启动任务

**复杂度**：⭐⭐（中）
**原因**：主要是工厂模式的实现，相对简单

## 待完成的工作

### ⏳ 重构 Task 主类
**职责**：作为协调器
- 保留核心标识符
- 委托方法到各个服务
- 初始化所有服务
- 事件分发
- 保留 `recursivelyMakeClineRequests()` 方法（核心请求循环）

**复杂度**：⭐⭐⭐（中高）
**原因**：需要重构现有代码，确保所有委托正确

### ⏳ 运行测试验证
**职责**：验证拆分结果
- 运行单元测试
- 运行集成测试
- 修复测试失败
- 验证功能完整性

## 拆分统计

| 类别 | 已完成 | 待完成 | 总计 |
|------|--------|--------|------|
| 接口 | 1 | 0 | 1 |
| 服务 | 9 | 0 | 9 |
| 管理器 | 1 | 0 | 1 |
| 工厂 | 1 | 0 | 1 |
| 主类重构 | 0 | 1 | 1 |
| 测试验证 | 0 | 1 | 1 |
| **总计** | **12** | **2** | **14** |

**完成度**：86% (12/14)

## 下一步计划

1. **重构 Task 主类**（优先级：高）
   - 将 Task 改为协调器
   - 委托所有方法到服务
   - 保留核心的 `recursivelyMakeClineRequests()` 方法
   - 确保所有依赖正确注入

2. **运行测试验证**（优先级：最高）
   - 确保所有功能正常
   - 修复任何问题
   - 验证性能没有下降

## 技术细节

### 依赖关系图

```
Task (主类)
├── TaskStateManager (状态管理)
├── TaskMessageService (消息管理)
│   └── TaskStateManager
├── TaskMetricsService (指标管理)
│   └── TaskMessageService
├── TaskInteractionService (交互管理)
│   ├── TaskStateManager
│   └── TaskMessageService
├── TaskToolService (工具管理)
│   ├── TaskStateManager
│   ├── TaskInteractionService
│   └── TaskMetricsService
├── TaskApiService (API 管理)
│   ├── TaskStateManager
│   ├── TaskMessageService
│   ├── TaskToolService
│   ├── TaskInteractionService
│   └── TaskMetricsService
├── TaskContextService (上下文管理)
│   ├── TaskStateManager
│   ├── TaskApiService
│   ├── TaskMessageService
│   └── TaskInteractionService
├── TaskCheckpointService (检查点管理)
│   ├── TaskStateManager
│   └── TaskInteractionService
├── TaskSubtaskService (子任务管理)
│   └── TaskStateManager
└── TaskLifecycleService (生命周期管理)
    ├── TaskStateManager
    ├── TaskApiService
    ├── TaskInteractionService
    ├── TaskMessageService
    └── TaskCheckpointService
```

### 关键设计决策

1. **单一职责原则**：每个服务只负责一个关注点
2. **依赖注入**：所有服务通过构造函数注入依赖
3. **状态集中**：所有状态集中在 TaskStateManager
4. **事件驱动**：使用 EventEmitter 进行服务间通信
5. **向后兼容**：保持 Task 类的公共接口不变

## 注意事项

1. **依赖注入**：所有服务通过构造函数注入依赖
2. **循环依赖**：避免服务之间的循环依赖
3. **向后兼容**：确保重构后的代码与现有代码兼容
4. **测试覆盖**：确保所有新代码都有测试覆盖
5. **性能影响**：确保拆分不会影响性能
6. **内存管理**：确保所有服务正确释放资源

## 预期收益

1. **单一职责**：每个类只负责一个关注点
2. **可测试性**：可以单独测试每个服务
3. **可维护性**：修改一个功能不需要理解整个 Task 类
4. **可扩展性**：添加新功能只需创建新的服务
5. **依赖清晰**：通过构造函数明确声明依赖
6. **状态集中**：状态管理集中在一处

## 更新日志

- 2024-02-24: 初始进度报告，完成 9/14 个模块（64%）
- 2024-02-24: 完成 TaskApiService、TaskLifecycleService、TaskFactory，完成 12/14 个模块（86%）
- 2024-02-24: 开始 Task.ts 主类重构
  - ✅ 添加服务类导入
  - ✅ 添加服务实例声明（使用下划线前缀避免命名冲突）
  - ✅ 在构造函数中初始化所有服务（按依赖顺序）
  - ✅ 验证构造函数重构无类型错误
  - ⏳ 待完成：将方法委托到各个服务
  - ⏳ 待完成：清理已迁移的代码