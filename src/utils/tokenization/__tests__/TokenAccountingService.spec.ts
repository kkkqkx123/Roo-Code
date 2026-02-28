import { describe, it, expect, beforeEach } from "vitest"
import { TokenAccountingService } from "../TokenAccountingService"
import { TokenAccountingState, TokenAccountingContext } from "@coder/types"

describe("TokenAccountingService", () => {
  const createContext = (): TokenAccountingContext => ({
    systemPrompt: "You are a helpful assistant.",
    userMessage: [{ type: "text", text: "Hello" }],
    history: []
  })

  let service: TokenAccountingService

  beforeEach(() => {
    service = new TokenAccountingService()
  })

  describe("constructor", () => {
    it("should create service with default tokenizer", () => {
      expect(service).toBeInstanceOf(TokenAccountingService)
      expect(service.getSessionCount()).toBe(0)
    })
  })

  describe("createSession", () => {
    it("should create a new session", () => {
      const sessionId = "test-session-1"
      const context = createContext()
      
      const session = service.createSession(sessionId, context)
      
      expect(session).toBeDefined()
      expect(service.hasSession(sessionId)).toBe(true)
      expect(service.getSessionCount()).toBe(1)
    })

    it("should throw error for duplicate session ID", () => {
      const sessionId = "test-session-1"
      const context = createContext()
      
      service.createSession(sessionId, context)
      
      expect(() => service.createSession(sessionId, context)).toThrow()
    })

    it("should return the same session on getSession", () => {
      const sessionId = "test-session-1"
      const context = createContext()
      
      const created = service.createSession(sessionId, context)
      const retrieved = service.getSession(sessionId)
      
      expect(retrieved).toBe(created)
    })

    it("should return undefined for non-existent session", () => {
      const session = service.getSession("non-existent")
      expect(session).toBeUndefined()
    })
  })

  describe("removeSession", () => {
    it("should remove an existing session", () => {
      const sessionId = "test-session-1"
      service.createSession(sessionId, createContext())
      
      const removed = service.removeSession(sessionId)
      
      expect(removed).toBe(true)
      expect(service.hasSession(sessionId)).toBe(false)
      expect(service.getSessionCount()).toBe(0)
    })

    it("should return false for non-existent session", () => {
      const removed = service.removeSession("non-existent")
      expect(removed).toBe(false)
    })
  })

  describe("finalizeSession", () => {
    it("should finalize a session and update totals", () => {
      const sessionId = "test-session-1"
      service.createSession(sessionId, createContext())
      const session = service.getSession(sessionId)!
      
      session.startCollectingApiData()
      session.setApiUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
      
      const result = service.finalizeSession(sessionId, 50, 0.001)
      
      expect(result.inputTokens).toBe(100)
      expect(result.outputTokens).toBe(50)
      expect(result.totalTokens).toBe(150)
      
      const totals = service.getTotalStats()
      expect(totals.totalInputTokens).toBe(100)
      expect(totals.totalOutputTokens).toBe(50)
      expect(totals.totalCost).toBe(0.001)
    })

    it("should throw error for non-existent session", () => {
      expect(() => service.finalizeSession("non-existent")).toThrow()
    })
  })

  describe("getTotalStats", () => {
    it("should return zero stats initially", () => {
      const stats = service.getTotalStats()
      
      expect(stats.totalInputTokens).toBe(0)
      expect(stats.totalOutputTokens).toBe(0)
      expect(stats.totalCost).toBe(0)
    })

    it("should aggregate stats from multiple sessions", () => {
      // Session 1
      const session1 = service.createSession("session-1", createContext())
      session1.startCollectingApiData()
      session1.setApiUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
      service.finalizeSession("session-1", 50, 0.001)
      
      // Session 2
      const session2 = service.createSession("session-2", createContext())
      session2.startCollectingApiData()
      session2.setApiUsage({ inputTokens: 200, outputTokens: 100, totalTokens: 300 })
      service.finalizeSession("session-2", 100, 0.002)
      
      const totals = service.getTotalStats()
      
      expect(totals.totalInputTokens).toBe(300)
      expect(totals.totalOutputTokens).toBe(150)
      expect(totals.totalCost).toBe(0.003)
    })
  })

  describe("resetTotals", () => {
    it("should reset all totals to zero", () => {
      const session = service.createSession("session-1", createContext())
      session.startCollectingApiData()
      session.setApiUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
      service.finalizeSession("session-1", 50, 0.001)
      
      service.resetTotals()
      
      const stats = service.getTotalStats()
      expect(stats.totalInputTokens).toBe(0)
      expect(stats.totalOutputTokens).toBe(0)
      expect(stats.totalCost).toBe(0)
    })

    it("should not affect sessions", () => {
      const session = service.createSession("session-1", createContext())
      session.startCollectingApiData()
      
      service.resetTotals()
      
      expect(service.hasSession("session-1")).toBe(true)
      expect(session.getState()).toBe(TokenAccountingState.COLLECTING_API_DATA)
    })
  })

  describe("getSessionsSummary", () => {
    it("should return empty array when no sessions", () => {
      const summary = service.getSessionsSummary()
      expect(summary).toEqual([])
    })

    it("should return summary for all sessions", () => {
      service.createSession("session-1", createContext())
      service.createSession("session-2", createContext())
      
      const summary = service.getSessionsSummary()
      
      expect(summary.length).toBe(2)
      expect(summary.map(s => s.sessionId)).toContain("session-1")
      expect(summary.map(s => s.sessionId)).toContain("session-2")
    })
  })

  describe("getFinalizedSessionCount", () => {
    it("should return 0 initially", () => {
      expect(service.getFinalizedSessionCount()).toBe(0)
    })

    it("should count finalized sessions", () => {
      const session1 = service.createSession("session-1", createContext())
      session1.startCollectingApiData()
      session1.setApiUsage({ inputTokens: 100 })
      service.finalizeSession("session-1", 50)
      
      service.createSession("session-2", createContext())
      
      expect(service.getFinalizedSessionCount()).toBe(1)
    })
  })

  describe("static helper methods", () => {
    describe("buildContext", () => {
      it("should build a TokenAccountingContext", () => {
        const context = TokenAccountingService.buildContext(
          "System prompt",
          [{ type: "text", text: "Hello" }],
          [{ role: "user", content: "Hi" }]
        )
        
        expect(context.systemPrompt).toBe("System prompt")
        expect(context.userMessage).toEqual([{ type: "text", text: "Hello" }])
        expect(context.history).toEqual([{ role: "user", content: "Hi" }])
      })
    })

    describe("buildUserMessageFromText", () => {
      it("should build user message from text", () => {
        const message = TokenAccountingService.buildUserMessageFromText("Hello")
        expect(message).toEqual([{ type: "text", text: "Hello" }])
      })
    })

    describe("buildHistoryFromTexts", () => {
      it("should build history from texts", () => {
        const history = TokenAccountingService.buildHistoryFromTexts([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" }
        ])
        
        expect(history).toEqual([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" }
        ])
      })
    })
  })

  describe("dispose", () => {
    it("should dispose all sessions and clear cache", () => {
      service.createSession("session-1", createContext())
      service.createSession("session-2", createContext())
      
      service.dispose()
      
      expect(service.getSessionCount()).toBe(0)
    })
  })
})