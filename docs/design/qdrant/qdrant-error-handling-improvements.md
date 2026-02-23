# Qdrant 存储模块错误处理改进方案

## 问题背景

### 原始问题

当打开项目时如果没有网络连接或未开启数据库服务，索引获取会直接失败。但是在修复后点击重新索引时，系统不会先尝试获取现有索引，而是直接执行全量重新嵌入向量，导致不必要的资源浪费。

### 根本原因分析

1. **错误类型混淆**：连接错误被误判为"无现有数据"
2. **缺少重试机制**：临时连接问题没有自动恢复
3. **重试逻辑不完善**：错误恢复和正常重新索引使用相同逻辑
4. **错误信息不清晰**：用户无法区分不同类型的错误

## 解决方案

### 1. 自定义错误类型

在 `qdrant-client.ts` 中添加了两个自定义错误类，用于精确区分不同类型的错误：

```typescript
export class QdrantConnectionError extends Error {
	constructor(message: string, public readonly originalError?: Error) {
		super(message)
		this.name = "QdrantConnectionError"
	}
}

export class QdrantCollectionNotFoundError extends Error {
	constructor(collectionName: string) {
		super(`Collection "${collectionName}" not found`)
		this.name = "QdrantCollectionNotFoundError"
	}
}
```

**作用**：
- `QdrantConnectionError`：标识网络连接、数据库服务不可用等连接问题
- `QdrantCollectionNotFoundError`：标识集合不存在的问题
- 通过错误类型区分，上层可以采取不同的恢复策略

### 2. 改进错误处理

#### 2.1 getCollectionInfo() 方法改进

```typescript
async getCollectionInfo(collectionName: string): Promise<CollectionInfo | null> {
	try {
		const response = await this.client.getCollection(collectionName)
		return {
			pointsCount: response.result.points_count ?? 0,
			vectorsCount: response.result.vectors_count ?? 0,
			segmentsCount: response.result.segments_count ?? 0,
			status: response.result.status ?? "green",
			optimizerStatus: response.result.optimizer_status ?? "ok",
		}
	} catch (error) {
		if (error instanceof AxiosError) {
			if (error.response?.status === 404) {
				throw new QdrantCollectionNotFoundError(collectionName)
			}
			if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
				throw new QdrantConnectionError(
					`Failed to connect to Qdrant: ${error.message}`,
					error,
				)
			}
		}
		throw error
	}
}
```

**改进点**：
- 404 错误转换为 `QdrantCollectionNotFoundError`
- 连接错误（ECONNREFUSED, ETIMEDOUT）转换为 `QdrantConnectionError`
- 保留原始错误信息用于调试

#### 2.2 hasIndexedData() 方法改进

```typescript
async hasIndexedData(): Promise<boolean> {
	try {
		const collectionInfo = await this.getCollectionInfo(this.collectionName)
		return collectionInfo !== null && collectionInfo.pointsCount > 0
	} catch (error) {
		if (error instanceof QdrantConnectionError) {
			throw error
		}
		if (error instanceof QdrantCollectionNotFoundError) {
			return false
		}
		throw error
	}
}
```

**改进点**：
- 连接错误向上抛出，触发重试机制
- 集合不存在返回 false，表示无现有数据
- 其他错误继续抛出

#### 2.3 collectionExists() 方法改进

```typescript
async collectionExists(): Promise<boolean> {
	try {
		await this.getCollectionInfo(this.collectionName)
		return true
	} catch (error) {
		if (error instanceof QdrantConnectionError) {
			throw error
		}
		if (error instanceof QdrantCollectionNotFoundError) {
			return false
		}
		throw error
	}
}
```

**改进点**：
- 与 `hasIndexedData()` 保持一致的错误处理策略
- 提供准确的集合存在性判断

### 3. 重试机制

添加了带指数退避的重试机制，提高系统对临时连接问题的容错能力：

```typescript
private async retryWithBackoff<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	initialDelay: number = 1000,
): Promise<T> {
	let lastError: Error | undefined

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await operation()
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))

			if (error instanceof QdrantConnectionError) {
				if (attempt < maxRetries) {
					const delay = initialDelay * Math.pow(2, attempt)
					console.log(
						`[QdrantVectorStore] Connection error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`,
					)
					await new Promise((resolve) => setTimeout(resolve, delay))
					continue
				}
			}

			throw lastError
		}
	}

	throw lastError || new Error("Retry failed")
}
```

**特点**：
- 最多重试 3 次
- 初始延迟 1 秒，每次延迟翻倍（1s, 2s, 4s）
- 仅对连接错误进行重试
- 其他错误（如集合不存在）直接抛出，不浪费时间重试

### 4. 区分错误重试与正常重新索引

#### 4.1 Orchestrator 改进

在 `orchestrator.ts` 的 `startIndexing()` 方法中添加了 `isRetryAfterError` 参数：

```typescript
public async startIndexing(isRetryAfterError: boolean = false): Promise<void> {
	let collectionExists = false
	let hasExistingData = false

	try {
		collectionExists = await this.vectorStore.collectionExists()

		if (isRetryAfterError) {
			if (collectionExists) {
				hasExistingData = await this.vectorStore.hasIndexedData()
				if (hasExistingData) {
					console.log(
						"[CodeIndexOrchestrator] Error retry: Collection exists with indexed data. Reusing existing collection for incremental scan.",
					)
					this.stateManager.setSystemState("Indexing", "Reusing existing collection...")
				} else {
					console.log(
						"[CodeIndexOrchestrator] Error retry: Collection exists but has no indexed data. Will perform full scan.",
					)
				}
			} else {
				console.log(
					"[CodeIndexOrchestrator] Error retry: Collection does not exist. Will create new collection and perform full scan.",
				)
			}
		}
	} catch (error) {
		if (error instanceof QdrantConnectionError) {
			console.error("[CodeIndexOrchestrator] Failed to connect to Qdrant:", error.message)
			this.stateManager.setSystemState(
				"Error",
				t("embeddings:orchestrator.failedToConnect", {
					errorMessage: error.message,
				}),
			)
			this._isProcessing = false
			return
		}
		throw error
	}

	if (isRetryAfterError && collectionExists && hasExistingData) {
		// 错误恢复：使用增量扫描
		await this.performIncrementalScan(scanWorkspace)
	} else {
		// 正常重新索引或无现有数据：执行全量扫描
		await this.performFullScan(scanWorkspace)
	}
}
```

**逻辑说明**：
- `isRetryAfterError = true`：从错误状态恢复
  - 检查集合是否存在
  - 如果存在且有数据，复用现有集合进行增量扫描
  - 如果不存在或无数据，执行全量扫描
- `isRetryAfterError = false`：正常重新索引
  - 直接开始索引流程，不检查现有数据

#### 4.2 Manager 改进

在 `manager.ts` 的 `startIndexing()` 方法中添加状态检测：

```typescript
public async startIndexing(): Promise<void> {
	if (!this.isFeatureEnabled) {
		return
	}

	const currentStatus = this.getCurrentStatus()
	const isRetryAfterError = currentStatus.systemStatus === "Error"

	if (isRetryAfterError) {
		console.log("[CodeIndexManager] Starting indexing after error state, will attempt to reuse existing collection if available")
	}

	this.assertInitialized()
	await this._orchestrator!.startIndexing(isRetryAfterError)
}
```

**作用**：
- 检测当前系统状态
- 如果处于错误状态，设置 `isRetryAfterError = true`
- 将标志传递给 orchestrator

### 5. 国际化错误消息

更新了中英文错误消息，提供更清晰的错误提示：

#### 中文 (zh-CN/embeddings.json)

```json
{
	"orchestrator": {
		"failedToConnect": "连接失败：{{errorMessage}}",
		"unexpectedError": "意外错误：{{errorMessage}}",
		"indexingRequiresWorkspace": "索引需要打开的工作区文件夹"
	}
}
```

#### 英文 (en/embeddings.json)

```json
{
	"orchestrator": {
		"failedToConnect": "Connection failed: {{errorMessage}}",
		"unexpectedError": "Unexpected error: {{errorMessage}}",
		"indexingRequiresWorkspace": "Indexing requires an open workspace folder"
	}
}
```

## 实施效果

### 1. 错误恢复流程

**场景 1：临时连接失败后恢复**

```
1. 用户打开项目，Qdrant 服务未启动
2. 索引失败，系统进入 Error 状态
3. 用户启动 Qdrant 服务
4. 用户点击重新索引
5. 系统检测到 Error 状态，设置 isRetryAfterError = true
6. 检查集合是否存在
7. 如果存在且有数据，复用现有集合进行增量扫描
8. 如果不存在或无数据，执行全量扫描
```

**场景 2：正常重新索引**

```
1. 用户点击重新索引按钮
2. 系统检测到非 Error 状态，设置 isRetryAfterError = false
3. 直接开始索引流程
4. 执行全量扫描（或根据配置执行增量扫描）
```

### 2. 连接错误处理

```
1. 尝试连接 Qdrant
2. 连接失败（ECONNREFUSED 或 ETIMEDOUT）
3. 抛出 QdrantConnectionError
4. 触发重试机制
5. 等待 1 秒后重试
6. 如果仍然失败，等待 2 秒后重试
7. 如果仍然失败，等待 4 秒后重试
8. 如果仍然失败，放弃重试，进入 Error 状态
```

### 3. 集合不存在处理

```
1. 尝试获取集合信息
2. 收到 404 响应
3. 抛出 QdrantCollectionNotFoundError
4. 不触发重试（因为重试不会改变结果）
5. 返回 false（集合不存在）
6. 执行全量扫描，创建新集合
```

## 技术细节

### 错误类型层次

```
Error
├── QdrantConnectionError (连接问题，可重试)
└── QdrantCollectionNotFoundError (集合不存在，不可重试)
```

### 重试策略

| 错误类型 | 是否重试 | 重试次数 | 初始延迟 | 延迟策略 |
|---------|---------|---------|---------|---------|
| QdrantConnectionError | 是 | 3 | 1000ms | 指数退避 |
| QdrantCollectionNotFoundError | 否 | - | - | - |
| 其他错误 | 否 | - | - | - |

### 状态转换

```
Standby → Indexing → Indexed
Standby → Indexing → Error → Indexing (isRetryAfterError=true) → Indexed
```

## 测试验证

### 1. Lint 检查

```bash
pnpm lint
```

结果：✅ 通过

### 2. 类型检查

```bash
pnpm check-types
```

结果：✅ 通过

### 3. 手动测试场景

#### 场景 1：连接失败后恢复

1. 停止 Qdrant 服务
2. 打开项目，尝试索引
3. 预期：进入 Error 状态，显示连接失败消息
4. 启动 Qdrant 服务
5. 点击重新索引
6. 预期：检测到现有集合，执行增量扫描

#### 场景 2：正常重新索引

1. 项目已索引完成
2. 点击重新索引按钮
3. 预期：直接开始索引，不检查现有数据

#### 场景 3：集合不存在

1. 删除 Qdrant 集合
2. 点击重新索引
3. 预期：检测到集合不存在，执行全量扫描

## 总结

本次改进主要解决了以下问题：

1. **错误类型混淆**：通过自定义错误类型精确区分连接错误和集合不存在错误
2. **缺少重试机制**：添加带指数退避的重试机制，提高对临时连接问题的容错能力
3. **重试逻辑不完善**：区分错误恢复和正常重新索引，避免不必要的全量扫描
4. **错误信息不清晰**：更新国际化消息，提供更清晰的错误提示

改进后的系统具有以下优势：

- **更高的可靠性**：自动重试机制处理临时连接问题
- **更好的用户体验**：错误恢复时复用现有数据，减少等待时间
- **更清晰的错误信息**：用户可以了解具体发生了什么问题
- **更高效的资源利用**：避免不必要的全量扫描

这些改进使得 Qdrant 存储模块在面对网络波动、服务重启等临时问题时，能够更加智能地恢复，提供更稳定的代码索引服务。
