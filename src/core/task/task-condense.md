## Interfaces

- **TaskOptions** (line 138) (exported)
- **StackItem** (line 2494) (inner)

## Type Aliases

- **TaskLike** (line 20) (inner)
- **TaskMetadata** (line 21) (inner)
- **TaskEvents** (line 22) (inner)
- **ProviderSettings** (line 23) (inner)
- **TokenUsage** (line 24) (inner)
- **ToolUsage** (line 25) (inner)
- **ToolName** (line 26) (inner)
- **ContextCondense** (line 27) (inner)
- **ContextTruncation** (line 28) (inner)
- **ClineMessage** (line 29) (inner)
- **ClineSay** (line 30) (inner)
- **ClineAsk** (line 31) (inner)
- **ToolProgressStatus** (line 32) (inner)
- **HistoryItem** (line 33) (inner)
- **CreateTaskOptions** (line 34) (inner)
- **ModelInfo** (line 35) (inner)
- **ClineApiReqCancelReason** (line 36) (inner)
- **ClineApiReqInfo** (line 37) (inner)
- **ApiMessage** (line 108) (inner)
- **CheckpointDiffOptions** (line 118) (inner)
- **CheckpointRestoreOptions** (line 119) (inner)
- **ReasoningItemForRequest** (line 4558) (inner)

## Task Class Methods

| Visibility | Static | Async | Method Signature | Return Type | Line |
|------------|--------|-------|------------------|-------------|------|
| static | ✓ |  | `resetGlobalApiRequestTime()` | void { | 291 |
| public |  |  | `pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam)` | boolean { | 371 |
| private |  | ✓ | `initializeTaskMode(provider: ClineProvider)` | Promise<void> { | 598 |
| private |  | ✓ | `initializeTaskApiConfigName(provider: ClineProvider)` | Promise<void> { | 632 |
| private |  |  | `setupProviderProfileChangeListener(provider: ClineProvider)` | void { | 658 |
| public |  | ✓ | `waitForModeInitialization()` | Promise<void> { | 704 |
| public |  | ✓ | `getTaskMode()` | Promise<string> { | 733 |
| public |  |  | `taskMode()` | string { | 763 |
| public |  | ✓ | `waitForApiConfigInitialization()` | Promise<void> { | 784 |
| public |  | ✓ | `getTaskApiConfigName()` | Promise<string | undefined> { | 801 |
| public |  |  | `taskApiConfigName()` | string | undefined { | 822 |
| public |  |  | `setTaskApiConfigName(apiConfigName: string | undefined)` | void { | 834 |
| static | ✓ |  | `create(options: TaskOptions)` | [Task, Promise<void>] { | 838 |
| private |  | ✓ | `getSavedApiConversationHistory()` | Promise<ApiMessage[]> { | 856 |
| public |  | ✓ | `flushPendingToolResultsToHistory()` | Promise<boolean> { | 1042 |
| private |  | ✓ | `saveApiConversationHistory()` | Promise<boolean> { | 1108 |
| public |  | ✓ | `retrySaveApiConversationHistory()` | Promise<boolean> { | 1141 |
| private |  | ✓ | `getSavedClineMessages()` | Promise<ClineMessage[]> { | 1162 |
| public |  | ✓ | `saveClineMessages()` | Promise<boolean> { | 1188 |
| private |  |  | `findMessageByTimestamp(ts: number)` | ClineMessage | undefined { | 1228 |
| public |  |  | `cancelAutoApprovalTimeout()` | void { | 1535 |
| public |  |  | `supersedePendingAsk()` | void { | 1550 |
| public |  |  | `updateApiConfiguration(newApiConfiguration: ProviderSettings)` | void { | 1560 |
| private |  | ✓ | `getFilesReadByRooSafely(context: string)` | Promise<string[] | undefined> { | 1620 |      
| public |  | ✓ | `condenseContext()` | Promise<void> { | 1629 |
| private |  | ✓ | `getEnabledMcpToolsCount()` | Promise<{ enabledToolCount: number; enabledServerCount: number }> { | 1869 |
| public |  |  | `start()` | void { | 1905 |
| private |  | ✓ | `startTask(task?: string, images?: string[])` | Promise<void> { | 1918 |
| public |  |  | `cancelCurrentRequest()` | void { | 2221 |
| public |  |  | `emitFinalTokenUsageUpdate()` | void { | 2234 |
| public |  |  | `dispose()` | void { | 2274 |
| public |  | ✓ | `resumeAfterDelegation()` | Promise<void> { | 2389 |
| private |  | ✓ | `initiateTaskLoop(userContent: Anthropic.Messages.ContentBlockParam[])` | Promise<void> { | 2456 |
| private |  | ✓ | `getSystemPrompt()` | Promise<string> { | 3836 |
| private |  |  | `getCurrentProfileId(state: any)` | string { | 3917 |
| private |  | ✓ | `handleContextWindowExceededError()` | Promise<void> { | 3924 |
| private |  | ✓ | `maybeWaitForProviderRateLimit(retryAttempt: number)` | Promise<void> { | 4056 |
| private |  | ✓ | `backoffAndAnnounce(retryAttempt: number, error: any)` | Promise<void> { | 4480 |
| public |  |  | `getTokenUsage()` | TokenUsage { | 4713 |
| public |  |  | `taskStatus()` | TaskStatus { | 4739 |
| public |  |  | `taskAsk()` | ClineMessage | undefined { | 4755 |
| public |  |  | `queuedMessages()` | QueuedMessage[] { | 4759 |
| public |  |  | `tokenUsage()` | TokenUsage | undefined { | 4763 |
| public |  |  | `messageManager()` | MessageManager { | 4800 |
| public |  |  | `processQueuedMessages()` | void { | 4814 |