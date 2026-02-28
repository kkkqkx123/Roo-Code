import { TokenStats, TokenCount } from "@coder/types"

/**
 * TokenStatsAggregator - Token 统计聚合器
 * 
 * 聚合多轮对话的 token 统计。
 * 用于跨任务、跨会话的 token 统计汇总。
 * 
 * 设计目标：
 * - 支持多个 TokenAccountingService 的统计聚合
 * - 提供历史 token 使用趋势分析
 * - 支持按时间段、按任务类型等维度聚合
 */
export class TokenStatsAggregator {
  private statsHistory: TokenStats[] = []
  private aggregatedStats: TokenStats | null = null

  /**
   * 添加 TokenStats 到历史记录
   * 
   * @param stats - Token 统计结果
   */
  addStats(stats: TokenStats): void {
    this.statsHistory.push(stats)
    this.aggregatedStats = null // 清除缓存，强制重新计算
  }

  /**
   * 添加多个 TokenStats
   * 
   * @param statsArray - Token 统计结果数组
   */
  addStatsBatch(statsArray: TokenStats[]): void {
    for (const stats of statsArray) {
      this.addStats(stats)
    }
  }

  /**
   * 从 TokenAccountingService 获取统计并添加
   * 
   * @param stats - TokenStats
   */
  recordSession(stats: TokenStats): void {
    this.addStats(stats)
  }

  /**
   * 获取聚合后的总统计
   * 
   * @returns 聚合后的 TokenStats
   */
  getAggregatedStats(): TokenStats {
    if (this.aggregatedStats) {
      return this.aggregatedStats
    }

    if (this.statsHistory.length === 0) {
      return this.createEmptyStats()
    }

    const aggregated: TokenStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalCost: 0,
      breakdown: {
        systemPrompt: 0,
        userMessage: 0,
        conversationHistory: 0,
        assistantOutput: 0
      }
    }

    for (const stats of this.statsHistory) {
      aggregated.totalInputTokens += stats.totalInputTokens
      aggregated.totalOutputTokens += stats.totalOutputTokens
      aggregated.cacheWriteTokens = (aggregated.cacheWriteTokens || 0) + (stats.cacheWriteTokens || 0)
      aggregated.cacheReadTokens = (aggregated.cacheReadTokens || 0) + (stats.cacheReadTokens || 0)
      aggregated.totalCost += stats.totalCost

      // 聚合详细分解
      if (stats.breakdown) {
        aggregated.breakdown = aggregated.breakdown || {}
        aggregated.breakdown.systemPrompt = (aggregated.breakdown.systemPrompt || 0) + (stats.breakdown.systemPrompt || 0)
        aggregated.breakdown.userMessage = (aggregated.breakdown.userMessage || 0) + (stats.breakdown.userMessage || 0)
        aggregated.breakdown.conversationHistory = (aggregated.breakdown.conversationHistory || 0) + (stats.breakdown.conversationHistory || 0)
        aggregated.breakdown.assistantOutput = (aggregated.breakdown.assistantOutput || 0) + (stats.breakdown.assistantOutput || 0)
      }
    }

    this.aggregatedStats = aggregated
    return aggregated
  }

  /**
   * 获取平均每次交互的 token 统计
   * 
   * @returns 平均 TokenStats
   */
  getAverageStats(): TokenStats {
    const count = this.statsHistory.length
    if (count === 0) {
      return this.createEmptyStats()
    }

    const aggregated = this.getAggregatedStats()
    return {
      totalInputTokens: Math.round(aggregated.totalInputTokens / count),
      totalOutputTokens: Math.round(aggregated.totalOutputTokens / count),
      cacheWriteTokens: Math.round((aggregated.cacheWriteTokens || 0) / count),
      cacheReadTokens: Math.round((aggregated.cacheReadTokens || 0) / count),
      totalCost: aggregated.totalCost / count,
      breakdown: aggregated.breakdown ? {
        systemPrompt: Math.round((aggregated.breakdown.systemPrompt || 0) / count),
        userMessage: Math.round((aggregated.breakdown.userMessage || 0) / count),
        conversationHistory: Math.round((aggregated.breakdown.conversationHistory || 0) / count),
        assistantOutput: Math.round((aggregated.breakdown.assistantOutput || 0) / count)
      } : undefined
    }
  }

  /**
   * 获取统计历史记录
   * 
   * @returns TokenStats 数组
   */
  getHistory(): TokenStats[] {
    return [...this.statsHistory]
  }

  /**
   * 获取历史记录数量
   * 
   * @returns 数量
   */
  getHistoryCount(): number {
    return this.statsHistory.length
  }

  /**
   * 获取最新的 N 条统计记录
   * 
   * @param n - 数量
   * @returns 最新的 N 条 TokenStats
   */
  getLatest(n: number): TokenStats[] {
    if (n <= 0) {
      return []
    }
    return this.statsHistory.slice(-n)
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.statsHistory = []
    this.aggregatedStats = null
  }

  /**
   * 获取 token 使用趋势（输入/输出比率）
   * 
   * @returns { inputRatio: number, outputRatio: number }
   */
  getTokenUsageRatio(): { inputRatio: number; outputRatio: number } {
    const aggregated = this.getAggregatedStats()
    const total = aggregated.totalInputTokens + aggregated.totalOutputTokens

    if (total === 0) {
      return { inputRatio: 0, outputRatio: 0 }
    }

    return {
      inputRatio: aggregated.totalInputTokens / total,
      outputRatio: aggregated.totalOutputTokens / total
    }
  }

  /**
   * 获取缓存使用统计
   * 
   * @returns { writeRatio: number, readRatio: number, totalCacheTokens: number }
   */
  getCacheUsageStats(): {
    writeRatio: number
    readRatio: number
    totalCacheTokens: number
  } {
    const aggregated = this.getAggregatedStats()
    const totalCacheTokens = (aggregated.cacheWriteTokens || 0) + (aggregated.cacheReadTokens || 0)
    const totalTokens = aggregated.totalInputTokens + aggregated.totalOutputTokens

    if (totalTokens === 0) {
      return { writeRatio: 0, readRatio: 0, totalCacheTokens: 0 }
    }

    return {
      writeRatio: (aggregated.cacheWriteTokens || 0) / totalTokens,
      readRatio: (aggregated.cacheReadTokens || 0) / totalTokens,
      totalCacheTokens
    }
  }

  /**
   * 获取成本统计
   * 
   * @returns { totalCost: number, averageCost: number, costPerToken: number }
   */
  getCostStats(): {
    totalCost: number
    averageCost: number
    costPerToken: number
  } {
    const aggregated = this.getAggregatedStats()
    const count = this.statsHistory.length
    const totalTokens = aggregated.totalInputTokens + aggregated.totalOutputTokens

    return {
      totalCost: aggregated.totalCost,
      averageCost: count > 0 ? aggregated.totalCost / count : 0,
      costPerToken: totalTokens > 0 ? aggregated.totalCost / totalTokens : 0
    }
  }

  /**
   * 导出统计数据为 JSON
   * 
   * @returns JSON 对象
   */
  exportToJson(): {
    aggregated: TokenStats
    average: TokenStats
    history: TokenStats[]
    ratios: { inputRatio: number; outputRatio: number }
    cacheUsage: { writeRatio: number; readRatio: number; totalCacheTokens: number }
    costStats: { totalCost: number; averageCost: number; costPerToken: number }
  } {
    return {
      aggregated: this.getAggregatedStats(),
      average: this.getAverageStats(),
      history: this.getHistory(),
      ratios: this.getTokenUsageRatio(),
      cacheUsage: this.getCacheUsageStats(),
      costStats: this.getCostStats()
    }
  }

  /**
   * 创建空的 TokenStats
   */
  private createEmptyStats(): TokenStats {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalCost: 0,
      breakdown: {
        systemPrompt: 0,
        userMessage: 0,
        conversationHistory: 0,
        assistantOutput: 0
      }
    }
  }
}