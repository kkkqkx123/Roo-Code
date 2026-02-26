# Streaming Types Migration Summary

## 迁移概述

本次迁移将 `src/core/task/streaming/types.ts` 中的通用类型定义迁移到 `packages/types/src` 目录，以实现类型复用和统一管理。

## 迁移的文件

### 新建文件

1. **packages/types/src/errors.ts** - 统一错误定义
   - `BaseError` - 基础错误类
   - `StreamingError` - 流处理错误基类
   - `InvalidStreamError` - 无效流错误
   - `ChunkHandlerError` - 块处理错误
   - `StreamAbortedError` - 流中止错误
   - `ToolCallError` - 工具调用错误
   - `TokenError` - 令牌错误
   - `UserInterruptError` - 用户中断错误
   - `ToolInterruptError` - 工具中断错误
   - `StreamProviderError` - 提供商错误
   - `StreamTimeoutError` - 超时错误
   - `StateError` - 状态错误
   - `StreamingRetryError` - 重试错误
   - `StreamingErrorType` - 错误联合类型
   - `ErrorHandlingResult` - 错误处理结果
   - 辅助函数：`isStreamingError`, `getErrorCode`, `getErrorContext`

2. **packages/types/src/streaming.ts** - 流处理核心类型
   - `StreamingGroundingSource` - 引用来源（重命名以避免冲突）
   - `ApiMessage` - API 消息
   - `StreamingTokenUsage` - 令牌使用统计（重命名以避免冲突）
   - `TokenBreakdown` - 令牌分类
   - `StreamingResult` - 流处理结果

3. **packages/types/src/streaming-events.ts** - 流处理事件类型
   - `StreamChunk` - 流数据块联合类型
   - `ToolCallStartEvent` - 工具调用开始事件
   - `ToolCallDeltaEvent` - 工具调用增量事件
   - `ToolCallEndEvent` - 工具调用结束事件
   - `ToolCallEvent` - 工具调用事件联合类型
   - 辅助函数：`isToolCallEvent`, `isErrorChunk`, `isUsageChunk`

### 修改文件

1. **packages/types/src/index.ts**
   - 添加 `errors.ts` 导出
   - 添加 `streaming.ts` 导出
   - 添加 `streaming-events.ts` 导出

2. **src/core/task/streaming/types.ts**
   - 重新导出 packages/types 中的类型
   - 保留 streaming 模块特定的配置类型：
     - `StreamingProcessorConfig`
     - `ApiHandler`
     - `DiffViewProvider`
     - `ChunkHandlerContext`
     - `StreamingStateManager`
     - `StreamingTokenManager`
     - `ChunkHandler`
     - `ClineMessage` (模块特定版本)
     - `StreamingResult` (模块特定版本)

## 类型命名冲突处理

由于 `message.ts` 中已存在 `TokenUsage` 类型，为了避免冲突：

- `packages/types/src/streaming.ts` 中的 `TokenUsage` 重命名为 `StreamingTokenUsage`
- `packages/types/src/streaming.ts` 中的 `GroundingSource` 重命名为 `StreamingGroundingSource`
- 在 `src/core/task/streaming/types.ts` 中使用别名导出以保持向后兼容：
  ```typescript
  export type {
    StreamingTokenUsage as TokenUsage,
    StreamingGroundingSource as GroundingSource,
  } from "@shared/types/streaming"
  ```

## 未迁移的类型

以下类型与 streaming 模块紧密耦合，保留在原位置：

- `StreamingProcessorConfig` - 包含具体的回调函数和依赖注入
- `ApiHandler` - 具体的 API 处理器接口
- `DiffViewProvider` - VSCode 特定的差异视图提供者
- `ChunkHandlerContext` - 处理器上下文
- `StreamingStateManager` - 状态管理器接口
- `StreamingTokenManager` - 令牌管理器接口
- `ChunkHandler` - 处理器接口
- `ClineMessage` - streaming 模块特定的消息类型

## 迁移优势

1. **类型复用**：其他模块可以直接引用，避免重复定义
2. **错误统一**：建立项目级错误体系，便于错误处理和日志记录
3. **维护性**：集中管理，修改时只需更新一处
4. **类型安全**：配合 `packages/types` 的类型系统，增强类型检查
5. **向后兼容**：通过重新导出保持现有代码的导入路径不变

## 使用示例

### 从 packages/types 导入类型

```typescript
// 导入错误类型
import { StreamingError, InvalidStreamError, ErrorHandlingResult } from "@shared/types/errors"

// 导入流处理类型
import { StreamingTokenUsage, StreamingResult, ApiMessage } from "@shared/types/streaming"

// 导入事件类型
import { StreamChunk, ToolCallEvent, isToolCallEvent } from "@shared/types/streaming-events"
```

### 从 streaming 模块导入（向后兼容）

```typescript
// 现有代码无需修改，继续使用原来的导入路径
import { StreamChunk, TokenUsage, GroundingSource, StreamingError } from "./types"
```

## 构建验证

- ✅ `packages/types` 包构建成功
- ✅ 类型定义正确导出
- ✅ 无类型冲突
- ✅ 向后兼容性保持

## 后续建议

1. 考虑在其他模块中使用统一的错误体系
2. 逐步将其他模块的通用类型迁移到 `packages/types`
3. 为错误类添加更详细的文档和使用示例
4. 考虑添加错误码的枚举定义，便于错误分类和处理
