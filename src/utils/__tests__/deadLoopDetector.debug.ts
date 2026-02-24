import { DeadLoopDetector } from "../deadLoopDetector"

// 简单的调试脚本
const detector = new DeadLoopDetector()

// 测试1: 短序列循环
console.log("=== 测试1: 短序列循环 ===")
const text1 = "a".repeat(1900) + "思考".repeat(10) + "b".repeat(100)
console.log("文本长度:", text1.length)
const result1 = detector.detect(text1)
console.log("检测结果:", result1)

// 测试2: 段落重复
console.log("\n=== 测试2: 段落重复 ===")
const detector2 = new DeadLoopDetector()
const repeatingText2 = "今天天气真好。我们出去玩吧！".repeat(200)
const text2 = "a".repeat(2000) + repeatingText2 + "p".repeat(1000)
console.log("文本长度:", text2.length)
console.log("重复内容长度:", repeatingText2.length)
const fragment2 = text2.slice(2000, 3000)
console.log("2000-3000字符片段:", fragment2)
// 手动测试语义块分割
const separators = /[。.;；！!？?\n]+/
const blocks = fragment2.split(separators).filter((block) => block.trim().length > 0)
console.log("分割后的块:", blocks)
const result2 = detector2.detect(text2)
console.log("检测结果:", result2)

// 测试3: 有序列表重复
console.log("\n=== 测试3: 有序列表重复 ===")
const detector3 = new DeadLoopDetector()
const repeatingText3 = "1. 分析需求\n2. 设计方案\n".repeat(100)
const text3 = "a".repeat(2000) + repeatingText3 + "p".repeat(1000)
console.log("文本长度:", text3.length)
console.log("重复内容长度:", repeatingText3.length)
const fragment3 = text3.slice(2000, 3000)
console.log("2000-3000字符片段:", fragment3)
// 手动测试行分割和标准化
const lines = fragment3.split("\n")
console.log("分割后的行:", lines)
const normalizedLines = lines.map((line) => line.replace(/^\s*\d+\.\s*/, ""))
console.log("标准化后的行:", normalizedLines)
const result3 = detector3.detect(text3)
console.log("检测结果:", result3)

// 测试4: 正则表达式测试
console.log("\n=== 测试4: 正则表达式 ===")
const regex = /(.{2,})\1{3,}/g
const testText = "思考思考思考思考"
const match = regex.exec(testText)
console.log("测试文本:", testText)
console.log("匹配结果:", match)

// 测试5: 检查点测试
console.log("\n=== 测试5: 检查点测试 ===")
const detector5 = new DeadLoopDetector()
const text5 = "a".repeat(2000)
console.log("文本长度:", text5.length)
const result5 = detector5.detect(text5)
console.log("检测结果:", result5)
console.log("已检查的检查点:", (detector5 as any).checkedCheckpoints)

// 测试6: 短序列循环（超过2000字符）
console.log("\n=== 测试6: 短序列循环（超过2000字符） ===")
const detector6 = new DeadLoopDetector()
const text6 = "a".repeat(1900) + "思考".repeat(10) + "b".repeat(100)
console.log("文本长度:", text6.length)
console.log("最后200字符:", text6.slice(-200))
const result6 = detector6.detect(text6)
console.log("检测结果:", result6)