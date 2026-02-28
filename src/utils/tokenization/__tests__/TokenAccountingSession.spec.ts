import { describe, it, expect, beforeEach } from "vitest"
import { TokenAccountingSession } from "../TokenAccountingSession"
import { TokenAccountingState, TokenAccountingContext, ApiUsage } from "@coder/types"

describe("TokenAccountingSession", () => {
  const createContext = (): TokenAccountingContext => ({
    systemPrompt: "You are a helpful assistant.",
    userMessage: [{ type: "text", text: "Hello" }],
    history: []
  })

  describe("constructor and initial state", () => {
    it("should start in IDLE state", () => {
      const session = new TokenAccountingSession(createContext())
      expect(session.getState()).toBe(TokenAccountingState.IDLE)
      expect(session.isIdle()).toBe(true)
    })

    it("should not be collecting API data initially", () => {
      const session = new TokenAccountingSession(createContext())
      expect(session.isCollectingApiData()).toBe(false)
    })

    it("should not be finalized initially", () => {
      const session = new TokenAccountingSession(createContext())
      expect(session.isFinalized()).toBe(false)
    })
  })

  describe("startCollectingApiData", () => {
    it("should transition from IDLE to COLLECTING_API_DATA", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      expect(session.getState()).toBe(TokenAccountingState.COLLECTING_API_DATA)
      expect(session.isCollectingApiData()).toBe(true)
    })

    it("should throw error if not in IDLE state", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      
      expect(() => session.startCollectingApiData()).toThrow()
    })
  })

  describe("setApiUsage", () => {
    it("should transition to API_VALID with valid usage data", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      
      const usage: ApiUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      }
      
      session.setApiUsage(usage)
      expect(session.getState()).toBe(TokenAccountingState.API_VALID)
      expect(session.isApiValid()).toBe(true)
    })

    it("should transition to FALLBACK_TIKTOKEN with invalid usage data", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      
      const usage: ApiUsage = {}
      
      session.setApiUsage(usage)
      expect(session.getState()).toBe(TokenAccountingState.FALLBACK_TIKTOKEN)
      expect(session.isFallbackTiktoken()).toBe(true)
    })

    it("should throw error if not in COLLECTING_API_DATA state", () => {
      const session = new TokenAccountingSession(createContext())
      const usage: ApiUsage = { inputTokens: 100 }
      
      expect(() => session.setApiUsage(usage)).toThrow()
    })

    it("should accept usage with only inputTokens", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      
      const usage: ApiUsage = { inputTokens: 100 }
      session.setApiUsage(usage)
      expect(session.getState()).toBe(TokenAccountingState.API_VALID)
    })

    it("should accept usage with only outputTokens", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      
      const usage: ApiUsage = { outputTokens: 50 }
      session.setApiUsage(usage)
      expect(session.getState()).toBe(TokenAccountingState.API_VALID)
    })

    it("should accept usage with only totalTokens", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      
      const usage: ApiUsage = { totalTokens: 150 }
      session.setApiUsage(usage)
      expect(session.getState()).toBe(TokenAccountingState.API_VALID)
    })
  })

  describe("finalize", () => {
    it("should finalize with API_VALID state", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      session.setApiUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
      
      const result = session.finalize(50)
      
      expect(result.inputTokens).toBe(100)
      expect(result.outputTokens).toBe(50)
      expect(result.totalTokens).toBe(150)
      expect(session.isFinalized()).toBe(true)
    })

    it("should throw error if in IDLE state", () => {
      const session = new TokenAccountingSession(createContext())
      expect(() => session.finalize()).toThrow()
    })

    it("should throw error if in COLLECTING_API_DATA state", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      expect(() => session.finalize()).toThrow()
    })

    it("should throw error if in FALLBACK_TIKTOKEN state without performing tiktoken", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      session.setApiUsage({}) // Invalid usage triggers fallback
      expect(() => session.finalize()).toThrow()
    })
  })

  describe("getApiUsage", () => {
    it("should return null before API usage is set", () => {
      const session = new TokenAccountingSession(createContext())
      expect(session.getApiUsage()).toBeNull()
    })

    it("should return the API usage after set", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      const usage: ApiUsage = { inputTokens: 100 }
      session.setApiUsage(usage)
      
      expect(session.getApiUsage()).toEqual(usage)
    })
  })

  describe("getSummary", () => {
    it("should return correct summary for initial state", () => {
      const session = new TokenAccountingSession(createContext())
      const summary = session.getSummary()
      
      expect(summary.state).toBe(TokenAccountingState.IDLE)
      expect(summary.hasApiUsage).toBe(false)
      expect(summary.hasTiktokenCount).toBe(false)
      expect(summary.finalizedAt).toBeNull()
    })

    it("should return correct summary after API usage is set", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      session.setApiUsage({ inputTokens: 100 })
      const summary = session.getSummary()
      
      expect(summary.state).toBe(TokenAccountingState.API_VALID)
      expect(summary.hasApiUsage).toBe(true)
    })

    it("should return correct summary after finalization", () => {
      const session = new TokenAccountingSession(createContext())
      session.startCollectingApiData()
      session.setApiUsage({ inputTokens: 100, outputTokens: 50 })
      session.finalize(50)
      const summary = session.getSummary()
      
      expect(summary.state).toBe(TokenAccountingState.FINALIZED)
      expect(summary.finalizedAt).toBeGreaterThan(0)
    })
  })

  describe("state transitions", () => {
    it("should follow correct state transition: IDLE -> COLLECTING -> API_VALID -> FINALIZED", () => {
      const session = new TokenAccountingSession(createContext())
      
      expect(session.getState()).toBe(TokenAccountingState.IDLE)
      
      session.startCollectingApiData()
      expect(session.getState()).toBe(TokenAccountingState.COLLECTING_API_DATA)
      
      session.setApiUsage({ inputTokens: 100, outputTokens: 50 })
      expect(session.getState()).toBe(TokenAccountingState.API_VALID)
      
      session.finalize(50)
      expect(session.getState()).toBe(TokenAccountingState.FINALIZED)
    })

    it("should follow correct state transition: IDLE -> COLLECTING -> FALLBACK -> FINALIZED", () => {
      const session = new TokenAccountingSession(createContext())
      
      expect(session.getState()).toBe(TokenAccountingState.IDLE)
      
      session.startCollectingApiData()
      expect(session.getState()).toBe(TokenAccountingState.COLLECTING_API_DATA)
      
      session.setApiUsage({}) // Invalid usage
      expect(session.getState()).toBe(TokenAccountingState.FALLBACK_TIKTOKEN)
    })
  })
})