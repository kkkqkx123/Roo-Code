这个文件确实承担了太多职责，可以按照**单一职责原则**进行拆分。以下是详细的重构方案：

## 一、核心重构思路

将 `Task` 类拆分为以下核心模块：

```
src/core/task/
├── Task.ts                    # 主类（精简后的协调器）
├── interfaces/
│   └── ITask.ts               # Task接口定义
├── services/
│   ├── TaskLifecycleService.ts    # 生命周期管理
│   ├── TaskMessageService.ts      # 消息历史管理
│   ├── TaskInteractionService.ts  # 用户交互（ask/say）
│   ├── TaskToolService.ts         # 工具调用管理
│   ├── TaskApiService.ts          # API通信管理
│   ├── TaskContextService.ts      # 上下文管理（总结/截断）
│   ├── TaskCheckpointService.ts   # 检查点管理
│   ├── TaskSubtaskService.ts      # 子任务管理
│   └── TaskMetricsService.ts      # 统计指标管理
├── managers/
│   └── TaskStateManager.ts        # 状态管理
└── factories/
    └── TaskFactory.ts          # Task工厂类
```

## 二、详细拆分方案

### 1. **Task 接口定义** (`interfaces/ITask.ts`)

```typescript
export interface ITask extends EventEmitter<TaskEvents> {
    taskId: string
    rootTaskId?: string
    parentTaskId?: string
    childTaskId?: string
    
    // 核心状态
    get taskStatus(): TaskStatus
    get taskAsk(): ClineMessage | undefined
    get cwd(): string
    get workspacePath(): string
    
    // 生命周期
    start(): void
    abortTask(isAbandoned?: boolean): Promise<void>
    dispose(): void
    
    // 交互
    ask(type: ClineAsk, text?: string, ...): Promise<AskResponse>
    say(type: ClineSay, text?: string, ...): Promise<undefined>
    submitUserMessage(text: string, images?: string[], mode?: string, profile?: string): Promise<void>
    
    // 工具
    recordToolUsage(toolName: ToolName): void
    recordToolError(toolName: ToolName, error?: string): void
    
    // 消息
    get messageManager(): MessageManager
    get queuedMessages(): QueuedMessage[]
    combineMessages(messages: ClineMessage[]): ClineMessage[]
    
    // 检查点
    checkpointSave(force?: boolean, suppressMessage?: boolean): Promise<CheckpointResult>
    checkpointRestore(options: CheckpointRestoreOptions): Promise<void>
    checkpointDiff(options: CheckpointDiffOptions): Promise<DiffResult>
    
    // 指标
    getTokenUsage(): TokenUsage
    get toolUsage(): ToolUsage
}
```

### 2. **精简后的 Task 主类** (`Task.ts`)

作为协调器，只保留核心状态和事件分发：

```typescript
export class Task extends EventEmitter<TaskEvents> implements ITask {
    // 只保留核心标识符
    readonly taskId: string
    readonly rootTaskId?: string
    readonly parentTaskId?: string
    childTaskId?: string
    
    readonly instanceId: string
    readonly cwd: string
    readonly workspacePath: string
    
    // 委托给各个服务
    private lifecycleService: TaskLifecycleService
    private messageService: TaskMessageService
    private interactionService: TaskInteractionService
    private toolService: TaskToolService
    private apiService: TaskApiService
    private contextService: TaskContextService
    private checkpointService: TaskCheckpointService
    private subtaskService: TaskSubtaskService
    private metricsService: TaskMetricsService
    private stateManager: TaskStateManager
    
    constructor(options: TaskOptions) {
        super()
        
        // 初始化核心标识符
        this.taskId = options.historyItem?.id || uuidv7()
        this.rootTaskId = options.historyItem?.rootTaskId || options.rootTask?.taskId
        this.parentTaskId = options.historyItem?.parentTaskId || options.parentTask?.taskId
        this.workspacePath = options.workspacePath ?? getWorkspacePath(path.join(os.homedir(), "Desktop"))
        this.cwd = this.workspacePath
        this.instanceId = crypto.randomUUID().slice(0, 8)
        
        // 初始化状态管理器
        this.stateManager = new TaskStateManager(this, options)
        
        // 初始化各个服务（注入依赖）
        this.messageService = new TaskMessageService(this, this.stateManager)
        this.metricsService = new TaskMetricsService(this, this.messageService)
        this.interactionService = new TaskInteractionService(this, this.stateManager, this.messageService)
        this.toolService = new TaskToolService(this, this.stateManager, this.interactionService, this.metricsService)
        this.apiService = new TaskApiService(this, this.stateManager, this.messageService, this.toolService, this.interactionService, this.metricsService)
        this.contextService = new TaskContextService(this, this.stateManager, this.apiService, this.messageService, this.interactionService)
        this.checkpointService = new TaskCheckpointService(this, this.stateManager, this.interactionService)
        this.subtaskService = new TaskSubtaskService(this, this.stateManager)
        this.lifecycleService = new TaskLifecycleService(
            this, 
            this.stateManager,
            this.apiService,
            this.interactionService,
            this.messageService,
            this.checkpointService
        )
        
        // 设置选项
        this.lifecycleService.initialize(options)
    }
    
    // 委托方法示例
    start(): void {
        this.lifecycleService.start()
    }
    
    async abortTask(isAbandoned = false): Promise<void> {
        await this.lifecycleService.abortTask(isAbandoned)
    }
    
    async ask(type: ClineAsk, text?: string, partial?: boolean, ...): Promise<AskResponse> {
        return this.interactionService.ask(type, text, partial, ...)
    }
    
    // ... 其他委托方法
}
```

### 3. **状态管理器** (`managers/TaskStateManager.ts`)

集中管理所有状态：

```typescript
export class TaskStateManager {
    private _taskMode: string | undefined
    private _taskApiConfigName: string | undefined
    private _isPaused: boolean = false
    private _abort: boolean = false
    private _abandoned: boolean = false
    private _abortReason?: ClineApiReqCancelReason
    
    // 消息状态
    idleAsk?: ClineMessage
    resumableAsk?: ClineMessage
    interactiveAsk?: ClineMessage
    
    // 流式状态
    isStreaming: boolean = false
    isWaitingForFirstChunk: boolean = false
    assistantMessageSavedToHistory: boolean = false
    
    // ... getters/setters
    
    async initializeMode(provider: ClineProvider): Promise<void> {
        // 原有的 mode 初始化逻辑
    }
    
    async initializeApiConfig(provider: ClineProvider): Promise<void> {
        // 原有的 apiConfig 初始化逻辑
    }
    
    updateApiConfiguration(newConfig: ProviderSettings): void {
        // 更新 API 配置
    }
}
```

### 4. **各服务实现**

#### **TaskLifecycleService** (`services/TaskLifecycleService.ts`)

```typescript
export class TaskLifecycleService {
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager,
        private apiService: TaskApiService,
        private interactionService: TaskInteractionService,
        private messageService: TaskMessageService,
        private checkpointService: TaskCheckpointService
    ) {}
    
    async startTask(task?: string, images?: string[]): Promise<void> {
        // 原有的 startTask 逻辑
    }
    
    async resumeTaskFromHistory(): Promise<void> {
        // 原有的 resumeTaskFromHistory 逻辑
    }
    
    async abortTask(isAbandoned = false): Promise<void> {
        // 原有的 abortTask 逻辑
    }
    
    dispose(): void {
        // 原有的 dispose 逻辑
    }
}
```

#### **TaskMessageService** (`services/TaskMessageService.ts`)

```typescript
export class TaskMessageService {
    apiConversationHistory: ApiMessage[] = []
    clineMessages: ClineMessage[] = []
    
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager
    ) {}
    
    async addToApiConversationHistory(message: Anthropic.MessageParam, reasoning?: string): Promise<void> {
        // 原有的 addToApiConversationHistory 逻辑
    }
    
    async overwriteApiConversationHistory(newHistory: ApiMessage[]): Promise<void> {
        // 原有的 overwriteApiConversationHistory 逻辑
    }
    
    async addToClineMessages(message: ClineMessage): Promise<void> {
        // 原有的 addToClineMessages 逻辑
    }
    
    async flushPendingToolResultsToHistory(): Promise<boolean> {
        // 原有的 flushPendingToolResultsToHistory 逻辑
    }
    
    async saveMessages(): Promise<boolean> {
        // 原有的保存逻辑
    }
}
```

#### **TaskApiService** (`services/TaskApiService.ts`)

```typescript
export class TaskApiService {
    apiConfiguration: ProviderSettings
    api: ApiHandler
    
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager,
        private messageService: TaskMessageService,
        private toolService: TaskToolService,
        private interactionService: TaskInteractionService,
        private metricsService: TaskMetricsService
    ) {}
    
    async *attemptApiRequest(retryAttempt: number = 0, options?: { skipProviderRateLimit?: boolean }): ApiStream {
        // 原有的 attemptApiRequest 逻辑
    }
    
    updateApiConfiguration(newConfig: ProviderSettings): void {
        // 更新 API 配置
    }
    
    private async maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void> {
        // 原有的速率限制逻辑
    }
    
    private async backoffAndAnnounce(retryAttempt: number, error: any): Promise<void> {
        // 原有的退避重试逻辑
    }
}
```

#### **TaskInteractionService** (`services/TaskInteractionService.ts`)

```typescript
export class TaskInteractionService {
    private askResponse?: ClineAskResponse
    private askResponseText?: string
    private askResponseImages?: string[]
    public lastMessageTs?: number
    
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager,
        private messageService: TaskMessageService
    ) {}
    
    async ask(type: ClineAsk, text?: string, partial?: boolean, ...): Promise<AskResponse> {
        // 原有的 ask 逻辑
    }
    
    async say(type: ClineSay, text?: string, images?: string[], partial?: boolean, ...): Promise<undefined> {
        // 原有的 say 逻辑
    }
    
    handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]): void {
        // 原有的 handleWebviewAskResponse 逻辑
    }
    
    cancelAutoApprovalTimeout(): void {
        // 原有的取消自动审批逻辑
    }
}
```

#### **TaskToolService** (`services/TaskToolService.ts`)

```typescript
export class TaskToolService {
    toolUsage: ToolUsage = {}
    consecutiveMistakeCount: number = 0
    consecutiveNoToolUseCount: number = 0
    
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager,
        private interactionService: TaskInteractionService,
        private metricsService: TaskMetricsService
    ) {}
    
    recordToolUsage(toolName: ToolName): void {
        // 原有的 recordToolUsage 逻辑
    }
    
    recordToolError(toolName: ToolName, error?: string): void {
        // 原有的 recordToolError 逻辑
    }
    
    pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam): boolean {
        // 原有的 pushToolResultToUserContent 逻辑
    }
    
    async executeTool(toolUse: ToolUse): Promise<void> {
        // 工具执行逻辑
    }
}
```

#### **TaskContextService** (`services/TaskContextService.ts`)

```typescript
export class TaskContextService {
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager,
        private apiService: TaskApiService,
        private messageService: TaskMessageService,
        private interactionService: TaskInteractionService
    ) {}
    
    async condenseContext(): Promise<void> {
        // 原有的 condenseContext 逻辑
    }
    
    async handleContextWindowExceededError(retryAttempt: number): Promise<void> {
        // 原有的 handleContextWindowExceededError 逻辑
    }
    
    private async getFilesReadByRooSafely(context: string): Promise<string[] | undefined> {
        // 原有的 getFilesReadByRooSafely 逻辑
    }
}
```

#### **TaskMetricsService** (`services/TaskMetricsService.ts`)

```typescript
export class TaskMetricsService {
    private tokenUsageSnapshot?: TokenUsage
    private toolUsageSnapshot?: ToolUsage
    private debouncedEmitTokenUsage: ReturnType<typeof debounce>
    
    constructor(
        private task: ITask,
        private messageService: TaskMessageService
    ) {
        this.initializeDebouncedEmit()
    }
    
    getTokenUsage(): TokenUsage {
        // 原有的 getTokenUsage 逻辑
    }
    
    emitFinalTokenUsageUpdate(): void {
        // 原有的 emitFinalTokenUsageUpdate 逻辑
    }
    
    private initializeDebouncedEmit(): void {
        // 原有的 debounce 初始化逻辑
    }
}
```

#### **TaskCheckpointService** (`services/TaskCheckpointService.ts`)

```typescript
export class TaskCheckpointService {
    checkpointService?: RepoPerTaskCheckpointService
    
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager,
        private interactionService: TaskInteractionService
    ) {}
    
    async checkpointSave(force: boolean = false, suppressMessage: boolean = false): Promise<CheckpointResult> {
        // 原有的 checkpointSave 逻辑
    }
    
    async checkpointRestore(options: CheckpointRestoreOptions): Promise<void> {
        // 原有的 checkpointRestore 逻辑
    }
    
    async checkpointDiff(options: CheckpointDiffOptions): Promise<DiffResult> {
        // 原有的 checkpointDiff 逻辑
    }
}
```

#### **TaskSubtaskService** (`services/TaskSubtaskService.ts`)

```typescript
export class TaskSubtaskService {
    constructor(
        private task: ITask,
        private stateManager: TaskStateManager
    ) {}
    
    async startSubtask(message: string, initialTodos: TodoItem[], mode: string): Promise<Task> {
        // 原有的 startSubtask 逻辑
    }
    
    async resumeAfterDelegation(): Promise<void> {
        // 原有的 resumeAfterDelegation 逻辑
    }
}
```

### 5. **工厂类** (`factories/TaskFactory.ts`)

```typescript
export class TaskFactory {
    static async createTask(options: TaskOptions): Promise<Task> {
        const task = new Task(options)
        
        // 异步初始化
        await Promise.all([
            task.stateManager.initializeMode(options.provider),
            task.stateManager.initializeApiConfig(options.provider)
        ])
        
        return task
    }
    
    static async createAndStartTask(options: TaskOptions): Promise<[Task, Promise<void>]> {
        const task = await this.createTask(options)
        const promise = task.start()
        return [task, promise]
    }
}
```

## 三、依赖注入简化

为了简化依赖注入，可以创建一个服务容器：

```typescript
// containers/TaskServiceContainer.ts
export class TaskServiceContainer {
    constructor(
        public readonly task: ITask,
        public readonly stateManager: TaskStateManager,
        public readonly messageService: TaskMessageService,
        public readonly interactionService: TaskInteractionService,
        public readonly toolService: TaskToolService,
        public readonly apiService: TaskApiService,
        public readonly contextService: TaskContextService,
        public readonly metricsService: TaskMetricsService,
        public readonly checkpointService: TaskCheckpointService,
        public readonly subtaskService: TaskSubtaskService,
        public readonly lifecycleService: TaskLifecycleService
    ) {}
    
    static async create(task: Task, options: TaskOptions): Promise<TaskServiceContainer> {
        const stateManager = new TaskStateManager(task, options)
        
        // 按依赖顺序初始化
        const messageService = new TaskMessageService(task, stateManager)
        const metricsService = new TaskMetricsService(task, messageService)
        const interactionService = new TaskInteractionService(task, stateManager, messageService)
        const toolService = new TaskToolService(task, stateManager, interactionService, metricsService)
        const apiService = new TaskApiService(task, stateManager, messageService, toolService, interactionService, metricsService)
        const contextService = new TaskContextService(task, stateManager, apiService, messageService, interactionService)
        const checkpointService = new TaskCheckpointService(task, stateManager, interactionService)
        const subtaskService = new TaskSubtaskService(task, stateManager)
        const lifecycleService = new TaskLifecycleService(task, stateManager, apiService, interactionService, messageService, checkpointService)
        
        return new TaskServiceContainer(
            task, stateManager, messageService, interactionService,
            toolService, apiService, contextService, metricsService,
            checkpointService, subtaskService, lifecycleService
        )
    }
}
```

## 四、重构收益

1. **单一职责**：每个类只负责一个关注点，易于理解和维护
2. **可测试性**：可以单独测试每个服务，更容易编写单元测试
3. **可维护性**：修改一个功能不需要理解整个 Task 类
4. **可扩展性**：添加新功能只需创建新的服务，不需要修改现有代码
5. **依赖清晰**：通过构造函数明确声明依赖，便于管理和替换
6. **状态集中**：状态管理集中在一处，避免状态分散在各处导致的bug

这种拆分方式保留了原有的功能，同时使代码结构更加清晰、可维护。