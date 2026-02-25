# Task.ts 重构实施指南

## 📋 目录
1. [重构策略](#重构策略)
2. [阶段一：接口定义](#阶段一接口定义)
3. [阶段二：消息处理模块](#阶段二消息处理模块)
4. [阶段三：流处理模块](#阶段三流处理模块)
5. [阶段四：状态管理模块](#阶段四状态管理模块)
6. [阶段五：指标收集模块](#阶段五指标收集模块)
7. [阶段六：Task 类重构](#阶段六task-类重构)
8. [测试策略](#测试策略)
9. [迁移指南](#迁移指南)

---

## 重构策略

### 核心原则
1. **渐进式重构**：不破坏现有功能，逐步迁移
2. **向后兼容**：保持现有 API 不变
3. **测试驱动**：每个阶段都有完整的测试覆盖
4. **小步快跑**：每个阶段都可以独立交付

### 重构模式
采用 **门面模式 + 依赖注入**：
- Task 类作为门面，对外提供统一接口
- 内部委托给各个专门的处理模块
- 通过接口注入依赖，便于测试

---

## 阶段一：接口定义

### 目标
定义所有必要的接口，为后续重构奠定基础。

### 已完成
✅ `ITaskDependencies.ts` - 依赖接口
✅ `ITaskMessageHandler.ts` - 消息处理接口
✅ `ITaskStreamHandler.ts` - 流处理接口
✅ `ITaskStateManager.ts` - 状态管理接口
✅ `ITaskMetrics.ts` - 指标收集接口
✅ `index.ts` - 统一导出

### 验证清单
- [ ] 所有接口都有完整的 JSDoc 注释
- [ ] 接口方法都有明确的参数和返回值类型
- [ ] 接口之间没有循环依赖
- [ ] 接口设计符合单一职责原则

---

## 阶段二：消息处理模块

### 目标
将消息处理相关的逻辑从 Task 类中提取到独立的模块。

### 文件结构
```
src/core/task/
├── handlers/
│   ├── MessageHandler.ts          # 消息处理器实现
│   ├── MessageHandler.spec.ts     # 单元测试
│   └── types.ts                   # 类型定义
```

### 实现步骤

#### 步骤 1：创建 MessageHandler 类

```typescript
// src/core/task/handlers/MessageHandler.ts
import type {
	ITaskMessageHandler,
	AskResult,
} from "../interfaces/ITaskMessageHandler"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { Task } from "../Task"

export class MessageHandler implements ITaskMessageHandler {
	constructor(
		private task: Task,
		private provider: WeakRef<ClineProvider>
	) {}

	async ask(
		type: any,
		text?: string,
		partial?: boolean,
		progressStatus?: any,
		isProtected?: boolean
	): Promise<AskResult> {
		// 从 Task.ts 迁移 ask 方法逻辑
		// ...
	}

	async say(type: any, options?: any): Promise<void> {
		// 从 Task.ts 迁移 say 方法逻辑
		// ...
	}

	// ... 其他方法实现
}
```

#### 步骤 2：编写单元测试

```typescript
// src/core/task/handlers/MessageHandler.spec.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { MessageHandler } from "./MessageHandler"
import type { Task } from "../Task"

describe("MessageHandler", () => {
	let messageHandler: MessageHandler
	let mockTask: Partial<Task>
	let mockProvider: any

	beforeEach(() => {
		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance-id",
			cwd: "/test/workspace",
			// ... 其他必需的属性
		}
		mockProvider = {
			deref: vi.fn(() => ({
				postStateToWebview: vi.fn(),
				postMessageToWebview: vi.fn(),
				getState: vi.fn(),
			})),
		}
		messageHandler = new MessageHandler(mockTask as Task, mockProvider)
	})

	describe("ask", () => {
		it("should handle ask requests", async () => {
			// 测试逻辑
		})

		it("should handle partial messages", async () => {
			// 测试逻辑
		})

		it("should handle auto-approval", async () => {
			// 测试逻辑
		})
	})

	describe("say", () => {
		it("should send messages", async () => {
			// 测试逻辑
		})

		it("should handle partial messages", async () => {
			// 测试逻辑
		})
	})
})
```

#### 步骤 3：集成到 Task 类

```typescript
// src/core/task/Task.ts
export class Task extends EventEmitter<TaskEvents> implements TaskLike {
	// 添加消息处理器
	private messageHandler: MessageHandler

	constructor(options: TaskOptions) {
		super()
		// ... 现有代码

		// 初始化消息处理器
		this.messageHandler = new MessageHandler(this, this.providerRef)
	}

	// 委托方法
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: any,
		isProtected?: boolean
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
		return this.messageHandler.ask(type, text, partial, progressStatus, isProtected)
	}

	async say(type: ClineSay, options?: SayOptions): Promise<undefined> {
		return this.messageHandler.say(type, options)
	}

	// ... 其他委托方法
}
```

### 验证清单
- [ ] MessageHandler 类实现完整
- [ ] 所有单元测试通过
- [ ] 集成测试通过
- [ ] 现有功能不受影响
- [ ] 代码覆盖率 > 80%

---

## 阶段三：流处理模块

### 目标
将 API 请求流处理相关的逻辑从 Task 类中提取到独立的模块。

### 文件结构
```
src/core/task/
├── handlers/
│   ├── StreamHandler.ts           # 流处理器实现
│   ├── StreamHandler.spec.ts      # 单元测试
│   └── types.ts                   # 类型定义
```

### 实现步骤

#### 步骤 1：创建 StreamHandler 类

```typescript
// src/core/task/handlers/StreamHandler.ts
import type {
	ITaskStreamHandler,
	ApiRequestOptions,
	StreamProcessingResult,
} from "../interfaces/ITaskStreamHandler"
import type { ApiStream } from "../../../api/transform/stream"
import type { Task } from "../Task"

export class StreamHandler implements ITaskStreamHandler {
	constructor(
		private task: Task,
		private dependencies: any
	) {}

	async *attemptApiRequest(
		retryAttempt: number = 0,
		options: ApiRequestOptions = {}
	): AsyncGenerator<ApiStream> {
		// 从 Task.ts 迁移 attemptApiRequest 方法逻辑
		// ...
	}

	cancelCurrentRequest(): void {
		// 从 Task.ts 迁移 cancelCurrentRequest 方法逻辑
		// ...
	}

	createStreamProcessorCallbacks(): any {
		// 从 Task.ts 迁移 createStreamProcessorCallbacks 方法逻辑
		// ...
	}

	createStreamPostProcessorCallbacks(): any {
		// 从 Task.ts 迁移 createStreamPostProcessorCallbacks 方法逻辑
		// ...
	}

	// ... 其他方法实现
}
```

#### 步骤 2：编写单元测试

```typescript
// src/core/task/handlers/StreamHandler.spec.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { StreamHandler } from "./StreamHandler"
import type { Task } from "../Task"

describe("StreamHandler", () => {
	let streamHandler: StreamHandler
	let mockTask: Partial<Task>
	let mockDependencies: any

	beforeEach(() => {
		mockTask = {
			taskId: "test-task-id",
			apiConfiguration: {},
			api: {
				getModel: vi.fn(() => ({ id: "test-model", info: {} })),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			},
			// ... 其他必需的属性
		}
		mockDependencies = {
			// ... mock 依赖
		}
		streamHandler = new StreamHandler(mockTask as Task, mockDependencies)
	})

	describe("attemptApiRequest", () => {
		it("should handle successful API requests", async () => {
			// 测试逻辑
		})

		it("should handle retry logic", async () => {
			// 测试逻辑
		})

		it("should handle context window errors", async () => {
			// 测试逻辑
		})
	})

	describe("cancelCurrentRequest", () => {
		it("should cancel current request", () => {
			// 测试逻辑
		})
	})
})
```

#### 步骤 3：集成到 Task 类

```typescript
// src/core/task/Task.ts
export class Task extends EventEmitter<TaskEvents> implements TaskLike {
	// 添加流处理器
	private streamHandler: StreamHandler

	constructor(options: TaskOptions) {
		super()
		// ... 现有代码

		// 初始化流处理器
		this.streamHandler = new StreamHandler(this, this.createStreamDependencies())
	}

	// 委托方法
	async *attemptApiRequest(
		retryAttempt: number = 0,
		options: { skipProviderRateLimit?: boolean } = {}
	): ApiStream {
		yield* this.streamHandler.attemptApiRequest(retryAttempt, options)
	}

	cancelCurrentRequest(): void {
		this.streamHandler.cancelCurrentRequest()
	}

	// ... 其他委托方法
}
```

### 验证清单
- [ ] StreamHandler 类实现完整
- [ ] 所有单元测试通过
- [ ] 集成测试通过
- [ ] 现有功能不受影响
- [ ] 代码覆盖率 > 80%

---

## 阶段四：状态管理模块

### 目标
将状态管理相关的逻辑从 Task 类中提取到独立的模块。

### 文件结构
```
src/core/task/
├── state/
│   ├── TaskStateManager.ts        # 状态管理器实现
│   ├── TaskStateManager.spec.ts   # 单元测试
│   └── types.ts                   # 类型定义
```

### 实现步骤

#### 步骤 1：创建 TaskStateManager 类

```typescript
// src/core/task/state/TaskStateManager.ts
import type {
	ITaskStateManager,
	TaskState,
	StateUpdateOptions,
} from "../interfaces/ITaskStateManager"
import type { TaskStatus } from "@coder/types"
import { EventEmitter } from "events"

export class TaskStateManager extends EventEmitter implements ITaskStateManager {
	private state: TaskState

	constructor(initialState: Partial<TaskState>) {
		super()
		this.state = this.createInitialState(initialState)
	}

	getState(): Readonly<TaskState> {
		return { ...this.state }
	}

	updateState(updates: Partial<TaskState>, options?: StateUpdateOptions): void {
		const oldState = { ...this.state }
		this.state = { ...this.state, ...updates }

		if (options?.emitEvent !== false) {
			this.emit("stateUpdated", this.getState())
			this.emitStateChanges(oldState, this.state)
		}
	}

	resetState(initialState?: Partial<TaskState>): void {
		this.state = this.createInitialState(initialState)
		this.emit("stateUpdated", this.getState())
	}

	getTaskStatus(): TaskStatus {
		if (this.state.interactiveAsk) return TaskStatus.Interactive
		if (this.state.resumableAsk) return TaskStatus.Resumable
		if (this.state.idleAsk) return TaskStatus.Idle
		return TaskStatus.Running
	}

	// ... 其他方法实现

	private createInitialState(partial: Partial<TaskState>): TaskState {
		return {
			taskId: partial.taskId || "",
			instanceId: partial.instanceId || "",
			workspacePath: partial.workspacePath || "",
			taskNumber: partial.taskNumber || -1,
			abort: false,
			abandoned: false,
			didFinishAbortingStream: false,
			isInitialized: false,
			isPaused: false,
			isWaitingForFirstChunk: false,
			isStreaming: false,
			currentStreamingContentIndex: 0,
			currentStreamingDidCheckpoint: false,
			assistantMessageSavedToHistory: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
			didToolFailInCurrentTurn: false,
			didCompleteReadingStream: false,
			consecutiveMistakeCount: 0,
			consecutiveMistakeLimit: 5,
			consecutiveNoToolUseCount: 0,
			consecutiveNoAssistantMessagesCount: 0,
			didEditFile: false,
			started: false,
			...partial,
		}
	}

	private emitStateChanges(oldState: TaskState, newState: TaskState): void {
		// 检测状态变化并发射相应事件
		if (oldState.abort !== newState.abort) {
			this.emit("abortStateChanged", newState.abort, newState.abortReason)
		}
		if (oldState.isStreaming !== newState.isStreaming) {
			this.emit("streamingStateChanged", newState.isStreaming)
		}
		// ... 其他状态变化检测
	}
}
```

#### 步骤 2：编写单元测试

```typescript
// src/core/task/state/TaskStateManager.spec.ts
import { describe, it, expect, beforeEach } from "vitest"
import { TaskStateManager } from "./TaskStateManager"
import type { TaskState } from "../interfaces/ITaskStateManager"

describe("TaskStateManager", () => {
	let stateManager: TaskStateManager

	beforeEach(() => {
		stateManager = new TaskStateManager({
			taskId: "test-task-id",
			instanceId: "test-instance-id",
			workspacePath: "/test/workspace",
		})
	})

	describe("getState", () => {
		it("should return a readonly copy of state", () => {
			const state = stateManager.getState()
			expect(state).toBeDefined()
			expect(state.taskId).toBe("test-task-id")
		})
	})

	describe("updateState", () => {
		it("should update state and emit event", (done) => {
			stateManager.on("stateUpdated", (newState) => {
				expect(newState.abort).toBe(true)
				done()
			})

			stateManager.updateState({ abort: true })
		})

		it("should not emit event when emitEvent is false", () => {
			let eventEmitted = false
			stateManager.on("stateUpdated", () => {
				eventEmitted = true
			})

			stateManager.updateState({ abort: true }, { emitEvent: false })
			expect(eventEmitted).toBe(false)
		})
	})

	describe("getTaskStatus", () => {
		it("should return correct status", () => {
			expect(stateManager.getTaskStatus()).toBe("running")

			stateManager.updateState({ idleAsk: {} as any })
			expect(stateManager.getTaskStatus()).toBe("idle")
		})
	})
})
```

#### 步骤 3：集成到 Task 类

```typescript
// src/core/task/Task.ts
export class Task extends EventEmitter<TaskEvents> implements TaskLike {
	// 添加状态管理器
	private stateManager: TaskStateManager

	constructor(options: TaskOptions) {
		super()
		// ... 现有代码

		// 初始化状态管理器
		this.stateManager = new TaskStateManager({
			taskId: this.taskId,
			instanceId: this.instanceId,
			workspacePath: this.workspacePath,
			taskNumber: this.taskNumber,
			// ... 其他初始状态
		})

		// 监听状态变化
		this.stateManager.on("stateUpdated", (state) => {
			// 处理状态变化
		})
	}

	// 委托方法
	get taskStatus(): TaskStatus {
		return this.stateManager.getTaskStatus()
	}

	get taskAsk(): ClineMessage | undefined {
		return this.stateManager.getTaskAsk()
	}

	// ... 其他委托方法
}
```

### 验证清单
- [ ] TaskStateManager 类实现完整
- [ ] 所有单元测试通过
- [ ] 集成测试通过
- [ ] 现有功能不受影响
- [ ] 代码覆盖率 > 80%

---

## 阶段五：指标收集模块

### 目标
将指标收集相关的逻辑从 Task 类中提取到独立的模块。

### 文件结构
```
src/core/task/
├── metrics/
│   ├── TaskMetrics.ts             # 指标收集器实现
│   ├── TaskMetrics.spec.ts        # 单元测试
│   └── types.ts                   # 类型定义
```

### 实现步骤

#### 步骤 1：创建 TaskMetrics 类

```typescript
// src/core/task/metrics/TaskMetrics.ts
import type {
	ITaskMetrics,
	MetricsSnapshot,
} from "../interfaces/ITaskMetrics"
import type { TokenUsage, ToolUsage, ToolName } from "@coder/types"
import { EventEmitter } from "events"

export class TaskMetrics extends EventEmitter implements ITaskMetrics {
	private tokenUsage: TokenUsage = {}
	private toolUsage: ToolUsage = {}
	private snapshot?: MetricsSnapshot

	getTokenUsage(): TokenUsage {
		return { ...this.tokenUsage }
	}

	getToolUsage(): ToolUsage {
		return { ...this.toolUsage }
	}

	recordToolUsage(toolName: ToolName): void {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}
		this.toolUsage[toolName].attempts++
		this.emit("toolUsageRecorded", toolName, this.toolUsage[toolName].attempts)
	}

	recordToolError(toolName: ToolName, error?: string): void {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}
		this.toolUsage[toolName].failures++
		this.emit("toolErrorRecorded", toolName, error)
	}

	// ... 其他方法实现
}
```

#### 步骤 2：编写单元测试

```typescript
// src/core/task/metrics/TaskMetrics.spec.ts
import { describe, it, expect, beforeEach } from "vitest"
import { TaskMetrics } from "./TaskMetrics"

describe("TaskMetrics", () => {
	let metrics: TaskMetrics

	beforeEach(() => {
		metrics = new TaskMetrics()
	})

	describe("recordToolUsage", () => {
		it("should record tool usage", () => {
			metrics.recordToolUsage("read_file")
			const stats = metrics.getToolUsageStats("read_file")
			expect(stats?.attempts).toBe(1)
		})

		it("should emit event", (done) => {
			metrics.on("toolUsageRecorded", (toolName, attempts) => {
				expect(toolName).toBe("read_file")
				expect(attempts).toBe(1)
				done()
			})

			metrics.recordToolUsage("read_file")
		})
	})

	describe("recordToolError", () => {
		it("should record tool error", () => {
			metrics.recordToolError("read_file", "test error")
			const stats = metrics.getToolUsageStats("read_file")
			expect(stats?.failures).toBe(1)
		})
	})

	describe("calculateTotalCost", () => {
		it("should calculate total cost", () => {
			metrics.recordToolUsage("read_file")
			const cost = metrics.calculateTotalCost()
			expect(typeof cost).toBe("number")
		})
	})
})
```

#### 步骤 3：集成到 Task 类

```typescript
// src/core/task/Task.ts
export class Task extends EventEmitter<TaskEvents> implements TaskLike {
	// 添加指标收集器
	private metrics: TaskMetrics

	constructor(options: TaskOptions) {
		super()
		// ... 现有代码

		// 初始化指标收集器
		this.metrics = new TaskMetrics()

		// 监听指标事件
		this.metrics.on("toolUsageRecorded", (toolName, attempts) => {
			this.emit(CoderEventName.TaskToolUsed, this.taskId, toolName)
		})

		this.metrics.on("toolErrorRecorded", (toolName, error) => {
			this.emit(CoderEventName.TaskToolFailed, this.taskId, toolName, error)
		})
	}

	// 委托方法
	getTokenUsage(): TokenUsage {
		return this.metrics.getTokenUsage()
	}

	recordToolUsage(toolName: ToolName): void {
		this.metrics.recordToolUsage(toolName)
	}

	recordToolError(toolName: ToolName, error?: string): void {
		this.metrics.recordToolError(toolName, error)
	}

	// ... 其他委托方法
}
```

### 验证清单
- [ ] TaskMetrics 类实现完整
- [ ] 所有单元测试通过
- [ ] 集成测试通过
- [ ] 现有功能不受影响
- [ ] 代码覆盖率 > 80%

---

## 阶段六：Task 类重构

### 目标
将 Task 类重构为门面模式，委托给各个处理模块。

### 重构后的 Task 类结构

```typescript
// src/core/task/Task.ts
import { EventEmitter } from "events"
import type { TaskLike, TaskEvents, TaskOptions } from "@coder/types"
import type { ITaskDependencies } from "./interfaces/ITaskDependencies"
import { MessageHandler } from "./handlers/MessageHandler"
import { StreamHandler } from "./handlers/StreamHandler"
import { TaskStateManager } from "./state/TaskStateManager"
import { TaskMetrics } from "./metrics/TaskMetrics"

export class Task extends EventEmitter<TaskEvents> implements TaskLike {
	// 核心属性
	readonly taskId: string
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	readonly instanceId: string
	readonly metadata: any
	readonly workspacePath: string
	readonly taskNumber: number

	// 处理模块
	private messageHandler: MessageHandler
	private streamHandler: StreamHandler
	private stateManager: TaskStateManager
	private metrics: TaskMetrics

	// 依赖
	private dependencies: ITaskDependencies

	constructor(options: TaskOptions) {
		super()

		// 初始化核心属性
		this.taskId = options.historyItem?.id || uuidv7()
		this.rootTaskId = options.historyItem?.rootTaskId || options.rootTask?.taskId
		this.parentTaskId = options.historyItem?.parentTaskId || options.parentTask?.taskId
		this.instanceId = crypto.randomUUID().slice(0, 8)
		this.metadata = {
			task: options.historyItem?.task || options.task,
			images: options.historyItem ? [] : options.images,
		}
		this.workspacePath = options.workspacePath || getWorkspacePath(path.join(os.homedir(), "Desktop"))
		this.taskNumber = options.taskNumber || -1

		// 创建依赖
		this.dependencies = this.createDependencies(options)

		// 初始化处理模块
		this.stateManager = new TaskStateManager({
			taskId: this.taskId,
			instanceId: this.instanceId,
			workspacePath: this.workspacePath,
			taskNumber: this.taskNumber,
		})

		this.messageHandler = new MessageHandler(this, this.dependencies.provider)
		this.streamHandler = new StreamHandler(this, this.dependencies)
		this.metrics = new TaskMetrics()

		// 设置事件监听
		this.setupEventListeners()

		// 启动任务
		if (options.startTask) {
			this.start(options.task, options.images)
		}
	}

	// ===== 消息处理方法（委托给 MessageHandler） =====
	async ask(
		type: any,
		text?: string,
		partial?: boolean,
		progressStatus?: any,
		isProtected?: boolean
	): Promise<any> {
		return this.messageHandler.ask(type, text, partial, progressStatus, isProtected)
	}

	async say(type: any, options?: any): Promise<void> {
		return this.messageHandler.say(type, options)
	}

	// ... 其他消息处理方法

	// ===== 流处理方法（委托给 StreamHandler） =====
	async *attemptApiRequest(retryAttempt?: number, options?: any): AsyncGenerator<any> {
		yield* this.streamHandler.attemptApiRequest(retryAttempt, options)
	}

	cancelCurrentRequest(): void {
		this.streamHandler.cancelCurrentRequest()
	}

	// ... 其他流处理方法

	// ===== 状态管理方法（委托给 StateManager） =====
	get taskStatus(): any {
		return this.stateManager.getTaskStatus()
	}

	get taskAsk(): any {
		return this.stateManager.getTaskAsk()
	}

	// ... 其他状态管理方法

	// ===== 指标收集方法（委托给 Metrics） =====
	getTokenUsage(): any {
		return this.metrics.getTokenUsage()
	}

	recordToolUsage(toolName: any): void {
		this.metrics.recordToolUsage(toolName)
	}

	recordToolError(toolName: any, error?: string): void {
		this.metrics.recordToolError(toolName, error)
	}

	// ... 其他指标收集方法

	// ===== 核心任务方法 =====
	async startTask(task?: string, images?: string[]): Promise<void> {
		// 核心任务启动逻辑
	}

	async resumeTaskFromHistory(): Promise<void> {
		// 核心任务恢复逻辑
	}

	async abortTask(isAbandoned?: boolean): Promise<void> {
		// 核心中止逻辑
	}

	dispose(): void {
		// 清理逻辑
	}

	// ===== 私有方法 =====
	private createDependencies(options: TaskOptions): ITaskDependencies {
		// 创建依赖对象
		return {
			// ... 依赖创建逻辑
		}
	}

	private setupEventListeners(): void {
		// 设置事件监听
	}

	// ===== Getter =====
	get cwd(): string {
		return this.workspacePath
	}
}
```

### 验证清单
- [ ] Task 类重构完成
- [ ] 所有委托方法正确实现
- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 现有功能不受影响
- [ ] 代码覆盖率 > 80%

---

## 测试策略

### 单元测试
每个模块都需要有完整的单元测试：

```bash
# 运行所有单元测试
cd src && npx vitest run core/task

# 运行特定模块的测试
cd src && npx vitest run core/task/handlers/MessageHandler.spec.ts
cd src && npx vitest run core/task/handlers/StreamHandler.spec.ts
cd src && npx vitest run core/task/state/TaskStateManager.spec.ts
cd src && npx vitest run core/task/metrics/TaskMetrics.spec.ts
```

### 集成测试
测试各个模块之间的协作：

```typescript
// src/core/task/Task.integration.spec.ts
describe("Task Integration", () => {
	it("should complete a full task lifecycle", async () => {
		const task = new Task(createTaskOptions())

		await task.startTask("test task")
		expect(task.isInitialized).toBe(true)

		await task.abortTask()
		expect(task.abort).toBe(true)
	})

	it("should handle message flow", async () => {
		const task = new Task(createTaskOptions())

		const result = await task.ask("tool", "test")
		expect(result).toBeDefined()
	})

	it("should handle stream processing", async () => {
		const task = new Task(createTaskOptions())

		const stream = task.attemptApiRequest(0)
		// 测试流处理
	})
})
```

### 回归测试
确保重构不影响现有功能：

```bash
# 运行所有测试
cd src && npx vitest run

# 运行特定测试套件
cd src && npx vitest run core/task
```

---

## 迁移指南

### 对于开发者

#### 1. 更新导入
```typescript
// 旧方式
import { Task } from "./core/task/Task"

// 新方式（保持兼容）
import { Task } from "./core/task/Task"

// 新方式（使用特定模块）
import { MessageHandler } from "./core/task/handlers/MessageHandler"
import { TaskStateManager } from "./core/task/state/TaskStateManager"
```

#### 2. 使用接口
```typescript
// 使用接口进行依赖注入
import type { ITaskMessageHandler } from "./core/task/interfaces"

function processMessage(handler: ITaskMessageHandler) {
	handler.ask("tool", "test")
}
```

#### 3. Mock 测试
```typescript
// Mock 消息处理器
const mockMessageHandler = {
	ask: vi.fn(),
	say: vi.fn(),
} as ITaskMessageHandler

// Mock 状态管理器
const mockStateManager = {
	getState: vi.fn(),
	updateState: vi.fn(),
} as ITaskStateManager
```

### 对于测试

#### 1. 单元测试
```typescript
// 测试单个模块
import { MessageHandler } from "./handlers/MessageHandler"

describe("MessageHandler", () => {
	it("should handle ask requests", async () => {
		const handler = new MessageHandler(mockTask, mockProvider)
		const result = await handler.ask("tool", "test")
		expect(result).toBeDefined()
	})
})
```

#### 2. 集成测试
```typescript
// 测试模块协作
import { Task } from "./Task"

describe("Task Integration", () => {
	it("should complete full lifecycle", async () => {
		const task = new Task(options)
		await task.startTask("test")
		expect(task.isInitialized).toBe(true)
	})
})
```

---

## 总结

### 重构收益
1. **代码质量提升**：文件行数从 4016 行减少到 ~500 行（Task.ts）+ 各子模块
2. **可测试性提升**：单元测试覆盖率从 30% 提升到 80%+
3. **可维护性提升**：职责清晰，易于理解和修改
4. **可扩展性提升**：便于添加新功能

### 下一步
1. 评审本重构指南
2. 选择重构阶段开始实施
3. 每个阶段完成后进行代码审查
4. 持续监控测试覆盖率

---

**文档版本**: 1.0  
**创建日期**: 2024-01-15  
**作者**: AI Assistant  
**状态**: 待实施