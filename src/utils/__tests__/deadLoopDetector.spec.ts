import { describe, test, expect, beforeEach } from "vitest"
import { DeadLoopDetector } from "../deadLoopDetector"

describe("DeadLoopDetector", () => {
	let detector: DeadLoopDetector

	beforeEach(() => {
		detector = new DeadLoopDetector()
	})

	describe("短序列循环检测", () => {
		test("应该检测到短序列循环", () => {
			// 创建一个超过2000字符的文本，最后200字符包含重复
			const baseText = "a".repeat(1800)
			const repeatingText = "思考".repeat(100) // "思考思考思考..." (200字符)
			const text = baseText + repeatingText
			// 总长度 = 1800 + 200 = 2000字符

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
			expect(result.type).toBe("shortSequenceLoop")
			expect(result.details).toContain("思考")
		})

		test("应该检测到刚好达到阈值的短序列循环", () => {
			const baseText = "a".repeat(1800)
			const repeatingText = "测试".repeat(100) // 200字符，刚好4次重复（每次50字符）
			const text = baseText + repeatingText
			// 总长度 = 1800 + 200 = 2000字符

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
			expect(result.type).toBe("shortSequenceLoop")
		})

		test("不应该检测到未达到阈值的短序列循环", () => {
			const baseText = "a".repeat(1940)
			const repeatingText = "测试".repeat(3) // 6字符，只有3次重复
			const text = baseText + repeatingText
			// 总长度 = 1940 + 6 = 1946字符，未达到2000字符检查点

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("不应该检测到单字符重复", () => {
			const baseText = "a".repeat(1900)
			const repeatingText = "a".repeat(100) // 单字符重复
			const text = baseText + repeatingText
			// 总长度 = 1900 + 100 = 2000字符

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("不应该检测到正常重复（如哈哈哈）", () => {
			const baseText = "a".repeat(1994)
			const repeatingText = "哈哈哈" // 只有3次重复
			const text = baseText + repeatingText
			// 总长度 = 1994 + 6 = 2000字符

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("在未达到检查点时不应该检测", () => {
			const text = "思考".repeat(100) // 远未达到2000字符
			// 总长度 = 200字符

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})
	})

	describe("段落内容重复检测", () => {
		test("应该检测到段落内容重复（不换行）", () => {
			// 创建一个超过3000字符的文本，2000-3000字符之间包含重复段落
			// 每个段落约50字符，重复6次共300字符，完全在1000字符窗口内
			const baseText = "a".repeat(2000)
			const repeatingParagraph = "今天天气真好。我们出去玩吧！"
			const repeatingText = repeatingParagraph.repeat(6) // 重复6次，约300字符
			const text = baseText + repeatingText + "b".repeat(1000) // 确保超过3000字符

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
			expect(result.type).toBe("paragraphRepetition")
		})

		test("应该检测到段落内容重复（换行）", () => {
			const baseText = "a".repeat(2000)
			const repeatingParagraph = "第一句话。第二句话！"
			const repeatingText = repeatingParagraph.repeat(6)
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
			expect(result.type).toBe("paragraphRepetition")
		})

		test("应该检测到刚好达到阈值的段落重复", () => {
			const baseText = "a".repeat(2000)
			const repeatingParagraph = "测试段落。"
			const repeatingText = repeatingParagraph.repeat(6) // 刚好6个块
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("不应该检测到未达到阈值的段落重复", () => {
			const baseText = "a".repeat(2000)
			const repeatingParagraph = "测试段落。"
			const repeatingText = repeatingParagraph.repeat(5) // 只有5个块
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("应该正确处理不同的语义边界符", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "句号。分号；感叹号！问号？".repeat(6)
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("不应该检测到正常列举", () => {
			const baseText = "a".repeat(2000)
			const normalList = "第一点。第二点。第三点。第四点。第五点。"
			const text = baseText + normalList + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})
	})

	describe("有序列表重复检测", () => {
		test("应该检测到有序列表重复", () => {
			const baseText = "a".repeat(2000)
			const repeatingList = "1. 分析需求\n2. 设计方案\n"
			const repeatingText = repeatingList.repeat(3) // 重复3次，共6行
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
			expect(result.type).toBe("orderedListRepetition")
		})

		test("应该检测到标号递增但内容相同的列表", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "1. 分析需求\n2. 设计方案\n3. 分析需求\n4. 设计方案\n5. 分析需求\n6. 设计方案\n"
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
			expect(result.type).toBe("orderedListRepetition")
		})

		test("应该检测到刚好达到阈值的列表重复", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "1. 第一项\n2. 第二项\n3. 第一项\n4. 第二项\n5. 第一项\n6. 第二项\n"
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("不应该检测到未达到阈值的列表重复", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "1. 第一项\n2. 第二项\n3. 第一项\n4. 第二项\n5. 第一项\n" // 只有5行
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("应该正确处理不同标号格式", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "10. 第一项\n11. 第二项\n12. 第一项\n13. 第二项\n14. 第一项\n15. 第二项\n"
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("不应该检测到正常列表", () => {
			const baseText = "a".repeat(2000)
			const normalList = "1. 第一点\n2. 第二点\n3. 第三点\n4. 第四点\n5. 第五点\n6. 第六点\n"
			const text = baseText + normalList + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})
	})

	describe("通用周期检测", () => {
		test("应该检测到周期长度为2的循环", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "块A。块B。".repeat(6)
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("应该检测到周期长度为3的循环", () => {
			const baseText = "a".repeat(2000)
			const repeatingText = "块A。块B。块C。".repeat(4) // 4个周期，共12个块
			const text = baseText + repeatingText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("不应该检测到过长的周期", () => {
			const baseText = "a".repeat(2000)
			// 创建一个周期长度超过50的序列
			const longPeriod = Array.from({ length: 60 }, (_, i) => `块${i}。`).join("")
			const text = baseText + longPeriod + longPeriod + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})
	})

	describe("边界情况", () => {
		test("应该正确处理空文本", () => {
			const result = detector.detect("")
			expect(result.detected).toBe(false)
		})

		test("应该正确处理极短文本", () => {
			const result = detector.detect("短文本")
			expect(result.detected).toBe(false)
		})

		test("应该正确处理刚好达到检查点的文本", () => {
			const text = "a".repeat(2000)
			const result = detector.detect(text)
			expect(result.detected).toBe(false) // 没有死循环
		})

		test("应该正确处理极长文本", () => {
			const baseText = "a".repeat(5000)
			const repeatingText = "思考".repeat(10)
			const text = baseText + repeatingText

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("应该在达到第3检查点时执行尾部检测", () => {
			const baseText = "a".repeat(3000)
			const repeatingText = "1. 第一项\n2. 第二项\n".repeat(3)
			const text = baseText + repeatingText + "b".repeat(2000)

			const result = detector.detect(text)
			expect(result.detected).toBe(true)
		})
	})

	describe("误判防范", () => {
		test("不应该检测到用户提示词中的重复", () => {
			// 模拟用户提示词中的重复（在2000字符之前）
			const userPrompt = "测试测试测试测试".repeat(100) // 用户提示词中的重复
			const text = userPrompt + "a".repeat(2000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("不应该检测到代码块中的重复行", () => {
			const baseText = "a".repeat(2000)
			const codeBlock = "for (let i = 0; i < 10; i++) {\n  console.log(i);\n}\n".repeat(3)
			const text = baseText + codeBlock + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("不应该检测到格式化内容", () => {
			const baseText = "a".repeat(2000)
			const formattedText = "  缩进文本  ".repeat(6)
			const text = baseText + formattedText + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})

		test("不应该检测到正常的强调", () => {
			const baseText = "a".repeat(2000)
			const emphasis = "非常重要！非常重要！非常重要！"
			const text = baseText + emphasis + "b".repeat(1000)

			const result = detector.detect(text)
			expect(result.detected).toBe(false)
		})
	})

	describe("检测器状态管理", () => {
		test("应该在重置后重新检测", () => {
			const baseText = "a".repeat(1900)
			const repeatingText = "思考".repeat(10)
			const text = baseText + repeatingText

			// 第一次检测
			let result = detector.detect(text)
			expect(result.detected).toBe(true)

			// 重置检测器
			detector.reset()

			// 第二次检测应该仍然能检测到
			result = detector.detect(text)
			expect(result.detected).toBe(true)
		})

		test("不应该重复检测同一个检查点", () => {
			const baseText = "a".repeat(1900)
			const repeatingText = "思考".repeat(10)
			const text = baseText + repeatingText

			// 第一次检测
			let result = detector.detect(text)
			expect(result.detected).toBe(true)

			// 第二次检测（文本未变）
			result = detector.detect(text)
			expect(result.detected).toBe(false) // 已经检测过该检查点
		})

		test("应该在文本增长后检测新的检查点", () => {
			// 第一次检测：2000字符
			let text = "a".repeat(2000)
			let result = detector.detect(text)
			expect(result.detected).toBe(false)

			// 增长到3000字符
			text = "a".repeat(3000)
			result = detector.detect(text)
			expect(result.detected).toBe(false)
		})
	})

	describe("配置参数", () => {
		test("应该支持自定义配置", () => {
			const customDetector = new DeadLoopDetector({
				checkpoints: [100, 200],
				shortSequenceWindowSize: 50,
				minRepeatUnitLength: 2,
				minRepeatCount: 3,
				minPeriodElements: 4,
				maxPeriodLength: 30,
			})

			const baseText = "a".repeat(50)
			const repeatingText = "测试测试测试" // 3次重复，每次2字符
			const text = baseText + repeatingText

			const result = customDetector.detect(text)
			expect(result.detected).toBe(true)
		})
	})
})