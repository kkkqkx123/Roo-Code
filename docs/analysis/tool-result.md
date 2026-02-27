当前项目里，工具调用结果是“先聚合、再入历史、再送模型”的两通道流程。

**1) 处理主链路（工具结果）**
1. `presentAssistantMessage` 逐块处理 assistant 的 `tool_use`，为每次调用构造 `pushToolResult`/`askApproval`/`handleError` 回调，并保证同一个 `tool_use_id` 只入一次结果。`src/core/assistant-message/presentAssistantMessage.ts:472`
2. 工具执行后，结果通过 `pushToolResult` 写入 `Task.userMessageContent`，实际是 `tool_result`（可附带 image block）。`src/core/assistant-message/presentAssistantMessage.ts:504`
3. assistant 消息先保存到 API 历史，再允许 flush 工具结果，避免 `tool_result` 在 `tool_use` 前面。`src/core/task/Task.ts:2681` `src/core/task/Task.ts:1024`
4. user 侧工具结果入历史前会做 ID 修复/补齐（缺失时补“interrupted”占位）。`src/core/task/validateToolResultIds.ts:50`
5. 发请求前，历史会经过有效历史过滤、合并、图片能力清洗、provider 适配转换。`src/core/task/Task.ts:3722` `src/core/task/Task.ts:3728` `src/core/task/Task.ts:3808`

**2) 哪些内容会返回给 LLM**
1. `apiConversationHistory` 的有效内容（assistant/user/tool_use/tool_result），经清洗后送 provider。`src/core/task/Task.ts:3728`
2. `tool_result` 会按 provider 转成对应格式：
1. OpenAI Chat: `role=tool` + `tool_call_id` + string content。`src/api/transform/openai-format.ts:366`
2. OpenAI Responses: `function_call_output`。`src/api/providers/openai-native.ts:498`
3. Gemini: `functionResponse`（要求能从 `tool_use_id` 找到工具名，否则报错）。`src/api/transform/gemini-format.ts:88`
3. 大输出命令不会把全文直接给 LLM，只给 preview + artifact id，再由 `read_command_output` 按需读取。`src/integrations/terminal/OutputInterceptor.ts:26` `src/core/tools/ExecuteCommandTool.ts:525`
4. 一些保存过的 `tool_result` 可能在有效历史阶段被过滤（如对应 `tool_use` 已被 summary 截断）。`src/core/condense/index.ts:553`

**3) 哪些内容主要走日志/观测，不回给 LLM**
1. UI 消息流（`say/ask`）持久化到 `ui_messages.json`，并可被 API 层写入 `coder-messages.log`。`src/core/task-persistence/taskMessages.ts:52` `src/extension/api.ts:390` `src/extension/api.ts:56`
2. API 历史调试文件会额外写入 system prompt（`isSystemPrompt`），这是调试用途，不参与请求。`src/core/task/Task.ts:1090` `src/core/condense/index.ts:542`
3. 工具失败统计进入 metrics/event（`TaskToolFailed`），目前对外是字符串错误，结构化字段会被折叠。`src/core/metrics/MetricsService.ts:138` `src/core/task/Task.ts:532` `packages/types/src/events.ts:112`

**4) 是否应在基类规范使用行为**
结论：`应该`，但要“基类 + 调度层”分层规范，不是只靠基类。

1. 现状已暴露不一致：`presentAssistantMessage` 已统一记录一次 `recordToolUsage`，但部分工具成功后又再记一次，存在统计口径重复风险。`src/core/assistant-message/presentAssistantMessage.ts:586` `src/core/tools/EditTool.ts:240` `src/core/tools/EditFileTool.ts:493` `src/core/tools/ApplyPatchTool.ts:299` `src/core/tools/SearchReplaceTool.ts:229`
2. `BaseTool` 目前只统一了 partial/参数解析框架，未统一“结果提交/日志上报/成功失败口径”。`src/core/tools/BaseTool.ts:114`
3. 建议：
1. 在基类统一 attempt/success/failure 计数与错误上报接口，工具实现只产出业务结果。
2. 保留 `presentAssistantMessage` 对协议级约束（一次 `tool_result`、审批流、tool_call_id 对齐）的控制。
3. 扩展 `TaskToolFailed` 事件 payload（至少支持结构化 `LogEntry`），避免日志信息在事件层丢失。