import { ContentBlock } from "@coder/types"

/**
 * Tokenizer - Token 分词器接口
 * 
 * 定义统一的 token 计数接口，支持不同的实现策略：
 * - TiktokenTokenizer: 使用 tiktoken 库进行本地分词
 * - ProviderTokenizer: 使用 API 提供方的分词服务
 * 
 * 设计目标：
 * - 统一接口，屏蔽底层实现差异
 * - 支持流式计数和批量计数
 * - 易于测试和 mock
 */
export interface Tokenizer {
  /**
   * Tokenizer 类型标识
   */
  readonly type: "tiktoken" | "provider" | "fallback"

  /**
   * 计算文本的 token 数量
   * 
   * @param text - 要计数的文本
   * @returns Token 数量
   */
  countTokens(text: string): Promise<number>

  /**
   * 计算内容块数组的 token 数量
   * 
   * @param contentBlocks - 内容块数组
   * @returns Token 数量
   */
  countContentBlocks(contentBlocks: ContentBlock[]): Promise<number>

  /**
   * 对文本进行分词，返回 token ID 数组
   * 
   * @param text - 要分词的文本
   * @returns Token ID 数组
   */
  encode(text: string): Promise<Uint32Array>

  /**
   * 清理资源（如 WASM 内存）
   */
  dispose(): void
}

/**
 * Tokenizer 配置选项
 */
export interface TokenizerOptions {
  /**
   * 编码器名称（如 o200k_base）
   */
  encoder?: string

  /**
   * 是否启用缓存
   */
  enableCache?: boolean
}