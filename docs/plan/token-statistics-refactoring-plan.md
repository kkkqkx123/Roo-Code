# Token统计重构完整方案

**版本**: 1.0  
**日期**: 2026年2月27日  
**状态**: 设计阶段  

---

## 1. 架构设计目标

### 1.1 核心目标

- **数据一致性**: 确保所有场景下token统计准确，包含系统提示词、用户消息、助手回复
- **可观测性**: 提供详细的token统计日志，便于问题排查
- **可扩展性**: 支持未来新增provider和统计维度（如多模态token）
- **容错性**: 当API统计不可靠时，tiktoken回退机制能无缝接管

### 1.2 设计原则

1. **单一数据源**: 统一token统计的数据源，避免API统计和tiktoken统计使用不同数据源
2. **职责分离**: 统计、计算、聚合三个职责分别由不同模块承担
3. **状态显式化**: 所有统计状态必须可追踪、可验证
4. **向后兼容**: 重构不破坏现有消息存储格式

---

## 2. 现有架构分析

### 2.1 现有模块分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        表现层 (UI)                               │
│         webview-ui/ContextWindowProgress.tsx                     │
│                   显示上下文token数                               │
├─────────────────────────────────────────────────────────────────┤
│                      聚合层 (Core)                               │
│    packages/core/src/message-utils/consolidateTokenUsage.ts      │
│              聚合多条api_req_started消息的token                   │
├─────────────────────────────────────────────────────────────────┤
│                      业务层 (Task)                               │
│              src/core/task/Task.ts                               │
│    管理流式响应、调用updateApiReqMsg更新token统计                 │
├─────────────────────────────────────────────────────────────────┤
│                    流式处理层 (Streaming)                        │
│    src/core/task/streaming/StreamingTokenManager.ts              │
│         管理tiktoken回退、统计流式输出token                       │
├─────────────────────────────────────────────────────────────────┤
│                     API适配层 (API)                              │
│    src/api/providers/anthropic.ts, openai-native.ts              │
│         提供API流、返回usage数据、countTokens方法                 │
├─────────────────────────────────────────────────────────────────┤
│                    工具层 (Utils)                                │
│    src/utils/tiktoken.ts - Tiktoken封装                          │
│    src/shared/cost.ts - 成本计算                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 现有问题根因

1. **数据源不一致**: API统计使用API返回的usage，tiktoken使用`apiConversationHistory`，两者统计范围不同
2. **系统提示词丢失**: 系统提示词作为独立参数传递，不包含在历史中，tiktoken无法统计
3. **用户消息条件添加**: 用户消息添加到历史有条件限制，某些场景下缺失
4. **状态管理分散**: token统计状态分散在Task、StreamingTokenManager、API provider中

---

## 3. 新架构设计

### 3.1 新模块分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        表现层 (UI)                               │
│         ContextWindowProgress.tsx                                │
│              订阅Token统计事件，显示实时数据                      │
├─────────────────────────────────────────────────────────────────┤
│                      聚合层 (Core)                               │
│    packages/core/src/token-stats/TokenStatsAggregator.ts         │
│         聚合多轮对话的token统计，计算contextTokens                │
├─────────────────────────────────────────────────────────────────┤
│                   统计服务层 (Services)                          │
│    src/services/token-accounting/TokenAccountingService.ts       │
│    统一管理token统计的生命周期：收集、计算、验证、回退            │
│                                                                  │
│    ┌─────────────────────────────────────────────────────────┐  │
│    │              TokenAccountingSession                     │  │
│    │  (有状态，每个API请求创建一个会话，请求结束后销毁)        │  │
│    │  - 接收API usage数据                                    │  │
│    │  - 管理tiktoken回退                                     │  │
│    │  - 提供最终统计结果                                     │  │
│    └─────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      业务层 (Task)                               │
│              Task.ts                                             │
│    创建TokenAccountingSession，传递上下文信息                     │
├─────────────────────────────────────────────────────────────────┤
│                    流式处理层 (Streaming)                        │
│    StreamingProcessor.ts                                         │
│    通过TokenAccountingProxy与统计服务通信                         │
├─────────────────────────────────────────────────────────────────┤
│                     API适配层 (API)                              │
│    BaseProvider.ts - 统一countTokens实现                         │
│    各Provider实现getContextForTokenCounting()方法                 │
├─────────────────────────────────────────────────────────────────┤
│                    工具层 (Utils)                                │
│    TiktokenTokenizer.ts - 封装tiktoken                           │
│    ProviderTokenizer.ts - Provider原生token计数                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

#### 3.2.1 TokenAccountingService（有状态服务，单例）

**职责**: 作为token统计的中心化管理器，负责协调各个统计源。

**生命周期**:
1. **初始化**: Task创建时初始化，持有当前Task的上下文信息
2. **会话创建**: 每个API请求开始前创建新的TokenAccountingSession
3. **数据收集**: 接收来自API和tiktoken的统计数据
4. **会话结束**: API请求结束后关闭会话，返回最终统计

**依赖关系**:
- 被Task持有（依赖注入）
- 持有TokenizerFactory（创建tokenizer）
- 被StreamingProcessor通过TokenAccountingProxy访问

**实现方式**: 有状态全局单例（每个Task一个实例）

#### 3.2.2 TokenAccountingSession（有状态，多实例）

**职责**: 管理单个API请求的完整token统计生命周期。

**状态机**:
```
┌─────────┐    创建    ┌──────────┐   收到usage   ┌──────────────┐
│  IDLE   │ ─────────→ │ COLLECT  │ ────────────→ │ API_VALID    │
└─────────┘            │ API_DATA │               └──────────────┘
                       └──────────┘                     │
                            │                           │
                            │ 未收到usage               │ 验证通过
                            │ 触发回退                  │
                            ▼                           ▼
                       ┌──────────┐              ┌──────────────┐
                       │ FALLBACK │────────────→ │   FINALIZED  │
                       │ TIKTOKEN │   回退完成    │              │
                       └──────────┘              └──────────────┘
```

**职责细分**:
- 接收并存储API返回的usage数据
- 计算tiktoken统计（系统提示词+用户消息+助手输出）
- 验证API数据的完整性
- 在API数据不可靠时触发回退
- 生成最终的TokenStats结果

**实现方式**: 有状态多实例（每个API请求一个实例）

#### 3.2.3 TokenContextBuilder（无状态工具类）

**职责**: 构建完整的token统计上下文，解决数据源不一致问题。

**构建内容**:
1. 系统提示词（从Task获取）
2. 当前用户消息（从Task获取，确保无论是否添加到历史都被包含）
3. API对话历史（从apiConversationHistory获取）
4. 助手输出（从StreamingProcessor获取）

**输出**: 标准化的TokenContext对象，包含所有需要统计的内容块

**实现方式**: 无状态，纯函数导出

#### 3.2.4 Tokenizer（策略模式）

**接口设计**:
```
interface Tokenizer {
    countTokens(context: TokenContext): Promise<TokenCount>
    countTokensSync(context: TokenContext): TokenCount  // 用于简单场景
}
```

**实现类**:
1. **TiktokenTokenizer**: 使用tiktoken库进行统计
2. **AnthropicTokenizer**: 使用Anthropic的token计数API
3. **OpenAITokenizer**: 使用OpenAI的token计数API
4. **CachingTokenizer**: 装饰器，缓存统计结果

**工厂**: TokenizerFactory根据provider类型创建对应的tokenizer

#### 3.2.5 TokenStatsAggregator（无状态，纯函数）

**职责**: 聚合多轮对话的token统计。

**输入**: 多条消息的token统计（ClineMessage数组）
**输出**: 聚合后的TokenUsage（包含totalTokensIn, totalTokensOut, contextTokens等）

**算法**:
1. 遍历所有`api_req_started`消息
2. 累加每条消息的tokensIn和tokensOut
3. 如果存在`condense_context`消息，使用其权威值作为基准
4. 验证数据一致性（如果累加值与权威值差异过大，发出警告）

**实现方式**: 纯函数导出，无状态

---

## 4. 调用链设计

### 4.1 正常流程（API返回完整usage）

```
┌──────────┐     createSession      ┌─────────────────────┐
│  Task    │ ─────────────────────→ │ TokenAccountingServ │
└──────────┘                        └─────────────────────┘
     │                                        │
     │ 传递上下文信息                          │ createSession
     │ (系统提示词、用户消息、历史)              │
     ▼                                        ▼
┌──────────┐                          ┌─────────────────┐
│Streaming │                          │TokenAccounting  │
│Processor │                          │Session          │
└──────────┘                          └─────────────────┘
     │                                        │
     │ processStream                         │ 初始化状态
     │ (传递完整上下文)                       │ (IDLE → COLLECT_API_DATA)
     ▼                                        │
┌──────────┐                                 │
│  API     │                                 │
│ Provider │                                 │
└──────────┘                                 │
     │                                        │
     │ yield usage chunk                      │ recordApiUsage
     │ (inputTokens, outputTokens)            │
     ▼───────────────────────────────────────►│
                                              │
┌──────────┐                                 │ validate
│Streaming │ ◄────────────────────────────────│ (验证通过)
│Processor │ 返回StreamingResult              │
└──────────┘                                 │
     │                                        │ finalize
     │ getTokens                              │ (生成最终统计)
     ▼───────────────────────────────────────►│
                                              │
┌──────────┐                                 │
│  Task    │ ◄────────────────────────────────│ 返回TokenStats
└──────────┘                                 │
     │                                        │
     │ updateApiReqMsg                        │
     │ (使用最终统计)                          │
     ▼                                        │
saveClineMessages                            │
                                              ▼
                                        ┌─────────────┐
                                        │   FINALIZED │
                                        └─────────────┘
```

### 4.2 Tiktoken回退流程（API未返回usage）

```
┌─────────────────┐
│TokenAccounting  │
│Session          │
└─────────────────┘
     │
     │ 未收到usage
     │ 超时或流式结束
     ▼
┌─────────────────┐
│  检查是否需要回退  │
│ (hasApiUsageData │
│  && tokens > 0)  │
└─────────────────┘
     │
     │ 需要回退
     ▼
┌─────────────────┐
│   FALLBACK      │
│   TIKTOKEN      │
└─────────────────┘
     │
     │ buildFullContext
     ▼
┌─────────────────┐
│TokenContext     │
│Builder          │
└─────────────────┘
     │
     │ 构建完整上下文
     │ (系统提示词+用户消息+历史+输出)
     ▼
┌─────────────────┐
│  Tiktoken       │
│  Tokenizer      │
└─────────────────┘
     │
     │ countTokens
     ▼
┌─────────────────┐
│   更新统计结果   │
│ (input/output   │
│  使用tiktoken)  │
└─────────────────┘
     │
     ▼
┌─────────────────┐
│    FINALIZED    │
└─────────────────┘
```

### 4.3 上下文构建流程

```
TokenContextBuilder.buildContext()
     │
     ├──► 获取系统提示词
     │         │
     │         ├──► 从Task.state.systemPrompt
     │         └──► 或使用默认值
     │
     ├──► 获取当前用户消息
     │         │
     │         ├──► 使用finalUserContent（确保包含当前消息）
     │         └──► 不依赖apiConversationHistory
     │
     ├──► 获取API对话历史
     │         │
     │         └──► 从apiConversationHistory
     │
     ├──► 获取助手输出（用于tiktoken回退）
     │         │
     │         └──► 从StreamingStateManager
     │
     └──► 返回TokenContext
              │
              ├── systemPrompt: ContentBlock[]
              ├── currentUserMessage: ContentBlock[]
              ├── conversationHistory: MessageParam[]
              └── assistantOutput: ContentBlock[]
```

---

## 5. 文件设计与实现

### 5.1 新增文件

#### 5.1.1 src/services/token-accounting/TokenAccountingService.ts

**文件职责**: 中心化管理token统计，协调各个统计源。

**分层定位**: 服务层，被Task层依赖。

**实现方式**: 有状态全局单例（每个Task一个实例），通过构造函数注入依赖。

**持有关系**:
- 持有TokenizerFactory实例
- 持有当前Task的配置信息（provider, model等）
- 持有当前活跃的TokenAccountingSession（如果有）

**被持有关系**:
- 被Task持有（作为成员变量）

**业务逻辑**:
1. 创建TokenAccountingSession时，注入完整的上下文信息
2. 提供会话管理方法（createSession, getCurrentSession, closeSession）
3. 提供统计查询方法（获取历史统计、当前会话统计）

#### 5.1.2 src/services/token-accounting/TokenAccountingSession.ts

**文件职责**: 管理单个API请求的token统计生命周期。

**分层定位**: 服务层，被TokenAccountingService管理。

**实现方式**: 有状态多实例，每个API请求创建一个实例，请求结束后销毁。

**状态管理**:
```
状态: IDLE → COLLECT_API_DATA → (API_VALID | FALLBACK_TIKTOKEN) → FINALIZED
```

**持有关系**:
- 持有TokenContextBuilder实例
- 持有Tokenizer实例
- 持有StreamingTokenCounter实例（用于流式输出统计）

**被持有关系**:
- 被TokenAccountingService持有

**业务逻辑**:
1. 接收API usage数据，存储并验证
2. 接收流式输出token统计（来自StreamingTokenCounter）
3. 在需要时触发tiktoken回退
4. 生成最终的TokenStats

#### 5.1.3 src/services/token-accounting/TokenContextBuilder.ts

**文件职责**: 构建完整的token统计上下文。

**分层定位**: 服务层工具类，被TokenAccountingSession使用。

**实现方式**: 无状态，纯函数导出。

**输入参数**:
- 系统提示词字符串
- 当前用户消息内容块数组
- API对话历史
- 助手输出内容（可选，用于tiktoken回退）

**输出**: TokenContext对象

**业务逻辑**:
1. 将系统提示词转换为内容块格式
2. 确保当前用户消息被包含（无论是否已添加到历史）
3. 合并所有内容形成完整上下文

#### 5.1.4 src/utils/tokenization/Tokenizer.ts（接口）

**文件职责**: 定义tokenizer接口。

**分层定位**: 工具层接口。

**实现方式**: TypeScript接口定义。

**方法定义**:
- countTokens(context: TokenContext): Promise<TokenCount>
- supportsProvider(provider: string): boolean

#### 5.1.5 src/utils/tokenization/TiktokenTokenizer.ts

**文件职责**: Tiktoken实现。

**分层定位**: 工具层，实现Tokenizer接口。

**实现方式**: 有状态单例（tiktoken encoder是重量级对象，需要复用）。

**持有关系**:
- 持有Tiktoken encoder实例

**业务逻辑**:
1. 使用TokenizerManager获取encoder
2. 对TokenContext中的每个内容块进行token计数
3. 图片内容使用估算公式
4. 返回总token数

#### 5.1.6 src/utils/tokenization/TokenizerFactory.ts

**文件职责**: 根据provider创建对应的tokenizer。

**分层定位**: 工具层工厂。

**实现方式**: 无状态，纯函数导出。

**业务逻辑**:
1. 根据provider类型返回对应的tokenizer
2. Anthropic/Gemini/OpenAI使用各自的API计数
3. 其他provider使用TiktokenTokenizer

#### 5.1.7 packages/core/src/token-stats/TokenStatsAggregator.ts

**文件职责**: 聚合多轮对话的token统计。

**分层定位**: 核心共享层，被UI层和Task层使用。

**实现方式**: 无状态，纯函数导出。

**输入**: ClineMessage数组

**输出**: TokenUsage对象

**业务逻辑**:
1. 遍历所有消息
2. 累加`api_req_started`的token数据
3. 处理`condense_context`的权威值
4. 验证数据一致性
5. 返回聚合结果

#### 5.1.8 packages/types/src/token-stats.ts（新增类型定义）

**文件职责**: 定义token统计相关的类型。

**分层定位**: 类型定义层。

**定义内容**:
- TokenContext接口
- TokenCount接口
- TokenStats接口
- TokenAccountingState枚举
- TokenUsage接口（如不存在）

### 5.2 修改文件

#### 5.2.1 src/core/task/Task.ts

**修改内容**:
1. 添加TokenAccountingService成员变量
2. 在构造函数中初始化TokenAccountingService
3. 在`recursivelyMakeClineRequests`中：
   - 调用前创建TokenAccountingSession
   - 传递完整的上下文信息（系统提示词、用户消息、历史）
   - 调用后获取最终统计并更新消息
4. 移除原有的`inputTokens`/`outputTokens`累加逻辑，改为从TokenAccountingSession获取

**依赖变更**:
- 新增依赖：TokenAccountingService

#### 5.2.2 src/core/task/streaming/StreamingProcessor.ts

**修改内容**:
1. 移除直接操作token统计的逻辑
2. 通过TokenAccountingProxy与TokenAccountingService通信
3. 流式结束时通知TokenAccountingSession进行最终统计

**依赖变更**:
- 新增依赖：TokenAccountingProxy
- 移除依赖：直接创建StreamingTokenManager（改为通过proxy访问）

#### 5.2.3 src/core/task/streaming/StreamingTokenManager.ts

**修改内容**:
1. 简化职责，只负责流式输出的tiktoken统计
2. 提供接口供TokenAccountingSession调用
3. 移除直接更新消息的逻辑

**依赖变更**:
- 新增依赖：被TokenAccountingSession调用

#### 5.2.4 src/api/providers/base-provider.ts

**修改内容**:
1. 优化`countTokens`方法，确保统计范围完整
2. 添加`getContextForTokenCounting`虚方法，子类可覆盖

**依赖变更**:
- 使用新的Tokenizer接口

#### 5.2.5 src/api/providers/anthropic.ts, openai-native.ts等

**修改内容**:
1. 实现`getContextForTokenCounting`方法
2. 确保系统提示词被包含在统计上下文中

#### 5.2.6 packages/core/src/message-utils/consolidateTokenUsage.ts

**修改内容**:
1. 使用新的TokenStatsAggregator逻辑
2. 添加数据一致性验证
3. 添加警告日志（当数据不一致时）

---

## 6. 数据流设计

### 6.1 Token统计数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Token统计数据流                                │
└─────────────────────────────────────────────────────────────────────────┘

[数据源]
     │
     ├──► 系统提示词 ────────────────────────────────────────────────────┐
     │                                                                    │
     ├──► 用户消息 ────────────────────────┐                              │
     │                                      │                              │
     ├──► API对话历史 ────────────┐         │                              │
     │                            │         │                              │
     └──► 助手输出 ────────┐      │         │                              │
                         │      │         │                              │
                         ▼      │         │                              │
              ┌─────────────────┴─────────┴──────────────────────────┐   │
              │               TokenContextBuilder                     │   │
              │  (合并所有数据源，构建完整的TokenContext)              │◄──┘
              └──────────────────────────────────────────────────────┘
                                    │
                                    │ TokenContext
                                    ▼
              ┌──────────────────────────────────────────────────────┐
              │              TokenAccountingSession                   │
              │  ┌────────────────────────────────────────────────┐  │
              │  │  API Usage Data (来自API响应)                   │  │
              │  │  - input_tokens                                  │  │
              │  │  - output_tokens                                 │  │
              │  │  - cache_tokens                                  │  │
              │  └────────────────────────────────────────────────┘  │
              │                         │                            │
              │                         │ 验证通过？                   │
              │                         ▼                            │
              │  ┌────────────────────────────────────────────────┐  │
              │  │  Tiktoken统计 (来自TokenContext)                │  │
              │  │  - 系统提示词token数                             │  │
              │  │  - 用户消息token数                               │  │
              │  │  - 对话历史token数                               │  │
              │  │  - 助手输出token数                               │  │
              │  └────────────────────────────────────────────────┘  │
              └──────────────────────────────────────────────────────┘
                                    │
                                    │ 合并/回退决策
                                    ▼
              ┌──────────────────────────────────────────────────────┐
              │                 TokenStats (最终结果)                 │
              │  - totalInputTokens                                  │
              │  - totalOutputTokens                                 │
              │  - cacheWriteTokens                                  │
              │  - cacheReadTokens                                   │
              │  - totalCost                                         │
              │  - breakdown (详细分解)                              │
              └──────────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────────────────┐
              │              持久化到ClineMessage                     │
              │  api_req_started.text = JSON.stringify(TokenStats)   │
              └──────────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────────────────┐
              │               TokenStatsAggregator                    │
              │         (聚合多轮对话的统计)                          │
              └──────────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────────────────┐
              │                  UI显示                               │
              │         ContextWindowProgress.tsx                    │
              └──────────────────────────────────────────────────────┘
```

### 6.2 上下文构建详细流程

```
TokenContextBuilder.build()
     │
     ├──► 系统提示词处理
     │         │
     │         ├──► 输入: systemPrompt字符串
     │         ├──► 转换为: [{type: "text", text: systemPrompt}]
     │         └──► 输出: systemPromptBlocks
     │
     ├──► 用户消息处理
     │         │
     │         ├──► 输入: finalUserContent (ContentBlockParam[])
     │         ├──► 确保包含环境详情
     │         └──► 输出: userMessageBlocks
     │
     ├──► 对话历史处理
     │         │
     │         ├──► 输入: apiConversationHistory
     │         ├──► 过滤掉非标准内容块
     │         └──► 输出: conversationHistory
     │
     └──► 助手输出处理（仅tiktoken回退时需要）
               │
               ├──► 输入: assistantMessageContent
               ├──► 序列化tool_use/tool_result块
               └──► 输出: assistantOutputBlocks

输出: TokenContext {
    systemPrompt: systemPromptBlocks,
    currentUserMessage: userMessageBlocks,
    conversationHistory: conversationHistory,
    assistantOutput: assistantOutputBlocks  // 可选
}
```

---

## 7. 集成设计

### 7.1 与现有模块的集成

#### 7.1.1 与Task的集成

```
Task.ts
     │
     ├──► 成员变量
     │         │
     │         └──► tokenAccountingService: TokenAccountingService
     │
     ├──► 构造函数
     │         │
     │         └──► 初始化tokenAccountingService
     │
     ├──► recursivelyMakeClineRequests()
     │         │
     │         ├──► 构建systemPrompt
     │         ├──► 构建finalUserContent
     │         ├──► 创建session:
     │         │         tokenAccountingService.createSession({
     │         │             systemPrompt,
     │         │             userMessage: finalUserContent,
     │         │             history: apiConversationHistory
     │         │         })
     │         ├──► 调用StreamingProcessor.processStream()
     │         ├──► 获取结果:
     │         │         const stats = session.getFinalStats()
     │         ├──► 更新消息:
     │         │         updateApiReqMsg(stats)
     │         └──► 关闭session:
     │                 tokenAccountingService.closeSession()
```

#### 7.1.2 与StreamingProcessor的集成

```
StreamingProcessor.ts
     │
     ├──► 构造函数
     │         │
     │         └──► 接收TokenAccountingProxy（而非直接创建TokenManager）
     │
     ├──► processLoop()
     │         │
     │         ├──► 收到usage chunk
     │         │         │
     │         │         └──► proxy.recordApiUsage(chunk)
     │         │
     │         ├──► 收到text chunk
     │         │         │
     │         │         └──► proxy.addTextTokens(chunk.text)
     │         │
     │         └──► 收到reasoning chunk
     │                 │
     │                 └──► proxy.addReasoningTokens(chunk.text)
     │
     ├──► finalize()
     │         │
     │         └──► proxy.finalize()
```

#### 7.1.3 与API Provider的集成

```
BaseProvider.ts
     │
     ├──► countTokens(context: TokenContext)
     │         │
     │         ├──► 调用TokenizerFactory.getTokenizer(provider)
     │         ├──► 调用tokenizer.countTokens(context)
     │         └──► 返回结果
     │
     └──► getContextForTokenCounting(systemPrompt, messages)
              │
              ├──► 构建完整的TokenContext
              ├──► 确保系统提示词被包含
              └──► 返回TokenContext

AnthropicHandler.ts / OpenAiNativeHandler.ts
     │
     └──► 覆盖getContextForTokenCounting()
              │
              ├──► 调用父类方法
              ├──► 添加provider特定的内容（如缓存标记）
              └──► 返回完整的上下文
```

### 7.2 与UI层的集成

```
TokenStatsAggregator.ts
     │
     └──► 聚合统计
              │
              ├──► 输入: ClineMessage[]
              ├──► 解析每条api_req_started
              ├──► 累加token数
              ├──► 处理condense_context
              └──► 返回TokenUsage

ChatView.tsx / ContextWindowProgress.tsx
     │
     ├──► 调用getApiMetrics()
     │         │
     │         └──► 内部调用TokenStatsAggregator
     │
     └──► 显示token统计
```

---

## 8. 错误处理与容错设计

### 8.1 错误场景处理

| 错误场景 | 处理策略 | 日志级别 |
|---------|---------|---------|
| API未返回usage | 触发tiktoken回退 | warn |
| API返回不完整usage | 使用tiktoken补全缺失部分 | warn |
| tiktoken计算失败 | 使用字符估算作为fallback | error |
| 上下文构建失败 | 使用部分上下文继续计算 | error |
| 数据一致性验证失败 | 发出警告，使用累加值 | warn |
| TokenizerFactory找不到对应tokenizer | 默认使用TiktokenTokenizer | warn |

### 8.2 数据一致性验证

```
TokenStatsAggregator
     │
     ├──► 累加所有api_req_started的token
     │
     ├──► 检查是否有condense_context
     │         │
     │         ├──► 有: 比较累加值与权威值
     │         │         │
     │         │         ├──► 差异 < 10%: 接受权威值
     │         │         ├──► 差异 10-50%: 发出警告，使用权威值
     │         │         └──► 差异 > 50%: 发出错误，使用累加值
     │         │
     │         └──► 无: 使用累加值
     │
     └──► 返回最终统计
```

---

## 9. 性能考虑

### 9.1 优化策略

1. **Tiktoken Encoder复用**
   - TiktokenTokenizer使用单例模式
   - encoder只创建一次，避免重复加载WASM

2. **Token计数缓存**
   - 对不变化的内容（如系统提示词、历史消息）缓存token数
   - 只计算新增内容的token

3. **异步处理**
   - token统计不阻塞流式响应
   - 使用后台线程（worker）进行tiktoken计算

4. **懒加载**
   - TokenAccountingSession只在需要时创建
   - TokenContext只在tiktoken回退时构建

### 9.2 性能指标

| 指标 | 目标值 | 说明 |
|-----|-------|-----|
| Token统计延迟 | < 10ms | 从收到usage到更新UI的延迟 |
| Tiktoken回退延迟 | < 100ms | 触发回退到返回结果的延迟 |
| 内存占用 | < 10MB | TokenAccountingService的内存占用 |
| CPU使用率 | < 5% | 流式过程中的CPU占用 |

---

## 10. 测试策略

### 10.1 单元测试

| 测试模块 | 测试内容 | 覆盖率目标 |
|---------|---------|-----------|
| TokenContextBuilder | 上下文构建正确性、边界条件 | 100% |
| TokenAccountingSession | 状态机转换、数据验证 | 100% |
| TokenStatsAggregator | 聚合逻辑、数据一致性验证 | 100% |
| TiktokenTokenizer | token计数准确性 | 100% |
| TokenizerFactory | 工厂方法正确性 | 100% |

### 10.2 集成测试

| 测试场景 | 测试内容 |
|---------|---------|
| 正常流式响应 | API返回完整usage，验证统计准确性 |
| Tiktoken回退 | API不返回usage，验证回退机制 |
| 部分usage | API返回部分usage，验证补全逻辑 |
| 多轮对话 | 5-10轮对话，验证token累加 |
| 上下文压缩 | condense_context后，验证权威值使用 |
| 不同provider | Anthropic/OpenAI/Gemini，验证兼容性 |

---

## 11. 迁移计划

### 11.1 阶段划分

#### 阶段1: 基础设施（2周）
- 创建新的类型定义（packages/types）
- 实现TokenContextBuilder
- 实现Tokenizer接口和TiktokenTokenizer
- 实现TokenizerFactory
- 编写单元测试

#### 阶段2: 核心服务（2周）
- 实现TokenAccountingSession
- 实现TokenAccountingService
- 实现TokenStatsAggregator
- 与现有StreamingProcessor集成
- 编写集成测试

#### 阶段3: 业务层集成（1周）
- 修改Task.ts使用新服务
- 修改API provider实现getContextForTokenCounting
- 修改consolidateTokenUsage使用新聚合器
- 端到端测试

#### 阶段4: 优化与清理（1周）
- 移除旧的token统计逻辑
- 性能优化
- 代码清理
- 文档更新

### 11.2 回滚策略

1. **特性开关**: 使用配置项控制是否使用新统计逻辑
2. **A/B测试**: 部分用户使用新逻辑，对比统计准确性
3. **快速回滚**: 如果发现问题，立即切换回旧逻辑

---

## 12. 文件目录结构

```
project/
├── src/
│   ├── services/
│   │   └── token-accounting/
│   │       ├── index.ts                      # 统一导出
│   │       ├── TokenAccountingService.ts     # 中心化管理服务
│   │       ├── TokenAccountingSession.ts     # 单次请求统计会话
│   │       ├── TokenContextBuilder.ts        # 上下文构建器
│   │       └── __tests__/
│   │           ├── TokenAccountingService.spec.ts
│   │           ├── TokenAccountingSession.spec.ts
│   │           └── TokenContextBuilder.spec.ts
│   │
│   ├── utils/
│   │   └── tokenization/
│   │       ├── index.ts                      # 统一导出
│   │       ├── Tokenizer.ts                  # 接口定义
│   │       ├── TiktokenTokenizer.ts          # Tiktoken实现
│   │       ├── ProviderTokenizer.ts          # Provider API实现
│   │       ├── TokenizerFactory.ts           # 工厂类
│   │       └── __tests__/
│   │           ├── TiktokenTokenizer.spec.ts
│   │           └── TokenizerFactory.spec.ts
│   │
│   ├── core/
│   │   └── task/
│   │       ├── streaming/
│   │       │   ├── StreamingProcessor.ts     # 修改：集成新服务
│   │       │   ├── StreamingTokenManager.ts  # 修改：简化职责
│   │       │   └── TokenAccountingProxy.ts   # 新增：代理访问
│   │       └── Task.ts                       # 修改：使用新服务
│   │
│   └── api/
│       └── providers/
│           ├── base-provider.ts              # 修改：优化countTokens
│           ├── anthropic.ts                  # 修改：实现新方法
│           └── openai-native.ts              # 修改：实现新方法
│
├── packages/
│   ├── types/
│   │   └── src/
│   │       ├── token-stats.ts                # 新增：类型定义
│   │       └── index.ts                      # 修改：导出新类型
│   │
│   └── core/
│       └── src/
│           ├── token-stats/
│           │   ├── index.ts                  # 统一导出
│           │   ├── TokenStatsAggregator.ts   # 聚合逻辑
│           │   └── __tests__/
│           │       └── TokenStatsAggregator.spec.ts
│           │
│           └── message-utils/
│               └── consolidateTokenUsage.ts  # 修改：使用新聚合器
│
└── docs/
    └── plan/
        └── token-statistics-refactoring-plan.md  # 本文档
```

---

## 13. 接口契约

### 13.1 TokenAccountingService接口

```
interface TokenAccountingService {
    // 创建新的统计会话
    createSession(context: TokenAccountingContext): TokenAccountingSession
    
    // 获取当前活跃的会话
    getCurrentSession(): TokenAccountingSession | undefined
    
    // 关闭当前会话
    closeSession(): void
    
    // 获取历史统计（聚合所有已完成会话）
    getHistoricalStats(): TokenUsage
    
    // 重置服务（用于测试）
    reset(): void
}
```

### 13.2 TokenAccountingSession接口

```
interface TokenAccountingSession {
    // 会话ID
    readonly id: string
    
    // 当前状态
    readonly state: TokenAccountingState
    
    // 接收API usage数据
    recordApiUsage(usage: ApiUsage): void
    
    // 添加流式输出token（来自tiktoken实时统计）
    addStreamingOutputTokens(text: string): void
    
    // 添加流式推理token
    addStreamingReasoningTokens(text: string): void
    
    // 最终化会话，返回统计结果
    finalize(): TokenStats
    
    // 获取当前统计（中间状态）
    getCurrentStats(): TokenStats
}
```

### 13.3 TokenContext接口

```
interface TokenContext {
    // 系统提示词内容块
    systemPrompt: ContentBlockParam[]
    
    // 当前用户消息内容块
    currentUserMessage: ContentBlockParam[]
    
    // API对话历史
    conversationHistory: MessageParam[]
    
    // 助手输出内容块（可选，用于tiktoken回退）
    assistantOutput?: ContentBlockParam[]
}
```

---

## 14. 总结

本方案通过引入**TokenAccountingService**中心化服务，解决了现有token统计架构的数据源不一致、状态管理分散等核心问题。主要改进包括：

1. **统一数据源**: TokenContextBuilder确保系统提示词、用户消息都被包含在统计中
2. **状态机管理**: TokenAccountingSession使用显式状态机管理统计生命周期
3. **策略化Tokenizer**: 通过Tokenizer接口支持不同provider的token计数方式
4. **数据验证**: TokenStatsAggregator验证数据一致性，发出警告
5. **向后兼容**: 不破坏现有消息格式，平滑迁移

预计开发周期6周，分4个阶段实施。新架构将显著提高token统计的准确性和可维护性。
