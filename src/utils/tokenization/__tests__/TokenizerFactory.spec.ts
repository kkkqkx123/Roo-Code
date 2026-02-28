import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { TokenizerFactory } from "../TokenizerFactory"
import { TiktokenTokenizer } from "../TiktokenTokenizer"

describe("TokenizerFactory", () => {
  beforeEach(() => {
    // Clear cache before each test
    TokenizerFactory.clearCache()
  })

  afterEach(() => {
    // Clean up after tests
    TokenizerFactory.clearCache()
  })

  describe("createTokenizer", () => {
    it("should create a tiktoken tokenizer by default", () => {
      const tokenizer = TokenizerFactory.createTokenizer()
      expect(tokenizer).toBeInstanceOf(TiktokenTokenizer)
      expect(tokenizer.type).toBe("tiktoken")
    })

    it("should create a tiktoken tokenizer when explicitly requested", () => {
      const tokenizer = TokenizerFactory.createTokenizer("tiktoken")
      expect(tokenizer).toBeInstanceOf(TiktokenTokenizer)
      expect(tokenizer.type).toBe("tiktoken")
    })

    it("should create a provider tokenizer (uses tiktoken implementation)", () => {
      const tokenizer = TokenizerFactory.createTokenizer("provider")
      expect(tokenizer).toBeInstanceOf(TiktokenTokenizer)
      expect(tokenizer.type).toBe("tiktoken")
    })

    it("should create a fallback tokenizer (uses tiktoken implementation)", () => {
      const tokenizer = TokenizerFactory.createTokenizer("fallback")
      expect(tokenizer).toBeInstanceOf(TiktokenTokenizer)
      expect(tokenizer.type).toBe("tiktoken")
    })
  })

  describe("createTiktokenTokenizer", () => {
    it("should create a new TiktokenTokenizer instance", () => {
      const tokenizer = TokenizerFactory.createTiktokenTokenizer()
      expect(tokenizer).toBeInstanceOf(TiktokenTokenizer)
    })

    it("should cache tokenizer instances by default", () => {
      const tokenizer1 = TokenizerFactory.createTiktokenTokenizer()
      const tokenizer2 = TokenizerFactory.createTiktokenTokenizer()
      
      expect(tokenizer1).toBe(tokenizer2)
      expect(TokenizerFactory.getCacheSize()).toBe(1)
    })

    it("should respect enableCache option", () => {
      const tokenizer1 = TokenizerFactory.createTiktokenTokenizer({ enableCache: false })
      const tokenizer2 = TokenizerFactory.createTiktokenTokenizer({ enableCache: false })
      
      expect(tokenizer1).not.toBe(tokenizer2)
    })

    it("should use encoder option in cache key", () => {
      const tokenizer1 = TokenizerFactory.createTiktokenTokenizer({ encoder: "o200k_base" })
      const tokenizer2 = TokenizerFactory.createTiktokenTokenizer({ encoder: "custom_encoder" })
      
      expect(tokenizer1).not.toBe(tokenizer2)
      expect(TokenizerFactory.getCacheSize()).toBe(2)
    })
  })

  describe("getDefaultTokenizer", () => {
    it("should return a cached tiktoken tokenizer with default options", () => {
      const tokenizer = TokenizerFactory.getDefaultTokenizer()
      expect(tokenizer).toBeInstanceOf(TiktokenTokenizer)
      expect(tokenizer.type).toBe("tiktoken")
    })

    it("should return the same instance on multiple calls", () => {
      const tokenizer1 = TokenizerFactory.getDefaultTokenizer()
      const tokenizer2 = TokenizerFactory.getDefaultTokenizer()
      
      expect(tokenizer1).toBe(tokenizer2)
    })
  })

  describe("clearCache", () => {
    it("should clear all cached tokenizers", () => {
      TokenizerFactory.createTokenizer("tiktoken")
      TokenizerFactory.createTokenizer("provider")
      
      expect(TokenizerFactory.getCacheSize()).toBe(2)
      
      TokenizerFactory.clearCache()
      expect(TokenizerFactory.getCacheSize()).toBe(0)
    })

    it("should clear specific tokenizer type", () => {
      TokenizerFactory.createTokenizer("tiktoken")
      TokenizerFactory.createTokenizer("provider")
      TokenizerFactory.createTokenizer("fallback")
      
      expect(TokenizerFactory.getCacheSize()).toBe(3)
      
      TokenizerFactory.clearCache("tiktoken")
      expect(TokenizerFactory.getCacheSize()).toBe(2)
    })
  })

  describe("isCached", () => {
    it("should return true for cached tokenizer", () => {
      TokenizerFactory.createTokenizer("tiktoken")
      
      expect(TokenizerFactory.isCached("tiktoken")).toBe(true)
    })

    it("should return false for non-cached tokenizer", () => {
      expect(TokenizerFactory.isCached("tiktoken")).toBe(false)
    })

    it("should consider encoder in cache check", () => {
      TokenizerFactory.createTokenizer("tiktoken", { encoder: "o200k_base" })
      
      expect(TokenizerFactory.isCached("tiktoken", { encoder: "o200k_base" })).toBe(true)
      expect(TokenizerFactory.isCached("tiktoken", { encoder: "custom" })).toBe(false)
    })
  })

  describe("getCacheSize", () => {
    it("should return 0 for empty cache", () => {
      expect(TokenizerFactory.getCacheSize()).toBe(0)
    })

    it("should return correct count after adding tokenizers", () => {
      TokenizerFactory.createTokenizer("tiktoken")
      expect(TokenizerFactory.getCacheSize()).toBe(1)
      
      TokenizerFactory.createTokenizer("provider")
      expect(TokenizerFactory.getCacheSize()).toBe(2)
    })
  })
})