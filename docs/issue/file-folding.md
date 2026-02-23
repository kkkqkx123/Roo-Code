当前项目的condense模块中的文件折叠存在问题。
目前期望的是按照 @/docs/design/context-compression-requirements.md 的设计实现，但实际上折叠的结果类似于：
      {
        "type": "text",
        "text": "<system-reminder>\n## File Context: src/core/webview/ClineProvider.ts\n469--472 | const timeoutId = setTimeout(() => {\n764--767 | const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {\n775--779 | const viewStateDisposable = webviewView.onDidChangeViewState(() => {\n784--788 | const visibilityDisposable = webviewView.onDidChangeVisibility(() => {\n815--820 | const configDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {\n1007--1013 | const { messageIndex, apiConversationHistoryIndex } = (() => {\n1654--1657 | const aggregatedCosts = await aggregateTaskCostsRecursive(taskId, async (id: string) => {\n1715--1728 | const collectChildIds = async (taskId: string): Promise<void> => {\n102--110 | interface PendingEditOperation {\n112--3186 | export class ClineProvider\n156--294 | constructor(\n219--246 | const onTaskAborted = async () => {\n349--364 | async addClineToStack(task: Task) {\n372--440 | async removeClineFromStack(options?: { skipDelegationRepair?: boolean }) {\n530--580 | async dispose() {\n685--829 | async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {\n796--807 | async () => {\n1004--1035 | setTimeout(async () => {\n1268--1271 | const onReceiveMessage = async (message: WebviewMessage) => {\n1420--1473 | async upsertProviderProfile(\n1475--1496 | async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {\n1525--1561 | async activateProviderProfile(\n1563--1567 | async updateCustomInstructions(instructions?: string) {\n1571--1592 | async ensureMcpServersDirectoryExists(): Promise<string> {\n1594--1598 | async ensureSettingsDirectoryExists(): Promise<string> {\n1602--1646 | async getTaskWithId(id: string): Promise<{\n1648--1660 | async getTaskWithAggregatedCosts(taskId: string): Promise<{\n1662--1670 | async showTaskWithId(id: string) {\n1672--1684 | async exportTaskWithId(id: string) {\n1687--1701 | async condenseTaskContext(taskId: string) {\n1705--1782 | async deleteTaskWithId(id: string, cascadeSubtasks: boolean = true) {\n1784--1789 | async deleteTaskFromState(id: string) {\n1791--1794 | async refreshWorkspace() {\n1796--1805 | async postStateToWebview() {\n1815--1823 | async postStateToWebviewWithoutTaskHistory(): Promise<void> {\n1836--1842 | async postStateToWebviewWithoutClineMessages(): Promise<void> {\n1900--2094 | async getStateToPostToWebview(): Promise<ExtensionState> {\n2102--2226 | async getState(): Promise<\n2236--2250 | async updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<HistoryItem[]> {\n2343--2360 | async resetState() {\n</system-reminder>"
      },
      {
        "type": "text",
        "text": "<system-reminder>\n## File Context: packages/types/src/global-settings.ts\n283--287 | export type SecretState = {\n</system-reminder>"
      },
      {
        "type": "text",
        "text": "<system-reminder>\n## File Context: src/services/code-index/interfaces/vector-storage-config.ts\n9--14 | export interface HnswConfig {\n19--24 | export interface VectorConfig {\n29--36 | export interface QuantizationConfig {\n41--46 | export interface WalConfig {\n51--58 | export interface CustomVectorStorageConfig {\n68--82 | export interface VectorStorageConfig {\n92--101 | export interface VectorStoragePresetDefinition {\n</system-reminder>"
      },

可以看到并非只保留name，而是把完整捕获内容都包含了进去，且行也多了结束行号，函数合并也明显没有实现

分析导致问题的原因，并给出修改方案
