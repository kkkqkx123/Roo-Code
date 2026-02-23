# Qdrant 向量点计算与集合迁移机制分析

本文档详细分析了 Roo-Code 项目中 Qdrant 向量数据库的向量点个数计算方法和集合配置动态迁移机制。

## 目录

1. [向量点个数计算机制](#向量点个数计算机制)
2. [集合配置动态迁移机制](#集合配置动态迁移机制)
3. [配置阈值与 Preset 对应关系](#配置阈值与-preset-对应关系)
4. [迁移流程详解](#迁移流程详解)
5. [关键组件与接口](#关键组件与接口)

---

## 向量点个数计算机制

项目使用 **两种方式** 计算向量点个数：

### 1. 实际集合大小查询 (运行时)

**使用场景：** 检查集合当前状态、判断是否需要升级配置

**实现类：** `CollectionSizeEstimator`

**文件路径：** `src/services/code-index/vector-store/collection-size-estimator.ts`

```typescript
export class CollectionSizeEstimator {
    private client: QdrantClient

    constructor(qdrantUrl: string, apiKey?: string) {
        this.client = new QdrantClient({
            url: qdrantUrl,
            apiKey,
        })
    }

    async estimateSize(collectionName: string): Promise<number> {
        try {
            const collectionInfo = await this.client.getCollection(collectionName)
            return collectionInfo.points_count || 0
        } catch (error) {
            console.warn(
                `[CollectionSizeEstimator] Failed to get collection size for ${collectionName}:`, 
                error
            )
            return 0
        }
    }
}
```

**工作原理：**
1. 通过 QdrantClient 调用 `getCollection()` API
2. 从返回的 `CollectionInfo` 中读取 `points_count` 字段
3. 如果查询失败，返回 0 并记录警告日志

**调用链路：**
```
VectorStorageConfigManager.getCollectionConfig()
    ↓
CollectionSizeEstimator.estimateSize()
    ↓
QdrantClient.getCollection()
    ↓
返回 points_count
```

### 2. 基于 Token 的预估 (索引前)

**使用场景：** 首次索引前预估集合大小，用于提前分配合适的配置

**实现类：** `TokenBasedSizeEstimator`

**文件路径：** `src/services/code-index/token-based-size-estimator.ts`

```typescript
export class TokenBasedSizeEstimator {
    private readonly avgTokensPerVector: number = 100
    private readonly avgVectorsPerFile: number = 10

    async estimateCollectionSize(directoryPath: string): Promise<SizeEstimationResult> {
        // 1. 列出所有文件
        const [allPaths, _] = await listFiles(directoryPath, true, MAX_LIST_FILES_LIMIT_CODE_INDEX)
        const filePaths = allPaths.filter((p) => !p.endsWith("/"))

        // 2. 应用忽略规则过滤
        const ignoreController = new RooIgnoreController(directoryPath)
        await ignoreController.initialize()
        const allowedPaths = ignoreController.filterPaths(filePaths)

        // 3. 按扩展名过滤
        const supportedPaths = allowedPaths.filter((filePath) => {
            const ext = path.extname(filePath).toLowerCase()
            return scannerExtensions.includes(ext) && !isPathInIgnoredDirectory(filePath)
        })

        // 4. 遍历文件计算 Token 总数
        let totalTokenCount = 0
        let totalFileSize = 0
        let processedFileCount = 0

        for (const filePath of supportedPaths) {
            const stats = await fs.stat(filePath)
            const content = await fs.readFile(filePath, "utf-8")
            const tokenCount = this.estimateTokenCount(content)
            totalTokenCount += tokenCount
            totalFileSize += stats.size
            processedFileCount++
        }

        // 5. 计算预估向量数量
        const estimatedVectorCount = Math.ceil(totalTokenCount / this.avgTokensPerVector)

        return {
            estimatedVectorCount,
            estimatedTokenCount: totalTokenCount,
            fileCount: processedFileCount,
            totalFileSize,
        }
    }

    private estimateTokenCount(text: string): number {
        const charCount = text.trim().length
        const avgCharsPerToken = 4
        const estimatedTokens = Math.ceil(charCount / avgCharsPerToken)
        const codeMultiplier = 1.2
        return Math.floor(estimatedTokens * codeMultiplier)
    }
}
```

**计算公式：**

```
字符数 → Token 数 → 向量数
  ↓         ↓          ↓
text   chars/4    tokens/100
       ×1.2(代码)
```

**关键参数：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `avgTokensPerVector` | 100 | 每个向量平均 Token 数 |
| `avgCharsPerToken` | 4 | 每个 Token 平均字符数 |
| `codeMultiplier` | 1.2 | 代码文本 Token 估算乘数 |

**调用链路：**
```
CodeIndexOrchestrator.startIndexing()
    ↓
TokenBasedSizeEstimator.estimateCollectionSize()
    ↓
QdrantVectorStore.setCollectionConfigFromEstimation()
    ↓
VectorStorageConfigManager.getCollectionConfigFromEstimation()
```

---

## 集合配置动态迁移机制

项目实现了 **基于阈值的自动配置升级机制**，根据集合中向量点数量动态调整 Qdrant 集合配置。

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    调度层 (Scheduler)                        │
│  ConfigUpgradeScheduler                                     │
│  - 定时检查 (默认每小时)                                     │
│  - 并发控制 (默认 1 个)                                       │
│  - 时间窗口控制                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  服务层 (Service)                            │
│  CollectionConfigUpgradeService                             │
│  - 检查当前配置与目标配置                                    │
│  - 计算升级路径                                              │
│  - 执行配置应用                                              │
│  - 进度跟踪与状态报告                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  配置层 (Config Manager)                     │
│  VectorStorageConfigManager                                 │
│  - 存储配置模式 (auto/preset/custom)                         │
│  - 阈值配置                                                  │
│  - 配置解析                                                  │
└─────────────────────────────────────────────────────────────┘
```

### 配置模式

#### Auto 模式 (默认)

根据集合大小自动选择配置：

```typescript
// VectorStorageConfigManager.resolveConfig()
private resolveConfig(collectionSize: number): CustomVectorStorageConfig {
    switch (this.config.mode) {
        case "auto":
            return this.getAutoConfig(collectionSize)
        case "preset":
            return VECTOR_STORAGE_PRESETS[this.config.preset!].customConfig!
        case "custom":
            return this.config.customConfig!
        default:
            return VECTOR_STORAGE_PRESETS.medium.customConfig!
    }
}

private getAutoConfig(size: number): CustomVectorStorageConfig {
    const thresholds = this.config.thresholds || {
        tiny: 2000,
        small: 10000,
        medium: 100000,
    }

    if (size < thresholds.tiny) {
        return VECTOR_STORAGE_PRESETS.tiny.customConfig!
    } else if (size < thresholds.small) {
        return VECTOR_STORAGE_PRESETS.small.customConfig!
    } else if (size < thresholds.medium) {
        return VECTOR_STORAGE_PRESETS.medium.customConfig!
    } else {
        return VECTOR_STORAGE_PRESETS.large.customConfig!
    }
}
```

### 阈值配置

**默认阈值：**

```typescript
const DEFAULT_VECTOR_STORAGE_CONFIG: VectorStorageConfig = {
    mode: "auto",
    thresholds: {
        tiny: 2000,      // < 2,000 向量
        small: 10000,    // 2,000 - 10,000 向量
        medium: 100000,  // 10,000 - 100,000 向量
        large: 1000000,  // > 100,000 向量
    },
}
```

**阈值决定目标 Preset：**

```typescript
// CollectionConfigUpgradeService.determineTargetPreset()
private determineTargetPreset(currentSize: number): PresetType {
    if (currentSize < this.thresholds.tiny) {
        return "tiny"
    } else if (currentSize < this.thresholds.small) {
        return "small"
    } else if (currentSize < this.thresholds.medium) {
        return "medium"
    } else {
        return "large"
    }
}
```

### 当前 Preset 检测

通过读取 Qdrant 集合的现有配置来检测当前 Preset：

```typescript
// CollectionConfigUpgradeService.detectCurrentPreset()
private detectCurrentPreset(config: any): PresetType | null {
    const hnswConfig = config.hnsw_config
    const vectorsConfig = config.vectors_config
    const quantizationConfig = config.quantization_config

    // 无 HNSW 配置 = tiny
    if (!hnswConfig) {
        return "tiny"
    }

    const m = hnswConfig.m
    const efConstruct = hnswConfig.ef_construct

    // 根据 HNSW 参数判断 Preset
    if (m === 16 && efConstruct === 128) {
        return "small"
    } else if (m === 32 && efConstruct === 256) {
        return "medium"
    } else if (m === 64 && efConstruct === 512) {
        return "large"
    }

    return null
}
```

### 升级路径计算

支持 **渐进式升级**，不能跨级跳跃：

```typescript
// CollectionConfigUpgradeService.calculateUpgradePath()
private calculateUpgradePath(
    currentPreset: PresetType | null, 
    targetPreset: PresetType
): PresetType[] {
    const presetOrder: PresetType[] = ["tiny", "small", "medium", "large"]

    if (!currentPreset) {
        return [targetPreset]
    }

    const currentIndex = presetOrder.indexOf(currentPreset)
    const targetIndex = presetOrder.indexOf(targetPreset)

    if (currentIndex === -1 || targetIndex === -1) {
        return []
    }

    // 只支持向上升级，返回中间所有层级
    if (targetIndex > currentIndex) {
        return presetOrder.slice(currentIndex + 1, targetIndex + 1)
    }

    return []  // 不支持降级
}
```

**示例：**

| 当前 Preset | 目标 Preset | 升级路径 |
|-------------|-------------|----------|
| tiny | small | `[small]` |
| tiny | medium | `[small, medium]` |
| tiny | large | `[small, medium, large]` |
| small | large | `[medium, large]` |
| medium | tiny | `[]` (不支持降级) |

---

## 配置阈值与 Preset 对应关系

### Preset 配置详情

| Preset | 向量数量范围 | HNSW 配置 | 量化配置 | WAL 配置 | 适用场景 |
|--------|-------------|-----------|----------|----------|----------|
| **tiny** | < 2,000 | 无 (全表搜索) | 无 | capacity: 16MB, segments: 1 | 小型项目，快速构建 |
| **small** | 2,000 - 10,000 | m: 16, ef_construct: 128 | 无 | capacity: 32MB, segments: 2 | 中小型项目 |
| **medium** | 10,000 - 100,000 | m: 32, ef_construct: 256 | 无 | capacity: 64MB, segments: 4 | 中型项目 |
| **large** | > 100,000 | m: 64, ef_construct: 512 | scalar 8-bit | capacity: 128MB, segments: 8 | 大型项目，内存优化 |

### 配置应用逻辑

```typescript
// CollectionConfigUpgradeService.applyPresetConfig()
private async applyPresetConfig(preset: PresetType): Promise<void> {
    const presetConfig = VECTOR_STORAGE_PRESETS[preset]

    // 应用 HNSW 配置
    if ("hnsw" in presetConfig.customConfig && presetConfig.customConfig.hnsw) {
        await this.qdrantClient.updateCollection(this.collectionName, {
            hnsw_config: presetConfig.customConfig.hnsw,
            optimizers_config: {
                indexing_threshold: 0,  // 禁用后台优化器阈值
            },
        })
    }

    // 应用量化配置
    if (presetConfig.customConfig.vectors && 
        "quantization" in presetConfig.customConfig.vectors && 
        presetConfig.customConfig.vectors.quantization) {
        
        await this.qdrantClient.updateCollection(this.collectionName, {
            quantization_config: presetConfig.customConfig.vectors.quantization,
        })
    }
}
```

---

## 迁移流程详解

### 完整迁移流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 触发检查                                                 │
│    - 定时触发 (Scheduler 每小时)                             │
│    - 手动触发 (用户操作)                                     │
│    - 索引完成后触发                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. 获取集合信息                                             │
│    - QdrantClient.getCollection()                           │
│    - 读取 points_count (当前向量数)                          │
│    - 读取 config (当前配置)                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. 确定目标 Preset                                          │
│    - 根据 points_count 与 thresholds 比较                    │
│    - determineTargetPreset(currentSize)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. 检测当前 Preset                                          │
│    - 从 hnsw_config 参数识别                                │
│    - detectCurrentPreset(collectionInfo.config)             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. 判断是否需要升级                                         │
│    - currentPreset === targetPreset → 无需升级              │
│    - currentPreset !== targetPreset → 需要升级              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. 计算升级路径                                             │
│    - calculateUpgradePath(currentPreset, targetPreset)      │
│    - 返回渐进式 Preset 列表                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. 执行升级                                                 │
│    - 创建 UpgradeProgress 对象                               │
│    - 遍历升级路径，逐步应用配置                              │
│    - 每步调用 updateCollection()                            │
│    - 更新进度状态                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 8. 完成/失败处理                                            │
│    - 成功：status = "completed", 记录历史                   │
│    - 失败：status = "failed", 记录错误信息                  │
│    - 取消：status = "cancelled"                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心代码实现

```typescript
// CollectionConfigUpgradeService.checkAndUpgradeCollection()
public async checkAndUpgradeCollection(): Promise<boolean> {
    try {
        // 1. 获取集合信息
        const collectionInfo = await this.qdrantClient.getCollection(this.collectionName)
        const currentSize = collectionInfo.points_count || 0

        // 2. 确定目标 Preset
        const targetPreset = this.determineTargetPreset(currentSize)
        
        // 3. 检测当前 Preset
        const currentPreset = this.detectCurrentPreset(collectionInfo.config)

        // 4. 判断是否需要升级
        if (currentPreset === targetPreset) {
            return false  // 无需升级
        }

        // 5. 计算升级路径
        const upgradePath = this.calculateUpgradePath(currentPreset, targetPreset)
        if (upgradePath.length === 0) {
            return false  // 无有效升级路径
        }

        // 6. 执行升级
        await this.executeUpgrade(collectionInfo, upgradePath)
        return true
    } catch (error) {
        console.error(
            `[CollectionConfigUpgradeService] Failed to check and upgrade collection ${this.collectionName}:`, 
            error
        )
        throw error
    }
}
```

### 升级执行流程

```typescript
// CollectionConfigUpgradeService.executeUpgrade()
private async executeUpgrade(
    collectionInfo: any,
    upgradePath: PresetType[],
    startStepIndex: number = 0,
): Promise<void> {
    const currentPreset = this.detectCurrentPreset(collectionInfo.config)
    const targetPreset = upgradePath[upgradePath.length - 1]
    const currentSize = collectionInfo.points_count || 0

    // 创建升级进度对象
    const progress: UpgradeProgress = {
        collectionName: this.collectionName,
        currentPreset,
        targetPreset,
        status: "in_progress",
        progress: 0,
        message: `Starting upgrade from ${currentPreset} to ${targetPreset}`,
        startTime: Date.now(),
        steps: [],
    }

    this.currentUpgrades.set(this.collectionName, progress)
    this._statusEmitter.fire({ ...progress })

    try {
        for (let i = startStepIndex; i < upgradePath.length; i++) {
            // 检查取消/暂停请求
            if (this._cancellationRequested) {
                throw new Error("Upgrade was cancelled by user")
            }

            if (this._pauseRequested) {
                this._pauseRequested = false
                progress.status = "paused"
                this.currentUpgrades.set(this.collectionName, { ...progress })
                this._statusEmitter.fire({ ...progress })
                return
            }

            // 创建步骤对象
            const preset = upgradePath[i]
            const step: UpgradeStep = {
                preset,
                status: "in_progress",
                startTime: Date.now(),
            }

            progress.steps.push(step)
            progress.progress = (i / upgradePath.length) * 100
            progress.message = `Applying ${preset} configuration (${i + 1}/${upgradePath.length})`
            this.currentUpgrades.set(this.collectionName, { ...progress })
            this._statusEmitter.fire({ ...progress })

            // 应用配置
            await this.applyPresetConfig(preset)

            // 标记步骤完成
            step.status = "completed"
            step.endTime = Date.now()
            progress.progress = ((i + 1) / upgradePath.length) * 100
            
            // 发送进度更新
            this.currentUpgrades.set(this.collectionName, { ...progress })
            this._statusEmitter.fire({ ...progress })
        }

        // 升级完成
        progress.status = "completed"
        progress.progress = 100
        progress.message = `Successfully upgraded from ${currentPreset} to ${targetPreset}`
        progress.endTime = Date.now()
        
        this.currentUpgrades.delete(this.collectionName)
        this._statusEmitter.fire({ ...progress })

        // 记录历史
        const history = this.upgradeHistory.get(this.collectionName) || []
        history.push(progress)
        this.upgradeHistory.set(this.collectionName, history)

    } catch (error: any) {
        // 升级失败处理
        progress.status = "failed"
        progress.error = error.message
        progress.message = `Upgrade failed: ${error.message}`
        progress.endTime = Date.now()
        
        this.currentUpgrades.delete(this.collectionName)
        this._statusEmitter.fire({ ...progress })

        const history = this.upgradeHistory.get(this.collectionName) || []
        history.push(progress)
        this.upgradeHistory.set(this.collectionName, history)

        throw error
    }
}
```

---

## 关键组件与接口

### 核心类

| 类名 | 文件路径 | 职责 |
|------|----------|------|
| `TokenBasedSizeEstimator` | `src/services/code-index/token-based-size-estimator.ts` | 基于 Token 分析预估向量数量 |
| `CollectionSizeEstimator` | `src/services/code-index/vector-store/collection-size-estimator.ts` | 查询 Qdrant 集合实际大小 |
| `VectorStorageConfigManager` | `src/services/code-index/vector-storage-config-manager.ts` | 管理向量存储配置 |
| `CollectionConfigUpgradeService` | `src/services/code-index/vector-store/collection-config-upgrade-service.ts` | 执行配置升级 |
| `ConfigUpgradeScheduler` | `src/services/code-index/vector-store/config-upgrade-scheduler.ts` | 定时调度升级检查 |

### 接口定义

```typescript
// src/services/code-index/interfaces/vector-store.ts
export interface SizeEstimationResult {
    estimatedVectorCount: number
    estimatedTokenCount: number
    fileCount: number
    totalFileSize: number
}

export interface IVectorStore {
    // ... 其他方法
    
    // 可选方法：根据估算设置配置
    setCollectionConfigFromEstimation?(
        estimation: SizeEstimationResult
    ): Promise<void>
}
```

### 配置接口

```typescript
// shared/types/codebase-index.ts
export interface VectorStorageConfig {
    mode: "auto" | "preset" | "custom"
    preset?: "tiny" | "small" | "medium" | "large"
    customConfig?: CustomVectorStorageConfig
    thresholds?: {
        tiny: number
        small: number
        medium: number
        large: number
    }
}

export interface CustomVectorStorageConfig {
    hnsw?: {
        m: number
        ef_construct: number
        on_disk: boolean
    }
    vectors: {
        on_disk: boolean
        quantization?: {
            enabled: boolean
            type: "scalar" | "product"
            bits?: number
        }
    }
    wal?: {
        capacity_mb: number
        segments: number
    }
}
```

### 升级进度接口

```typescript
// shared/config/vector-storage-presets.ts
export type UpgradeStatus = 
    | "pending" 
    | "in_progress" 
    | "paused" 
    | "completed" 
    | "failed" 
    | "rolling_back" 
    | "cancelled"

export interface UpgradeProgress {
    collectionName: string
    workspacePath?: string
    currentPreset: PresetType | null
    targetPreset: PresetType
    status: UpgradeStatus
    progress: number
    message: string
    startTime: number
    endTime?: number
    error?: string
    steps: UpgradeStep[]
    previousConfig?: QdrantCollectionConfig
}

export interface UpgradeStep {
    preset?: PresetType
    name?: string
    status: "pending" | "in_progress" | "completed" | "failed"
    startTime?: number
    endTime?: number
    error?: string
}
```

---

## 调度器配置

### 默认配置

```typescript
const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    enabled: true,              // 启用调度器
    checkInterval: 60 * 60 * 1000,  // 每小时检查一次
    maxConcurrentUpgrades: 1,   // 最多 1 个并发升级
    upgradeWindow: {
        startHour: 0,           // 开始时间 (0点)
        endHour: 24,            // 结束时间 (24 点)
    },
}
```

### 调度器工作流程

```typescript
// ConfigUpgradeScheduler.performCheck()
private async performCheck(): Promise<void> {
    this.lastCheckTime = Date.now()
    this.emit("checkStarted", { checkTime: this.lastCheckTime })

    try {
        // 1. 检查是否在升级时间窗口内
        const currentHour = new Date().getHours()
        const { startHour, endHour } = this.config.upgradeWindow

        if (!this.isWithinUpgradeWindow(currentHour, startHour, endHour)) {
            console.log("Outside upgrade window, skipping check")
            this.scheduleNextCheck()
            return
        }

        // 2. 检查并发限制
        const runningUpgrades = this.countRunningUpgrades()
        if (runningUpgrades >= this.config.maxConcurrentUpgrades) {
            console.log("Maximum concurrent upgrades reached, skipping check")
            this.scheduleNextCheck()
            return
        }

        // 3. 检查所有集合
        const upgradeResults = await this.checkAllCollections()

        for (const result of upgradeResults) {
            if (result.success) {
                this.totalUpgradesCompleted++
                this.emit("upgradeCompleted", {
                    collectionName: result.collectionName,
                    duration: result.duration,
                })
            } else {
                this.totalUpgradesFailed++
                this.emit("upgradeFailed", {
                    collectionName: result.collectionName,
                    error: result.error,
                })
            }
        }
    } catch (error) {
        console.error("Error during check:", error)
        this.emit("checkError", { error })
    } finally {
        this.emit("checkCompleted", {
            checkTime: this.lastCheckTime,
            duration: Date.now() - this.lastCheckTime,
        })
        this.scheduleNextCheck()  // 调度下次检查
    }
}
```

---

## 特殊功能

### 1. 暂停与恢复

```typescript
// 暂停升级
public pauseUpgrade(): boolean {
    const currentUpgrade = this.currentUpgrades.get(this.collectionName)
    if (!currentUpgrade || currentUpgrade.status !== "in_progress") {
        return false
    }

    this._pauseRequested = true
    this._pausedStepIndex = currentUpgrade.steps.length
    currentUpgrade.status = "paused"
    currentUpgrade.message = "Upgrade paused by user"
    this.currentUpgrades.set(this.collectionName, { ...currentUpgrade })
    this._statusEmitter.fire({ ...currentUpgrade })
    return true
}

// 恢复升级
public async resumeUpgrade(): Promise<boolean> {
    const currentUpgrade = this.currentUpgrades.get(this.collectionName)
    if (!currentUpgrade || currentUpgrade.status !== "paused") {
        return false
    }

    this._pauseRequested = false
    const pausedStepIndex = this._pausedStepIndex

    currentUpgrade.status = "in_progress"
    currentUpgrade.message = "Resuming upgrade..."
    this.currentUpgrades.set(this.collectionName, { ...currentUpgrade })
    this._statusEmitter.fire({ ...currentUpgrade })

    // 从暂停的步骤继续执行
    await this.executeUpgrade(collectionInfo, upgradePath, pausedStepIndex)
    return true
}
```

### 2. 取消升级

```typescript
public cancelUpgrade(): boolean {
    const currentUpgrade = this.currentUpgrades.get(this.collectionName)
    if (!currentUpgrade || currentUpgrade.status !== "in_progress") {
        return false
    }

    this._cancellationRequested = true
    currentUpgrade.status = "cancelled"
    currentUpgrade.message = "Upgrade cancelled by user"
    currentUpgrade.endTime = Date.now()
    this.currentUpgrades.delete(this.collectionName)
    this._statusEmitter.fire({ ...currentUpgrade })

    // 记录历史
    const history = this.upgradeHistory.get(this.collectionName) || []
    history.push(currentUpgrade)
    this.upgradeHistory.set(this.collectionName, history)

    return true
}
```

### 3. 回滚升级

```typescript
public async rollbackUpgrade(): Promise<boolean> {
    const history = this.upgradeHistory.get(this.collectionName) || []
    const lastUpgrade = history[history.length - 1]

    if (!lastUpgrade || lastUpgrade.status !== "completed") {
        return false
    }

    if (!lastUpgrade.previousConfig) {
        console.error("Cannot rollback: No previous config saved")
        return false
    }

    try {
        // 恢复 HNSW 配置
        if (lastUpgrade.previousConfig.hnsw_config) {
            await this.qdrantClient.updateCollection(this.collectionName, {
                hnsw_config: lastUpgrade.previousConfig.hnsw_config,
            })
        }

        // 恢复量化配置
        if (lastUpgrade.previousConfig.quantization_config) {
            await this.qdrantClient.updateCollection(this.collectionName, {
                quantization_config: lastUpgrade.previousConfig.quantization_config,
            })
        }

        return true
    } catch (error) {
        console.error("Rollback failed:", error)
        return false
    }
}
```

---

## 总结

### 向量点计算特点

1. **双模式计算**：
   - 索引前：基于 Token 分析预估 (字符数/4/100)
   - 运行时：直接查询 Qdrant API (`points_count`)

2. **预估精度**：
   - 使用字符数估算 Token 数 (4 字符/Token)
   - 代码文本乘以 1.2 系数
   - 默认 100 Token/向量

### 集合迁移特点

1. **渐进式升级**：
   - 不支持跨级跳跃 (tiny → large 需经过 small, medium)
   - 每步独立应用配置，可暂停/恢复

2. **自动触发**：
   - 定时检查 (默认每小时)
   - 基于阈值自动判断

3. **状态追踪**：
   - 完整的进度记录
   - 升级历史保存
   - 支持取消、暂停、回滚

4. **配置优化**：
   - tiny: 无 HNSW，快速构建
   - small/medium: 逐步增强 HNSW 参数
   - large: 启用量化减少内存占用
