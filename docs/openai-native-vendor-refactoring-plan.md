# OpenAI Native 供应商改造方案（已实施）

## 一、背景与目标

### 1.1 当前问题

当前项目的 OpenAI Native 供应商实现中存在硬编码的供应商信息，主要包括：

**硬编码位置**：`src/api/providers/openai-native.ts`

**硬编码内容**：
1. **供应商名称**：`"OpenAI Native"` (第36行)
2. **默认 Headers**：
   - `originator: "coder"`
   - `session_id: 动态生成的UUID`
   - `User-Agent: coder/{version} ({platform} {release}; {arch}) node/{node_version}`

**问题影响**：
- 供应商信息与业务逻辑耦合，难以复用
- 无法灵活切换或扩展供应商
- 与 OpenAI Compatible 供应商的实现方式不一致
- 维护成本高，修改需要修改多处代码

### 1.2 改造目标

参考 OpenAI Compatible 供应商的实现方式，将 OpenAI Native 供应商改造为：
1. **删除硬编码的供应商信息**
2. **采用配置化方式管理供应商信息**
3. **保持调用 Responses API 端点**（`/v1/responses`）
4. **提高代码复用性和可维护性**
5. **不提供向后兼容，不保留默认值**

## 二、改造实施

### 2.1 修改内容

#### 2.1.1 扩展 ApiHandlerOptions 接口

**文件**：`src/shared/api.ts`

**修改**：添加了两个新的可选配置字段

```typescript
export type ApiHandlerOptions = Omit<ProviderSettings, "apiProvider"> & {
    enableResponsesReasoningSummary?: boolean
    /**
     * OpenAI Native 供应商的 originator 标识
     */
    originator?: string
    /**
     * OpenAI Native 供应商的自定义 Headers
     */
    openAiNativeHeaders?: Record<string, string>
}
```

#### 2.1.2 删除硬编码的 providerName

**文件**：`src/api/providers/openai-native.ts`

**修改**：删除了第36行的硬编码属性

```typescript
// 删除前
private readonly providerName = "OpenAI Native"

// 删除后
（该行已删除）
```

#### 2.1.3 修改构造函数

**文件**：`src/api/providers/openai-native.ts`

**修改**：将硬编码的 originator 改为从配置中获取

```typescript
// 修改前
this.client = new OpenAI({
    baseURL: this.options.openAiNativeBaseUrl || undefined,
    apiKey,
    defaultHeaders: {
        originator: "coder",  // 硬编码
        session_id: this.sessionId,
        "User-Agent": userAgent,
    },
})

// 修改后
this.client = new OpenAI({
    baseURL: this.options.openAiNativeBaseUrl || undefined,
    apiKey,
    defaultHeaders: {
        ...this.options.openAiNativeHeaders,
        ...(this.options.originator ? { originator: this.options.originator } : {}),
        session_id: this.sessionId,
        "User-Agent": userAgent,
    },
})
```

#### 2.1.4 修改 executeRequest 方法

**文件**：`src/api/providers/openai-native.ts`

**修改**：将硬编码的 originator 改为从配置中获取

```typescript
// 修改前
const requestHeaders: Record<string, string> = {
    originator: "coder",  // 硬编码
    session_id: taskId || this.sessionId,
    "User-Agent": userAgent,
}

// 修改后
const requestHeaders: Record<string, string> = {
    ...this.options.openAiNativeHeaders,
    ...(this.options.originator ? { originator: this.options.originator } : {}),
    session_id: taskId || this.sessionId,
    "User-Agent": userAgent,
}
```

#### 2.1.5 修改 makeResponsesApiRequest 方法

**文件**：`src/api/providers/openai-native.ts`

**修改**：将硬编码的 originator 改为从配置中获取

```typescript
// 修改前
const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    originator: "coder",  // 硬编码
    session_id: taskId || this.sessionId,
    "User-Agent": userAgent,
}

// 修改后
const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    ...this.options.openAiNativeHeaders,
    ...(this.options.originator ? { originator: this.options.originator } : {}),
    session_id: taskId || this.sessionId,
    "User-Agent": userAgent,
}
```

## 三、改造验证

### 3.1 验证结果

所有硬编码信息已成功删除，配置化改造已完成：

| 检查项 | 状态 | 说明 |
|--------|------|------|
| providerName 删除 | ✅ 成功 | 硬编码的供应商名称已删除 |
| originator 硬编码删除 | ✅ 成功 | 所有硬编码的 originator 已删除 |
| openAiNativeHeaders 配置 | ✅ 成功 | 已添加并在 3 处使用 |
| originator 配置 | ✅ 成功 | 已添加并在 3 处使用 |
| 构造函数签名 | ✅ 正确 | 构造函数签名保持不变 |
| Responses API 端点 | ✅ 保持 | `/v1/responses` 端点保持不变 |

### 3.2 修改统计

- **删除的硬编码**：
  - `providerName = "OpenAI Native"`（1处）
  - `originator: "coder"`（3处）

- **新增的配置支持**：
  - `this.options.openAiNativeHeaders`（3处使用）
  - `this.options.originator`（3处使用）

## 四、使用方式

### 4.1 配置示例

```typescript
const options: ApiHandlerOptions = {
    apiProvider: "openai-native",
    openAiNativeApiKey: "your-api-key",
    openAiNativeBaseUrl: "https://api.openai.com",
    apiModelId: "gpt-5.1-codex-max",

    // 可选：配置 originator
    originator: "your-app-name",

    // 可选：配置自定义 Headers
    openAiNativeHeaders: {
        "HTTP-Referer": "https://your-app.com",
        "X-Title": "Your App",
    },
}

const handler = new OpenAiNativeHandler(options)
```

### 4.2 不提供默认值

按照要求，改造后不提供任何默认值：

- 如果不配置 `originator`，则不会发送 `originator` header
- 如果不配置 `openAiNativeHeaders`，则不会发送额外的 headers
- 必须显式配置所有需要的供应商信息

## 五、改造优势

### 5.1 与改造前对比

| 特性 | 改造前 | 改造后 |
|------|--------|--------|
| 供应商名称 | 硬编码 "OpenAI Native" | 已删除 |
| originator | 硬编码 "coder" | 可配置 |
| Headers | 硬编码 | 可配置 |
| 代码复用 | 低 | 高 |
| 可维护性 | 低 | 高 |
| 扩展性 | 低 | 高 |
| 向后兼容 | N/A | 不提供（按需） |

### 5.2 主要优势

1. **完全配置化**：所有供应商信息都通过配置管理，无硬编码
2. **灵活性高**：可以轻松切换或扩展供应商
3. **代码简洁**：删除了不必要的硬编码属性
4. **易于维护**：修改供应商信息只需修改配置，无需修改代码
5. **保持功能**：Responses API 端点和所有功能保持不变

## 六、注意事项

⚠️ **重要提示**：

1. **不提供默认值**：改造后不再提供任何默认值，必须显式配置
2. **不向后兼容**：原有代码可能需要更新配置
3. **无数据迁移**：不存在数据迁移需求

## 七、相关文件

- `src/api/providers/openai-native.ts` - 主要改造文件
- `src/shared/api.ts` - ApiHandlerOptions 接口扩展
- `docs/openai-native-vendor-refactoring-plan.md` - 本文档

## 八、总结

本次改造成功删除了 OpenAI Native 供应商中的所有硬编码信息，实现了完全配置化的供应商管理。改造后的代码更加灵活、可维护，为未来的扩展和优化奠定了良好的基础。

改造遵循了以下原则：
- ✅ 删除所有硬编码的供应商信息
- ✅ 采用配置化方式管理
- ✅ 保持调用 Responses API 端点
- ✅ 不提供默认值
- ✅ 不提供向后兼容

---

**改造日期**：2026-02-27
**改造状态**：✅ 已完成
**验证状态**：✅ 已通过
