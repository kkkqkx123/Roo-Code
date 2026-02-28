import { Tokenizer, TokenizerOptions } from "./Tokenizer"
import { ContentBlock } from "@coder/types"
import { TokenizerManager } from "../tiktoken"

/**
 * TiktokenTokenizer - 基于 tiktoken 库的 Tokenizer 实现
 * 
 * 使用 o200k_base 编码器，与现有实现保持一致。
 * 提供本地 token 计数功能，作为 API 提供方的回退方案。
 */
export class TiktokenTokenizer implements Tokenizer {
  readonly type = "tiktoken" as const

  private encoder: string
  private enableCache: boolean

  /**
   * 创建 TiktokenTokenizer 实例
   * 
   * @param options - Tokenizer 配置选项
   */
  constructor(options: TokenizerOptions = {}) {
    this.encoder = options.encoder || "o200k_base"
    this.enableCache = options.enableCache ?? true

    // 验证编码器是否支持
    if (this.encoder !== "o200k_base") {
      console.warn(`TiktokenTokenizer: encoder "${this.encoder}" may not be supported. Using o200k_base as fallback.`)
      this.encoder = "o200k_base"
    }
  }

  /**
   * 计算文本的 token 数量
   * 
   * @param text - 要计数的文本
   * @returns Token 数量
   */
  async countTokens(text: string): Promise<number> {
    if (!text || text.length === 0) {
      return 0
    }

    try {
      return TokenizerManager.countTokens(text)
    } catch (error) {
      console.error("TiktokenTokenizer.countTokens failed:", error)
      throw new Error(`Failed to count tokens: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 计算内容块数组的 token 数量
   * 
   * @param contentBlocks - 内容块数组
   * @returns Token 数量
   */
  async countContentBlocks(contentBlocks: ContentBlock[]): Promise<number> {
    if (!contentBlocks || contentBlocks.length === 0) {
      return 0
    }

    try {
      // 序列化内容块为文本并计数
      const serializedText = this.serializeContentBlocks(contentBlocks)
      return await this.countTokens(serializedText)
    } catch (error) {
      console.error("TiktokenTokenizer.countContentBlocks failed:", error)
      throw new Error(`Failed to count content blocks: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 对文本进行分词，返回 token ID 数组
   * 
   * @param text - 要分词的文本
   * @returns Token ID 数组
   */
  async encode(text: string): Promise<Uint32Array> {
    if (!text || text.length === 0) {
      return new Uint32Array(0)
    }

    try {
      return TokenizerManager.encode(text)
    } catch (error) {
      console.error("TiktokenTokenizer.encode failed:", error)
      throw new Error(`Failed to encode text: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 清理资源（如 WASM 内存）
   */
  dispose(): void {
    // TiktokenTokenizer 使用共享的 TokenizerManager，不需要单独清理
    // 如果需要强制清理，可以调用 TokenizerManager.dispose()
  }

  /**
   * 序列化内容块为文本（用于 token 计数）
   * 
   * @param contentBlocks - 内容块数组
   * @returns 序列化后的文本
   */
  private serializeContentBlocks(contentBlocks: ContentBlock[]): string {
    const parts: string[] = []

    for (const block of contentBlocks) {
      if (block.type === "text") {
        parts.push(block.text || "")
      } else if (block.type === "image") {
        // 图像内容使用占位符表示
        parts.push("[image content]")
      } else if (block.type === "tool_use") {
        // 工具调用序列化
        const toolUse = block as any
        const toolText = `Tool: ${toolUse.name || "unknown"}`
        const argsText = toolUse.input ? `Arguments: ${JSON.stringify(toolUse.input)}` : ""
        parts.push([toolText, argsText].filter(Boolean).join("\n"))
      } else if (block.type === "tool_result") {
        // 工具结果序列化
        const toolResult = block as any
        const resultText = `Tool Result (${toolResult.tool_use_id || "unknown"})`
        const contentText = this.serializeToolResultContent(toolResult.content)
        const errorText = toolResult.is_error ? "[Error]" : ""
        parts.push([resultText, errorText, contentText].filter(Boolean).join("\n"))
      } else {
        // 未知类型，使用 JSON 表示
        parts.push(`[${block.type}] ${JSON.stringify(block)}`)
      }
    }

    return parts.join("\n")
  }

  /**
   * 序列化工具结果内容
   * 
   * @param content - 工具结果内容
   * @returns 序列化后的文本
   */
  private serializeToolResultContent(content: unknown): string {
    if (typeof content === "string") {
      return content
    } else if (Array.isArray(content)) {
      // 递归处理内容块数组
      return content
        .map(item => {
          if (item && typeof item === "object" && "type" in item) {
            const block = item as ContentBlock
            if (block.type === "text") {
              return (block as any).text || ""
            } else if (block.type === "image") {
              return "[image content]"
            }
          }
          return String(item)
        })
        .filter(Boolean)
        .join("\n")
    } else {
      return String(content)
    }
  }

  /**
   * 获取编码器信息
   * 
   * @returns 编码器名称和状态
   */
  getEncoderInfo(): { encoder: string; isInitialized: boolean } {
    return {
      encoder: this.encoder,
      isInitialized: TokenizerManager.hasInstance()
    }
  }

  /**
   * 批量计数多个文本的 token 数量（性能优化）
   * 
   * @param texts - 文本数组
   * @returns 每个文本的 token 数量数组
   */
  async batchCountTokens(texts: string[]): Promise<number[]> {
    if (!texts || texts.length === 0) {
      return []
    }

    const results: number[] = []
    for (const text of texts) {
      results.push(await this.countTokens(text))
    }
    return results
  }

  /**
   * 验证文本是否可以被正确分词
   * 
   * @param text - 要验证的文本
   * @returns 验证结果
   */
  async validateText(text: string): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.encode(text)
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}