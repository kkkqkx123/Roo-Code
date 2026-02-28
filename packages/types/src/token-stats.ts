import { z } from "zod"

/**
 * ContentBlock - 内容块基础类型
 * 
 * 用于表示消息中的文本、图像等内容块
 * 使用基础类型避免依赖特定 SDK
 */
export interface ContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

/**
 * MessageParam - 消息参数基础类型
 * 
 * 用于表示对话消息的通用结构
 */
export interface MessageParam {
  role: "user" | "assistant" | "system"
  content: string | ContentBlock[]
}

/**
 * TokenContext - 完整的 token 统计上下文
 * 
 * 包含所有需要进行 token 统计的内容块，确保统计范围完整。
 * 用于解决系统提示词、用户消息、助手回复的统计一致性问题。
 */
export interface TokenContext {
  /**
   * 系统提示词内容块
   */
  systemPrompt: ContentBlock[]

  /**
   * 当前用户消息内容块
   */
  currentUserMessage: ContentBlock[]

  /**
   * API 对话历史
   */
  conversationHistory: MessageParam[]

  /**
   * 助手输出内容块（可选，用于 tiktoken 回退）
   */
  assistantOutput?: ContentBlock[]
}

/**
 * TokenCount - Token 计数结果
 */
export interface TokenCount {
  /**
   * 输入 token 数
   */
  inputTokens: number

  /**
   * 输出 token 数
   */
  outputTokens: number

  /**
   * 缓存写入 token 数（可选）
   */
  cacheWriteTokens?: number

  /**
   * 缓存读取 token 数（可选）
   */
  cacheReadTokens?: number

  /**
   * 总 token 数
   */
  totalTokens: number
}

/**
 * TokenStats - Token 统计结果
 */
export interface TokenStats {
  /**
   * 输入 token 数
   */
  totalInputTokens: number

  /**
   * 输出 token 数
   */
  totalOutputTokens: number

  /**
   * 缓存写入 token 数（可选）
   */
  cacheWriteTokens?: number

  /**
   * 缓存读取 token 数（可选）
   */
  cacheReadTokens?: number

  /**
   * 总成本
   */
  totalCost: number

  /**
   * 详细分解（可选）
   */
  breakdown?: {
    systemPrompt?: number
    userMessage?: number
    conversationHistory?: number
    assistantOutput?: number
  }

  /**
   * 使用的 tokenizer 类型
   */
  tokenizerType?: "tiktoken" | "api" | "fallback"
}

/**
 * TokenAccountingState - Token 统计状态枚举
 */
export enum TokenAccountingState {
  /**
   * 初始状态
   */
  IDLE = "IDLE",

  /**
   * 正在收集 API 数据
   */
  COLLECTING_API_DATA = "COLLECTING_API_DATA",

  /**
   * API 数据有效
   */
  API_VALID = "API_VALID",

  /**
   * 使用 tiktoken 回退
   */
  FALLBACK_TIKTOKEN = "FALLBACK_TIKTOKEN",

  /**
   * 已完成统计
   */
  FINALIZED = "FINALIZED"
}

/**
 * ApiUsage - API 返回的 usage 数据
 */
export interface ApiUsage {
  /**
   * 输入 token 数
   */
  inputTokens?: number

  /**
   * 输出 token 数
   */
  outputTokens?: number

  /**
   * 缓存写入 token 数
   */
  cacheWriteTokens?: number

  /**
   * 缓存读取 token 数
   */
  cacheReadTokens?: number

  /**
   * 总 token 数
   */
  totalTokens?: number
}

/**
 * TokenAccountingContext - TokenAccountingSession 的初始化上下文
 */
export interface TokenAccountingContext {
  /**
   * 系统提示词
   */
  systemPrompt: string

  /**
   * 当前用户消息内容
   */
  userMessage: ContentBlock[]

  /**
   * API 对话历史
   */
  history: MessageParam[]
}

/**
 * TokenStats 的 Zod schema
 */
export const tokenStatsSchema = z.object({
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  cacheWriteTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  totalCost: z.number(),
  breakdown: z.object({
    systemPrompt: z.number().optional(),
    userMessage: z.number().optional(),
    conversationHistory: z.number().optional(),
    assistantOutput: z.number().optional(),
  }).optional(),
  tokenizerType: z.enum(["tiktoken", "api", "fallback"]).optional(),
})

export type TokenStatsSchema = z.infer<typeof tokenStatsSchema>
