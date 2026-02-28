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
import { TokenAccountingSession } from "./TokenAccountingSession"
import { TokenContextBuilder } from "./TokenContextBuilder"

/**
 * TokenAccountingService - Token 统计服务
 * 
 * 中心化管理 token 统计的有状态服务。
 * 每个 Task 应该有一个独立的 TokenAccountingService 实例。
 * 
 * 职责：
 * - 管理多个 TokenAccountingSession（每个 API 请求一个）
 * - 聚合多轮对话的 token 统计
 * - 提供统一的 token 统计接口
 * - 跟踪当前任务的总 token 使用量
 */
export class TokenAccountingService {
  private sessions: Map<string, TokenAccountingSession> = new Map()
  private tokenizer: Tokenizer
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private totalCacheWriteTokens = 0
  private totalCacheReadTokens = 0
  private totalCost = 0

  /**
   * 创建 TokenAccountingService 实例
   * 
   * @param tokenizer - Tokenizer 实例（可选，默认使用 tiktoken）
   */
  constructor(tokenizer?: Tokenizer) {
    this.tokenizer = tokenizer || TokenizerFactory.getDefaultTokenizer()
  }

  /**
   * 创建新的 TokenAccountingSession
   * 
   * @param sessionId - 会话 ID（通常是请求 ID 或任务 ID）
   * @param context - Token 统计上下文
   * @returns 新创建的 TokenAccountingSession
   */
  createSession(sessionId: string, context: TokenAccountingContext): TokenAccountingSession {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session with ID ${sessionId} already exists`)
    }

    const session = new TokenAccountingSession(context, this.tokenizer)
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * 获取指定的 TokenAccountingSession
   * 
   * @param sessionId - 会话 ID
   * @returns TokenAccountingSession 或 undefined
   */
  getSession(sessionId: string): TokenAccountingSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 检查会话是否存在
   * 
   * @param sessionId - 会话 ID
   * @returns 是否存在
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * 删除指定的 TokenAccountingSession
   * 
   * @param sessionId - 会话 ID
   * @returns 是否删除成功
   */
  removeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.dispose()
      return this.sessions.delete(sessionId)
    }
    return false
  }

  /**
   * 完成会话并更新总计
   * 
   * @param sessionId - 会话 ID
   * @param outputTokens - 输出 token 数
   * @param cost - 本次请求的成本
   * @returns TokenCount 结果
   */
  finalizeSession(sessionId: string, outputTokens: number = 0, cost: number = 0): TokenCount {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session with ID ${sessionId} not found`)
    }

    const result = session.finalize(outputTokens)

    // 更新总计
    this.totalInputTokens += result.inputTokens
    this.totalOutputTokens += result.outputTokens
    this.totalCacheWriteTokens += result.cacheWriteTokens || 0
    this.totalCacheReadTokens += result.cacheReadTokens || 0
    this.totalCost += cost

    return result
  }

  /**
   * 获取当前总计
   */
  getTotalStats(): TokenStats {
    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      cacheWriteTokens: this.totalCacheWriteTokens,
      cacheReadTokens: this.totalCacheReadTokens,
      totalCost: this.totalCost,
      tokenizerType: this.tokenizer.type
    }
  }

  /**
   * 重置总计
   */
  resetTotals(): void {
    this.totalInputTokens = 0
    this.totalOutputTokens = 0
    this.totalCacheWriteTokens = 0
    this.totalCacheReadTokens = 0
    this.totalCost = 0
  }

  /**
   * 获取所有会话的摘要信息
   */
  getSessionsSummary(): Array<{
    sessionId: string
    state: TokenAccountingState
    hasApiUsage: boolean
    hasTiktokenCount: boolean
    finalizedAt: number | null
  }> {
    const summaries: Array<{
      sessionId: string
      state: TokenAccountingState
      hasApiUsage: boolean
      hasTiktokenCount: boolean
      finalizedAt: number | null
    }> = []

    for (const [sessionId, session] of this.sessions.entries()) {
      const summary = session.getSummary()
      summaries.push({
        sessionId,
        ...summary
      })
    }

    return summaries
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * 获取已完成会话数量
   */
  getFinalizedSessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.isFinalized()) {
        count++
      }
    }
    return count
  }

  /**
   * 获取使用 tiktoken 回退的会话数量
   */
  getFallbackSessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.isFallbackTiktoken()) {
        count++
      }
    }
    return count
  }

  /**
   * 清理所有资源
   */
  dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose()
    }
    this.sessions.clear()
    this.tokenizer.dispose()
  }

  /**
   * 构建 TokenAccountingContext
   * 
   * 便捷方法，用于创建 TokenAccountingContext
   */
  static buildContext(
    systemPrompt: string,
    userMessage: ContentBlock[],
    history: MessageParam[]
  ): TokenAccountingContext {
    return {
      systemPrompt,
      userMessage,
      history
    }
  }

  /**
   * 从文本构建用户消息
   * 
   * 便捷方法，用于将文本转换为 ContentBlock[]
   */
  static buildUserMessageFromText(text: string): ContentBlock[] {
    return TokenContextBuilder.buildUserMessageFromText(text)
  }

  /**
   * 从文本数组构建对话历史
   * 
   * 便捷方法，用于将文本数组转换为 MessageParam[]
   */
  static buildHistoryFromTexts(
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): MessageParam[] {
    return TokenContextBuilder.buildConversationHistoryFromTexts(messages)
  }
}