import { describe, it, expect } from "vitest"
import { TokenContextBuilder } from "../TokenContextBuilder"
import { ContentBlock, MessageParam } from "@coder/types"

describe("TokenContextBuilder", () => {
  describe("buildContext", () => {
    it("should build a complete TokenContext", () => {
      const systemPrompt = "You are a helpful assistant."
      const userMessage: ContentBlock[] = [{ type: "text", text: "Hello" }]
      const history: MessageParam[] = [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello! How can I help?" }
      ]

      const context = TokenContextBuilder.buildContext(systemPrompt, userMessage, history)

      expect(context.systemPrompt).toEqual([{ type: "text", text: systemPrompt }])
      expect(context.currentUserMessage).toEqual(userMessage)
      expect(context.conversationHistory).toEqual(history)
      expect(context.assistantOutput).toBeUndefined()
    })

    it("should handle empty system prompt", () => {
      const userMessage: ContentBlock[] = [{ type: "text", text: "Hello" }]
      const history: MessageParam[] = []

      const context = TokenContextBuilder.buildContext("", userMessage, history)

      expect(context.systemPrompt).toEqual([])
    })

    it("should include assistant output when provided", () => {
      const systemPrompt = "You are helpful."
      const userMessage: ContentBlock[] = [{ type: "text", text: "Hi" }]
      const history: MessageParam[] = []
      const assistantOutput: ContentBlock[] = [{ type: "text", text: "Hello!" }]

      const context = TokenContextBuilder.buildContext(
        systemPrompt,
        userMessage,
        history,
        assistantOutput
      )

      expect(context.assistantOutput).toEqual(assistantOutput)
    })
  })

  describe("buildUserMessageFromText", () => {
    it("should convert text to ContentBlock array", () => {
      const text = "Hello, world!"
      const result = TokenContextBuilder.buildUserMessageFromText(text)

      expect(result).toEqual([{ type: "text", text }])
    })

    it("should return empty array for empty string", () => {
      const result = TokenContextBuilder.buildUserMessageFromText("")
      expect(result).toEqual([])
    })
  })

  describe("buildConversationHistoryFromTexts", () => {
    it("should convert text messages to MessageParam array", () => {
      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" }
      ]

      const result = TokenContextBuilder.buildConversationHistoryFromTexts(messages)

      expect(result).toEqual(messages)
    })

    it("should handle empty array", () => {
      const result = TokenContextBuilder.buildConversationHistoryFromTexts([])
      expect(result).toEqual([])
    })
  })

  describe("serializeContentBlocks", () => {
    it("should serialize text blocks", () => {
      const blocks: ContentBlock[] = [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" }
      ]

      const result = TokenContextBuilder.serializeContentBlocks(blocks)

      expect(result).toContain("[text] Hello")
      expect(result).toContain("[text] World")
    })

    it("should serialize image blocks", () => {
      const blocks: ContentBlock[] = [
        { type: "image", source: { type: "base64", data: "abc123" } }
      ]

      const result = TokenContextBuilder.serializeContentBlocks(blocks)

      expect(result).toContain("[image]")
    })

    it("should handle empty array", () => {
      const result = TokenContextBuilder.serializeContentBlocks([])
      expect(result).toBe("")
    })
  })

  describe("serializeMessageParam", () => {
    it("should serialize message with string content", () => {
      const message: MessageParam = { role: "user", content: "Hello" }
      const result = TokenContextBuilder.serializeMessageParam(message)

      expect(result).toBe("[user] Hello")
    })

    it("should serialize message with ContentBlock array", () => {
      const message: MessageParam = {
        role: "assistant",
        content: [{ type: "text", text: "Hi there!" }]
      }
      const result = TokenContextBuilder.serializeMessageParam(message)

      expect(result).toContain("[assistant]")
      expect(result).toContain("[text] Hi there!")
    })
  })

  describe("validateContext", () => {
    it("should validate a correct context", () => {
      const context = TokenContextBuilder.buildContext(
        "System prompt",
        [{ type: "text", text: "Hello" }],
        [{ role: "user", content: "Hi" }]
      )

      const result = TokenContextBuilder.validateContext(context)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it("should reject context with missing systemPrompt", () => {
      const context: any = {
        currentUserMessage: [{ type: "text", text: "Hello" }],
        conversationHistory: []
      }

      const result = TokenContextBuilder.validateContext(context)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("systemPrompt")
    })

    it("should reject context with invalid role", () => {
      const context = TokenContextBuilder.buildContext(
        "System",
        [{ type: "text", text: "Hello" }],
        [{ role: "invalid" as any, content: "Hi" }]
      )

      const result = TokenContextBuilder.validateContext(context)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Invalid role")
    })

    it("should reject context with empty message content", () => {
      const context = TokenContextBuilder.buildContext(
        "System",
        [{ type: "text", text: "Hello" }],
        [{ role: "user", content: "" }]
      )

      const result = TokenContextBuilder.validateContext(context)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("cannot be empty")
    })
  })

  describe("getContextSummary", () => {
    it("should return correct summary", () => {
      const context = TokenContextBuilder.buildContext(
        "System prompt",
        [{ type: "text", text: "Hello" }, { type: "text", text: "World" }],
        [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" }
        ],
        [{ type: "text", text: "Response" }]
      )

      const summary = TokenContextBuilder.getContextSummary(context)

      expect(summary.systemPromptBlocks).toBe(1)
      expect(summary.userMessageBlocks).toBe(2)
      expect(summary.conversationHistoryMessages).toBe(2)
      expect(summary.assistantOutputBlocks).toBe(1)
    })

    it("should handle context without assistant output", () => {
      const context = TokenContextBuilder.buildContext(
        "System",
        [{ type: "text", text: "Hello" }],
        []
      )

      const summary = TokenContextBuilder.getContextSummary(context)

      expect(summary.assistantOutputBlocks).toBeUndefined()
    })
  })
})