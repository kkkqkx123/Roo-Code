# OpenAI 兼容端点工具调用安全性分析

## 背景

历史阻塞问题发生在 **OpenAI 兼容 Chat Completions 流式端点**，而不是 OpenAI Native Responses 事件流。  
因此，仅修复 `openai-native.ts` 并不能覆盖真实故障面。

本次复盘重点检查了这两层链路：

1. `src/api/providers/base-openai-compatible-provider.ts`（把 provider 的增量事件转成 `tool_call_partial`）
2. `src/core/assistant-message/NativeToolCallParser.ts`（把 `tool_call_partial` 组装成可执行工具调用）

## 发现的隐蔽缺陷

### 1) 对 `tool_call.index` 依赖过强

旧实现直接透传 `toolCall.index`。部分兼容端点会省略 `index`。  
结果：

- 多个工具分块可能被错误地归并到同一流索引
- 或出现未定义索引导致状态跟踪不稳定

这会放大并行工具场景的错配风险。

### 2) 对 `arguments` 类型假设过强

旧实现假设 `toolCall.function.arguments` 一定是字符串。  
一些兼容实现会返回对象（已解析 JSON）或其它类型。  
结果：

- 下游解析收到非字符串分块，可能拼接失败/JSON 失败
- 工具调用静默失败，表现为“模型调用了工具但未执行”

### 3) `NativeToolCallParser` 仅在“首包带 id”时初始化

旧实现要求“先收到 id 再跟踪该工具调用”。  
若兼容端点先发 `name/arguments`，后发 `id`：

- 早到的 arguments 被丢弃
- 工具调用无法完整组装

这是典型的“流式乱序字段”脆弱点。

## 设计层面的不安全点

当前架构是“弱约束输入 -> 强状态机组装”。  
当上游兼容端点不完全遵守 OpenAI 规范时，系统应优先“降级可恢复”，而不是“静默丢失”。

本次策略是：

- 在 provider 层做输入归一化（index/arguments）
- 在 parser 层支持延迟关联（先缓冲后启动）
- 保持工具调用 ID 尽量使用 provider 真实 ID，避免任意伪造

## 本次修改

### A. 兼容端点输出归一化

文件：`src/api/providers/base-openai-compatible-provider.ts`

- 当 `tool_call.index` 缺失时分配稳定 synthetic index（按 id 或位置回退）
- 对 `tool_call.function.arguments` 统一归一化为字符串（`JSON.stringify` 回退）
- 保留 `finish_reason: tool_calls` 的结束事件逻辑

### B. 解析器支持“先参数后 id”

文件：`src/core/assistant-message/NativeToolCallParser.ts`

- raw chunk 跟踪改为“无 id 也先建索引状态”
- arguments 先缓冲，待 id 到达后再触发 start + flush delta
- `processFinishReason/finalizeRawChunks` 增加 late-start 兜底
- 非字符串 arguments 分块统一字符串化

## 新增测试

1. `src/api/providers/__tests__/base-openai-compatible-provider.spec.ts`
   - 缺失 index 时应生成稳定 synthetic index
   - object 形式 arguments 应被规范化为字符串

2. `src/core/assistant-message/__tests__/NativeToolCallParser.spec.ts`
   - 先 arguments 后 id 的场景应正确启动并回放缓冲分块
   - 非字符串 arguments 分块应被规范化并可继续解析

## 结论

这次修改并非“针对单一 provider 的兼容补丁”，而是把兼容端点工具流从“理想输入驱动”升级为“异常输入可恢复”。  
即便上游端点字段缺失或顺序异常，系统也不应轻易进入“工具调用看似存在但未处理”的阻塞态。
