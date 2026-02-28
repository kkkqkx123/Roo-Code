import { Tokenizer, TokenizerOptions } from "./Tokenizer"
import { TiktokenTokenizer } from "./TiktokenTokenizer"

/**
 * TokenizerFactory - Tokenizer 工厂类
 * 
 * 负责创建和管理 Tokenizer 实例。
 * 根据配置返回合适的 Tokenizer 实现。
 * 
 * 设计目标：
 * - 集中管理 Tokenizer 的创建逻辑
 * - 支持缓存和复用 Tokenizer 实例
 * - 易于扩展新的 Tokenizer 实现
 */
export class TokenizerFactory {
  private static instanceCache: Map<string, Tokenizer> = new Map()

  /**
   * 创建 Tokenizer 实例
   * 
   * @param type - Tokenizer 类型
   * @param options - Tokenizer 配置选项
   * @returns Tokenizer 实例
   */
  static createTokenizer(
    type: "tiktoken" | "provider" | "fallback" = "tiktoken",
    options: TokenizerOptions = {}
  ): Tokenizer {
    // 构建缓存键，包含类型信息
    const cacheKey = `${type}:${options.encoder || "o200k_base"}`

    // 如果启用了缓存且实例已存在，则返回缓存实例
    if (options.enableCache ?? true) {
      const cached = TokenizerFactory.instanceCache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    let tokenizer: Tokenizer

    switch (type) {
      case "tiktoken":
        tokenizer = TokenizerFactory.createTiktokenTokenizer(options)
        break
      case "provider":
        // 目前 provider 类型也使用 tiktoken 作为实现
        // 未来可以扩展为使用 API 提供方的原生计数
        tokenizer = TokenizerFactory.createTiktokenTokenizer(options)
        break
      case "fallback":
        // fallback 类型使用 tiktoken 作为回退方案
        tokenizer = TokenizerFactory.createTiktokenTokenizer(options)
        break
      default:
        // 默认使用 tiktoken
        tokenizer = TokenizerFactory.createTiktokenTokenizer(options)
        break
    }

    // 缓存实例
    if (options.enableCache ?? true) {
      TokenizerFactory.instanceCache.set(cacheKey, tokenizer)
    }

    return tokenizer
  }

  /**
   * 创建 TiktokenTokenizer 实例
   * 
   * @param options - Tokenizer 配置选项
   * @returns TiktokenTokenizer 实例
   */
  static createTiktokenTokenizer(options: TokenizerOptions = {}): TiktokenTokenizer {
    const cacheKey = `tiktoken:${options.encoder || "o200k_base"}`

    // 如果启用了缓存且实例已存在，则返回缓存实例
    if (options.enableCache ?? true) {
      const cached = TokenizerFactory.instanceCache.get(cacheKey)
      if (cached) {
        return cached as TiktokenTokenizer
      }
    }

    const tokenizer = new TiktokenTokenizer(options)

    // 缓存实例
    if (options.enableCache ?? true) {
      TokenizerFactory.instanceCache.set(cacheKey, tokenizer)
    }

    return tokenizer
  }

  /**
   * 获取或创建默认 Tokenizer
   * 
   * @returns 默认 Tokenizer 实例
   */
  static getDefaultTokenizer(): Tokenizer {
    return TokenizerFactory.createTokenizer("tiktoken", {
      encoder: "o200k_base",
      enableCache: true
    })
  }

  /**
   * 清理缓存的 Tokenizer 实例
   * 
   * @param type - 要清理的 Tokenizer 类型，不传则清理所有
   */
  static clearCache(type?: "tiktoken" | "provider" | "fallback"): void {
    if (!type) {
      // 清理所有缓存
      for (const tokenizer of TokenizerFactory.instanceCache.values()) {
        tokenizer.dispose()
      }
      TokenizerFactory.instanceCache.clear()
    } else {
      // 清理指定类型的缓存
      const prefix = `${type}:`
      for (const [key, tokenizer] of TokenizerFactory.instanceCache.entries()) {
        if (key.startsWith(prefix)) {
          tokenizer.dispose()
          TokenizerFactory.instanceCache.delete(key)
        }
      }
    }
  }

  /**
   * 获取缓存的 Tokenizer 实例数量
   * 
   * @returns 缓存数量
   */
  static getCacheSize(): number {
    return TokenizerFactory.instanceCache.size
  }

  /**
   * 检查指定配置的 Tokenizer 是否已缓存
   * 
   * @param type - Tokenizer 类型
   * @param options - Tokenizer 配置选项
   * @returns 是否已缓存
   */
  static isCached(
    type: "tiktoken" | "provider" | "fallback",
    options: TokenizerOptions = {}
  ): boolean {
    const cacheKey = `${type}:${options.encoder || "o200k_base"}`
    return TokenizerFactory.instanceCache.has(cacheKey)
  }
}