# 上下文压缩优化设计文档

## 1. 概述

本文档描述了Roo Code项目上下文压缩机制的优化设计方案。优化目标包括：

1. **统一token计算**：使用tiktoken作为唯一的token计算来源，避免不同模型分词器差异
2. **文件折叠独立化**：将文件折叠功能从智能压缩中独立出来，作为可复用模块
3. **智能随机丢弃**：基于实际超出比例计算丢弃数量，使用启发式批大小
4. **函数块合并**：减少行跨度样板token消耗
5. **智能回退方案**：优化滑动窗口策略，优先删除模型注意力最低的中间段落

## 2. 整体架构

### 2.1 架构分层

优化后的上下文压缩系统遵循项目的现有分层架构：

```
┌─────────────────────────────────────────────────────────────┐
│                     应用层 (Application)                      │
│                  Task.ts (任务执行入口)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     核心层 (Core)                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │ Context          │  │ Condense         │  │ File       │ │
│  │ Management       │  │ (智能压缩)       │  │ Folding    │ │
│  │ (上下文管理)     │  │                  │  │ (文件折叠) │ │
│  └──────────────────┘  └──────────────────┘  └────────────┘ │
│  ┌──────────────────┐                                        │
│  │ Smart            │                                        │
│  │ Truncation       │                                        │
│  │ (智能截断)       │                                        │
│  └──────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     服务层 (Services)                         │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │ Tree-sitter      │  │ API Handler      │                  │
│  │ (代码解析)       │  │ (API调用)        │                  │
│  └──────────────────┘  └──────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     工具层 (Utils)                            │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │ Tiktoken         │  │ Count Tokens     │                  │
│  │ (Token计算)      │  │ (Token计数)      │                  │
│  └──────────────────┘  └──────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心流程

上下文压缩的执行流程如下：

1. **触发检查**：Context Management检查是否需要压缩
2. **智能压缩**：优先尝试智能压缩（LLM摘要 + 文件折叠）
3. **回退方案**：如果智能压缩失败，执行智能截断
4. **Token计算**：所有token计算统一使用tiktoken

## 3. 模块设计

### 3.1 文件折叠模块 (File Folding)

#### 3.1.1 模块职责

文件折叠模块负责将代码文件的结构信息压缩为极简形式，仅保留类名、接口名、函数名等关键标识符，大幅减少token消耗。

#### 3.1.2 目录结构

```
src/core/file-folding/
├── index.ts                    # 主入口，导出公共接口
├── name-extractor.ts           # 名称提取逻辑
├── function-merger.ts          # 函数块合并逻辑
├── random-dropper.ts           # 随机丢弃逻辑
└── __tests__/
    └── file-folding.spec.ts    # 单元测试
```

#### 3.1.3 文件职责

**index.ts**
- 模块主入口，定义公共接口
- 协调子模块完成文件折叠流程
- 提供foldFiles主函数
- 依赖：name-extractor, function-merger, random-dropper, tiktoken, tree-sitter
- 被依赖：context-management, smart-truncation

**name-extractor.ts**
- 从tree-sitter解析结果中提取名称
- 实现极简模式：仅提取类名、接口名、函数名
- 过滤掉行号、签名等详细信息
- 依赖：tree-sitter
- 被依赖：index.ts

**function-merger.ts**
- 合并函数块以减少行跨度样板
- 类、接口单独显示
- 函数名合并显示，行跨度超过100时中断
- 依赖：无
- 被依赖：index.ts

**random-dropper.ts**
- 基于超出比例计算丢弃数量
- 使用启发式批大小
- 执行随机丢弃操作
- 依赖：tiktoken
- 被依赖：index.ts

#### 3.1.4 调用链

```
foldFiles (index.ts)
  ├─> extractMinimalDefinitions (name-extractor.ts)
  │   └─> parseSourceCodeDefinitionsForFile (tree-sitter)
  │       └─> extractNamesOnly (name-extractor.ts)
  ├─> mergeFunctionBlocks (function-merger.ts)
  ├─> tiktoken (utils/tiktoken.ts) [计算总token]
  └─> applyRandomDrop (random-dropper.ts)
      ├─> tiktoken (utils/tiktoken.ts) [计算超出比例]
      └─> shuffleArray (random-dropper.ts)
```

#### 3.1.5 业务逻辑

**步骤1：提取极简定义**
- 遍历所有文件路径
- 调用tree-sitter解析代码结构
- 从解析结果中提取名称（类名、接口名、函数名）
- 过滤掉行号、签名等详细信息
- 每个文件包装在独立的system-reminder块中

**步骤2：合并函数块**
- 遍历每个文件的section
- 识别类、接口定义，单独显示
- 识别函数定义，加入缓冲区
- 当行跨度超过100时，输出缓冲区并清空
- 输出剩余的函数缓冲区

**步骤3：计算token数**
- 使用tiktoken计算折叠后内容的token数
- 与阈值进行比较

**步骤4：随机丢弃**
- 计算超出比例：(当前token数 / 阈值) - 1
- 如果超出比例 <= 0，无需丢弃
- 计算启发式批大小：excessTokens / avgTokensPerSection
- 随机打乱sections
- 删除前batchSize个sections
- 重新计算token数

### 3.2 智能截断模块 (Smart Truncation)

#### 3.2.1 模块职责

智能截断模块作为智能压缩失败时的回退方案，通过过滤工具调用、折叠文件、删除消息等方式降低token消耗。

#### 3.2.2 目录结构

```
src/core/smart-truncation/
├── index.ts                    # 主入口，导出公共接口
├── middle-range-calculator.ts  # 中间段范围计算
├── tool-filter.ts              # 工具调用过滤
├── file-folder.ts              # 文件折叠集成
├── message-deleter.ts          # 消息删除
└── __tests__/
    └── smart-truncation.spec.ts # 单元测试
```

#### 3.2.3 文件职责

**index.ts**
- 模块主入口，定义公共接口
- 协调子模块完成智能截断流程
- 提供smartTruncate主函数
- 依赖：middle-range-calculator, tool-filter, file-folder, message-deleter, tiktoken, file-folding
- 被依赖：context-management

**middle-range-calculator.ts**
- 基于tiktoken计算中间段范围（1/6到5/6位置）
- 计算每个消息的token数
- 计算累积token分布
- 确定中间段的起始和结束索引
- 依赖：tiktoken
- 被依赖：index.ts, tool-filter, message-deleter

**tool-filter.ts**
- 过滤中间段的工具调用
- 保留文件查看的tool_result
- 删除其他tool_use和tool_result
- 依赖：无
- 被依赖：index.ts

**file-folder.ts**
- 集成文件折叠模块
- 识别所有文件查看的tool_result
- 提取文件路径
- 调用file-folding模块执行折叠
- 替换原始tool_result内容
- 依赖：file-folding
- 被依赖：index.ts

**message-deleter.ts**
- 删除中间消息以降低token消耗
- 使用启发式批大小
- 从中间开始删除（不随机，避免消息不匹配）
- 依赖：tiktoken
- 被依赖：index.ts

#### 3.2.4 调用链

```
smartTruncate (index.ts)
  ├─> calculateMiddleRange (middle-range-calculator.ts)
  │   ├─> calculateMessageTokens (index.ts)
  │   │   └─> tiktoken (utils/tiktoken.ts)
  │   └─> 计算累积token分布
  ├─> filterToolCallsInMiddle (tool-filter.ts)
  │   ├─> filterToolCallContent (tool-filter.ts)
  │   │   └─> isFileReadToolResult (tool-filter.ts)
  │   └─> calculateMessageTokens (index.ts)
  ├─> foldAllFileReads (file-folder.ts)
  │   ├─> isFileReadToolResult (tool-filter.ts)
  │   ├─> extractFilePaths (file-folder.ts)
  │   ├─> foldFiles (file-folding/index.ts)
  │   └─> replaceFileReadResults (file-folder.ts)
  ├─> calculateTotalTokens (index.ts)
  │   └─> calculateMessageTokens (index.ts)
  └─> deleteMiddleMessages (message-deleter.ts)
      ├─> calculateMessageTokens (index.ts)
      └─> 计算启发式批大小
```

#### 3.2.5 业务逻辑

**步骤1：计算中间段范围**
- 遍历所有消息，使用tiktoken计算每个消息的token数
- 计算总token数
- 计算累积token分布
- 找到1/6位置对应的消息索引（起始索引）
- 找到5/6位置对应的消息索引（结束索引）

**步骤2：过滤中间段的工具调用**
- 遍历所有消息
- 判断消息是否在中间段范围内
- 对于中间段的消息：
  - 保留text类型的content block
  - 删除所有tool_use类型的block
  - 对于tool_result类型的block：
    - 判断是否是文件查看结果（包含大量文本内容）
    - 保留文件查看的tool_result
    - 删除其他tool_result
- 对于非中间段的消息，保持不变
- 计算删除的token数

**步骤3：折叠所有文件查看结果**
- 遍历所有消息
- 识别所有文件查看的tool_result
- 从tool_result内容中提取文件路径
- 调用file-folding模块对文件进行折叠
- 替换原始tool_result内容为折叠后的内容
- 统计折叠的文件数量

**步骤4：检查是否仍超出阈值**
- 使用tiktoken计算处理后消息的总token数
- 与回退阈值（默认50000）比较
- 如果未超出，返回结果

**步骤5：删除中间消息**
- 计算需要删除的token数（当前token数 - 阈值）
- 计算中间段消息的平均token数
- 计算启发式批大小：excessTokens / avgTokensPerMessage
- 从中间段中心开始，向两侧扩展确定删除范围
- 删除指定范围内的消息
- 统计删除的消息数量

### 3.3 上下文管理模块 (Context Management)

#### 3.3.1 模块职责

上下文管理模块是整个压缩系统的协调者，负责决定何时触发压缩、选择压缩策略、协调各模块完成压缩任务。

#### 3.3.2 目录结构

```
src/core/context-management/
├── index.ts                    # 主入口，导出公共接口
├── threshold-calculator.ts     # 阈值计算
├── token-calculator.ts         # Token计算（基于tiktoken）
└── __tests__/
    └── context-management.spec.ts # 单元测试
```

#### 3.3.3 文件职责

**index.ts**
- 模块主入口，定义公共接口
- 提供manageContext主函数
- 提供willManageContext预检查函数
- 提供truncateConversation滑动窗口函数（保留向后兼容）
- 协调condense、file-folding、smart-truncation模块
- 依赖：condense, file-folding, smart-truncation, tiktoken, threshold-calculator, token-calculator
- 被依赖：Task.ts

**threshold-calculator.ts**
- 计算有效阈值（考虑全局设置和配置文件设置）
- 计算允许的token数（考虑缓冲区和预留token）
- 判断是否需要触发压缩
- 依赖：无
- 被依赖：index.ts

**token-calculator.ts**
- 使用tiktoken计算上下文token数
- 计算系统提示词token数
- 计算消息token数
- 计算工具定义token数
- 依赖：tiktoken
- 被依赖：index.ts

#### 3.3.4 调用链

```
manageContext (index.ts)
  ├─> calculateContextTokensWithTiktoken (token-calculator.ts)
  │   ├─> tiktoken (utils/tiktoken.ts) [系统提示词]
  │   ├─> tiktoken (utils/tiktoken.ts) [消息]
  │   └─> tiktoken (utils/tiktoken.ts) [工具定义]
  ├─> calculateEffectiveThreshold (threshold-calculator.ts)
  ├─> calculateAllowedTokens (threshold-calculator.ts)
  ├─> 判断是否需要压缩
  │   ├─> contextPercent >= effectiveThreshold
  │   └─> prevContextTokens > allowedTokens
  ├─> 如果需要压缩且启用智能压缩：
  │   └─> summarizeConversation (condense/index.ts)
  │       ├─> getMessagesSinceLastSummary (condense/index.ts)
  │       ├─> transformMessagesForCondensing (condense/index.ts)
  │       ├─> apiHandler.createMessage (api/)
  │       ├─> extractCommandBlocks (condense/index.ts)
  │       ├─> foldFiles (file-folding/index.ts)
  │       │   └─> [文件折叠调用链]
  │       └─> tiktoken (utils/tiktoken.ts) [计算新上下文token]
  └─> 如果智能压缩失败或未启用：
      └─> smartTruncate (smart-truncation/index.ts)
          └─> [智能截断调用链]
```

#### 3.3.5 业务逻辑

**步骤1：计算当前上下文token数**
- 使用tiktoken计算系统提示词的token数
- 遍历所有消息，使用tiktoken计算每个消息的token数
- 如果有工具定义，使用tiktoken计算工具定义的token数
- 汇总得到总token数

**步骤2：计算阈值和允许token数**
- 计算有效阈值：
  - 优先使用配置文件的自定义阈值
  - 如果配置文件阈值为-1，使用全局阈值
  - 如果配置文件阈值无效，使用全局阈值
- 计算允许的token数：
  - contextWindow * (1 - 0.1) - reservedTokens
  - 保留10%缓冲区
  - 为响应预留token（默认4096）

**步骤3：判断是否需要压缩**
- 计算上下文百分比：(100 * prevContextTokens) / contextWindow
- 判断条件：
  - contextPercent >= effectiveThreshold
  - 或 prevContextTokens > allowedTokens
- 任一条件满足则触发压缩

**步骤4：执行智能压缩**
- 如果启用智能压缩且需要压缩：
  - 调用condense模块生成对话摘要
  - 在摘要中包含：
    - 对话摘要文本
    - 活跃工作流（<command>块）
    - 文件折叠内容（调用file-folding模块）
    - 环境详情（仅自动触发时）
  - 标记所有消息为已压缩
  - 添加摘要消息
  - 计算压缩后的token数
  - 如果成功，返回结果
  - 如果失败，记录错误信息

**步骤5：执行智能截断（回退方案）**
- 如果智能压缩失败或未启用：
  - 调用smart-truncation模块
  - 传入配置参数（阈值、中间段范围、文件折叠配置）
  - 执行工具调用过滤
  - 执行文件折叠
  - 执行消息删除
  - 计算截断后的token数
  - 返回结果

**步骤6：返回结果**
- 返回处理后的消息列表
- 返回摘要文本（如果有）
- 返回token消耗信息
- 返回错误信息（如果有）

### 3.4 智能压缩模块 (Condense)

#### 3.4.1 模块职责

智能压缩模块负责使用LLM生成对话摘要，实现Fresh Start模型，保留关键上下文信息。

#### 3.4.2 目录结构

```
src/core/condense/
├── index.ts                    # 主入口，导出公共接口
├── foldedFileContext.ts        # 文件上下文折叠（将被file-folding替代）
├── tool-converter.ts           # 工具块转换
├── command-extractor.ts        # 命令块提取
└── __tests__/
    ├── index.spec.ts
    ├── foldedFileContext.spec.ts
    └── ...
```

#### 3.4.3 文件职责

**index.ts**
- 模块主入口，定义公共接口
- 提供summarizeConversation主函数
- 提供getEffectiveApiHistory函数
- 提供cleanupAfterTruncation函数
- 协调子模块完成智能压缩流程
- 依赖：apiHandler, tool-converter, command-extractor, file-folding, tiktoken
- 被依赖：context-management

**tool-converter.ts**
- 将tool_use和tool_result块转换为文本表示
- 处理孤立工具调用
- 依赖：无
- 被依赖：index.ts

**command-extractor.ts**
- 从消息中提取<command>块
- 保留活跃工作流
- 依赖：无
- 被依赖：index.ts

**foldedFileContext.ts**
- 文件上下文折叠（将被file-folding模块替代）
- 保留向后兼容
- 依赖：tree-sitter
- 被依赖：index.ts（将被移除）

#### 3.4.4 调用链

```
summarizeConversation (index.ts)
  ├─> getMessagesSinceLastSummary (index.ts)
  ├─> injectSyntheticToolResults (index.ts)
  ├─> transformMessagesForCondensing (tool-converter.ts)
  │   ├─> convertToolBlocksToText (tool-converter.ts)
  │   │   ├─> toolUseToText (tool-converter.ts)
  │   │   └─> toolResultToText (tool-converter.ts)
  │   └─> maybeRemoveImageBlocks (api/transform/image-cleaning.ts)
  ├─> apiHandler.createMessage (api/)
  ├─> extractCommandBlocks (command-extractor.ts)
  ├─> foldFiles (file-folding/index.ts) [新增]
  │   └─> [文件折叠调用链]
  ├─> 构建摘要内容
  │   ├─> 对话摘要文本
  │   ├─> 活跃工作流
  │   ├─> 文件折叠内容
  │   └─> 环境详情（仅自动触发）
  ├─> 标记所有消息
  └─> tiktoken (utils/tiktoken.ts) [计算新上下文token]
```

#### 3.4.5 业务逻辑

**步骤1：获取需要压缩的消息**
- 查找最后一个摘要消息
- 返回从摘要之后的所有消息
- 如果没有摘要，返回所有消息

**步骤2：验证消息数量**
- 如果消息数量 <= 1，返回错误（消息不足）
- 如果最近有摘要且消息数量 <= 2，返回错误（刚压缩过）

**步骤3：转换工具块**
- 将所有tool_use块转换为文本表示
- 将所有tool_result块转换为文本表示
- 移除图片块（如果需要）
- 注入合成工具结果处理孤立工具调用

**步骤4：调用LLM生成摘要**
- 构建请求消息（使用自定义或默认压缩提示词）
- 调用apiHandler.createMessage
- 流式接收响应
- 提取摘要文本
- 记录token消耗和成本

**步骤5：提取活跃工作流**
- 从第一条消息中提取<command>块
- 这些块代表活跃的工作流，必须保留

**步骤6：折叠文件上下文**
- 调用file-folding模块
- 传入文件路径列表
- 获取折叠后的文件上下文
- 每个文件包装在独立的system-reminder块中

**步骤7：构建摘要内容**
- 对话摘要文本
- 活跃工作流（在system-reminder块中）
- 文件折叠内容（在system-reminder块中）
- 环境详情（仅自动触发时）

**步骤8：标记消息**
- 为所有消息添加condenseParent标记
- 创建摘要消息（role: user）
- 添加摘要消息到消息列表

**步骤9：计算新上下文token数**
- 使用tiktoken计算系统提示词token数
- 使用tiktoken计算摘要消息token数
- 使用tiktoken计算工具定义token数
- 汇总得到新上下文token数

**步骤10：返回结果**
- 返回处理后的消息列表
- 返回摘要文本
- 返回token消耗信息
- 返回错误信息（如果有）

## 4. 文件间关系

### 4.1 依赖关系图

```
Task.ts
  └─> context-management/index.ts
      ├─> condense/index.ts
      │   ├─> apiHandler
      │   ├─> tool-converter.ts
      │   ├─> command-extractor.ts
      │   ├─> file-folding/index.ts [新增]
      │   │   ├─> name-extractor.ts
      │   │   ├─> function-merger.ts
      │   │   ├─> random-dropper.ts
      │   │   └─> tree-sitter
      │   └─> tiktoken
      ├─> smart-truncation/index.ts [新增]
      │   ├─> middle-range-calculator.ts
      │   ├─> tool-filter.ts
      │   ├─> file-folder.ts
      │   │   └─> file-folding/index.ts
      │   ├─> message-deleter.ts
      │   └─> tiktoken
      ├─> threshold-calculator.ts
      ├─> token-calculator.ts
      └─> tiktoken

tree-sitter (services/)
  └─> parseSourceCodeDefinitionsForFile
      └─> file-folding/name-extractor.ts

tiktoken (utils/)
  ├─> file-folding/random-dropper.ts
  ├─> smart-truncation/middle-range-calculator.ts
  ├─> smart-truncation/message-deleter.ts
  └─> context-management/token-calculator.ts
```

### 4.2 分层关系

**应用层**
- Task.ts：任务执行入口，调用context-management

**核心层**
- context-management：上下文管理协调者
- condense：智能压缩实现
- file-folding：文件折叠模块（新增）
- smart-truncation：智能截断模块（新增）

**服务层**
- tree-sitter：代码解析服务
- apiHandler：API调用服务

**工具层**
- tiktoken：Token计算工具
- countTokens：Token计数工具（封装tiktoken）

### 4.3 持有关系

**持有关系**
- context-management持有condense、file-folding、smart-truncation的引用
- condense持有apiHandler的引用
- file-folding持有tree-sitter的引用
- smart-truncation持有file-folding的引用

**被持有关系**
- condense被context-management持有
- file-folding被condense和smart-truncation持有
- smart-truncation被context-management持有
- tree-sitter被file-folding持有
- tiktoken被所有需要token计算的模块持有

## 5. 调用链详细说明

### 5.1 完整调用链

```
Task.ts
  └─> manageContext (context-management/index.ts)
      ├─> calculateContextTokensWithTiktoken (token-calculator.ts)
      │   └─> tiktoken (utils/tiktoken.ts)
      ├─> calculateEffectiveThreshold (threshold-calculator.ts)
      ├─> calculateAllowedTokens (threshold-calculator.ts)
      ├─> 判断是否需要压缩
      │
      ├─> [分支1：智能压缩]
      │   └─> summarizeConversation (condense/index.ts)
      │       ├─> getMessagesSinceLastSummary (condense/index.ts)
      │       ├─> injectSyntheticToolResults (condense/index.ts)
      │       ├─> transformMessagesForCondensing (tool-converter.ts)
      │       │   ├─> convertToolBlocksToText (tool-converter.ts)
      │       │   │   ├─> toolUseToText (tool-converter.ts)
      │       │   │   └─> toolResultToText (tool-converter.ts)
      │       │   └─> maybeRemoveImageBlocks (api/transform/image-cleaning.ts)
      │       ├─> apiHandler.createMessage (api/)
      │       ├─> extractCommandBlocks (command-extractor.ts)
      │       ├─> foldFiles (file-folding/index.ts)
      │       │   ├─> extractMinimalDefinitions (name-extractor.ts)
      │       │   │   ├─> parseSourceCodeDefinitionsForFile (tree-sitter)
      │       │   │   └─> extractNamesOnly (name-extractor.ts)
      │       │   ├─> mergeFunctionBlocks (function-merger.ts)
      │       │   ├─> tiktoken (utils/tiktoken.ts)
      │       │   └─> applyRandomDrop (random-dropper.ts)
      │       │       ├─> tiktoken (utils/tiktoken.ts)
      │       │       └─> shuffleArray (random-dropper.ts)
      │       ├─> 构建摘要内容
      │       ├─> 标记所有消息
      │       └─> tiktoken (utils/tiktoken.ts)
      │
      └─> [分支2：智能截断]
          └─> smartTruncate (smart-truncation/index.ts)
              ├─> calculateMiddleRange (middle-range-calculator.ts)
              │   ├─> calculateMessageTokens (smart-truncation/index.ts)
              │   │   └─> tiktoken (utils/tiktoken.ts)
              │   └─> 计算累积token分布
              ├─> filterToolCallsInMiddle (tool-filter.ts)
              │   ├─> filterToolCallContent (tool-filter.ts)
              │   │   └─> isFileReadToolResult (tool-filter.ts)
              │   └─> calculateMessageTokens (smart-truncation/index.ts)
              ├─> foldAllFileReads (file-folder.ts)
              │   ├─> isFileReadToolResult (tool-filter.ts)
              │   ├─> extractFilePaths (file-folder.ts)
              │   ├─> foldFiles (file-folding/index.ts)
              │   │   └─> [文件折叠调用链]
              │   └─> replaceFileReadResults (file-folder.ts)
              ├─> calculateTotalTokens (smart-truncation/index.ts)
              │   └─> calculateMessageTokens (smart-truncation/index.ts)
              └─> deleteMiddleMessages (message-deleter.ts)
                  ├─> calculateMessageTokens (smart-truncation/index.ts)
                  └─> 计算启发式批大小
```

### 5.2 关键调用路径

**路径1：文件折叠调用链**
```
foldFiles (file-folding/index.ts)
  ├─> extractMinimalDefinitions (name-extractor.ts)
  │   └─> parseSourceCodeDefinitionsForFile (tree-sitter)
  │       └─> extractNamesOnly (name-extractor.ts)
  ├─> mergeFunctionBlocks (function-merger.ts)
  ├─> tiktoken (utils/tiktoken.ts)
  └─> applyRandomDrop (random-dropper.ts)
      ├─> tiktoken (utils/tiktoken.ts)
      └─> shuffleArray (random-dropper.ts)
```

**路径2：智能截断调用链**
```
smartTruncate (smart-truncation/index.ts)
  ├─> calculateMiddleRange (middle-range-calculator.ts)
  │   └─> tiktoken (utils/tiktoken.ts)
  ├─> filterToolCallsInMiddle (tool-filter.ts)
  ├─> foldAllFileReads (file-folder.ts)
  │   └─> foldFiles (file-folding/index.ts)
  ├─> calculateTotalTokens (smart-truncation/index.ts)
  │   └─> tiktoken (utils/tiktoken.ts)
  └─> deleteMiddleMessages (message-deleter.ts)
      └─> tiktoken (utils/tiktoken.ts)
```

**路径3：Token计算调用链**
```
calculateContextTokensWithTiktoken (token-calculator.ts)
  ├─> tiktoken (utils/tiktoken.ts) [系统提示词]
  ├─> tiktoken (utils/tiktoken.ts) [消息]
  └─> tiktoken (utils/tiktoken.ts) [工具定义]
```

## 6. 配置参数

### 6.1 文件折叠配置

```typescript
interface FileFoldingOptions {
  maxTokens: number              // token阈值（默认10000）
  cwd: string                    // 当前工作目录
  rooIgnoreController?: any      // 文件访问控制器
  mergeFunctions?: boolean       // 是否合并函数块（默认true）
  maxLineSpan?: number           // 最大行跨度（默认100）
}
```

### 6.2 智能截断配置

```typescript
interface SmartTruncationOptions {
  maxTokens: number              // 回退阈值（默认50000）
  middlePercentileStart: number  // 中间段起始百分位（默认16.67，即1/6）
  middlePercentileEnd: number    // 中间段结束百分位（默认83.33，即5/6）
  fileFoldingOptions?: FileFoldingOptions  // 文件折叠配置
}
```

### 6.3 上下文管理配置

```typescript
interface ContextManagementOptions {
  messages: ApiMessage[]
  totalTokens: number
  contextWindow: number
  maxTokens?: number | null
  apiHandler: ApiHandler
  autoCondenseContext: boolean
  autoCondenseContextPercent: number
  systemPrompt: string
  taskId: string
  customCondensingPrompt?: string
  profileThresholds: Record<string, number>
  currentProfileId: string
  metadata?: ApiHandlerCreateMessageMetadata
  environmentDetails?: string
  filesReadByRoo?: string[]
  cwd?: string
  rooIgnoreController?: RooIgnoreController
  fileFoldingOptions?: FileFoldingOptions      // 新增
  smartTruncationOptions?: SmartTruncationOptions  // 新增
}
```

## 7. 实施计划

### 7.1 第一阶段：文件折叠模块

**目标**：实现独立的文件折叠模块

**任务**：
1. 创建src/core/file-folding目录结构
2. 实现name-extractor.ts（名称提取）
3. 实现function-merger.ts（函数块合并）
4. 实现random-dropper.ts（随机丢弃）
5. 实现index.ts（主入口）
6. 编写单元测试
7. 集成测试

**验收标准**：
- 文件折叠仅保留类名、接口名、函数名
- 函数块正确合并
- 随机丢弃基于超出比例计算
- 所有token计算使用tiktoken

### 7.2 第二阶段：智能截断模块

**目标**：实现智能截断回退方案

**任务**：
1. 创建src/core/smart-truncation目录结构
2. 实现middle-range-calculator.ts（中间段计算）
3. 实现tool-filter.ts（工具调用过滤）
4. 实现file-folder.ts（文件折叠集成）
5. 实现message-deleter.ts（消息删除）
6. 实现index.ts（主入口）
7. 编写单元测试
8. 集成测试

**验收标准**：
- 中间段范围基于tiktoken计算（1/6到5/6）
- 工具调用正确过滤（保留文件查看）
- 文件查看结果正确折叠
- 消息删除使用启发式批大小

### 7.3 第三阶段：上下文管理集成

**目标**：将新模块集成到上下文管理

**任务**：
1. 修改context-management/index.ts
2. 实现threshold-calculator.ts（阈值计算）
3. 实现token-calculator.ts（Token计算）
4. 集成file-folding模块
5. 集成smart-truncation模块
6. 更新单元测试
7. 集成测试

**验收标准**：
- 所有token计算使用tiktoken
- 智能压缩优先使用file-folding
- 智能压缩失败时使用smart-truncation
- 向后兼容性保持

### 7.4 第四阶段：测试和调优

**目标**：全面测试和参数调优

**任务**：
1. 端到端测试
2. 性能测试
3. 参数调优
4. 文档更新
5. 代码审查

**验收标准**：
- 所有测试通过
- 性能满足要求
- 文档完整准确

## 8. 风险和缓解措施

### 8.1 技术风险

**风险1：tiktoken计算不准确**
- 影响：压缩后token数仍超出阈值
- 缓解：添加安全缓冲区，保守估计token数

**风险2：文件折叠丢失关键信息**
- 影响：模型无法理解代码结构
- 缓解：保留类名、接口名、函数名，确保结构信息完整

**风险3：智能截断删除重要消息**
- 影响：对话上下文不完整
- 缓解：优先删除中间段，保留开头和结尾

### 8.2 兼容性风险

**风险1：向后兼容性破坏**
- 影响：现有功能失效
- 缓解：保留原有接口，渐进式迁移

**风险2：不同模型分词器差异**
- 影响：token计算不准确
- 缓解：统一使用tiktoken，添加fudge factor

### 8.3 性能风险

**风险1：tiktoken计算开销大**
- 影响：压缩速度慢
- 缓解：使用worker pool，缓存计算结果

**风险2：文件折叠耗时**
- 影响：压缩延迟增加
- 缓解：限制文件数量，异步处理

## 9. 监控和指标

### 9.1 关键指标

- 压缩前后token数
- 压缩率（压缩后/压缩前）
- 压缩耗时
- 智能压缩成功率
- 回退方案触发率
- 文件折叠token节省率
- 消息删除数量

### 9.2 监控点

- manageContext入口
- summarizeConversation入口
- foldFiles入口
- smartTruncate入口
- tiktoken调用

## 10. 总结

本设计方案通过以下优化改进了上下文压缩机制：

1. **统一token计算**：使用tiktoken作为唯一token计算来源，避免模型切换带来的差异
2. **文件折叠独立化**：将文件折叠功能独立为可复用模块，提高代码复用性
3. **智能随机丢弃**：基于实际超出比例计算，使用启发式批大小，提高准确性
4. **函数块合并**：减少行跨度样板token消耗，提高压缩效率
5. **智能回退方案**：优化滑动窗口策略，优先删除模型注意力最低的中间段落

通过模块化设计和清晰的职责划分，系统具有良好的可维护性和可扩展性。所有模块遵循项目的分层架构，确保代码质量和一致性。