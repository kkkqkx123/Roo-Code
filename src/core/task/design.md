针对原始 `Task` 类过于臃肿的问题，我们提出一个**务实的分治方案**，避免过度工程和复杂的依赖注入。该方案混合使用多种设计模式，根据职责的内聚性和耦合程度选择最合适的分解方式。以下是详细的组件划分及设计模式说明：

---

### 一、纯函数工具库（无状态，无副作用）

**设计模式**：纯函数模块  
**状态**：无  
**导出方式**：独立的函数  
**适用场景**：不依赖 Task 实例的计算逻辑，例如消息合并、成本计算、Token 统计等。

- **`token-utils`**：提供 `calculateApiCost`、`getTokenUsage` 等函数，输入原始消息和模型信息，输出用量和成本。
- **`message-utils`**：包含 `combineApiRequests`、`mergeConsecutiveMessages`、`removeImageBlocks` 等，用于处理消息历史。
- **`history-utils`**：实现 `getEffectiveApiHistory`、`getMessagesSinceLastSummary` 等，过滤系统消息和摘要标记。
- **`tool-utils`**：如 `formatToolInvocation`、`sanitizeToolUseId`，处理工具调用的格式化和 ID 清理。

这些模块导出纯函数，易于测试，可在多处复用。

---

### 二、事件驱动的观察者模式（有状态，低耦合）

**设计模式**：观察者（EventEmitter）  
**状态**：有（内部缓存）  
**导出方式**：类实例，通过订阅 Task 事件工作  
**适用场景**：对 Task 核心流程无侵入的旁路功能，如指标收集、检查点自动保存。

- **`MetricsCollector`**：监听 Task 的 `messageSaved`、`toolUsed` 等事件，维护 Token 用量快照，并在变化时触发 `tokenUsageUpdated` 事件。完全解耦，Task 只需在关键点 emit 事件。
- **`AutoCheckpointer`**：订阅 `userMessageSubmitted` 或 `taskPaused` 事件，自动触发检查点保存。它持有 `CheckpointService` 引用，但不直接依赖 Task。

这些观察者可以在 Task 外部注册，Task 不需要知道它们的存在，符合开闭原则。

---

### 三、状态模式（有状态，内聚行为）

**设计模式**：状态模式（State）  
**状态**：有（状态对象持有上下文）  
**导出方式**：抽象状态接口和具体状态类  
**适用场景**：管理 Task 的运行时状态（运行、等待用户、等待子任务等），将状态相关的行为（如如何处理新消息、是否允许工具执行）封装到状态类中。

- **`TaskState`**（抽象类）：定义 `onEnter`、`onMessage`、`onAskResponse`、`canExecuteTool` 等方法。
- **具体状态**：
    - `RunningState`：正常运行，可处理消息和执行工具。
    - `WaitingForUserState`：等待用户响应，忽略除用户响应外的所有事件。
    - `WaitingForSubtaskState`：等待子任务完成，子任务完成后自动恢复。
    - `IdleState`、`InteractiveState` 等对应 `idleAsk`、`interactiveAsk`。

Task 内部持有当前状态对象，将 `ask`、`submitUserMessage` 等调用委托给状态对象处理。这大大简化了 `ask` 方法中复杂的超时和状态转换逻辑。

---

### 四、策略模式（无状态或有状态，可插拔）

**设计模式**：策略模式（Strategy）  
**状态**：可选（策略实现可以有自己的状态）  
**导出方式**：接口和实现类  
**适用场景**：需要支持多种算法的功能，如上下文管理、差异对比策略。

- **`ContextManagementStrategy`**（接口）：定义 `condense` 和 `truncate` 方法。实现类如 `LLMSummaryStrategy`（有状态，需要调用 API）、`SlidingWindowStrategy`（无状态）。Task 根据配置选择策略，并将策略对象传入上下文管理器。
- **`DiffStrategy`**（接口）：定义 `applyDiff`、`revert` 等方法。已有 `MultiSearchReplaceDiffStrategy` 等实现。Task 通过组合持有策略，而非自己实现差异逻辑。

策略模式使算法可独立变化，Task 只需依赖接口。

---

### 五、模块化函数（通过 `this` 绑定，紧密耦合但物理分离）

**设计模式**：函数模块化（非正式模式）  
**状态**：通过 `this` 访问 Task 内部状态  
**导出方式**：普通函数，接收 `this: Task` 作为第一个参数（或使用箭头函数在定义时绑定）  
**适用场景**：核心复杂逻辑，与 Task 高度耦合，无法完全解耦但希望拆分文件以降低复杂度。

- **`api-request.ts`**：导出 `attemptApiRequest` 函数，内部使用 `this.api`、`this.stateManager` 等。在 Task 中通过 `attemptApiRequest = apiRequest.attemptApiRequest.bind(this)` 挂载为方法。
- **`lifecycle.ts`**：导出 `startTask`、`resumeTaskFromHistory`、`abortTask` 等，同样绑定 `this`。
- **`tool-execution.ts`**：导出 `executeTools`、`pushToolResult` 等，处理工具调用流程。

这种方式没有引入新的类，只是将大方法移到外部文件，通过 `bind` 确保 `this` 正确。它减少了单个文件的代码行数，提高了可读性，同时保持了内部状态的直接访问，无需依赖注入。

---

### 六、内部服务类（组合，有状态，明确边界）

**设计模式**：组合（Composition）  
**状态**：有（服务类内部状态）  
**导出方式**：类，由 Task 在构造函数中创建并持有  
**适用场景**：已有或容易识别的独立子系统，职责清晰，与 Task 通过接口交互。

- **`MessageQueueService`**：管理待处理消息队列，Task 通过 `enqueue`/`dequeue` 与之交互。
- **`FileContextTracker`**：追踪任务读取的文件，提供 `getFilesReadByRoo` 等方法。
- **`RooIgnoreController`** 和 **`RooProtectedController`**：处理忽略规则和受保护文件。
- **`DiffViewProvider`**：管理差异视图，Task 只需调用 `open`、`apply` 等方法。

这些服务在 Task 内部实例化，通过组合方式使用，生命周期与 Task 一致。它们内部状态封装良好，与 Task 的交互通过有限的公共方法。

---

### 七、工厂模式（创建复杂对象）

**设计模式**：工厂方法 / 简单工厂  
**状态**：无（只负责创建）  
**导出方式**：静态方法或独立工厂类  
**适用场景**：创建 Task 实例时涉及异步初始化、依赖组装。

- **`TaskFactory`**：提供 `createTask` 方法，内部处理 `Task` 的构造、状态管理器初始化、服务组装等。工厂还可以根据配置选择不同的策略实现（如 diff 策略）。

工厂封装了创建逻辑，使 Task 构造函数保持简洁，同时便于测试（可 mock 依赖）。

---

### 八、协调器（精简后的 Task）

最终，`Task` 类本身作为协调器，持有以上各组件的引用，负责将外部请求（如 Webview 消息）路由到适当的组件，并在组件之间传递上下文。Task 的职责简化为：

- 维护核心标识符（ID、路径等）
- 持有状态管理器、服务实例和策略
- 触发生命周期事件
- 将公开 API（如 `ask`、`submitUserMessage`）委托给相应组件

这样，`Task` 类的代码量大幅减少，每个组件职责单一，且根据其特性选择了最合适的设计模式，避免了过度工程和样板代码。
