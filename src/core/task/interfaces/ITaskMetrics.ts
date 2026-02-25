/**
 * Task 指标收集接口
 * 
 * 定义了 Task 类中指标收集相关的接口。
 */

import type { TokenUsage, ToolUsage, ToolName } from "@coder/types"

/**
 * 指标快照
 */
export interface MetricsSnapshot {
	/** Token 使用快照 */
	tokenUsage: TokenUsage
	/** 工具使用快照 */
	toolUsage: ToolUsage
	/** 快照时间戳 */
	timestamp: number
}

/**
 * Task 指标收集接口
 * 
 * 这个接口定义了 Task 类中指标收集相关的方法。
 * 通过这个接口，可以轻松地 mock 指标收集逻辑进行测试。
 */
export interface ITaskMetrics {
	/**
	 * 获取 Token 使用情况
	 * 
	 * @returns Token 使用情况
	 */
	getTokenUsage(): TokenUsage

	/**
	 * 获取工具使用情况
	 * 
	 * @returns 工具使用情况
	 */
	getToolUsage(): ToolUsage

	/**
	 * 记录工具使用
	 * 
	 * @param toolName - 工具名称
	 */
	recordToolUsage(toolName: ToolName): void

	/**
	 * 记录工具错误
	 * 
	 * @param toolName - 工具名称
	 * @param error - 错误信息
	 */
	recordToolError(toolName: ToolName, error?: string): void

	/**
	 * 重置工具使用统计
	 * 
	 * @param toolName - 工具名称（可选，不提供则重置所有）
	 */
	resetToolUsage(toolName?: ToolName): void

	/**
	 * 获取工具使用统计
	 * 
	 * @param toolName - 工具名称
	 * @returns 工具使用统计
	 */
	getToolUsageStats(toolName: ToolName): { attempts: number; failures: number } | undefined

	/**
	 * 获取所有工具使用统计
	 * 
	 * @returns 所有工具使用统计
	 */
	getAllToolUsageStats(): Map<ToolName, { attempts: number; failures: number }>

	/**
	 * 创建指标快照
	 * 
	 * @returns 指标快照
	 */
	createSnapshot(): MetricsSnapshot

	/**
	 * 恢复指标快照
	 * 
	 * @param snapshot - 指标快照
	 */
	restoreSnapshot(snapshot: MetricsSnapshot): void

	/**
	 * 检查 Token 使用是否变化
	 * 
	 * @param currentUsage - 当前使用情况
	 * @param snapshot - 快照
	 * @returns 是否变化
	 */
	hasTokenUsageChanged(currentUsage: TokenUsage, snapshot?: MetricsSnapshot): boolean

	/**
	 * 检查工具使用是否变化
	 * 
	 * @param currentUsage - 当前使用情况
	 * @param snapshot - 快照
	 * @returns 是否变化
	 */
	hasToolUsageChanged(currentUsage: ToolUsage, snapshot?: MetricsSnapshot): boolean

	/**
	 * 计算总成本
	 * 
	 * @returns 总成本
	 */
	calculateTotalCost(): number

	/**
	 * 获取最常用的工具
	 * 
	 * @param limit - 返回数量限制
	 * @returns 工具使用次数排序
	 */
	getMostUsedTools(limit?: number): Array<{ toolName: ToolName; attempts: number }>

	/**
	 * 获取错误率最高的工具
	 * 
	 * @param limit - 返回数量限制
	 * @returns 工具错误率排序
	 */
	getMostErrorProneTools(limit?: number): Array<{ toolName: ToolName; errorRate: number }>

	/**
	 * 重置所有指标
	 */
	resetAll(): void
}

/**
 * 指标事件
 */
export interface MetricsEvents {
	/** Token 使用已更新 */
	tokenUsageUpdated: (usage: TokenUsage) => void
	/** 工具使用已记录 */
	toolUsageRecorded: (toolName: ToolName, attempts: number) => void
	/** 工具错误已记录 */
	toolErrorRecorded: (toolName: ToolName, error?: string) => void
	/** 指标已重置 */
	metricsReset: () => void
}