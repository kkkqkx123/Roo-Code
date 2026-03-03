# Worktree 多分支并行工作机制分析

## 概述

本文档详细分析了 Roo-Code 项目中 worktree 功能如何支持多分支同时工作的架构设计、核心机制和实现细节。

---

## 一、核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                    VSCode Extension Layer                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ extension.ts    │  ┌─────────────────┐  ┌──────────────┐ │
│  │ (自动打开检测)   │  │ handlers.ts     │  │ ClineProvider│ │
│  │                 │  │ (消息桥接)       │  │ (状态管理)    │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Core Service Layer                         │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │ WorktreeService      │  │ WorktreeIncludeService       │ │
│  │ - Git worktree 管理   │  │ - .worktreeinclude 文件管理   │ │
│  │ - 分支管理            │  │ - 智能文件同步               │ │
│  │ - 跨平台支持          │  │ - 进度跟踪                   │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      Webview UI Layer                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ WorktreesView   │  │ CreateModal     │  │ DeleteModal  │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 文件结构

| 层级 | 文件路径 | 职责 |
|------|----------|------|
| **类型定义** | `packages/types/src/worktree.ts` | 平台无关的类型定义 |
| **核心服务** | `packages/core/src/worktree/worktree-service.ts` | Git worktree 管理服务 |
| **文件同步** | `packages/core/src/worktree/worktree-include.ts` | 智能文件同步和进度跟踪 |
| **VSCode 集成** | `src/core/webview/worktree/handlers.ts` | Webview 消息处理和 VSCode 桥接 |
| **UI 组件** | `webview-ui/src/components/worktrees/` | React 管理界面组件 |
| **扩展激活** | `src/extension.ts` | worktree 自动打开检测 |

---

## 二、多分支并行工作的关键机制

### 2.1 Git Worktree 原生支持

每个分支有独立的物理目录，通过 `git worktree` 命令管理：

```typescript
// packages/core/src/worktree/worktree-service.ts
async createWorktree(cwd: string, options: CreateWorktreeOptions) {
    // 创建新分支的 worktree: git worktree add -b <branch> <path> [<base>]
    const args = ["worktree", "add", "-b", branch, worktreePath, baseBranch]
    await execFileAsync("git", args, { cwd })
}
```

**关键特性**：
- 每个 worktree 是 Git 仓库的独立工作目录
- 不同 worktree 可检出不同分支
- 共享 `.git` 目录，节省磁盘空间
- 分支切换无需等待，直接在不同目录间切换

**Worktree 数据结构**：
```typescript
interface Worktree {
    path: string        // 工作目录绝对路径
    branch: string      // 检出的分支名
    commitHash: string  // 当前提交
    isCurrent: boolean  // 是否为当前工作区
    isBare: boolean     // 是否为主仓库
    isDetached: boolean // 是否为分离 HEAD 状态
    isLocked: boolean   // 是否被锁定
    lockReason?: string // 锁定原因
}
```

### 2.2 智能文件同步系统 (`.worktreeinclude`)

这是项目的核心创新点，解决 worktree 默认只包含版本控制文件的问题：

```typescript
// packages/core/src/worktree/worktree-include.ts
async copyWorktreeIncludeFiles(sourceDir: string, targetDir: string) {
    // 1. 读取 .worktreeinclude 和 .gitignore
    const worktreeIncludePatterns = await this.parseIgnoreFile(worktreeIncludePath)
    const gitignorePatterns = await this.parseIgnoreFile(gitignorePath)
    
    // 2. 创建 ignore 匹配器
    const worktreeIncludeMatcher = ignore().add(worktreeIncludePatterns)
    const gitignoreMatcher = ignore().add(gitignorePatterns)
    
    // 3. 找到同时匹配两个文件的项（交集）
    const itemsToCopy = await this.findMatchingItems(
        sourceDir, 
        worktreeIncludeMatcher,
        gitignoreMatcher
    )
    
    // 4. 复制这些文件到新 worktree（如 node_modules、.env 等）
    for (const item of itemsToCopy) {
        await this.copyDirectoryWithProgress(sourcePath, targetPath, item, onProgress)
    }
}
```

**同步策略**：
- `.worktreeinclude` 定义要复制的文件/目录
- 必须同时被 `.gitignore` 忽略（避免复制已跟踪文件）
- 跨平台支持：Windows 用 `robocopy`，Unix 用 `cp`
- 实时进度反馈（基于字节数而非文件数）

**进度跟踪机制**：
```typescript
private async copyDirectoryWithProgress(
    source: string,
    target: string,
    itemName: string,
    bytesCopiedBefore: number,
    onProgress?: CopyProgressCallback,
): Promise<number> {
    // 启动原生复制命令
    const copyPromise = new Promise<void>((resolve, reject) => {
        const proc = spawn(isWindows ? "robocopy" : "cp", args)
        proc.on("close", (code) => { /* ... */ })
    })
    
    // 轮询目标目录大小以报告进度
    const pollProgress = async () => {
        while (polling) {
            const currentSize = await this.getCurrentDirectorySize(target)
            const totalCopied = bytesCopiedBefore + currentSize
            onProgress?.({ bytesCopied: totalCopied, itemName })
            await new Promise((resolve) => setTimeout(resolve, 500))
        }
    }
    
    await Promise.all([copyPromise, pollProgress()])
}
```

### 2.3 VSCode 窗口级隔离

每个 worktree 在独立的 VSCode 窗口中打开：

```typescript
// src/core/webview/worktree/handlers.ts
async handleSwitchWorktree(provider, worktreePath, newWindow: boolean) {
    const worktreeUri = vscode.Uri.file(worktreePath)
    
    if (newWindow) {
        // 设置自动打开路径，新窗口自动打开 Coder 侧边栏
        await provider.contextProxy.setValue("worktreeAutoOpenPath", worktreePath)
        // 在新窗口中打开
        await vscode.commands.executeCommand("vscode.openFolder", worktreeUri, { 
            forceNewWindow: true 
        })
    } else {
        // 在当前窗口打开（会重新加载）
        await vscode.commands.executeCommand("vscode.openFolder", worktreeUri, { 
            forceNewWindow: false 
        })
    }
}
```

**自动打开机制**：
```typescript
// src/extension.ts
async function checkWorktreeAutoOpen(
    context: vscodeTypes.ExtensionContext,
    outputChannel: vscodeTypes.OutputChannel,
): Promise<void> {
    const worktreeAutoOpenPath = context.globalState.get<string>("worktreeAutoOpenPath")
    if (!worktreeAutoOpenPath) {
        return
    }
    
    const workspaceFolders = vscode.workspace.workspaceFolders
    const currentPath = workspaceFolders[0].uri.fsPath
    
    // 检查当前工作区路径是否匹配
    if (normalizePath(currentPath) === normalizePath(worktreeAutoOpenPath)) {
        // 清除状态防止重复触发
        await context.globalState.update("worktreeAutoOpenPath", undefined)
        
        // 自动打开 Coder 侧边栏
        setTimeout(async () => {
            await vscode.commands.executeCommand("coder-roo.plusButtonClicked")
        }, 500)
    }
}
```

### 2.4 分支与 Worktree 映射管理

```typescript
// packages/core/src/worktree/worktree-service.ts
async listWorktrees(cwd: string): Promise<Worktree[]> {
    const { stdout } = await execAsync("git worktree list --porcelain", { cwd })
    return this.parseWorktreeOutput(stdout, cwd)
}

private parseWorktreeOutput(output: string, currentCwd: string): Worktree[] {
    const worktrees: Worktree[] = []
    const entries = output.trim().split("\n\n")
    
    for (const entry of entries) {
        const worktree: Partial<Worktree> = { /* ... */ }
        
        for (const line of lines) {
            if (line.startsWith("worktree ")) {
                worktree.path = line.substring(9).trim()
            } else if (line.startsWith("branch ")) {
                // branch refs/heads/main -> main
                const branchRef = line.substring(7).trim()
                worktree.branch = branchRef.replace(/^refs\/heads\//, "")
            } else if (line === "locked") {
                worktree.isLocked = true
            }
            // ...
        }
        
        worktree.isCurrent = this.normalizePath(worktree.path) === this.normalizePath(currentCwd)
        worktrees.push(worktree as Worktree)
    }
    
    return worktrees
}
```

**可用分支查询**（支持过滤已在 worktree 中的分支）：
```typescript
async getAvailableBranches(cwd: string, includeWorktreeBranches = false): Promise<BranchInfo> {
    const [worktrees, localResult, remoteResult, currentBranch] = await Promise.all([
        this.listWorktrees(cwd),
        execAsync('git branch --format="%(refname:short)"', { cwd }),
        execAsync('git branch -r --format="%(refname:short)"', { cwd }),
        this.getCurrentBranch(cwd),
    ])
    
    const branchesInWorktrees = new Set(worktrees.map((wt) => wt.branch).filter(Boolean))
    
    // 过滤已在 worktree 中的分支（除非明确需要）
    const localBranches = localResult.stdout
        .trim()
        .split("\n")
        .filter((b) => b && (includeWorktreeBranches || !branchesInWorktrees.has(b)))
    
    return { localBranches, remoteBranches, currentBranch }
}
```

---

## 三、用户交互流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   用户操作       │     │   系统响应       │     │   底层执行       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
1. 点击"新建 Worktree"  →  显示 CreateWorktreeModal  →  获取可用分支列表
                          - 获取 .worktreeinclude 状态   获取建议路径
                          - 生成建议分支名和路径

        │                       │                       │
        ▼                       ▼                       ▼
2. 填写表单并提交        →   发送 createWorktree 消息  →  git worktree add
                          - 显示创建中状态              -b <branch> <path>
                                                        <base>

        │                       │                       │
        ▼                       ▼                       ▼
3. 文件复制阶段          →   显示复制进度             →  copyWorktreeIncludeFiles
                          - 当前文件名                 - robocopy / cp -r
                          - 已复制字节数               - 轮询进度反馈

        │                       │                       │
        ▼                       ▼                       ▼
4. 创建完成              →   显示结果对话框            →  可选操作：
                          - 成功/失败消息              - 在新窗口打开
                          - 错误提示（如有）            - 当前窗口切换

        │                       │                       │
        ▼                       ▼                       ▼
5. 新窗口打开            →   检测 worktreeAutoOpenPath →  自动打开 Coder
                          - globalState 存储路径         侧边栏
                          - 路径匹配检查
```

---

## 四、关键设计亮点

### 4.1 平台无关的核心服务

```typescript
// 使用 Node.js 原生模块，不依赖 VSCode API
import { exec, execFile } from "child_process"
import * as path from "path"
import * as fs from "fs/promises"

// 所有服务方法都是纯函数，便于单元测试
export class WorktreeService {
    async listWorktrees(cwd: string): Promise<Worktree[]> { /* ... */ }
    async createWorktree(cwd: string, options: CreateWorktreeOptions): Promise<WorktreeResult> { /* ... */ }
}
```

**优势**：
- 可在任何 Node.js 环境中使用
- 便于编写单元测试（`__tests__/worktree-service.spec.ts`）
- 逻辑与 UI 完全分离

### 4.2 精确的进度计算

```typescript
// 使用文件系统块大小计算实际磁盘占用
private getSizeOnDisk(stats: { size: number; blksize?: number }): number {
    if (stats.blksize !== undefined && stats.blksize > 0) {
        // 按块大小向上取整
        return stats.blksize * Math.ceil(stats.size / stats.blksize)
    }
    // 回退到逻辑大小
    return stats.size
}
```

**优势**：
- 反映真实的磁盘空间占用
- 考虑文件系统块分配开销
- 比单纯文件计数更准确

### 4.3 智能的文件匹配策略

```typescript
// 找到同时匹配 .worktreeinclude 和 .gitignore 的项
private async findMatchingItems(
    sourceDir: string,
    includeMatcher: Ignore,
    gitignoreMatcher: Ignore,
): Promise<string[]> {
    const matchingItems: string[] = []
    
    for (const entry of entries) {
        const relativePath = entry.name
        if (relativePath === ".git") continue
        
        // 必须同时匹配两个模式
        const matchesWorktreeInclude = includeMatcher.ignores(relativePath)
        const matchesGitignore = gitignoreMatcher.ignores(relativePath)
        
        if (matchesWorktreeInclude && matchesGitignore) {
            matchingItems.push(relativePath)
        }
    }
    
    return matchingItems
}
```

**优势**：
- 只复制必要的本地文件（如 `node_modules`、`.env`）
- 避免复制已跟踪的源代码文件
- 保持 worktree 的分支独立性

### 4.4 状态持久化与自动恢复

```typescript
// 使用 VSCode globalState 持久化
await provider.contextProxy.setValue("worktreeAutoOpenPath", worktreePath)

// 扩展激活时检查并自动打开
const worktreeAutoOpenPath = context.globalState.get<string>("worktreeAutoOpenPath")
```

**优势**：
- 窗口切换后自动恢复工作状态
- 防止重复触发（检查后立即清除）
- 提供无缝的用户体验

### 4.5 完整的类型安全

```typescript
// packages/types/src/worktree.ts
export interface Worktree { /* ... */ }
export interface WorktreeResult { /* ... */ }
export interface CreateWorktreeOptions { /* ... */ }
export interface WorktreeIncludeStatus { /* ... */ }
export interface WorktreeListResponse { /* ... */ }
export interface WorktreeDefaultsResponse { /* ... */ }
```

**优势**：
- 编译时错误检测
- IDE 智能提示支持
- 消息格式标准化

---

## 五、约束条件与限制

| 约束 | 原因 | 处理方式 |
|------|------|----------|
| **不支持多根工作区** | Git worktree 要求单一根目录 | `isMultiRoot` 检查，返回错误提示 |
| **不支持子文件夹** | worktree 必须是仓库根目录 | `isSubfolder` 检查，提示打开根目录 |
| **Git 依赖** | 需要 `git worktree` 命令支持 | `checkGitInstalled()` 预检查 |
| **无 .worktreeinclude** | 只复制版本控制文件 | 显示警告，用户可手动创建 |
| **Windows 路径限制** | 路径分隔符差异 | `path.normalize()` 统一处理 |

---

## 六、典型使用场景

### 6.1 功能分支并行开发

```
主仓库目录 (main 分支)
├── .git/
├── src/
├── package.json
└── .worktreeinclude  (定义：node_modules, .env, .vscode/)

Worktree 1: ~/worktrees/project-feature-login (feature/login 分支)
├── .git -> ../../repo/.git/worktrees/login
├── src/ (feature/login 版本)
├── node_modules/ (从 .worktreeinclude 复制)
├── .env (从 .worktreeinclude 复制)
└── .vscode/settings.json (从 .worktreeinclude 复制)

Worktree 2: ~/worktrees/project-feature-api (feature/api 分支)
├── .git -> ../../repo/.git/worktrees/api
├── src/ (feature/api 版本)
├── node_modules/ (从 .worktreeinclude 复制)
├── .env (从 .worktreeinclude 复制)
└── .vscode/settings.json (从 .worktreeinclude 复制)
```

**工作流**：
1. 在主窗口保持 `main` 分支稳定开发
2. 为 `feature/login` 创建 worktree，在新窗口开发登录功能
3. 为 `feature/api` 创建 worktree，在另一窗口开发 API 功能
4. 三个窗口可同时运行，互不干扰
5. 每个窗口有独立的 `node_modules` 和配置文件

### 6.2 代码审查场景

```
1. 收到 PR #123 (feature/new-feature)
2. 创建 worktree 审查代码：
   - 分支：review/pr-123
   - 基于：origin/feature/new-feature
3. 在独立窗口中审查，不影响当前开发
4. 审查完成后可直接删除 worktree
```

### 6.3 实验性开发

```
1. 想尝试重构方案 A
2. 创建 worktree: experiment/refactor-a
3. 如果方案失败，直接删除 worktree
4. 主开发不受影响
```

---

## 七、消息类型定义

### 7.1 Webview → Extension 消息

```typescript
// packages/types/src/vscode-extension-host/webview-messages.ts
type WebviewMessage =
    | { type: "listWorktrees" }
    | { type: "createWorktree"; worktreePath: string; worktreeBranch: string; ... }
    | { type: "deleteWorktree"; worktreePath: string; worktreeForce: boolean }
    | { type: "switchWorktree"; worktreePath: string; worktreeNewWindow: boolean }
    | { type: "getWorktreeDefaults" }
    | { type: "getWorktreeIncludeStatus" }
    | { type: "checkBranchWorktreeInclude"; branch: string }
    | { type: "createWorktreeInclude"; worktreeIncludeContent: string }
    | { type: "browseForWorktreePath" }
    | { type: "getAvailableBranches" }
```

### 7.2 Extension → Webview 消息

```typescript
// packages/types/src/vscode-extension-host/extension-messages.ts
type ExtensionMessage =
    | { type: "worktreeList"; worktrees: Worktree[]; isGitRepo: boolean; ... }
    | { type: "worktreeResult"; success: boolean; text: string; ... }
    | { type: "worktreeCopyProgress"; copyProgressBytesCopied: number; ... }
    | { type: "worktreeDefaults"; suggestedBranch: string; suggestedPath: string }
    | { type: "worktreeIncludeStatus"; worktreeIncludeExists: boolean; ... }
    | { type: "branchList"; localBranches: string[]; remoteBranches: string[]; ... }
```

---

## 八、配置选项

### 8.1 全局设置

```typescript
// packages/types/src/global-settings.ts
interface GlobalSettings {
    // worktree 自动打开路径
    worktreeAutoOpenPath?: string
    
    // 是否在主屏幕显示 worktree 选择器
    showWorktreesInHomeScreen?: boolean
}
```

### 8.2 UI 控制

```typescript
// webview-ui/src/components/worktrees/WorktreesView.tsx
const handleToggleShowInHomeScreen = () => {
    const newValue = !showWorktreesInHomeScreen
    setShowWorktreesInHomeScreen(newValue)
    
    vscode.postMessage({
        type: "didUpdateGlobalSettings",
        updatedSettings: { showWorktreesInHomeScreen: newValue },
    })
}
```

---

## 九、测试覆盖

### 9.1 单元测试

```typescript
// packages/core/src/worktree/__tests__/worktree-service.spec.ts
describe("WorktreeService", () => {
    it("should list worktrees", async () => { /* ... */ })
    it("should create worktree with new branch", async () => { /* ... */ })
    it("should delete worktree", async () => { /* ... */ })
    it("should get available branches", async () => { /* ... */ })
})

// packages/core/src/worktree/__tests__/worktree-include.spec.ts
describe("WorktreeIncludeService", () => {
    it("should check if .worktreeinclude exists", async () => { /* ... */ })
    it("should copy files matching both patterns", async () => { /* ... */ })
    it("should report progress during copy", async () => { /* ... */ })
})
```

---

## 十、总结

Roo-Code 的 worktree 功能是一个完善的 Git worktree 管理解决方案，通过以下核心机制支持多分支并行工作：

1. **Git Worktree 原生支持**：利用 Git 的 worktree 功能，为每个分支创建独立工作目录
2. **智能文件同步**：通过 `.worktreeinclude` 机制，自动复制必要的本地文件
3. **窗口级隔离**：每个 worktree 在独立 VSCode 窗口中打开，提供完整的开发环境
4. **状态持久化**：使用 `globalState` 实现自动打开和状态恢复
5. **跨平台支持**：统一的接口，Windows/Unix 平台特定的实现
6. **精确进度跟踪**：基于文件系统块大小的实时进度反馈

该设计特别适合需要同时处理多个分支的开发场景，不仅提供了基础的工作区管理功能，还针对 AI 辅助编码场景进行了优化，使 AI 能够更好地理解多分支的代码上下文。
