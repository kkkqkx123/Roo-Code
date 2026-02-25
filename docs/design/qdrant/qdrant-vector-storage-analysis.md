# Roo Code 代码索引模块 Qdrant 向量存储配置与数据迁移分析

## 概述

Roo Code 项目使用 Qdrant 作为向量数据库来存储代码索引的嵌入向量。该模块实现了智能的向量存储配置管理和自动化的数据迁移机制，能够根据数据量自动调整存储预设，优化性能和资源使用。

## 核心架构

### 主要组件

```
src/services/code-index/
├── vector-store/
│   ├── qdrant-client.ts              # Qdrant 客户端实现
│   ├── collection-config-upgrade-service.ts  # 集合配置升级服务
│   ├── config-upgrade-scheduler.ts   # 配置升级调度器
│   └── collection-size-estimator.ts  # 集合大小估算器
├── vector-storage-config-manager.ts  # 向量存储配置管理器
└── service-factory.ts                # 服务工厂
```

## 一、Qdrant 向量存储配置

### 1.1 存储预设 (Vector Storage Presets)

项目定义了四种存储预设，位于 `shared/config/vector-storage-presets.ts`：

```typescript
type PresetType = "tiny" | "small" | "medium" | "large"
```

#### 预设配置详情

| 预设 | 适用数据量 | HNSW 配置 | 向量配置 | WAL 配置 |
|------|-----------|----------|---------|---------|
| **tiny** | < 2,000 | 无 (全表搜索) | on_disk: true | capacity_mb: 32, segments: 2 |
| **small** | 2,000 - 50,000 | m: 16, ef_construct: 128 | on_disk: true | capacity_mb: 32, segments: 2 |
| **medium** | 50,000 - 500,000 | m: 32, ef_construct: 256 | on_disk: true | capacity_mb: 64, segments: 4 |
| **large** | > 500,000 | m: 64, ef_construct: 512 | on_disk: true, quantization: scalar 8bit | capacity_mb: 256, segments: 8 |

**配置说明：**

- **HNSW (Hierarchical Navigable Small World)**: 近似最近邻搜索算法
  - `m`: 每个节点的邻居数量，越大搜索越精确但内存占用越高
  - `ef_construct`: 构建时的搜索深度，越大构建质量越高但速度越慢

- **向量配置**:
  - `on_disk`: 向量数据是否存储在磁盘上，节省内存
  - `quantization`: 量化配置，减少存储空间（large 预设启用）

- **WAL (Write-Ahead Log)**: 预写日志配置
  - `capacity_mb`: 日志段容量
  - `segments`: 日志段数量

### 1.2 配置管理模式

`VectorStorageConfigManager` 支持三种配置模式：

```typescript
interface VectorStorageConfig {
  mode: "auto" | "preset" | "custom"
  thresholds?: {
    tiny: number      // 默认：2000
    small: number     // 默认：10000
    medium: number    // 默认：100000
    large: number     // 默认：1000000
  }
  preset?: PresetType           // preset 模式使用
  customConfig?: CustomConfig   // custom 模式使用
}
```

**模式说明：**

1. **auto (自动模式)**: 根据集合大小自动选择预设
2. **preset (预设模式)**: 固定使用指定预设
3. **custom (自定义模式)**: 使用完全自定义的配置

### 1.3 配置解析流程

```
┌─────────────────────────────────────┐
│  VectorStorageConfigManager         │
│  .getCollectionConfig()             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  CollectionSizeEstimator            │
│  .estimateSize(collectionName)      │
│  → 获取当前集合中的向量数量          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  resolveConfig(collectionSize)      │
│                                     │
│  mode: "auto" → getAutoConfig()     │
│  mode: "preset" → preset config     │
│  mode: "custom" → custom config     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  getAutoConfig(size)                │
│                                     │
│  size < thresholds.tiny   → tiny    │
│  size < thresholds.small  → small   │
│  size < thresholds.medium → medium  │
│  else                     → large   │
└─────────────────────────────────────┘
```

## 二、数据迁移机制

### 2.1 迁移触发条件

数据迁移在以下情况下触发：

1. **向量维度变化**: 当嵌入模型改变导致向量维度不匹配时
2. **阈值跨越**: 当集合大小超过当前预设的阈值时
3. **手动触发**: 用户手动触发配置升级

### 2.2 向量维度变化迁移

当检测到向量维度不匹配时，`QdrantVectorStore.initialize()` 会执行以下流程：

```typescript
async initialize(): Promise<boolean> {
  const collectionInfo = await this.getCollectionInfo()
  
  if (collectionInfo === null) {
    // 集合不存在，创建新集合
    await this.client.createCollection(...)
    return true
  } else {
    // 集合存在，检查向量维度
    const existingVectorSize = this.getExistingVectorSize(collectionInfo)
    
    if (existingVectorSize === this.vectorSize) {
      return false  // 维度匹配，无需迁移
    } else {
      // 维度不匹配，重建集合
      return await this._recreateCollectionWithNewDimension(existingVectorSize)
    }
  }
}
```

#### 重建集合流程 (`_recreateCollectionWithNewDimension`)

```
┌─────────────────────────────────────────┐
│  1. 删除现有集合                         │
│     client.deleteCollection()           │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  2. 等待删除完成                         │
│     setTimeout(100ms)                   │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  3. 验证删除成功                         │
│     getCollectionInfo() → 应为 null     │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  4. 创建新集合（新维度）                  │
│     client.createCollection({           │
│       vectors: { size: newVectorSize }  │
│     })                                  │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  5. 创建 payload 索引                     │
│     - type 字段索引                      │
│     - pathSegments.0-4 索引              │
└─────────────────────────────────────────┘
```

**错误处理：**

```typescript
try {
  await deleteCollection()
  await verifyDeletion()
  await createNewCollection()
} catch (error) {
  // 根据失败阶段提供不同的错误信息
  if (!deletionSucceeded) {
    // 删除失败
  } else if (!recreationAttempted) {
    // 验证失败
  } else {
    // 创建失败
  }
  throw new Error(t("embeddings:vectorStore.vectorDimensionMismatch", ...))
}
```

### 2.3 存储预设升级迁移

当集合大小超过阈值时，`CollectionConfigUpgradeService` 会自动升级配置。

#### 升级流程

```typescript
async checkAndUpgradeCollection(): Promise<boolean> {
  // 1. 获取集合信息
  const collectionInfo = await this.qdrantClient.getCollection(this.collectionName)
  const currentSize = collectionInfo.points_count || 0
  
  // 2. 确定目标预设
  const targetPreset = this.determineTargetPreset(currentSize)
  const currentPreset = this.detectCurrentPreset(collectionInfo.config)
  
  // 3. 检查是否需要升级
  if (currentPreset === targetPreset) {
    return false  // 无需升级
  }
  
  // 4. 计算升级路径
  const upgradePath = this.calculateUpgradePath(currentPreset, targetPreset)
  
  // 5. 执行升级
  await this.executeUpgrade(collectionInfo, upgradePath)
  return true
}
```

#### 预设检测逻辑

```typescript
detectCurrentPreset(config: any): PresetType | null {
  const hnswConfig = config.hnsw_config
  
  if (!hnswConfig) {
    return "tiny"  // 无 HNSW 配置为 tiny
  }
  
  const { m, ef_construct } = hnswConfig
  
  if (m === 16 && ef_construct === 128) return "small"
  if (m === 32 && ef_construct === 256) return "medium"
  if (m === 64 && ef_construct === 512) return "large"
  
  return null  // 未知配置
}
```

#### 升级路径计算

```typescript
calculateUpgradePath(currentPreset: PresetType | null, targetPreset: PresetType): PresetType[] {
  const presetOrder: PresetType[] = ["tiny", "small", "medium", "large"]
  
  if (!currentPreset) {
    return [targetPreset]
  }
  
  const currentIndex = presetOrder.indexOf(currentPreset)
  const targetIndex = presetOrder.indexOf(targetPreset)
  
  // 只支持向上升级，不支持降级
  if (targetIndex > currentIndex) {
    return presetOrder.slice(currentIndex + 1, targetIndex + 1)
  }
  
  return []  // 降级返回空路径
}
```

**升级路径示例：**

| 当前预设 | 目标预设 | 升级路径 |
|---------|---------|---------|
| tiny | small | ["small"] |
| tiny | medium | ["small", "medium"] |
| tiny | large | ["small", "medium", "large"] |
| small | large | ["medium", "large"] |
| medium | small | [] (降级不支持) |

#### 执行升级步骤

```typescript
private async executeUpgrade(collectionInfo: any, upgradePath: PresetType[]): Promise<void> {
  const progress: UpgradeProgress = {
    collectionName: this.collectionName,
    currentPreset: this.detectCurrentPreset(collectionInfo.config),
    targetPreset: upgradePath[upgradePath.length - 1],
    status: "in_progress",
    progress: 0,
    steps: [],
    startTime: Date.now(),
  }
  
  for (let i = 0; i < upgradePath.length; i++) {
    const preset = upgradePath[i]
    const step: UpgradeStep = {
      preset,
      status: "in_progress",
      startTime: Date.now(),
    }
    
    // 应用预设配置
    await this.applyPresetConfig(preset)
    
    step.status = "completed"
    step.endTime = Date.now()
    progress.steps.push(step)
    progress.progress = ((i + 1) / upgradePath.length) * 100
    
    // 发送状态更新
    this._statusEmitter.fire({ ...progress })
  }
  
  progress.status = "completed"
  progress.endTime = Date.now()
}
```

#### 应用预设配置

```typescript
private async applyPresetConfig(preset: PresetType): Promise<void> {
  const presetConfig = VECTOR_STORAGE_PRESETS[preset]
  
  // 应用 HNSW 配置
  if (presetConfig.customConfig.hnsw) {
    await this.qdrantClient.updateCollection(this.collectionName, {
      hnsw_config: presetConfig.customConfig.hnsw,
      optimizers_config: {
        indexing_threshold: 0,  // 禁用优化器索引阈值
      },
    })
  }
  
  // 应用量化配置（如果有）
  if (presetConfig.customConfig.vectors?.quantization) {
    await this.qdrantClient.updateCollection(this.collectionName, {
      quantization_config: presetConfig.customConfig.vectors.quantization,
    })
  }
}
```

### 2.4 升级状态管理

升级过程支持多种状态：

```typescript
type UpgradeStatus = 
  | "pending"      // 等待中
  | "in_progress"  // 进行中
  | "paused"       // 已暂停
  | "completed"    // 已完成
  | "failed"       // 失败
  | "rolling_back" // 回滚中
  | "cancelled"    // 已取消
```

#### 升级进度跟踪

```typescript
interface UpgradeProgress {
  collectionName: string
  currentPreset: PresetType | null
  targetPreset: PresetType
  status: UpgradeStatus
  progress: number          // 0-100
  message: string
  startTime: number
  endTime?: number
  error?: string
  steps: UpgradeStep[]
  previousConfig?: QdrantCollectionConfig  // 用于回滚
}
```

### 2.5 升级控制操作

#### 暂停/恢复升级

```typescript
// 暂停升级
pauseUpgrade(): boolean {
  const currentUpgrade = this.currentUpgrades.get(this.collectionName)
  if (!currentUpgrade || currentUpgrade.status !== "in_progress") {
    return false
  }
  
  this._pauseRequested = true
  this._pausedStepIndex = currentUpgrade.steps.length
  currentUpgrade.status = "paused"
  currentUpgrade.message = "Upgrade paused by user"
  
  this._statusEmitter.fire({ ...currentUpgrade })
  return true
}

// 恢复升级
async resumeUpgrade(): Promise<boolean> {
  const currentUpgrade = this.currentUpgrades.get(this.collectionName)
  if (!currentUpgrade || currentUpgrade.status !== "paused") {
    return false
  }
  
  this._pauseRequested = false
  currentUpgrade.status = "in_progress"
  
  // 从暂停的步骤继续执行
  await this.executeUpgrade(collectionInfo, upgradePath, this._pausedStepIndex)
  return true
}
```

#### 取消升级

```typescript
cancelUpgrade(): boolean {
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
  
  // 记录到历史
  const history = this.upgradeHistory.get(this.collectionName) || []
  history.push(currentUpgrade)
  this.upgradeHistory.set(this.collectionName, history)
  
  return true
}
```

#### 回滚升级

```typescript
async rollbackUpgrade(): Promise<boolean> {
  const history = this.upgradeHistory.get(this.collectionName) || []
  const lastUpgrade = history[history.length - 1]
  
  if (!lastUpgrade || lastUpgrade.status !== "completed") {
    return false
  }
  
  if (!lastUpgrade.previousConfig) {
    return false  // 没有保存之前的配置，无法回滚
  }
  
  // 恢复之前的配置
  if (lastUpgrade.previousConfig.hnsw_config) {
    await this.qdrantClient.updateCollection(this.collectionName, {
      hnsw_config: lastUpgrade.previousConfig.hnsw_config,
    })
  }
  
  if (lastUpgrade.previousConfig.quantization_config) {
    await this.qdrantClient.updateCollection(this.collectionName, {
      quantization_config: lastUpgrade.previousConfig.quantization_config,
    })
  }
  
  return true
}
```

### 2.6 定时调度器

`ConfigUpgradeScheduler` 提供定时检查和自动升级功能：

```typescript
interface SchedulerConfig {
  enabled: boolean              // 是否启用
  checkInterval: number         // 检查间隔（毫秒），默认 1 小时
  maxConcurrentUpgrades: number // 最大并发升级数，默认 1
  upgradeWindow: {
    startHour: number           // 升级窗口开始时间（小时）
    endHour: number             // 升级窗口结束时间（小时）
  }
}
```

#### 调度器工作流程

```
┌─────────────────────────────────────────┐
│  Scheduler.start()                      │
│  → scheduleNextCheck()                  │
└─────────────────┬───────────────────────┘
                  │
                  ▼ (每隔 checkInterval)
┌─────────────────────────────────────────┐
│  performCheck()                         │
│                                         │
│  1. 检查是否在升级窗口内                 │
│  2. 检查并发升级数量                     │
│  3. 遍历所有集合检查是否需要升级          │
│  4. 执行升级                             │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  checkAllCollections()                  │
│                                         │
│  for each collection:                   │
│    configManager.checkAndUpgrade()      │
│    → 成功：emit("upgradeCompleted")     │
│    → 失败：emit("upgradeFailed")        │
└─────────────────────────────────────────┘
```

## 三、关键代码示例

### 3.1 初始化向量存储

```typescript
// service-factory.ts
createVectorStore(): IVectorStore {
  const config = this.configManager.getVectorStorageConfig()
  
  // 确定 Qdrant URL
  const qdrantUrl = config.qdrantUrl || "http://localhost:6333"
  
  // 确定向量维度（根据嵌入模型）
  const vectorSize = this.getVectorSize(config.embedderModel)
  
  // 创建配置管理器
  const vectorStorageConfigManager = new VectorStorageConfigManager(
    this.contextProxy,
    new CollectionSizeEstimator(qdrantUrl, config.apiKey)
  )
  
  // 创建 Qdrant 客户端
  return new QdrantVectorStore(
    this.workspacePath,
    qdrantUrl,
    vectorSize,
    config.apiKey,
    vectorStorageConfigManager
  )
}
```

### 3.2 集合初始化流程

```typescript
// qdrant-client.ts
async initialize(): Promise<boolean> {
  let created = false
  
  try {
    const collectionInfo = await this.getCollectionInfo()
    
    if (collectionInfo === null) {
      // 集合不存在，创建新集合
      const config = await this.getConfig()
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: "Cosine",
          on_disk: config.vectors.on_disk,
        },
        hnsw_config: config.hnsw && {
          m: config.hnsw.m,
          ef_construct: config.hnsw.ef_construct,
          on_disk: config.hnsw.on_disk,
        },
      })
      created = true
    } else {
      // 集合存在，检查向量维度
      const existingVectorSize = this.getVectorSizeFromConfig(collectionInfo)
      
      if (existingVectorSize !== this.vectorSize) {
        // 维度不匹配，重建集合
        created = await this._recreateCollectionWithNewDimension(existingVectorSize)
      }
    }
    
    // 创建 payload 索引
    await this._createPayloadIndexes()
    return created
  } catch (error) {
    throw new Error(t("embeddings:vectorStore.qdrantConnectionFailed", ...))
  }
}
```

### 3.3 自动升级触发

```typescript
// orchestrator.ts - 在索引完成后触发检查
async performIndexing(): Promise<void> {
  try {
    // 执行索引...
    await this.indexFiles()
    
    // 标记索引完成
    await this.vectorStore.markIndexingComplete()
    
    // 检查是否需要升级配置
    await this.configManager.checkAndUpgradeCollection(this.collectionName)
  } catch (error) {
    // 错误处理...
  }
}
```

## 四、配置存储

配置存储在 VSCode 的 globalState 中：

```typescript
// vector-storage-config-manager.ts
private loadConfig(): VectorStorageConfig {
  const codebaseIndexConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig")
  const storedConfig = codebaseIndexConfig?.codebaseIndexVectorStorageConfig
  
  if (storedConfig) {
    return { ...DEFAULT_VECTOR_STORAGE_CONFIG, ...storedConfig }
  }
  return DEFAULT_VECTOR_STORAGE_CONFIG
}

private saveConfig(): void {
  const codebaseIndexConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig")
  this.contextProxy?.updateGlobalState("codebaseIndexConfig", {
    ...codebaseIndexConfig,
    codebaseIndexVectorStorageConfig: this.config,
  })
}
```

## 五、Qdrant API 使用详解

### 5.1 使用的 Qdrant API 总览

Roo Code 项目使用了以下 Qdrant REST API（通过 `@qdrant/js-client-rest` 客户端）：

| API 方法 | 用途 | 调用位置 |
|---------|------|---------|
| `createCollection` | 创建新集合 | qdrant-client.ts, initialize() |
| `getCollection` | 获取集合信息和状态 | qdrant-client.ts, getCollectionInfo() |
| `deleteCollection` | 删除集合 | qdrant-client.ts, deleteCollection() |
| `upsert` | 插入或更新向量点 | qdrant-client.ts, upsertPoints() |
| `query` | 搜索相似向量 | qdrant-client.ts, search() |
| `delete` | 删除符合条件的点 | qdrant-client.ts, deletePointsByMultipleFilePaths() |
| `retrieve` | 根据 ID 获取点 | qdrant-client.ts, hasIndexedData() |
| `createPayloadIndex` | 创建 payload 字段索引 | qdrant-client.ts, _createPayloadIndexes() |
| `updateCollection` | 更新集合配置 | collection-config-upgrade-service.ts |

### 5.2 API 详细用法

#### 5.2.1 createCollection - 创建集合

**用途**: 创建新的向量集合，配置向量维度、距离度量、HNSW 参数等。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - initialize()
const createParams: any = {
  vectors: {
    size: this.vectorSize,              // 向量维度（如 384, 768, 1536）
    distance: this.DISTANCE_METRIC,     // "Cosine" 余弦相似度
    on_disk: config.vectors.on_disk,    // 是否存储在磁盘上
  },
}

// 如果有 HNSW 配置
if (config.hnsw) {
  createParams.hnsw_config = {
    m: config.hnsw.m,                   // 邻居数量 (16/32/64)
    ef_construct: config.hnsw.ef_construct, // 构建精度 (128/256/512)
    on_disk: config.hnsw.on_disk,
  }
}

await this.client.createCollection(this.collectionName, createParams)
```

**API 参数说明**:

```typescript
interface CreateCollectionParams {
  collection_name: string
  vectors: {
    size: number           // 向量维度
    distance: "Cosine" | "Euclid" | "Dot" | "Manhattan"
    on_disk?: boolean
  }
  hnsw_config?: {
    m: number              // 每个节点的邻居数
    ef_construct: number   // 构建时的搜索深度
    on_disk?: boolean
  }
  optimizers_config?: {
    indexing_threshold: number  // 索引阈值
  }
  quantization_config?: {
    enabled: boolean
    type: "scalar" | "product" | "binary"
    bits?: number
  }
}
```

#### 5.2.2 getCollection - 获取集合信息

**用途**: 获取集合的详细信息，包括向量数量、配置参数等。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - getCollectionInfo()
private async getCollectionInfo(): Promise<Schemas["CollectionInfo"] | null> {
  try {
    const collectionInfo = await this.client.getCollection(this.collectionName)
    return collectionInfo
  } catch (error: unknown) {
    const errorStatus = (error as any)?.status || (error as any)?.response?.status
    
    if (errorStatus === 404) {
      throw new QdrantCollectionNotFoundError(this.collectionName)
    }
    // ... 错误处理
  }
}

// collection-config-upgrade-service.ts - checkAndUpgradeCollection()
const collectionInfo = await this.qdrantClient.getCollection(this.collectionName)
const currentSize = collectionInfo.points_count || 0
const hnswConfig = collectionInfo.config.hnsw_config  // 检测当前预设
```

**返回数据结构**:

```typescript
interface CollectionInfo {
  status: "green" | "yellow" | "red"
  optimizer_status: "ok" | "indexing"
  vectors_count: number      // 向量总数
  points_count: number       // 点的数量
  segments_count: number
  config: {
    params: {
      vectors: {
        size: number
        distance: string
      }
    }
    hnsw_config?: {
      m: number
      ef_construct: number
    }
  }
}
```

#### 5.2.3 upsert - 插入/更新向量点

**用途**: 插入新向量或更新已存在的向量及其 payload。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - upsertPoints()
async upsertPoints(points: Array<{
  id: string
  vector: number[]
  payload: Record<string, any>
}>): Promise<void> {
  // 处理路径格式：Windows 转 POSIX
  const processedPoints = points.map((point) => {
    if (point.payload?.filePath) {
      const normalizedPath = point.payload.filePath.replace(/\\/g, "/")
      const segments = normalizedPath.split("/").filter(Boolean)
      
      // 构建 pathSegments 对象用于过滤
      const pathSegments = segments.reduce(
        (acc: Record<string, string>, segment: string, index: number) => {
          acc[index.toString()] = segment
          return acc
        },
        {},
      )
      
      return {
        ...point,
        payload: {
          ...point.payload,
          filePath: normalizedPath,
          pathSegments,
        },
      }
    }
    return point
  })

  await this.client.upsert(this.collectionName, {
    points: processedPoints,
    wait: true,  // 等待索引完成
  })
}
```

**API 参数说明**:

```typescript
interface UpsertParams {
  collection_name: string
  wait?: boolean
  points: Array<{
    id: string | number    // 点的唯一标识
    vector: number[]       // 向量数据
    payload?: {            // 附加数据
      filePath: string
      codeChunk: string
      startLine: number
      endLine: number
      pathSegments: Record<string, string>
      type?: "metadata"
      indexing_complete?: boolean
    }
  }>
}
```

#### 5.2.4 query - 搜索相似向量

**用途**: 使用查询向量搜索最相似的向量，支持过滤和分数阈值。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - search()
async search(
  queryVector: number[],
  directoryPrefix?: string,
  minScore?: number,
  maxResults?: number,
): Promise<VectorStoreSearchResult[]> {
  // 构建路径过滤器
  let filter: any = undefined
  
  if (directoryPrefix) {
    const normalizedPrefix = path.posix.normalize(directoryPrefix.replace(/\\/g, "/"))
    if (normalizedPrefix !== "." && normalizedPrefix !== "./") {
      const cleanedPrefix = path.posix.normalize(
        normalizedPrefix.startsWith("./") ? normalizedPrefix.slice(2) : normalizedPrefix
      )
      const segments = cleanedPrefix.split("/").filter(Boolean)
      
      if (segments.length > 0) {
        filter = {
          must: segments.map((segment, index) => ({
            key: `pathSegments.${index}`,
            match: { value: segment },
          })),
        }
      }
    }
  }
  
  // 排除 metadata 类型的点
  const metadataExclusion = {
    must_not: [{ key: "type", match: { value: "metadata" } }],
  }
  
  const mergedFilter = filter
    ? { ...filter, must_not: [...(filter.must_not || []), ...metadataExclusion.must_not] }
    : metadataExclusion
  
  const searchRequest = {
    query: queryVector,
    filter: mergedFilter,
    score_threshold: minScore ?? DEFAULT_SEARCH_MIN_SCORE,
    limit: maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
    params: {
      hnsw_ef: 128,    // 搜索时的精度参数
      exact: false,    // 使用近似搜索
    },
    with_payload: {
      include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
    },
  }
  
  const operationResult = await this.client.query(this.collectionName, searchRequest)
  return operationResult.points.filter((p) => this.isPayloadValid(p.payload))
}
```

**API 参数说明**:

```typescript
interface QueryParams {
  collection_name: string
  query: number[] | Record<string, any>  // 查询向量或命名向量
  filter?: {
    must?: Array<{ key: string; match: { value: any } }>
    must_not?: Array<{ key: string; match: { value: any } }>
    should?: Array<{ key: string; match: { value: any } }>
  }
  score_threshold?: number    // 最小相似度分数
  limit?: number              // 返回结果数量
  with_payload?: boolean | Array<string>
  params?: {
    hnsw_ef?: number
    exact?: boolean
  }
}
```

#### 5.2.5 delete - 删除点

**用途**: 根据过滤条件删除符合条件的向量点。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - deletePointsByMultipleFilePaths()
async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return
  
  const workspaceRoot = this.workspacePath
  
  // 为每个文件路径构建过滤器
  const filters = filePaths.map((filePath) => {
    const relativePath = path.isAbsolute(filePath) 
      ? path.relative(workspaceRoot, filePath) 
      : filePath
    
    const normalizedRelativePath = path.normalize(relativePath).replace(/\\/g, "/")
    const segments = normalizedRelativePath.split("/").filter(Boolean)
    
    // 匹配所有路径段
    const mustConditions = segments.map((segment, index) => ({
      key: `pathSegments.${index}`,
      match: { value: segment },
    }))
    
    return { must: mustConditions }
  })
  
  // 使用 'should' 匹配任意文件路径（OR 条件）
  const filter = filters.length === 1 
    ? filters[0] 
    : { should: filters }
  
  await this.client.delete(this.collectionName, {
    filter,
    wait: true,
  })
}
```

**API 参数说明**:

```typescript
interface DeleteParams {
  collection_name: string
  wait?: boolean
  filter: {
    must?: Array<{ key: string; match: { value: any } }>
    must_not?: Array<{ key: string; match: { value: any } }>
    should?: Array<{ key: string; match: { value: any } }>
  }
}
```

#### 5.2.6 retrieve - 根据 ID 获取点

**用途**: 通过点的 ID 获取详细信息。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - hasIndexedData()
async hasIndexedData(): Promise<boolean> {
  const collectionInfo = await this.getCollectionInfo()
  if (!collectionInfo) return false
  
  const pointsCount = collectionInfo.points_count ?? 0
  if (pointsCount === 0) return false
  
  // 检查索引完成标记
  const metadataId = uuidv5("__indexing_metadata__", QDRANT_CODE_BLOCK_NAMESPACE)
  const metadataPoints = await this.client.retrieve(this.collectionName, {
    ids: [metadataId],
  })
  
  if (metadataPoints.length > 0) {
    return metadataPoints[0].payload?.indexing_complete === true
  }
  
  // 向后兼容：没有标记时检查 points_count
  return pointsCount > 0
}
```

**API 参数说明**:

```typescript
interface RetrieveParams {
  collection_name: string
  ids: Array<string | number>
  with_payload?: boolean | Array<string>
  with_vector?: boolean
}
```

#### 5.2.7 createPayloadIndex - 创建 Payload 索引

**用途**: 为 payload 字段创建索引以加速过滤查询。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - _createPayloadIndexes()
private async _createPayloadIndexes(): Promise<void> {
  // 创建 type 字段索引（用于 metadata 过滤）
  try {
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: "type",
      field_schema: "keyword",  // 关键词索引，支持精确匹配
    })
  } catch (indexError: any) {
    const errorMessage = (indexError?.message || "").toLowerCase()
    if (!errorMessage.includes("already exists")) {
      console.warn("[QdrantVectorStore] Could not create payload index for type")
    }
  }
  
  // 创建 pathSegments 字段索引（用于路径过滤）
  for (let i = 0; i <= 4; i++) {
    try {
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: `pathSegments.${i}`,
        field_schema: "keyword",
      })
    } catch (indexError: any) {
      const errorMessage = (indexError?.message || "").toLowerCase()
      if (!errorMessage.includes("already exists")) {
        console.warn(`[QdrantVectorStore] Could not create payload index for pathSegments.${i}`)
      }
    }
  }
}
```

**API 参数说明**:

```typescript
interface CreatePayloadIndexParams {
  collection_name: string
  field_name: string
  field_schema: "keyword" | "integer" | "float" | "geo" | "text" | "bool" | "datetime"
  wait?: boolean
}
```

#### 5.2.8 updateCollection - 更新集合配置

**用途**: 动态更新集合的配置参数，用于存储预设升级。

**Roo Code 使用示例**:

```typescript
// collection-config-upgrade-service.ts - applyPresetConfig()
private async applyPresetConfig(preset: PresetType): Promise<void> {
  const presetConfig = VECTOR_STORAGE_PRESETS[preset]
  
  // 应用 HNSW 配置
  if ("hnsw" in presetConfig.customConfig && presetConfig.customConfig.hnsw) {
    await this.qdrantClient.updateCollection(this.collectionName, {
      hnsw_config: presetConfig.customConfig.hnsw,
      optimizers_config: {
        indexing_threshold: 0,  // 禁用优化器索引阈值
      },
    })
  }
  
  // 应用量化配置（如果有）
  if (presetConfig.customConfig.vectors && 
      "quantization" in presetConfig.customConfig.vectors && 
      presetConfig.customConfig.vectors.quantization) {
    await this.qdrantClient.updateCollection(this.collectionName, {
      quantization_config: presetConfig.customConfig.vectors.quantization,
    })
  }
}
```

**API 参数说明**:

```typescript
interface UpdateCollectionParams {
  collection_name: string
  hnsw_config?: {
    m: number
    ef_construct: number
    on_disk?: boolean
  }
  quantization_config?: {
    enabled: boolean
    type: "scalar" | "product" | "binary"
    bits?: number
  }
  optimizers_config?: {
    indexing_threshold: number
  }
}
```

#### 5.2.9 deleteCollection - 删除集合

**用途**: 删除整个集合及其所有数据。

**Roo Code 使用示例**:

```typescript
// qdrant-client.ts - deleteCollection()
async deleteCollection(): Promise<void> {
  try {
    // 先检查集合是否存在
    if (await this.collectionExists()) {
      await this.client.deleteCollection(this.collectionName)
    }
  } catch (error) {
    console.error(`[QdrantVectorStore] Failed to delete collection ${this.collectionName}:`, error)
    throw error
  }
}

// qdrant-client.ts - _recreateCollectionWithNewDimension()
private async _recreateCollectionWithNewDimension(existingVectorSize: number): Promise<boolean> {
  try {
    // 步骤 1: 删除现有集合
    await this.client.deleteCollection(this.collectionName)
    
    // 步骤 2: 等待删除完成
    await new Promise((resolve) => setTimeout(resolve, 100))
    
    // 步骤 3: 验证删除成功
    const verificationInfo = await this.getCollectionInfo()
    if (verificationInfo !== null) {
      throw new Error("Collection still exists after deletion attempt")
    }
    
    // 步骤 4: 创建新集合
    await this.client.createCollection(this.collectionName, createParams)
    return true
  } catch (recreationError) {
    // 错误处理...
  }
}
```

### 5.3 过滤器语法详解

Roo Code 大量使用 Qdrant 的过滤功能实现目录前缀搜索：

```typescript
// 单段路径过滤（must: AND 条件）
filter = {
  must: [
    { key: "pathSegments.0", match: { value: "src" } },
    { key: "pathSegments.1", match: { value: "components" } }
  ]
}

// 多文件过滤（should: OR 条件）
filter = {
  should: [
    { 
      must: [
        { key: "pathSegments.0", match: { value: "src" } },
        { key: "pathSegments.1", match: { value: "file1.ts" } }
      ]
    },
    { 
      must: [
        { key: "pathSegments.0", match: { value: "src" } },
        { key: "pathSegments.1", match: { value: "file2.ts" } }
      ]
    }
  ]
}

// 排除 metadata 类型
filter = {
  must_not: [
    { key: "type", match: { value: "metadata" } }
  ]
}

// 组合过滤
filter = {
  must: [...pathFilters],
  must_not: [{ key: "type", match: { value: "metadata" } }]
}
```

### 5.4 API 调用时序图

```
索引创建流程:
┌─────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Orchestrator │ → │ QdrantVectorStore │ → │ QdrantClient │ → │ Qdrant Server │
└─────────┘    └──────────────┘    └───────────────┘    └──────────────┘
     │                │                    │                    │
     │ initialize()   │                    │                    │
     │───────────────>│                    │                    │
     │                │ getCollection()    │                    │
     │                │───────────────────>│                    │
     │                │                    │ GET /collections/{name}
     │                │                    │───────────────────>│
     │                │                    │                    │
     │                │                    │ CollectionInfo     │
     │                │                    │<───────────────────│
     │                │ CollectionInfo     │                    │
     │                │<───────────────────│                    │
     │                │                    │                    │
     │                │ [不存在] createCollection()             │
     │                │───────────────────>│                    │
     │                │                    │ PUT /collections/{name}
     │                │                    │───────────────────>│
     │                │                    │                    │
     │                │                    │ {status: "ok"}     │
     │                │                    │<───────────────────│
     │                │ {status: "ok"}     │                    │
     │                │<───────────────────│                    │
     │                │                    │                    │
     │                │ createPayloadIndex()                    │
     │                │───────────────────>│                    │
     │                │                    │ PUT /collections/{name}/index
     │                │                    │───────────────────>│
     │                │                    │                    │
     │                │                    │ {status: "ok"}     │
     │                │                    │<───────────────────│
     │                │                    │                    │
     │                │ upsert() (metadata)                      │
     │                │───────────────────>│                    │
     │                │                    │ PUT /collections/{name}/points
     │                │                    │───────────────────>│
     │                │                    │                    │
     │ true (新建)    │                    │                    │
     │<───────────────│                    │                    │
     │                │                    │                    │


数据迁移流程 (向量维度变化):
┌─────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Orchestrator │ → │ QdrantVectorStore │ → │ QdrantClient │ → │ Qdrant Server │
└─────────┘    └──────────────┘    └───────────────┘    └──────────────┘
     │                │                    │                    │
     │ initialize()   │                    │                    │
     │───────────────>│                    │                    │
     │                │ getCollection()    │                    │
     │                │───────────────────>│                    │
     │                │                    │                    │
     │                │ [维度不匹配]                                │
     │                │                    │                    │
     │                │ deleteCollection() │                    │
     │                │───────────────────>│ DELETE /collections/{name}
     │                │                    │───────────────────>│
     │                │                    │                    │
     │                │                    │ {status: "ok"}     │
     │                │                    │<───────────────────│
     │                │                    │                    │
     │                │ [等待 100ms 验证删除]                        │
     │                │                    │                    │
     │                │ createCollection() │                    │
     │                │ (新维度)            │ PUT /collections/{name}
     │                │───────────────────>│───────────────────>│
     │                │                    │                    │
     │                │                    │ {status: "ok"}     │
     │                │                    │<───────────────────│
     │                │                    │                    │
     │                │ createPayloadIndex() (重建索引)           │
     │                │───────────────────>│                    │
     │                │                    │                    │
     │ true (重建)    │                    │                    │
     │<───────────────│                    │                    │


配置升级流程:
┌─────────┐    ┌─────────────────────┐    ┌───────────────┐    ┌──────────────┐
│ Scheduler │ → │ ConfigUpgradeService │ → │ QdrantClient │ → │ Qdrant Server │
└─────────┘    └─────────────────────┘    └───────────────┘    └──────────────┘
     │                │                        │                    │
     │ checkAndUpgrade()│                        │                    │
     │───────────────>│                        │                    │
     │                │ getCollection()        │                    │
     │                │───────────────────────>│                    │
     │                │                        │ GET /collections/{name}
     │                │                        │───────────────────>│
     │                │                        │                    │
     │                │                        │ CollectionInfo     │
     │                │                        │<───────────────────│
     │                │ CollectionInfo         │                    │
     │                │<───────────────────────│                    │
     │                │                        │                    │
     │                │ [检测预设 → 计算升级路径]                      │
     │                │                        │                    │
     │                │ updateCollection()     │                    │
     │                │ (HNSW 配置)              │ PUT /collections/{name}
     │                │───────────────────────>│───────────────────>│
     │                │                        │                    │
     │                │                        │ {status: "ok"}     │
     │                │                        │<───────────────────│
     │                │                        │                    │
     │                │ updateCollection()     │                    │
     │                │ (量化配置)              │ PUT /collections/{name}
     │                │───────────────────────>│───────────────────>│
     │                │                        │                    │
     │                │                        │ {status: "ok"}     │
     │                │                        │<───────────────────│
     │                │                        │                    │
     │ true (已升级)  │                        │                    │
     │<───────────────│                        │                    │
```

## 六、总结

### 核心特性

1. **智能配置管理**: 根据数据量自动选择最优存储配置
2. **无缝迁移**: 向量维度变化时自动重建集合
3. **渐进式升级**: 支持多级预设，逐步升级配置
4. **状态跟踪**: 完整的升级进度跟踪和状态报告
5. **用户控制**: 支持暂停、恢复、取消、回滚操作
6. **定时调度**: 自动检查和执行升级

### 数据迁移流程总结

```
┌─────────────────────────────────────────────────────────────┐
│                     数据迁移触发                             │
├─────────────────────────────────────────────────────────────┤
│  1. 向量维度变化                                              │
│     → deleteCollection → createCollection (新维度)           │
│     → createPayloadIndex (重建索引)                          │
│                                                             │
│  2. 阈值跨越（数据量增长）                                    │
│     → getCollection (检测当前预设)                            │
│     → calculateUpgradePath (计算升级路径)                    │
│     → updateCollection (应用 HNSW/量化配置)                   │
│     → tiny → small → medium → large（逐步升级）              │
│                                                             │
│  3. 手动触发                                                 │
│     → 用户指定目标预设 → 执行升级流程                        │
└─────────────────────────────────────────────────────────────┘
```

### 最佳实践

1. **小数据集使用 tiny 预设**: 避免 HNSW 开销，使用全表搜索
2. **大数据集启用量化**: large 预设使用 8bit 标量量化减少存储
3. **增量升级**: 不要跳过预设级别，逐步升级确保稳定性
4. **监控升级进度**: 通过状态事件跟踪升级过程
5. **合理设置阈值**: 根据实际性能和资源调整阈值配置
6. **使用 payload 索引**: 为常用过滤字段创建索引提升查询性能
7. **wait 参数使用**: 关键操作（upsert/delete）设置 `wait: true` 确保数据一致性
