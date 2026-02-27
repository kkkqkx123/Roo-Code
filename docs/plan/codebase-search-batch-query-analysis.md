# Codebase Search 批量查询功能分析

## 1. 现状分析

### 1.1 当前实现概述

当前 `codebase_search` 工具的实现位于以下文件：
- **工具定义**: `src/core/prompts/tools/native-tools/codebase_search.ts`
- **工具实现**: `src/core/tools/CodebaseSearchTool.ts`
- **搜索服务**: `src/services/code-index/search-service.ts`
- **索引管理**: `src/services/code-index/manager.ts`

### 1.2 当前工具的限制

#### 1.2.1 单次查询限制
当前工具只支持单次查询，每次调用只能执行一个搜索请求：
```typescript
interface CodebaseSearchParams {
    query: string
    path?: string
}
```

#### 1.2.2 多次搜索的性能问题
根据工具描述中的建议：
> "For complex query, you can split it into multiple codebase_search calls"

这意味着对于复杂查询，需要多次调用工具，存在以下问题：

1. **网络开销**: 每次调用都需要独立的网络请求（向量化API调用）
2. **延迟累积**: 多次调用的延迟会累积，影响用户体验
3. **资源浪费**: 每次调用都需要独立的embedding生成
4. **上下文消耗**: 多次工具调用会消耗更多的对话上下文

#### 1.2.3 结果聚合缺失
当前实现没有提供结果聚合机制：
- 无法合并重复结果
- 无法对多次匹配的结果提高权重
- 无法跨查询进行结果排序

### 1.3 现有批量处理参考

在 `ReadFileTool.ts` 中，已经实现了批量文件读取的功能：
- 支持批量审批（batch approval）
- 支持单个文件和多个文件的不同处理路径
- 提供了批量处理的UI交互模式

这为批量查询功能提供了良好的参考模式。

## 2. 批量查询功能必要性评估

### 2.1 使用场景分析

#### 场景1: 复杂语义搜索
用户需要搜索"user authentication and authorization validation"：
- 当前方案: 需要分别搜索 "authentication"、"authorization"、"validation"
- 批量方案: 一次调用传入多个查询，自动聚合结果

#### 场景2: 多维度搜索
用户需要从不同角度搜索同一功能：
- 搜索 "error handling"
- 搜索 "exception handling"
- 搜索 "try catch"
- 批量方案: 一次调用完成所有维度的搜索

#### 场景3: 相关概念搜索
用户需要搜索相关联的概念：
- 搜索 "database connection"
- 搜索 "connection pool"
- 搜索 "database client"
- 批量方案: 一次调用获取所有相关代码

### 2.2 收益评估

#### 2.2.1 性能收益
- **减少API调用**: 批量embedding生成可以减少API调用次数
- **并行处理**: 多个查询可以并行执行搜索
- **减少延迟**: 批量处理可以显著减少总体延迟

#### 2.2.2 用户体验收益
- **更自然的交互**: 用户可以用多个关键词表达复杂意图
- **更准确的结果**: 通过结果聚合提高搜索准确性
- **更少的工具调用**: 减少对话轮次，提高效率

#### 2.2.3 资源利用收益
- **减少上下文消耗**: 一次工具调用替代多次调用
- **更高效的embedding利用**: 批量生成embedding更高效

### 2.3 风险评估

#### 2.3.1 复杂度增加
- 需要设计新的参数结构
- 需要实现结果聚合逻辑
- 需要处理部分失败的情况

#### 2.3.2 向后兼容
- 需要保持对现有单查询格式的支持
- 需要考虑旧版本工具调用的兼容性

## 3. 批量查询实现方案设计（简化版）

### 3.1 设计原则

针对LLM使用的工具，应遵循以下原则：
1. **简单实用**：避免过度设计，减少LLM调用失败的可能性
2. **智能默认**：使用合理的默认策略，无需LLM配置复杂参数
3. **容错性强**：支持多种参数格式，提高调用成功率

### 3.2 参数结构设计

#### 3.2.1 新参数结构
```typescript
interface CodebaseSearchParams {
    // 批量查询（主要参数）
    queries: Array<{
        query: string
        path?: string  // 可选，限制搜索范围
    }>
    
    // 可选：聚合后的最大结果数（默认使用代码索引配置）
    maxResults?: number
}
```

#### 3.2.2 参数解析兼容性
为了减少LLM调用失败，工具在解析参数时应支持以下格式：

**格式1：标准批量查询**
```json
{
    "queries": [
        { "query": "error handling" },
        { "query": "exception handling" }
    ]
}
```

**格式2：单查询（向后兼容）**
```json
{
    "query": "authentication validation",
    "path": "src/auth"
}
```
解析时自动转换为：
```json
{
    "queries": [
        { "query": "authentication validation", "path": "src/auth" }
    ]
}
```

**格式3：简化批量查询（字符串数组）**
```json
{
    "queries": ["error handling", "exception handling"]
}
```
解析时自动转换为标准格式。

### 3.3 聚合策略（固定策略）

采用简单高效的固定聚合策略，无需LLM配置：

#### 3.3.1 去重策略
- **始终去重**：使用 `filePath + startLine + endLine` 作为唯一标识
- 重复结果只保留得分最高的版本

#### 3.3.2 权重计算
- **多次匹配加成**：每次额外匹配增加5%的相似性得分
- 计算公式：
  ```typescript
  finalScore = baseScore * (1 + 0.05 * (matchCount - 1))
  ```
  示例：
  - 匹配1个查询：得分 × 1.00
  - 匹配2个查询：得分 × 1.05
  - 匹配3个查询：得分 × 1.10
  - 匹配4个查询：得分 × 1.15

#### 3.3.3 结果数量控制
- **默认使用代码索引配置**：使用 `CodeIndexConfigManager.currentSearchMaxResults`
- **可选覆盖**：通过 `maxResults` 参数覆盖默认配置
- 聚合后返回的结果数量不超过配置的最大值

### 3.4 执行流程设计

```
1. 参数解析与标准化
   ├─ 检测参数格式（单查询/批量查询/字符串数组）
   ├─ 统一转换为标准批量查询格式
   └─ 验证参数合法性

2. 批量embedding生成
   ├─ 收集所有查询文本
   └─ 调用embedder.createEmbeddings(queries)

3. 并行搜索执行
   ├─ 对每个查询执行vectorStore.search()
   └─ 收集所有搜索结果

4. 结果聚合处理（固定策略）
   ├─ 去重（使用filePath:startLine-endLine作为key）
   ├─ 计算多次匹配加成（每次+5%）
   └─ 按最终得分排序

5. 返回结果
   └─ 限制结果数量（使用配置或maxResults参数）
```

### 3.5 核心代码实现建议

#### 3.5.1 参数解析与标准化

```typescript
interface NormalizedQuery {
    query: string
    path?: string
}

private normalizeParams(params: any): NormalizedQuery[] {
    // 格式1：标准批量查询
    if (params.queries && Array.isArray(params.queries)) {
        return params.queries.map((q: any) => {
            if (typeof q === 'string') {
                // 格式3：字符串数组
                return { query: q }
            }
            return { query: q.query, path: q.path }
        })
    }
    
    // 格式2：单查询（向后兼容）
    if (params.query && typeof params.query === 'string') {
        return [{ query: params.query, path: params.path }]
    }
    
    throw new Error('Invalid parameters: must provide "query" or "queries"')
}
```

#### 3.5.2 CodebaseSearchTool.ts 修改

```typescript
async execute(params: any, task: Task, callbacks: ToolCallbacks): Promise<void> {
    const { askApproval, handleError, pushToolResult } = callbacks
    
    // 1. 参数标准化
    let normalizedQueries: NormalizedQuery[]
    try {
        normalizedQueries = this.normalizeParams(params)
    } catch (error) {
        task.consecutiveMistakeCount++
        pushToolResult(formatResponse.toolError((error as Error).message))
        return
    }
    
    const maxResults = params.maxResults || this.configManager.currentSearchMaxResults
    
    // 2. 批量生成embeddings
    const queryTexts = normalizedQueries.map(q => q.query)
    const embeddings = await manager.createEmbeddings(queryTexts)
    
    // 3. 并行执行搜索
    const searchPromises = normalizedQueries.map((q, index) => {
        const vector = embeddings[index]
        return manager.searchWithVector(vector, q.path)
    })
    const allResults = await Promise.all(searchPromises)
    
    // 4. 聚合结果（固定策略）
    const aggregatedResults = this.aggregateResults(allResults, maxResults)
    
    // 5. 返回结果
    pushToolResult(this.formatResult(aggregatedResults, normalizedQueries))
}
```

#### 3.5.3 结果聚合器实现（简化版）

```typescript
private aggregateResults(
    allResults: VectorStoreSearchResult[][],
    maxResults: number
): AggregatedResult[] {
    const resultMap = new Map<string, AggregatedResult>()
    
    // 遍历所有查询结果
    allResults.forEach((queryResults) => {
        queryResults.forEach(result => {
            const key = this.getResultKey(result)
            const existing = resultMap.get(key)
            
            if (existing) {
                // 已存在：更新匹配次数和得分
                existing.matchCount++
                // 多次匹配加成：每次额外匹配增加5%
                existing.finalScore = existing.baseScore * (1 + 0.05 * (existing.matchCount - 1))
            } else {
                // 新结果
                resultMap.set(key, {
                    ...result,
                    matchCount: 1,
                    baseScore: result.score,
                    finalScore: result.score
                })
            }
        })
    })
    
    // 按最终得分排序并限制数量
    return Array.from(resultMap.values())
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, maxResults)
}

private getResultKey(result: VectorStoreSearchResult): string {
    const payload = result.payload
    return `${payload?.filePath}:${payload?.startLine}-${payload?.endLine}`
}
```

### 3.6 工具描述更新（简化版）

```typescript
const CODEBASE_SEARCH_DESCRIPTION = `This tool uses semantic search to find relevant code based on meaning rather than just keywords. For precise search (like a certain function name), use regex_search (search_files tool) instead.

**IMPORTANT**: Always use simple query terms. Avoid using complex queries that contain multiple content. Queries MUST be in English (translate if needed).

**Batch Query Support**: You can provide multiple queries in a single call for complex searches. This is more efficient than multiple separate calls. Results are automatically deduplicated and results matching multiple queries get a score boost (+5% per additional match).

Parameters:
- query: (optional) Single search query string. Use this for simple searches.
- queries: (optional) Array of queries for batch search. Can be:
  - Array of strings: ["error handling", "exception handling"]
  - Array of objects: [{ "query": "error handling", "path": "src/utils" }]
- path: (optional) Default subdirectory to limit search scope (used when query is a string)
- maxResults: (optional) Maximum number of results to return (defaults to code index configuration)

Examples:

Single query:
{ "query": "authentication validation", "path": "src/auth" }

Batch query (simple):
{ "queries": ["error handling", "exception handling", "try catch"] }

Batch query with paths:
{
  "queries": [
    { "query": "error handling", "path": "src/utils" },
    { "query": "exception handling", "path": "src/api" }
  ]
}

Batch query with custom maxResults:
{
  "queries": ["database connection", "connection pool"],
  "maxResults": 10
}`
```

## 4. 结果格式设计

### 4.1 单查询结果格式（保持不变）
```
Query: authentication validation
Results:

File path: src/auth/validator.ts
Score: 0.89
Lines: 45-67
Code Chunk: export function validateToken(token: string) { ... }
```

### 4.2 批量查询结果格式（简化版）
```
Batch Query Results (3 queries):
- "error handling"
- "exception handling"
- "try catch"

Results:

File path: src/utils/errorHandler.ts
Score: 0.89 (matched 2 queries, +5% boost)
Lines: 23-45
Code Chunk: export class ErrorHandler { ... }

File path: src/api/middleware.ts
Score: 0.72
Lines: 89-102
Code Chunk: try { ... } catch (error) { ... }
```

**说明**：
- 只在结果匹配多个查询时显示boost信息
- 保持简洁，避免过多细节干扰LLM理解

## 5. 实施建议

### 5.1 实施步骤

#### 步骤1：参数解析层
- 实现参数标准化函数 `normalizeParams()`
- 支持三种参数格式的自动转换
- 添加参数验证和错误处理

#### 步骤2：批量搜索层
- 修改 `CodeIndexSearchService` 支持批量embedding生成
- 实现并行搜索执行
- 保持与现有单查询接口的兼容

#### 步骤3：结果聚合层
- 实现固定策略的结果聚合器
- 去重逻辑（使用filePath:startLine-endLine作为key）
- 多次匹配加成计算（每次+5%）

#### 步骤4：结果格式化
- 更新结果输出格式
- 支持单查询和批量查询的不同输出格式
- 保持简洁，避免信息过载

### 5.2 测试策略

#### 5.2.1 参数解析测试
- 测试单查询格式转换
- 测试批量查询格式（对象数组）
- 测试简化批量查询格式（字符串数组）
- 测试错误参数处理

#### 5.2.2 聚合逻辑测试
- 测试去重功能
- 测试多次匹配加成计算
- 测试结果排序
- 测试结果数量限制

#### 5.2.3 集成测试
- 测试与CodeIndexManager的集成
- 测试与VectorStore的集成
- 测试端到端的批量查询流程

### 5.3 文档更新

- 更新工具描述（codebase_search.ts）
- 添加批量查询使用示例
- 更新API参考文档

## 6. 结论与建议

### 6.1 核心结论

**强烈建议添加批量查询功能**，采用简化设计方案：

1. **简单实用**：固定聚合策略，无需LLM配置复杂参数
2. **容错性强**：支持多种参数格式，减少调用失败
3. **智能默认**：自动去重和多次匹配加成（每次+5%）
4. **向后兼容**：完全兼容现有单查询格式

### 6.2 设计优势

#### 相比原方案的改进：
1. **移除复杂配置**：删除了aggregation、weight等可选参数
2. **固定聚合策略**：始终去重，始终应用多次匹配加成
3. **简化参数结构**：queries数组支持字符串和对象两种格式
4. **智能参数解析**：自动识别并转换三种参数格式

#### 对LLM的友好性：
1. **减少认知负担**：无需理解复杂的聚合配置
2. **降低错误率**：多种参数格式支持，减少调用失败
3. **清晰的反馈**：简洁的结果格式，易于理解

### 6.3 实施优先级

**高优先级**：立即实施简化版批量查询功能
- 参数解析与标准化
- 批量embedding生成
- 固定策略结果聚合
- 结果格式化

### 6.4 预期收益

1. **性能提升**：批量embedding生成减少API调用
2. **准确性提升**：多次匹配加成提高结果质量
3. **效率提升**：减少工具调用次数，节省上下文
4. **易用性提升**：简化参数，降低LLM使用门槛
