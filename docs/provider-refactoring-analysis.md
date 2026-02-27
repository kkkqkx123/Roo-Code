# 供应商配置重构分析

## 概述

本文档分析了当前供应商配置的实现方式,并提出了一个重构方案,旨在取消硬编码的值,让所有供应商都能像 OpenAI 兼容端点一样完全自定义,仅保留本身协议上的差别。

## 当前架构分析

### 1. 硬编码的供应商配置

当前系统在 `packages/types/src/providers` 目录下为每个供应商维护了硬编码的模型配置:

#### 文件结构
```
packages/types/src/providers/
├── anthropic.ts     # Anthropic 模型配置
├── gemini.ts        # Gemini 模型配置
├── openai.ts        # OpenAI Native 模型配置
└── index.ts         # 导出和默认模型ID获取函数
```

#### 硬编码内容

##### anthropic.ts
- **模型列表**: `anthropicModels` 对象包含所有 Claude 模型的配置
- **默认模型**: `anthropicDefaultModelId = "claude-sonnet-4-5"`
- **模型信息**: 每个模型的 maxTokens、contextWindow、定价信息、支持的特性等
- **常量**: `ANTHROPIC_DEFAULT_MAX_TOKENS = 8192`

##### gemini.ts
- **模型列表**: `geminiModels` 对象包含所有 Gemini 模型的配置
- **默认模型**: `geminiDefaultModelId = "gemini-3.1-pro-preview"`
- **模型信息**: 类似 Anthropic,包含完整的模型元数据

##### openai.ts
- **模型列表**: `openAiNativeModels` 对象包含所有 OpenAI 模型的配置
- **默认模型**: `openAiNativeDefaultModelId = "gpt-5.1-codex-max"`
- **模型信息**: 包含 GPT 系列模型的完整配置
- **默认值**: `openAiModelInfoSaneDefaults` 用于兼容性

### 2. 配置使用位置

#### 在 types 包中的使用
- `packages/types/src/provider-settings.ts:5` - 导入所有模型配置
- `packages/types/src/provider-settings.ts:254-275` - `MODELS_BY_PROVIDER` 使用硬编码的模型列表

#### 在 webview-ui 中的使用
- `webview-ui/src/components/settings/constants.ts:9-13` - 重复导出模型配置
- `webview-ui/src/components/settings/utils/providerModelConfig.ts:3-6` - 导入默认模型ID
- `webview-ui/src/components/settings/utils/providerModelConfig.ts:21-25` - `PROVIDER_DEFAULT_MODEL_IDS` 使用硬编码的默认值

#### 在 API 实现中的使用
- `src/api/providers/anthropic.ts:41-43` - Anthropic 处理器使用 `anthropicBaseUrl` 配置
- `src/api/providers/gemini.ts:42-70` - Gemini 处理器支持自定义配置(已部分支持)
- `src/api/providers/openai-native.ts` - OpenAI Native 处理器使用硬编码的模型配置

### 3. 协议差异分析

#### Anthropic 协议
- **API 端点**: 默认使用官方端点,但支持通过 `anthropicBaseUrl` 自定义
- **认证方式**: 支持 API Key 或 Auth Token
- **消息格式**: Anthropic 原生消息格式
- **特性**: 支持提示缓存、Beta 功能(如 1M 上下文)、思考功能
- **工具调用**: 使用 Anthropic 原生工具格式

#### Gemini 协议
- **API 端点**: 支持两种模式
  - 标准 Gemini API: 使用 `geminiApiKey`
  - Vertex AI: 使用 `vertexProjectId` 和 `vertexRegion`,支持 JSON 凭证或密钥文件
- **认证方式**: API Key 或 Google Auth
- **消息格式**: 需要从 Anthropic 格式转换为 Gemini 格式
- **特性**: 支持思考签名、推理预算、Grounding 等
- **工具调用**: 使用 Gemini 函数声明格式

#### OpenAI Native 协议
- **API 端点**: 默认使用官方端点,支持通过 `openAiNativeBaseUrl` 自定义
- **认证方式**: API Key
- **消息格式**: OpenAI Chat Completions 格式
- **特性**: 支持 reasoning effort、服务层级(flex/priority)、响应存储等
- **工具调用**: 使用 OpenAI 工具格式,支持严格模式

#### OpenAI Compatible 协议
- **API 端点**: 完全自定义,通过 `openAiBaseUrl` 配置
- **认证方式**: API Key
- **消息格式**: OpenAI Chat Completions 格式
- **特性**: 依赖用户提供的 `openAiCustomModelInfo`
- **工具调用**: 使用 OpenAI 工具格式

## 问题分析

### 1. 硬编码的局限性

**问题1: 无法支持自定义端点的模型列表**
- 使用自定义端点时,硬编码的模型列表不适用
- 用户需要手动配置模型信息,但系统仍依赖硬编码的默认值

**问题2: 新模型更新滞后**
- 新模型发布后需要手动更新硬编码配置
- 用户无法立即使用新模型

**问题3: 配置不一致**
- types 包和 webview-ui 包都有模型配置,存在重复
- 修改时需要同步更新多处

**问题4: 扩展性差**
- 添加新供应商需要创建新的硬编码文件
- 无法轻松支持用户自定义的供应商

### 2. 当前架构的优势

**优势1: 类型安全**
- 使用 TypeScript 类型定义确保配置的正确性
- 编译时检查避免运行时错误

**优势2: 默认值完整**
- 为常用模型提供完整的配置信息
- 新用户开箱即用

**优势3: 协议隔离**
- 不同供应商的协议差异在处理器中处理
- 清晰的职责分离

## 重构方案设计

### 1. 核心设计原则

1. **协议优先,配置灵活**
   - 保留协议处理逻辑(消息格式转换、工具格式转换等)
   - 移除硬编码的模型列表和默认值
   - 所有配置由用户提供或从 API 动态获取

2. **向后兼容**
   - 保留现有的硬编码配置作为可选的默认值
   - 新用户可以使用默认配置,高级用户可以完全自定义

3. **统一配置接口**
   - 所有供应商使用相同的配置接口
   - 通过协议类型区分不同的供应商

4. **动态模型发现**
   - 支持从供应商 API 动态获取模型列表
   - 支持用户手动配置模型信息

### 2. 新架构设计

#### 2.1 配置结构

```typescript
// 统一的供应商配置接口
interface ProviderConfig {
  // 协议类型: "anthropic" | "openai" | "gemini"
  protocol: ProviderProtocol

  // API 端点配置
  apiConfig: {
    baseUrl?: string
    apiKey?: string
    authToken?: string  // 用于替代 apiKey
    headers?: Record<string, string>
  }

  // 协议特定配置
  protocolConfig?: AnthropicConfig | OpenAIConfig | GeminiConfig

  // 模型配置
  modelConfig: {
    modelId: string
    modelInfo?: ModelInfo  // 可选,如果不提供则使用默认值或从 API 获取
  }

  // 认证配置
  authConfig?: {
    // Anthropic 特有
    useAuthToken?: boolean
    // Gemini 特有
    vertexProjectId?: string
    vertexRegion?: string
    vertexJsonCredentials?: string
    vertexKeyFile?: string
  }
}

// 协议类型
type ProviderProtocol = "anthropic" | "openai" | "gemini"

// Anthropic 协议配置
interface AnthropicConfig {
  betaFlags?: string[]
  enablePromptCache?: boolean
}

// OpenAI 协议配置
interface OpenAIConfig {
  serviceTier?: "flex" | "priority"
  storeResponses?: boolean
  enableReasoningBinary?: boolean
}

// Gemini 协议配置
interface GeminiConfig {
  isVertex?: boolean
  includeThoughtSignatures?: boolean
}
```

#### 2.2 模型配置管理

```typescript
// 模型信息接口(保持不变)
interface ModelInfo {
  maxTokens: number
  contextWindow: number
  supportsImages: boolean
  supportsPromptCache: boolean
  inputPrice: number
  outputPrice: number
  cacheReadsPrice?: number
  cacheWritesPrice?: number
  supportsTemperature?: boolean
  defaultTemperature?: number
  supportsReasoningEffort?: string[] | boolean
  reasoningEffort?: string
  supportsReasoningBudget?: boolean
  requiredReasoningBudget?: boolean
  maxThinkingTokens?: number
  tiers?: Array<{
    name?: string
    contextWindow: number
    inputPrice: number
    outputPrice: number
    cacheReadsPrice?: number
  }>
  includedTools?: string[]
  excludedTools?: string[]
  promptCacheRetention?: string
  supportsVerbosity?: boolean
  description?: string
}

// 模型配置管理器
class ModelConfigManager {
  // 获取模型信息
  async getModelInfo(
    protocol: ProviderProtocol,
    modelId: string,
    apiConfig: ApiConfig,
    userProvidedInfo?: ModelInfo
  ): Promise<ModelInfo>

  // 从 API 获取模型列表
  async fetchModels(
    protocol: ProviderProtocol,
    apiConfig: ApiConfig
  ): Promise<Record<string, ModelInfo>>

  // 验证模型配置
  validateModelInfo(info: ModelInfo): boolean

  // 获取默认模型信息(用于向后兼容)
  getDefaultModelInfo(
    protocol: ProviderProtocol,
    modelId: string
  ): ModelInfo | undefined
}
```

#### 2.3 供应商处理器重构

```typescript
// 基础供应商处理器
abstract class BaseProviderHandler {
  protected config: ProviderConfig
  protected modelInfo: ModelInfo

  constructor(config: ProviderConfig)

  abstract createMessage(
    systemPrompt: string,
    messages: Anthropic.Messages.MessageParam[],
    metadata?: ApiHandlerCreateMessageMetadata
  ): ApiStream

  abstract getModel(): { id: string; info: ModelInfo }

  // 共享功能
  protected convertToolsForOpenAI(tools: any[]): any[]
  protected convertToolsForAnthropic(tools: any[]): any[]
  protected convertToolsForGemini(tools: any[]): any[]
}

// Anthropic 处理器
class AnthropicProviderHandler extends BaseProviderHandler {
  constructor(config: ProviderConfig) {
    super(config)
    this.initClient()
  }

  private initClient() {
    const apiKeyFieldName =
      this.config.apiConfig.baseUrl &&
      this.config.authConfig?.useAuthToken
        ? "authToken"
        : "apiKey"

    this.client = new Anthropic({
      baseURL: this.config.apiConfig.baseUrl || undefined,
      [apiKeyFieldName]: this.config.apiConfig.apiKey || this.config.apiConfig.authToken,
    })
  }

  // 实现协议特定的消息创建逻辑
}

// OpenAI 处理器
class OpenAIProviderHandler extends BaseProviderHandler {
  constructor(config: ProviderConfig) {
    super(config)
    this.initClient()
  }

  private initClient() {
    this.client = new OpenAI({
      baseURL: this.config.apiConfig.baseUrl || undefined,
      apiKey: this.config.apiConfig.apiKey,
      defaultHeaders: this.config.apiConfig.headers,
    })
  }

  // 实现协议特定的消息创建逻辑
}

// Gemini 处理器
class GeminiProviderHandler extends BaseProviderHandler {
  constructor(config: ProviderConfig) {
    super(config)
    this.initClient()
  }

  private initClient() {
    const { isVertex, vertexProjectId, vertexRegion } =
      this.config.protocolConfig as GeminiConfig || {}

    if (this.config.authConfig?.vertexJsonCredentials) {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: vertexProjectId,
        location: vertexRegion,
        googleAuthOptions: {
          credentials: JSON.parse(this.config.authConfig.vertexJsonCredentials),
        },
      })
    } else if (this.config.authConfig?.vertexKeyFile) {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: vertexProjectId,
        location: vertexRegion,
        googleAuthOptions: { keyFile: this.config.authConfig.vertexKeyFile },
      })
    } else if (isVertex) {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: vertexProjectId,
        location: vertexRegion,
      })
    } else {
      this.client = new GoogleGenAI({
        apiKey: this.config.apiConfig.apiKey,
      })
    }
  }

  // 实现协议特定的消息创建逻辑
}
```

#### 2.4 处理器工厂

```typescript
class ProviderHandlerFactory {
  static async create(config: ProviderConfig): Promise<ApiHandler> {
    // 获取或验证模型信息
    const modelConfigManager = new ModelConfigManager()
    const modelInfo = await modelConfigManager.getModelInfo(
      config.protocol,
      config.modelConfig.modelId,
      config.apiConfig,
      config.modelConfig.modelInfo
    )

    // 根据协议创建处理器
    switch (config.protocol) {
      case "anthropic":
        return new AnthropicProviderHandler({
          ...config,
          modelConfig: {
            ...config.modelConfig,
            modelInfo,
          },
        })
      case "openai":
        return new OpenAIProviderHandler({
          ...config,
          modelConfig: {
            ...config.modelConfig,
            modelInfo,
          },
        })
      case "gemini":
        return new GeminiProviderHandler({
          ...config,
          modelConfig: {
            ...config.modelConfig,
            modelInfo,
          },
        })
      default:
        throw new Error(`Unsupported protocol: ${config.protocol}`)
    }
  }
}
```

### 3. 迁移策略

#### 阶段1: 准备阶段
1. 创建新的配置接口和类型定义
2. 实现 `ModelConfigManager`
3. 创建新的处理器类

#### 阶段2: 兼容层
1. 保留现有的硬编码配置文件
2. 创建配置转换函数,将旧配置转换为新配置
3. 更新 `buildApiHandler` 函数,支持新旧两种配置格式

#### 阶段3: 逐步迁移
1. 更新 API 处理器使用新的配置格式
2. 更新 webview-ui 使用新的配置格式
3. 保留配置转换函数用于向后兼容

#### 阶段4: 清理
1. 移除硬编码的模型配置文件
2. 移除配置转换函数
3. 更新文档

### 4. 配置转换示例

```typescript
// 旧配置(硬编码)
const oldConfig: ProviderSettings = {
  apiProvider: "anthropic",
  apiKey: "sk-ant-xxx",
  apiModelId: "claude-sonnet-4-5",
  anthropicBaseUrl: "https://api.anthropic.com",
}

// 新配置(灵活)
const newConfig: ProviderConfig = {
  protocol: "anthropic",
  apiConfig: {
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-xxx",
  },
  modelConfig: {
    modelId: "claude-sonnet-4-5",
  },
}

// 转换函数
function convertOldConfigToNew(oldConfig: ProviderSettings): ProviderConfig {
  const protocol = getProtocolFromProvider(oldConfig.apiProvider)

  return {
    protocol,
    apiConfig: {
      baseUrl: oldConfig.anthropicBaseUrl ||
               oldConfig.openAiNativeBaseUrl ||
               oldConfig.openAiBaseUrl,
      apiKey: oldConfig.apiKey ||
              oldConfig.openAiNativeApiKey ||
              oldConfig.openAiApiKey,
      authToken: oldConfig.apiKey, // 如果 useAuthToken 为 true
      headers: oldConfig.openAiHeaders,
    },
    modelConfig: {
      modelId: getModelIdFromConfig(oldConfig),
    },
    authConfig: {
      useAuthToken: oldConfig.anthropicUseAuthToken,
      vertexProjectId: oldConfig.vertexProjectId,
      vertexRegion: oldConfig.vertexRegion,
      vertexJsonCredentials: oldConfig.vertexJsonCredentials,
      vertexKeyFile: oldConfig.vertexKeyFile,
    },
  }
}
```

## 实施计划

### 步骤1: 创建新的类型定义
- 在 `packages/types/src` 创建新的配置接口
- 定义协议类型和配置结构

### 步骤2: 实现 ModelConfigManager
- 实现模型信息获取逻辑
- 实现从 API 获取模型列表的功能
- 保留硬编码配置作为默认值

### 步骤3: 重构供应商处理器
- 创建新的处理器类,使用统一的配置接口
- 保留协议特定的处理逻辑
- 实现配置转换功能

### 步骤4: 更新 API 构建函数
- 更新 `buildApiHandler` 使用新的配置格式
- 添加配置转换逻辑用于向后兼容

### 步骤5: 更新 webview-ui
- 更新配置界面支持新的配置格式
- 添加模型信息配置界面
- 添加动态模型发现功能

### 步骤6: 测试和验证
- 测试所有供应商的功能
- 验证向后兼容性
- 测试自定义端点配置

### 步骤7: 清理硬编码
- 移除 `packages/types/src/providers` 目录
- 更新所有导入和使用
- 更新文档

## 优势总结

### 1. 灵活性提升
- 用户可以完全自定义 API 端点
- 支持任何兼容的供应商
- 无需等待硬编码更新

### 2. 可扩展性增强
- 添加新供应商只需实现协议处理器
- 不需要维护硬编码的模型列表
- 支持用户自定义供应商

### 3. 配置统一
- 所有供应商使用相同的配置接口
- 减少配置重复
- 更容易维护

### 4. 向后兼容
- 保留现有配置的支持
- 平滑迁移路径
- 不影响现有用户

## 潜在风险和缓解措施

### 风险1: 配置复杂性增加
**缓解措施**:
- 提供配置向导
- 提供预设配置模板
- 保留默认配置选项

### 风险2: 向后兼容性问题
**缓解措施**:
- 实现完整的配置转换层
- 充分测试迁移过程
- 提供详细的迁移文档

### 风险3: API 调用增加
**缓解措施**:
- 缓存模型列表
- 提供离线模式
- 优化 API 调用频率

## 结论

通过这个重构方案,我们可以:
1. 取消硬编码的供应商配置
2. 让所有供应商都能完全自定义
3. 保留协议差异的处理逻辑
4. 提供更好的扩展性和灵活性
5. 保持向后兼容性

这个方案将使系统更加灵活和可扩展,同时保持现有功能的完整性。
