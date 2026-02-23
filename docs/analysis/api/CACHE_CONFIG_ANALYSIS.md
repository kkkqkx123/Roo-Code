# API 供应商缓存配置的实际作用分析

## 概述
项目中的缓存配置用于**自动启用和精准计算 LLM 提示词缓存的成本**。这是一个跨越三层的系统：缓存策略层、配置管理层和成本计算层。

---

## 三大核心作用

### 1. **自动注入缓存指令** (缓存策略)
通过在 API 请求中自动注入 `cache_control` 标记，告诉 LLM 提供商哪些内容需要缓存。

#### 不同供应商的实现方式：

**Anthropic** (`src/api/transform/caching/anthropic.ts`)
- 在系统提示词中注入 `cache_control: { type: "ephemeral" }`
- 在**最后两条用户消息**的最后一个文本部分中注入缓存标记
- 用于增量对话中重复内容的缓存

**Gemini** (`src/api/transform/caching/gemini.ts`)  
- 在系统提示词中注入 `cache_control: { type: "ephemeral" }`
- 每隔 N 条用户消息（默认每 10 条）在第 N 条消息注入缓存标记
- 适用于长对话序列的分段缓存

**OpenAI** (`src/api/providers/openai-native.ts`)
- 使用 `promptCacheRetention: "24h"` 设置缓存保留时长
- 支持扩展缓存（与内存缓存对比）
- 仅在配置中明确启用时使用

---

### 2. **用户可配置缓存能力** (模型能力配置)
在设置 UI 中允许用户为自定义模型定义是否支持缓存及其定价：

**配置位置**: `webview-ui/src/components/settings/providers/OpenAICompatible.tsx` (第 355-377 行)

**用户可配置的字段**:
```typescript
{
  supportsPromptCache: boolean        // 该模型是否支持提示词缓存
  cacheWritesPrice?: number           // 缓存写入成本（每百万 token）
  cacheReadsPrice?: number            // 缓存读取成本（每百万 token）
}
```

**UI 行为**:
- 勾选 `supportsPromptCache` 后，UI 会显示 `cacheWritesPrice` 和 `cacheReadsPrice` 输入框
- 允许用户为自定义 OpenAI 兼容模型定义缓存成本
- 这些配置会持久化到 VSCode 密钥存储

---

### 3. **精准成本计算** (财务追踪)
基于实际缓存使用情况计算成本，区别于普通 token 成本。

#### 成本计算公式 (`src/shared/cost.ts`):
```
缓存写入成本 = (cacheWritesPrice / 1,000,000) × cacheCreationInputTokens
缓存读取成本 = (cacheReadsPrice / 1,000,000) × cacheReadInputTokens
总成本 = 缓存写入成本 + 缓存读取成本 + 基础输入成本 + 输出成本
```

#### 两种成本计算模式：

**Anthropic 模式** (`calculateApiCostAnthropic`)
- 输入 token 数 **不包含** 缓存 token
- 总输入 = 基础输入 + 缓存创建 + 缓存读取
- 示例：基础 100 token + 缓存创建 20 token + 缓存读取 10 token = 总 130 token

**OpenAI 模式** (`calculateApiCostOpenAI`)
- 输入 token 数 **已包含** 所有 token（缓存 + 非缓存）
- 需要从总输入中扣除缓存部分来计算基础成本
- 非缓存输入 = 输入总数 - 缓存创建 - 缓存读取

#### 运行时成本追踪:
- **每条消息** 提取 `cacheWriteTokens` 和 `cacheReadTokens` (见 `src/api/providers/`)
- **累积汇总** 在任务级别 (`src/core/task/Task.ts`)
- **实时更新** 用户可见的成本信息

---

## 实际工作流程

### 1. 配置阶段 (User)
用户在设置中为自定义提供商启用缓存：
```
设置 → OpenAI 兼容提供商 → 勾选 "支持提示词缓存" 
→ 输入缓存读取价格和缓存写入价格 → 保存
```

### 2. 请求阶段 (Extension)
当使用支持缓存的模型发送 API 请求时：
1. 检查 `modelInfo.supportsPromptCache` 是否为真
2. 根据供应商类型，在消息中注入 `cache_control` 标记
3. 将配置的定价（`cacheWritesPrice`, `cacheReadsPrice`）发送给成本计算器

### 3. 响应阶段 (Extension)
当收到 API 响应时：
1. 从响应中提取缓存统计：
   - `cache_creation_input_tokens` (Anthropic/OpenAI)
   - `cache_read_input_tokens` (Anthropic)
   - `cachedInputTokens` (OpenAI)
   - `cachedContentTokenCount` (Gemini)
2. 根据供应商类型调用对应的成本计算函数
3. 累积到任务级别的总成本和 token 统计

---

## 配置的实际价值

| 功能 | 价值 |
|------|------|
| **supportsPromptCache** | 启用自动缓存注入；启用后才会在 UI 显示缓存定价字段 |
| **cacheWritesPrice** | 精准计算首次缓存内容的成本（通常比普通输入便宜） |
| **cacheReadsPrice** | 精准计算读取缓存内容的成本（通常比普通输入便宜 75-90%） |

### 为什么重要：
1. **成本控制**: 长对话和代码分析场景中，缓存可以显著降低成本
2. **财务准确性**: 用户能看到真实的、分解的成本构成（基础 vs 缓存）
3. **供应商灵活性**: 不同的自定义 OpenAI 兼容提供商可能有不同的缓存定价

---

## 代码关键路径

### 配置层
- `packages/types/src/model.ts` - ModelInfo 类型定义 (第 76-80, 98-99 行)
- `webview-ui/src/components/settings/providers/OpenAICompatible.tsx` - UI 配置 (第 355-554 行)

### 缓存注入层
- `src/api/transform/caching/anthropic.ts` - Anthropic 缓存策略
- `src/api/transform/caching/gemini.ts` - Gemini 缓存策略
- `src/api/providers/openai-native.ts` - OpenAI 缓存策略 (第 1280-1288 行)

### 成本计算层
- `src/shared/cost.ts` - 核心成本计算逻辑
- `src/api/providers/` - 各供应商的 token 提取
- `src/core/task/Task.ts` - 任务级别的累积和聚合

### 用户可见
- webview-ui 中的成本显示和 token 统计
- 消息历史中的成本明细

---

## 总结
缓存配置是一个**自动化 + 可观测**的系统：
- **自动化**: 开启即用，无需手动操作 API
- **可配置**: 用户可为任何 OpenAI 兼容模型定制缓存定价
- **可观测**: 每条消息都能看到缓存成本的精准计算和累积
