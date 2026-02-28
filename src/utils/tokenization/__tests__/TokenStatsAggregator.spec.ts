import { describe, it, expect, beforeEach } from "vitest"
import { TokenStatsAggregator } from "../TokenStatsAggregator"
import { TokenStats } from "@coder/types"

describe("TokenStatsAggregator", () => {
  let aggregator: TokenStatsAggregator

  const createStats = (
    inputTokens: number,
    outputTokens: number,
    cost: number = 0.001
  ): TokenStats => ({
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalCost: cost,
    breakdown: {
      systemPrompt: 10,
      userMessage: 20,
      conversationHistory: 30,
      assistantOutput: 40
    }
  })

  beforeEach(() => {
    aggregator = new TokenStatsAggregator()
  })

  describe("addStats", () => {
    it("should add a single stats entry", () => {
      const stats = createStats(100, 50)
      aggregator.addStats(stats)
      
      expect(aggregator.getHistoryCount()).toBe(1)
    })

    it("should invalidate cached aggregated stats", () => {
      aggregator.addStats(createStats(100, 50))
      aggregator.getAggregatedStats() // Cache the result
      
      aggregator.addStats(createStats(200, 100))
      
      const aggregated = aggregator.getAggregatedStats()
      expect(aggregated.totalInputTokens).toBe(300)
      expect(aggregated.totalOutputTokens).toBe(150)
    })
  })

  describe("addStatsBatch", () => {
    it("should add multiple stats entries", () => {
      const statsArray = [
        createStats(100, 50),
        createStats(200, 100),
        createStats(300, 150)
      ]
      
      aggregator.addStatsBatch(statsArray)
      
      expect(aggregator.getHistoryCount()).toBe(3)
    })

    it("should handle empty array", () => {
      aggregator.addStatsBatch([])
      expect(aggregator.getHistoryCount()).toBe(0)
    })
  })

  describe("recordSession", () => {
    it("should record a session stats", () => {
      const stats = createStats(100, 50)
      aggregator.recordSession(stats)
      
      expect(aggregator.getHistoryCount()).toBe(1)
    })
  })

  describe("getAggregatedStats", () => {
    it("should return empty stats when no data", () => {
      const stats = aggregator.getAggregatedStats()
      
      expect(stats.totalInputTokens).toBe(0)
      expect(stats.totalOutputTokens).toBe(0)
      expect(stats.totalCost).toBe(0)
    })

    it("should aggregate stats from multiple entries", () => {
      aggregator.addStats(createStats(100, 50, 0.001))
      aggregator.addStats(createStats(200, 100, 0.002))
      
      const aggregated = aggregator.getAggregatedStats()
      
      expect(aggregated.totalInputTokens).toBe(300)
      expect(aggregated.totalOutputTokens).toBe(150)
      expect(aggregated.totalCost).toBe(0.003)
    })

    it("should aggregate breakdown data", () => {
      aggregator.addStats(createStats(100, 50, 0.001))
      aggregator.addStats(createStats(100, 50, 0.001))
      
      const aggregated = aggregator.getAggregatedStats()
      
      expect(aggregated.breakdown?.systemPrompt).toBe(20)
      expect(aggregated.breakdown?.userMessage).toBe(40)
      expect(aggregated.breakdown?.conversationHistory).toBe(60)
      expect(aggregated.breakdown?.assistantOutput).toBe(80)
    })

    it("should cache the result", () => {
      aggregator.addStats(createStats(100, 50))
      const result1 = aggregator.getAggregatedStats()
      const result2 = aggregator.getAggregatedStats()
      
      expect(result1).toBe(result2) // Same reference
    })
  })

  describe("getAverageStats", () => {
    it("should return empty stats when no data", () => {
      const stats = aggregator.getAverageStats()
      
      expect(stats.totalInputTokens).toBe(0)
      expect(stats.totalOutputTokens).toBe(0)
    })

    it("should calculate average from multiple entries", () => {
      aggregator.addStats(createStats(100, 50, 0.001))
      aggregator.addStats(createStats(200, 100, 0.002))
      
      const average = aggregator.getAverageStats()
      
      expect(average.totalInputTokens).toBe(150)
      expect(average.totalOutputTokens).toBe(75)
      expect(average.totalCost).toBe(0.0015)
    })

    it("should round average values", () => {
      aggregator.addStats(createStats(100, 50))
      aggregator.addStats(createStats(101, 51))
      aggregator.addStats(createStats(102, 52))
      
      const average = aggregator.getAverageStats()
      
      expect(average.totalInputTokens).toBe(101)
      expect(average.totalOutputTokens).toBe(51)
    })
  })

  describe("getHistory", () => {
    it("should return empty array when no data", () => {
      const history = aggregator.getHistory()
      expect(history).toEqual([])
    })

    it("should return all history entries", () => {
      const stats1 = createStats(100, 50)
      const stats2 = createStats(200, 100)
      
      aggregator.addStats(stats1)
      aggregator.addStats(stats2)
      
      const history = aggregator.getHistory()
      
      expect(history.length).toBe(2)
      expect(history[0]).toBe(stats1)
      expect(history[1]).toBe(stats2)
    })

    it("should return a copy, not the original array", () => {
      aggregator.addStats(createStats(100, 50))
      
      const history1 = aggregator.getHistory()
      const history2 = aggregator.getHistory()
      
      expect(history1).not.toBe(history2)
    })
  })

  describe("getLatest", () => {
    it("should return empty array when n <= 0", () => {
      aggregator.addStats(createStats(100, 50))
      
      expect(aggregator.getLatest(0)).toEqual([])
      expect(aggregator.getLatest(-1)).toEqual([])
    })

    it("should return the latest N entries", () => {
      aggregator.addStats(createStats(100, 50))
      aggregator.addStats(createStats(200, 100))
      aggregator.addStats(createStats(300, 150))
      
      const latest2 = aggregator.getLatest(2)
      
      expect(latest2.length).toBe(2)
      expect(latest2[0].totalInputTokens).toBe(200)
      expect(latest2[1].totalInputTokens).toBe(300)
    })

    it("should return all entries when n > count", () => {
      aggregator.addStats(createStats(100, 50))
      aggregator.addStats(createStats(200, 100))
      
      const latest10 = aggregator.getLatest(10)
      
      expect(latest10.length).toBe(2)
    })
  })

  describe("clearHistory", () => {
    it("should clear all history", () => {
      aggregator.addStats(createStats(100, 50))
      aggregator.addStats(createStats(200, 100))
      
      aggregator.clearHistory()
      
      expect(aggregator.getHistoryCount()).toBe(0)
      expect(aggregator.getAggregatedStats().totalInputTokens).toBe(0)
    })
  })

  describe("getTokenUsageRatio", () => {
    it("should return zero ratios when no data", () => {
      const ratio = aggregator.getTokenUsageRatio()
      
      expect(ratio.inputRatio).toBe(0)
      expect(ratio.outputRatio).toBe(0)
    })

    it("should calculate input/output ratio", () => {
      aggregator.addStats(createStats(100, 100))
      
      const ratio = aggregator.getTokenUsageRatio()
      
      expect(ratio.inputRatio).toBe(0.5)
      expect(ratio.outputRatio).toBe(0.5)
    })

    it("should handle imbalanced ratios", () => {
      aggregator.addStats(createStats(300, 100))
      
      const ratio = aggregator.getTokenUsageRatio()
      
      expect(ratio.inputRatio).toBe(0.75)
      expect(ratio.outputRatio).toBe(0.25)
    })
  })

  describe("getCacheUsageStats", () => {
    it("should return zero stats when no data", () => {
      const stats = aggregator.getCacheUsageStats()
      
      expect(stats.writeRatio).toBe(0)
      expect(stats.readRatio).toBe(0)
      expect(stats.totalCacheTokens).toBe(0)
    })
  })

  describe("getCostStats", () => {
    it("should return zero costs when no data", () => {
      const stats = aggregator.getCostStats()
      
      expect(stats.totalCost).toBe(0)
      expect(stats.averageCost).toBe(0)
      expect(stats.costPerToken).toBe(0)
    })

    it("should calculate cost stats", () => {
      aggregator.addStats(createStats(100, 50, 0.001))
      aggregator.addStats(createStats(200, 100, 0.002))
      
      const stats = aggregator.getCostStats()
      
      expect(stats.totalCost).toBe(0.003)
      expect(stats.averageCost).toBe(0.0015)
      expect(stats.costPerToken).toBeCloseTo(0.00000667, 6)
    })
  })

  describe("exportToJson", () => {
    it("should export complete statistics", () => {
      aggregator.addStats(createStats(100, 50, 0.001))
      
      const exported = aggregator.exportToJson()
      
      expect(exported).toHaveProperty("aggregated")
      expect(exported).toHaveProperty("average")
      expect(exported).toHaveProperty("history")
      expect(exported).toHaveProperty("ratios")
      expect(exported).toHaveProperty("cacheUsage")
      expect(exported).toHaveProperty("costStats")
    })

    it("should include all history in export", () => {
      aggregator.addStats(createStats(100, 50))
      aggregator.addStats(createStats(200, 100))
      
      const exported = aggregator.exportToJson()
      
      expect(exported.history.length).toBe(2)
    })
  })
})