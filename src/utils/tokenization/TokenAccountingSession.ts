import {
  TokenAccountingState,
  TokenCount,
  TokenStats,
  ApiUsage,
  TokenAccountingContext,
  ContentBlock,
  MessageParam
} from "@coder/types"
import { Tokenizer } from "./Tokenizer"
import { TokenizerFactory } from "./TokenizerFactory"
import { TokenContextBuilder } from "./TokenContextBuilder"

/**
 * TokenAccountingSession - Token 统计会话
 * 
 * 管理单个 API 请求的 token 统计生命周期。
 * 使用状态机模式：IDLE → COLLECTING_API_DATA → (API_VALID | FALLBACK_TIKTOKEN) → FINALIZED
 * 
 * 职责：
 * - 跟踪 API 返回的 usage 数据
 * - 在 API 数据无效时回退到 tiktoken 计数
 * - 确保每个请求的 token 统计只被计算一次
 * - 提供状态查询和最终统计结果
 */
export class TokenAccountingSession {
  private state: TokenAccountingState = TokenAccountingState.IDLE
  private context: TokenAccountingContext
  private tokenizer: Tokenizer
  private apiUsage: ApiUsage | null = null
  private tiktokenCount: TokenCount | null = null
  private finalizedAt: number | null = null

  /**
   * 创建 TokenAccountingSession 实例
   * 
   * @param context - Token 统计上下文
   * @param tokenizer - Tokenizer 实例（可选，默认使用 tiktoken）
   */
  constructor(context: TokenAccountingContext, tokenizer?: Tokenizer) {
    this.context = context
    this.tokenizer = tokenizer || TokenizerFactory.getDefaultTokenizer()
  }

  /**
   * 获取当前状态
   */
  getState(): TokenAccountingState {
    return this.state
  }

  /**
   * 检查是否处于初始状态
   */
  isIdle(): boolean {
    return this.state === TokenAccountingState.IDLE
  }

  /**
   * 检查是否正在收集 API 数据
   */
  isCollectingApiData(): boolean {
    return this.state === TokenAccountingState.COLLECTING_API_DATA
  }

  /**
   * 检查 API 数据是否有效
   */
  isApiValid(): boolean {
    return this.state === TokenAccountingState.API_VALID
  }

  /**
   * 检查是否使用 tiktoken 回退
   */
  isFallbackTiktoken(): boolean {
    return this.state === TokenAccountingState.FALLBACK_TIKTOKEN
  }

  /**
   * 检查是否已完成统计
   */
  isFinalized(): boolean {
    return this.state === TokenAccountingState.FINALIZED
  }

  /**
   * 开始收集 API 数据
   * 
   * 从 IDLE 状态转换到 COLLECTING_API_DATA 状态
   */
  startCollectingApiData(): void {
    if (this.state !== TokenAccountingState.IDLE) {
      throw new Error(`Cannot start collecting API data from state: ${this.state}`)
    }
    this.state = TokenAccountingState.COLLECTING_API_DATA
  }

  /**
   * 设置 API usage 数据
   * 
   * 如果数据有效，状态转换为 API_VALID；否则转换为 FALLBACK_TIKTOKEN
   * 
   * @param usage - API 返回的 usage 数据
   */
  setApiUsage(usage: ApiUsage): void {
    if (this.state !== TokenAccountingState.COLLECTING_API_DATA) {
      throw new Error(`Cannot set API usage in state: ${this.state}`)
    }

    this.apiUsage = usage

    // 验证 API 数据是否有效
    if (this.isValidApiUsage(usage)) {
      this.state = TokenAccountingState.API_VALID
    } else {
      this.state = TokenAccountingState.FALLBACK_TIKTOKEN
    }
  }

  /**
   * 验证 API usage 数据是否有效
   */
  private isValidApiUsage(usage: ApiUsage): boolean {
    // 检查是否有有效的 token 计数
    const hasInputTokens = typeof usage.inputTokens === "number" && usage.inputTokens >= 0
    const hasOutputTokens = typeof usage.outputTokens === "number" && usage.outputTokens >= 0
    const hasTotalTokens = typeof usage.totalTokens === "number" && usage.totalTokens >= 0

    // 至少需要有输入或输出 token 计数
    return (hasInputTokens || hasOutputTokens || hasTotalTokens)
  }

  /**
   * 执行 tiktoken 回退计数
   * 
   * 当 API 数据无效时，使用 tiktoken 进行本地计数
   */
  async performFallbackTiktoken(): Promise<TokenCount> {
    if (this.state !== TokenAccountingState.FALLBACK_TIKTOKEN) {
      throw new Error(`Cannot perform tiktoken fallback in state: ${this.state}`)
    }

    if (this.tiktokenCount) {
      return this.tiktokenCount
    }

    try {
      // 构建完整的 token 上下文
      const tokenContext = TokenContextBuilder.buildContext(
        this.context.systemPrompt,
        this.context.userMessage,
        this.context.history
      )

      // 计算各部分的 token 数量
      const systemPromptTokens = await this.tokenizer.countContentBlocks(tokenContext.systemPrompt)
      const userMessageTokens = await this.tokenizer.countContentBlocks(tokenContext.currentUserMessage)
      const historyTokens = await this.countHistoryTokens(tokenContext.conversationHistory)

      const inputTokens = systemPromptTokens + userMessageTokens + historyTokens

      this.tiktokenCount = {
        inputTokens,
        outputTokens: 0, // 输出 token 数在请求完成前未知
        totalTokens: inputTokens
      }

      return this.tiktokenCount
    } catch (error) {
      console.error("TokenAccountingSession.performFallbackTiktoken failed:", error)
      throw new Error(`Failed to perform tiktoken fallback: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 计算对话历史的 token 数量
   */
  private async countHistoryTokens(history: MessageParam[]): Promise<number> {
    let total = 0
    for (const message of history) {
      if (typeof message.content === "string") {
        total += await this.tokenizer.countTokens(message.content)
      } else {
        total += await this.tokenizer.countContentBlocks(message.content)
      }
    }
    return total
  }

  /**
   * 完成统计
   * 
   * 根据当前状态返回最终的 token 统计结果
   */
  finalize(outputTokens: number = 0): TokenCount {
    if (this.state === TokenAccountingState.IDLE ||
        this.state === TokenAccountingState.COLLECTING_API_DATA) {
      throw new Error(`Cannot finalize session in state: ${this.state}`)
    }

    if (this.state === TokenAccountingState.FALLBACK_TIKTOKEN && !this.tiktokenCount) {
      throw new Error("Cannot finalize: tiktoken fallback not performed")
    }

    // 保存之前的状态用于判断
    const previousState = this.state

    // 更新状态
    this.state = TokenAccountingState.FINALIZED
    this.finalizedAt = Date.now()

    // 根据之前的状态返回结果
    if (previousState === TokenAccountingState.API_VALID && this.apiUsage) {
      return {
        inputTokens: this.apiUsage.inputTokens || 0,
        outputTokens: outputTokens || this.apiUsage.outputTokens || 0,
        cacheWriteTokens: this.apiUsage.cacheWriteTokens,
        cacheReadTokens: this.apiUsage.cacheReadTokens,
        totalTokens: this.apiUsage.totalTokens || 
                     (this.apiUsage.inputTokens || 0) + (outputTokens || this.apiUsage.outputTokens || 0)
      }
    }

    if (this.tiktokenCount) {
      return {
        ...this.tiktokenCount,
        outputTokens: outputTokens || this.tiktokenCount.outputTokens,
        totalTokens: this.tiktokenCount.inputTokens + (outputTokens || this.tiktokenCount.outputTokens)
      }
    }

    // 默认返回
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    }
  }

  /**
   * 获取 API usage 数据
   */
  getApiUsage(): ApiUsage | null {
    return this.apiUsage
  }

  /**
   * 获取 tiktoken 计数结果
   */
  getTiktokenCount(): TokenCount | null {
    return this.tiktokenCount
  }

  /**
   * 获取最终化时间
   */
  getFinalizedAt(): number | null {
    return this.finalizedAt
  }

  /**
   * 获取会话摘要信息
   */
  getSummary(): {
    state: TokenAccountingState
    hasApiUsage: boolean
    hasTiktokenCount: boolean
    finalizedAt: number | null
  } {
    return {
      state: this.state,
      hasApiUsage: this.apiUsage !== null,
      hasTiktokenCount: this.tiktokenCount !== null,
      finalizedAt: this.finalizedAt
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.tokenizer.dispose()
  }
}