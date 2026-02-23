## Qdrant 错误处理改进方案

### 一、目录结构设计

```
src/services/code-index/
├── vector-store/
│   ├── qdrant-client.ts              # 主实现文件（修改）
│   ├── qdrant-errors.ts              # 新增：自定义错误类型定义
│   └── __tests__/
│       └── qdrant-client.spec.ts     # 测试文件（扩展）
├── orchestrator.ts                   # 编排器（修改）
├── manager.ts                        # 管理器（修改）
└── i18n/
    └── locales/
        ├── zh-CN/
        │   └── embeddings.json       # 中文国际化（扩展）
        └── en/
            └── embeddings.json       # 英文国际化（扩展）
```

### 二、文件间关系

#### 1. 依赖关系图

```
qdrant-errors.ts (纯错误定义)
    ↓ (被导入)
qdrant-client.ts (使用错误类型)
    ↓ (被持有)
orchestrator.ts (捕获并处理错误)
    ↓ (被持有)
manager.ts (协调错误恢复)
    ↓ (使用)
embeddings.json (错误消息国际化)
```

#### 2. 持有关系

- **Manager** 持有 **Orchestrator** 实例（一对一）
- **Orchestrator** 持有 **VectorStore** 实例（一对一，通过接口）
- **VectorStore** 持有 **QdrantClient** 实例（一对一）
- **QdrantClient** 持有 **QdrantClient** SDK 实例（一对一）

### 三、文件实现方式

#### 1. qdrant-errors.ts（新增）
- **实现方式**：纯函数导出（无状态）
- **职责**：定义两个自定义错误类，提供类型安全的错误区分
- **生命周期**：静态定义，无实例化

#### 2. qdrant-client.ts（修改）
- **实现方式**：有状态多实例（每个工作区一个实例）
- **职责**：
  - 封装 Qdrant SDK 调用
  - 转换底层错误为自定义错误类型
  - 实现带指数退避的重试机制
  - 提供集合存在性和数据检查方法
- **状态**：持有 QdrantClient 实例、集合名称、向量维度等配置

#### 3. orchestrator.ts（修改）
- **实现方式**：有状态多实例（每个工作区一个实例）
- **职责**：
  - 协调索引流程
  - 根据错误恢复标志选择索引策略
  - 处理连接错误并设置错误状态
- **状态**：持有处理标志、中止控制器、文件监听器订阅

#### 4. manager.ts（修改）
- **实现方式**：有状态全局单例（每个工作区一个单例）
- **职责**：
  - 检测错误状态并触发恢复
  - 协调服务重新初始化
  - 防止并发恢复操作
- **状态**：持有配置管理器、编排器、搜索服务等实例

#### 5. embeddings.json（扩展）
- **实现方式**：静态配置文件
- **职责**：提供国际化错误消息

### 四、业务逻辑设计

#### 1. 错误类型层次结构

```
Error (基类)
├── QdrantConnectionError (连接错误，可重试)
│   ├── ECONNREFUSED (连接被拒绝)
│   ├── ETIMEDOUT (连接超时)
│   └── ENOTFOUND (主机未找到)
└── QdrantCollectionNotFoundError (集合不存在，不可重试)
    └── HTTP 404 (集合未找到)
```

#### 2. 重试机制调用链

**触发条件**：QdrantVectorStore 的任何方法抛出 QdrantConnectionError

**调用流程**：
1. 方法调用 → 捕获错误
2. 判断错误类型 → 如果是 QdrantConnectionError
3. 进入重试循环 → 检查重试次数
4. 如果未达上限 → 计算延迟时间（指数退避）
5. 等待延迟 → 重新调用方法
6. 如果成功 → 返回结果
7. 如果失败或达上限 → 抛出最后错误

**重试策略**：
- 最大重试次数：3 次
- 初始延迟：1000 毫秒
- 延迟策略：指数退避（1s → 2s → 4s）
- 仅重试连接错误，不重试集合不存在错误

#### 3. 错误恢复状态机

**状态定义**：
- **Standby**：待机状态，未开始索引
- **Indexing**：索引进行中
- **Indexed**：索引完成
- **Error**：错误状态

**状态转换**：

```
[Standby] -- startIndexing() --> [Indexing]
[Indexing] -- 成功 --> [Indexed]
[Indexing] -- 连接错误 --> [Error]
[Error] -- startIndexing() --> [Indexing] (带 isRetryAfterError=true)
[Indexed] -- startIndexing() --> [Indexing] (带 isRetryAfterError=false)
[Error] -- recoverFromError() --> [Standby]
```

**错误恢复分支逻辑**：

当从 Error 状态调用 startIndexing() 时：

1. **检测错误状态** → Manager 检测到 systemStatus === "Error"
2. **设置恢复标志** → isRetryAfterError = true
3. **调用编排器** → orchestrator.startIndexing(isRetryAfterError=true)
4. **检查集合存在性** → vectorStore.collectionExists()
   - **分支 A**：连接错误 → 抛出 QdrantConnectionError → 进入 Error 状态
   - **分支 B**：集合不存在 → 返回 false → 执行全量扫描
   - **分支 C**：集合存在 → 继续检查数据
5. **检查索引数据** → vectorStore.hasIndexedData()
   - **分支 A**：连接错误 → 抛出 QdrantConnectionError → 进入 Error 状态
   - **分支 B**：无数据 → 返回 false → 执行全量扫描
   - **分支 C**：有数据 → 返回 true → 执行增量扫描
6. **执行索引** → 根据检查结果选择扫描策略

#### 4. 正常重新索引分支逻辑

当从非 Error 状态调用 startIndexing() 时：

1. **检测正常状态** → Manager 检测到 systemStatus !== "Error"
2. **设置正常标志** → isRetryAfterError = false
3. **调用编排器** → orchestrator.startIndexing(isRetryAfterError=false)
4. **跳过检查** → 不检查集合存在性和数据
5. **直接索引** → 执行全量扫描（或根据配置执行增量扫描）

#### 5. getCollectionInfo() 错误处理分支树

```
调用 getCollectionInfo()
    ↓
尝试获取集合信息
    ↓
捕获错误
    ↓
判断错误类型
    ├── 是 AxiosError？
    │   ├── 状态码 404？
    │   │   └── 抛出 QdrantCollectionNotFoundError
    │   ├── 错误码 ECONNREFUSED 或 ETIMEDOUT？
    │   │   └── 抛出 QdrantConnectionError
    │   └── 其他 AxiosError
    │       └── 抛出原始错误
    └── 其他错误
        └── 抛出原始错误
```

#### 6. hasIndexedData() 错误处理分支树

```
调用 hasIndexedData()
    ↓
调用 getCollectionInfo()
    ↓
捕获错误
    ↓
判断错误类型
    ├── 是 QdrantConnectionError？
    │   └── 向上抛出（触发重试）
    ├── 是 QdrantCollectionNotFoundError？
    │   └── 返回 false（集合不存在，无数据）
    └── 其他错误
        └── 向上抛出
```

#### 7. collectionExists() 错误处理分支树

```
调用 collectionExists()
    ↓
调用 getCollectionInfo()
    ↓
捕获错误
    ↓
判断错误类型
    ├── 是 QdrantConnectionError？
    │   └── 向上抛出（触发重试）
    ├── 是 QdrantCollectionNotFoundError？
    │   └── 返回 false（集合不存在）
    └── 其他错误
        └── 向上抛出
```

### 五、关键业务流程

#### 流程 1：首次索引（无错误）

1. 用户打开项目
2. Manager.initialize() → 创建服务实例
3. Manager.startIndexing() → 检测状态为 Standby
4. Orchestrator.startIndexing(isRetryAfterError=false)
5. VectorStore.initialize() → 创建新集合
6. 执行全量扫描
7. 状态转换：Standby → Indexing → Indexed

#### 流程 2：连接失败后恢复

1. 用户打开项目，Qdrant 服务未启动
2. Manager.initialize() → 创建服务实例
3. Manager.startIndexing() → 检测状态为 Standby
4. Orchestrator.startIndexing(isRetryAfterError=false)
5. VectorStore.initialize() → 尝试连接
6. 连接失败 → 抛出 QdrantConnectionError
7. 重试机制触发 → 3 次重试均失败
8. Orchestrator 捕获错误 → 设置状态为 Error
9. 用户启动 Qdrant 服务
10. 用户点击重新索引
11. Manager.startIndexing() → 检测状态为 Error
12. 设置 isRetryAfterError = true
13. Orchestrator.startIndexing(isRetryAfterError=true)
14. VectorStore.collectionExists() → 检查集合存在
15. VectorStore.hasIndexedData() → 检查是否有数据
16. 如果集合存在且有数据 → 执行增量扫描
17. 如果集合不存在或无数据 → 执行全量扫描
18. 状态转换：Error → Indexing → Indexed

#### 流程 3：正常重新索引

1. 项目已索引完成，状态为 Indexed
2. 用户点击重新索引按钮
3. Manager.startIndexing() → 检测状态为 Indexed（非 Error）
4. 设置 isRetryAfterError = false
5. Orchestrator.startIndexing(isRetryAfterError=false)
6. 跳过集合检查
7. 执行全量扫描
8. 状态转换：Indexed → Indexing → Indexed

### 六、错误消息国际化

#### 中文消息映射

- `embeddings:orchestrator.failedToConnect` → "连接失败：{{errorMessage}}"
- `embeddings:orchestrator.unexpectedError` → "意外错误：{{errorMessage}}"
- `embeddings:orchestrator.indexingRequiresWorkspace` → "索引需要打开的工作区文件夹"

#### 英文消息映射

- `embeddings:orchestrator.failedToConnect` → "Connection failed: {{errorMessage}}"
- `embeddings:orchestrator.unexpectedError` → "Unexpected error: {{errorMessage}}"
- `embeddings:orchestrator.indexingRequiresWorkspace` → "Indexing requires an open workspace folder"

### 七、测试策略

#### 单元测试覆盖

1. **qdrant-errors.ts**：测试错误类实例化和属性
2. **qdrant-client.ts**：
   - 测试 getCollectionInfo() 的错误转换
   - 测试 hasIndexedData() 的错误处理
   - 测试 collectionExists() 的错误处理
   - 测试重试机制的指数退避
   - 测试重试次数限制
3. **orchestrator.ts**：
   - 测试 isRetryAfterError=true 时的增量扫描
   - 测试 isRetryAfterError=false 时的全量扫描
   - 测试连接错误的错误状态设置
4. **manager.ts**：
   - 测试错误状态检测
   - 测试 recoverFromError() 的幂等性
   - 测试并发恢复防护

#### 集成测试场景

1. 临时连接失败后恢复
2. 正常重新索引
3. 集合不存在时的处理
4. 并发恢复操作防护

### 八、向后兼容性

- 保持现有公共 API 不变
- 新增的 isRetryAfterError 参数有默认值
- 错误类型扩展不影响现有错误处理
- 国际化消息新增键值不影响现有翻译

### 九、性能考虑

- 重试机制仅在连接错误时触发，避免不必要的延迟
- 指数退避策略平衡重试效率和系统负载
- 错误恢复时复用现有集合，避免全量重新嵌入
- 集合检查仅在错误恢复时执行，正常流程不受影响

### 十、安全性考虑

- 重试次数限制防止无限循环
- 错误消息不暴露敏感信息
- 连接错误不泄露内部实现细节
- 防止并发恢复操作导致状态不一致