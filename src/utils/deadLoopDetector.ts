/**
 * LLM流式生成死循环检测器
 *
 * 用于检测reasoningMessage中的三种死循环类型：
 * - 类型1：段落内容重复
 * - 类型2：有序列表重复
 * - 类型3：短序列循环
 */

export interface DeadLoopDetectionResult {
	detected: boolean
	type?: "paragraphRepetition" | "orderedListRepetition" | "shortSequenceLoop"
	details?: string
}

export interface DeadLoopDetectorConfig {
	// 检查点阈值（字符数）
	checkpoints: number[]
	// 短序列检测窗口大小（字符）
	shortSequenceWindowSize: number
	// 最小重复单元长度（字符）
	minRepeatUnitLength: number
	// 最大重复单元长度（字符）
	maxRepeatUnitLength: number
	// 最小重复次数
	minRepeatCount: number
	// 最小周期块/行数
	minPeriodElements: number
	// 最大周期长度
	maxPeriodLength: number
}

const DEFAULT_CONFIG: DeadLoopDetectorConfig = {
	checkpoints: [2000, 3000, 5000],
	shortSequenceWindowSize: 200,
	minRepeatUnitLength: 2,
	maxRepeatUnitLength: 50,
	minRepeatCount: 4,
	minPeriodElements: 4,  // 降低从6到4，使检测更敏感
	maxPeriodLength: 50,
}

export class DeadLoopDetector {
	private config: DeadLoopDetectorConfig
	private checkedCheckpoints: Set<number>

	constructor(config?: Partial<DeadLoopDetectorConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.checkedCheckpoints = new Set()
	}

	/**
	 * 重置检测器状态
	 */
	public reset(): void {
		this.checkedCheckpoints.clear()
	}

	/**
	 * 检测死循环
	 * @param reasoningMessage 当前的reasoningMessage文本
	 * @returns 检测结果
	 */
	public detect(reasoningMessage: string): DeadLoopDetectionResult {
		const length = reasoningMessage.length

		// 第1检查点：2000字符 - 短序列循环检测
		if (length >= 2000 && !this.checkedCheckpoints.has(2000)) {
			this.checkedCheckpoints.add(2000)
			const shortSequenceResult = this.detectShortSequenceLoop(reasoningMessage)
			if (shortSequenceResult.detected) {
				return shortSequenceResult
			}
		}

		// 第2检查点：3000字符 - 段落重复和有序列表重复检测
		if (length >= 3000 && !this.checkedCheckpoints.has(3000)) {
			this.checkedCheckpoints.add(3000)
			// 检测2000-3000字符范围
			const paragraphResult = this.detectParagraphRepetition(reasoningMessage, 2000, 3000)
			if (paragraphResult.detected) {
				return paragraphResult
			}
			const orderedListResult = this.detectOrderedListRepetition(reasoningMessage, 2000, 3000)
			if (orderedListResult.detected) {
				return orderedListResult
			}
		}

		// 第3检查点：5000字符 - 尾部二次检查
		if (length >= 5000 && !this.checkedCheckpoints.has(5000)) {
			this.checkedCheckpoints.add(5000)
			// 检测3000-5000字符范围
			const paragraphResult = this.detectParagraphRepetition(reasoningMessage, 3000, 5000)
			if (paragraphResult.detected) {
				return paragraphResult
			}
			const orderedListResult = this.detectOrderedListRepetition(reasoningMessage, 3000, 5000)
			if (orderedListResult.detected) {
				return orderedListResult
			}
		}

		return { detected: false }
	}

	/**
	 * 通用周期检测方法
	 * 专注于检测尾部的周期循环（死循环特征）
	 * @param elements 元素列表（可以是块列表或行列表）
	 * @returns 是否检测到周期循环
	 */
	private detectPeriod<T>(elements: T[]): { detected: boolean; periodLength?: number } {
		if (elements.length < this.config.minPeriodElements) {
			return { detected: false }
		}

		const maxPeriodLength = Math.min(this.config.maxPeriodLength, Math.floor(elements.length / 2))
		const minRequiredMatches = this.config.minPeriodElements

		// 遍历可能的周期长度
		for (let periodLength = 1; periodLength <= maxPeriodLength; periodLength++) {
			// 从列表末尾开始，检查是否有足够长的周期循环
			// 我们期望至少看到minRequiredMatches个完整周期
			let matchCount = 0
			let checkPos = elements.length - 1

			// 从末尾向前检查周期模式
			while (checkPos >= periodLength && matchCount < minRequiredMatches) {
				if (elements[checkPos] === elements[checkPos - periodLength]) {
					matchCount++
					checkPos -= periodLength
				} else {
					// 如果匹配中断，检查是否已经检测到足够的周期
					break
				}
			}

			// 如果连续重复的数量达到阈值，则判定为周期循环
			if (matchCount >= minRequiredMatches) {
				return { detected: true, periodLength }
			}
		}

		return { detected: false }
	}

	/**
	 * 短序列循环检测（原类型3）
	 * 使用基于扫描的单遍算法，避免正则表达式的性能问题
	 * @param reasoningMessage 当前的reasoningMessage文本
	 * @returns 检测结果
	 */
	private detectShortSequenceLoop(reasoningMessage: string): DeadLoopDetectionResult {
		const length = reasoningMessage.length

		// 取最近200字符的文本片段
		const start = Math.max(0, length - this.config.shortSequenceWindowSize)
		const textFragment = reasoningMessage.slice(start)

		// 使用基于扫描的算法检测重复模式
		const fragmentLength = textFragment.length
		// 只检测短重复单元（最多6字符），避免检测到完整的段落块或短句子
		const maxShortUnitLength = Math.min(6, this.config.minRepeatUnitLength + 4, Math.floor(fragmentLength / this.config.minRepeatCount))

		// 遍历可能的重复单元长度（从短到长，优先检测短重复）
		for (let unitLength = this.config.minRepeatUnitLength; unitLength <= maxShortUnitLength; unitLength++) {
			// 对每个可能的起始位置，检查是否从该位置开始有连续重复
			for (let startPos = 0; startPos < fragmentLength - unitLength * this.config.minRepeatCount; startPos++) {
				const unit = textFragment.slice(startPos, startPos + unitLength)
				
				// 跳过无效的重复单元
				if (!this.isValidRepeatUnit(unit)) {
					continue
				}

				// 从startPos开始，计算连续重复的次数
				let repeatCount = 0
				let pos = startPos
				while (pos + unitLength <= fragmentLength && textFragment.slice(pos, pos + unitLength) === unit) {
					repeatCount++
					pos += unitLength
				}

				// 如果重复次数达到阈值，返回结果
				if (repeatCount >= this.config.minRepeatCount) {
					return {
						detected: true,
						type: "shortSequenceLoop",
						details: `检测到短序列循环：重复单元 "${unit}"`,
					}
				}
			}
		}

		return { detected: false }
	}

	/**
	 * 验证重复单元是否有效
	 * 排除纯空格、纯标点、纯数字、纯字母的重复
	 * 只检测包含中文或混合内容的重复
	 */
	private isValidRepeatUnit(unit: string): boolean {
		const trimmed = unit.trim()
		if (trimmed.length === 0) {
			return false
		}
		// 必须包含中文字符
		return /[\u4e00-\u9fa5]/.test(trimmed)
	}

	/**
	 * 段落内容重复检测（原类型1）
	 * @param reasoningMessage 当前的reasoningMessage文本
	 * @param startRange 检测范围起始位置
	 * @param endRange 检测范围结束位置
	 * @returns 检测结果
	 */
	private detectParagraphRepetition(
		reasoningMessage: string,
		startRange: number,
		endRange: number,
	): DeadLoopDetectionResult {
		const length = reasoningMessage.length

		// 从上一个检查点到当前检查点之间的文本片段
		const start = startRange
		const end = Math.min(length, endRange)
		const textFragment = reasoningMessage.slice(start, end)

		// 步骤1：语义块分割
		const blocks = this.splitIntoSemanticBlocks(textFragment)

		// 步骤2：调用通用周期检测
		const result = this.detectPeriod(blocks)

		if (result.detected) {
			return {
				detected: true,
				type: "paragraphRepetition",
				details: `检测到段落内容重复，周期长度：${result.periodLength}`,
			}
		}

		return { detected: false }
	}

	/**
	 * 有序列表重复检测（原类型2）
	 * @param reasoningMessage 当前的reasoningMessage文本
	 * @param startRange 检测范围起始位置
	 * @param endRange 检测范围结束位置
	 * @returns 检测结果
	 */
	private detectOrderedListRepetition(
		reasoningMessage: string,
		startRange: number,
		endRange: number,
	): DeadLoopDetectionResult {
		const length = reasoningMessage.length

		// 从上一个检查点到当前检查点之间的文本片段
		const start = startRange
		const end = Math.min(length, endRange)
		const textFragment = reasoningMessage.slice(start, end)

		// 步骤1：按行分割
		const lines = textFragment.split("\n")

		// 步骤2：行标准化
		const normalizedLines = lines.map((line) => this.normalizeOrderedListItem(line))

		// 步骤3：调用通用周期检测
		const result = this.detectPeriod(normalizedLines)

		if (result.detected) {
			return {
				detected: true,
				type: "orderedListRepetition",
				details: `检测到有序列表重复，周期长度：${result.periodLength}`,
			}
		}

		return { detected: false }
	}

	/**
	 * 将文本分割成语义块
	 * 以自然语言的常见边界符作为分隔点
	 */
	private splitIntoSemanticBlocks(text: string): string[] {
		// 分隔符包括：中文句号（。）、英文句号（.）、中文分号（；）、英文分号（;）、
		// 感叹号（！!）、问号（？?）、换行符（\n）
		const separators = /[。.;；！!？?\n]+/
		const blocks = text.split(separators).filter((block) => block.trim().length > 0)
		return blocks
	}

	/**
	 * 标准化有序列表项
	 * 去除行首的有序列表标号，保留后续内容
	 */
	private normalizeOrderedListItem(line: string): string {
		// 匹配有序列表标号模式，如"1. "、"2. "、"10. "等
		const regex = /^\s*\d+\.\s*/
		return line.replace(regex, "")
	}
}