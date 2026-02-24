import { DeadLoopDetector } from "../deadLoopDetector"

// 创建检测器
const detector = new DeadLoopDetector()

// 测试短序列循环
console.log("=== 测试短序列循环 ===")
const baseText = "a".repeat(1800)
const repeatingText = "思考".repeat(100) // 200字符
const text = baseText + repeatingText
console.log("文本长度:", text.length)
const result = detector.detect(text)
console.log("检测结果:", result)

// 测试段落重复
console.log("\n=== 测试段落重复 ===")
const detector2 = new DeadLoopDetector()
const baseText2 = "a".repeat(2000)
const repeatingParagraph = "今天天气真好。我们出去玩吧！"
const repeatingText2 = repeatingParagraph.repeat(6)
const text2 = baseText2 + repeatingText2 + "b".repeat(1000)
console.log("文本长度:", text2.length)
const result2 = detector2.detect(text2)
console.log("检测结果:", result2)

// 测试有序列表重复
console.log("\n=== 测试有序列表重复 ===")
const detector3 = new DeadLoopDetector()
const baseText3 = "a".repeat(2000)
const repeatingList = "1. 分析需求\n2. 设计方案\n"
const repeatingText3 = repeatingList.repeat(3)
const text3 = baseText3 + repeatingText3 + "b".repeat(1000)
console.log("文本长度:", text3.length)
const result3 = detector3.detect(text3)
console.log("检测结果:", result3)