import { TokenContext, ContentBlock, MessageParam } from "@coder/types"

/**
 * TokenContextBuilder - Token 上下文构建器
 * 
 * 无状态工具类，负责构建完整的 token 统计上下文。
 * 主要功能：
 * - 将系统提示词、用户消息、对话历史转换为统一的 TokenContext 格式
 * - 处理内容块的标准化和序列化
 * - 确保统计范围完整，解决统计一致性问题
 */
export class TokenContextBuilder {
  /**
   * 构建完整的 TokenContext
   * 
   * @param systemPrompt - 系统提示词文本
   * @param userMessage - 用户消息内容块
   * @param conversationHistory - 对话历史
   * @param assistantOutput - 助手输出内容块（可选）
   * @returns 完整的 TokenContext
   */
  static buildContext(
    systemPrompt: string,
    userMessage: ContentBlock[],
    conversationHistory: MessageParam[],
    assistantOutput?: ContentBlock[]
  ): TokenContext {
    // 将系统提示词转换为内容块
    const systemPromptBlocks: ContentBlock[] = systemPrompt
      ? [{ type: "text", text: systemPrompt }]
      : []

    return {
      systemPrompt: systemPromptBlocks,
      currentUserMessage: userMessage,
      conversationHistory: conversationHistory,
      assistantOutput: assistantOutput
    }
  }

  /**
   * 从字符串构建用户消息内容块
   * 
   * @param text - 用户消息文本
   * @returns 内容块数组
   */
  static buildUserMessageFromText(text: string): ContentBlock[] {
    return text ? [{ type: "text", text }] : []
  }

  /**
   * 从文本数组构建对话历史
   * 
   * @param messages - 消息数组，格式为 [{role: "user" | "assistant", content: string}]
   * @returns 标准化的 MessageParam 数组
   */
  static buildConversationHistoryFromTexts(
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): MessageParam[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  }

  /**
   * 序列化内容块为文本（用于调试和日志记录）
   * 
   * @param contentBlocks - 内容块数组
   * @returns 序列化后的文本
   */
  static serializeContentBlocks(contentBlocks: ContentBlock[]): string {
    return contentBlocks
      .map(block => {
        if (block.type === "text") {
          return `[text] ${block.text || ""}`
        } else if (block.type === "image") {
          return `[image] ${JSON.stringify(block)}`
        } else {
          return `[${block.type}] ${JSON.stringify(block)}`
        }
      })
      .join("\n")
  }

  /**
   * 序列化消息参数为文本（用于调试和日志记录）
   * 
   * @param message - 消息参数
   * @returns 序列化后的文本
   */
  static serializeMessageParam(message: MessageParam): string {
    const contentStr = typeof message.content === "string"
      ? message.content
      : this.serializeContentBlocks(message.content as ContentBlock[])
    
    return `[${message.role}] ${contentStr}`
  }

  /**
   * 验证 TokenContext 是否有效
   * 
   * @param context - 要验证的 TokenContext
   * @returns 验证结果和错误信息（如果有）
   */
  static validateContext(context: TokenContext): { valid: boolean; error?: string } {
    if (!context.systemPrompt || !Array.isArray(context.systemPrompt)) {
      return { valid: false, error: "systemPrompt must be an array" }
    }

    if (!context.currentUserMessage || !Array.isArray(context.currentUserMessage)) {
      return { valid: false, error: "currentUserMessage must be an array" }
    }

    if (!context.conversationHistory || !Array.isArray(context.conversationHistory)) {
      return { valid: false, error: "conversationHistory must be an array" }
    }

    if (context.assistantOutput && !Array.isArray(context.assistantOutput)) {
      return { valid: false, error: "assistantOutput must be an array if provided" }
    }

    // 验证内容块类型
    const allBlocks = [
      ...context.systemPrompt,
      ...context.currentUserMessage,
      ...(context.assistantOutput || [])
    ]

    for (const block of allBlocks) {
      if (!block.type || typeof block.type !== "string") {
        return { valid: false, error: "Content block must have a type property" }
      }
    }

    // 验证对话历史
    for (const message of context.conversationHistory) {
      if (!["user", "assistant", "system"].includes(message.role)) {
        return { valid: false, error: `Invalid role: ${message.role}` }
      }
      if (!message.content) {
        return { valid: false, error: "Message content cannot be empty" }
      }
    }

    return { valid: true }
  }

  /**
   * 计算 TokenContext 的摘要信息（用于日志和监控）
   * 
   * @param context - TokenContext
   * @returns 摘要信息
   */
  static getContextSummary(context: TokenContext): {
    systemPromptBlocks: number
    userMessageBlocks: number
    conversationHistoryMessages: number
    assistantOutputBlocks?: number
  } {
    return {
      systemPromptBlocks: context.systemPrompt.length,
      userMessageBlocks: context.currentUserMessage.length,
      conversationHistoryMessages: context.conversationHistory.length,
      assistantOutputBlocks: context.assistantOutput?.length
    }
  }
}