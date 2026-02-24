# DeadLoopDetector 测试设计纠正方案

## 核心问题

**现状**：为了让测试通过，错误地降低了检测参数（minRepeatCount: 4→3, minPeriodElements: 6→3）

**问题所在**：
- 这违背了原始设计文档的科学设定
- 增加了误报率，影响用户体验
- 测试数据的改动是为了适应参数，而不是参数适应现实

**正确做法**：恢复原始参数，重新设计测试用例

## 参数恢复决定

根据design-doc第248, 103-104行的明确规定：

```
检查点3检查点：
- 最小周期块/行数：默认6
- 短序列匹配模式：至少2个字符的子串连续重复至少4次
```

**恢复到**：
```typescript
minRepeatCount: 4        // 短序列：至少4次重复
minPeriodElements: 6     // 周期：至少6个元素
```

## 测试用例设计原则

### 原则1：测试数据要反映真实场景

**❌ 错误做法**：
```typescript
// 为了凑足6个块而重复20次
const repeatingText = repeatingParagraph.repeat(20)  // 40块
```

**✓ 正确做法**：
```typescript
// 真实死循环：通常是3-4个不同块的反复重复
// 最少情况：3个周期 × 2块 = 6块（刚好满足阈值）
const repeatingText = repeatingParagraph.repeat(3)  // 6块
```

### 原则2：验证边界情况

每个检测类型需要3类测试：

1. **边界上限**（刚好满足）
   - 3个周期 × 2块 = 6块 → 应检测
   - 2个周期 × 2块 = 4块 → 不检测

2. **正常情况**（明显满足）
   - 5个周期 × 2块 = 10块 → 应检测
   
3. **误报防范**（正常数据）
   - 非周期性列表 → 不检测
   - 正常的强调重复 → 不检测

### 原则3：考虑检查点范围

检测发生在范围内：
- 第1检查点：2000字符处，检查最后200字符
- 第2检查点：2000-3000字符之间
- 第3检查点：3000-5000字符之间

**数据设计**需要确保重复在检查范围内，而不是通过增加基础文本长度来绕过。

## 正确的测试用例结构

### 短序列循环检测（minRepeatCount=4）

```typescript
describe("短序列循环检测", () => {
    test("应该检测到4次重复的短序列", () => {
        const baseText = "a".repeat(1800)
        // 最后200字符内有4次重复
        const repeatingText = "思考".repeat(4)  // 4次 = 8字符，满足minRepeatCount=4
        const filler = "b".repeat(192)
        const text = baseText + repeatingText + filler
        
        expect(detector.detect(text)).toBe(true)
    })
    
    test("不应该检测到3次重复", () => {
        const baseText = "a".repeat(1800)
        const repeatingText = "思考".repeat(3)  // 3次，不满足
        const text = baseText + repeatingText
        
        expect(detector.detect(text)).toBe(false)
    })
})
```

### 段落重复检测（minPeriodElements=6）

```typescript
describe("段落重复检测", () => {
    test("应该检测到6个块的周期循环", () => {
        const baseText = "a".repeat(2000)
        // 在2000-3000范围内产生周期循环
        // 最小情况：3个周期 × 2块 = 6块
        const repeatingParagraph = "块A。块B。"  // 分割后：["块A", "块B"]
        const repeatingText = repeatingParagraph.repeat(3)  // 6块
        const text = baseText + repeatingText
        
        expect(detector.detect(text)).toBe(true)
        expect(result.type).toBe("paragraphRepetition")
    })
    
    test("不应该检测到5个块", () => {
        const baseText = "a".repeat(2000)
        const repeatingParagraph = "块。"  // 1块
        const repeatingText = repeatingParagraph.repeat(5)  // 5块
        const text = baseText + repeatingText + "c".repeat(1000)
        
        expect(detector.detect(text)).toBe(false)
    })
    
    test("不应该误报正常列表", () => {
        const baseText = "a".repeat(2000)
        // 6块但不是周期性的
        const text = baseText + "第一。第二。第三。第四。第五。第六。"
        
        expect(detector.detect(text)).toBe(false)  // 非周期
    })
})
```

### 列表重复检测（minPeriodElements=6）

```typescript
describe("列表重复检测", () => {
    test("应该检测到6行的周期循环", () => {
        const baseText = "a".repeat(2000)
        // 最小情况：3个周期 × 2行 = 6行
        const repeatingList = "1. 项\n2. 项\n"  // 2行 = 2个元素
        const repeatingText = repeatingList.repeat(3)  // 6行
        const text = baseText + repeatingText
        
        expect(detector.detect(text)).toBe(true)
        expect(result.type).toBe("orderedListRepetition")
    })
    
    test("不应该检测到5行", () => {
        const baseText = "a".repeat(2000)
        const text = baseText + "1. 项\n2. 项\n3. 项\n4. 项\n5. 项\n"
        
        expect(detector.detect(text)).toBe(false)
    })
})
```

## 为什么恢复到设计参数

### 1. 科学性
- 原始设计基于对真实LLM死循环的观察
- 参数不是随意设定，而是经过考虑的

### 2. 误报率控制
- minPeriodElements=6 意味着需要明显的周期循环
- 正常的3项列表（或3次强调）不会被误判
- 用户体验不会因为误报而受损

### 3. 检测延迟
- 虽然需要等待更多重复才能检测
- 但真实死循环会持续下去
- 总的字符数延迟在可接受范围内

### 4. 实现一致性
- 段落和列表使用相同的周期检测逻辑
- 避免特殊处理（如detectListPeriod）
- 代码更简洁，维护更容易

## 实施步骤

### 第1步：恢复参数
```typescript
const DEFAULT_CONFIG: DeadLoopDetectorConfig = {
    checkpoints: [2000, 3000, 5000],
    shortSequenceWindowSize: 200,
    minRepeatUnitLength: 2,
    maxRepeatUnitLength: 50,
    minRepeatCount: 4,      // 恢复为4
    minPeriodElements: 6,   // 恢复为6
    maxPeriodLength: 50,
}
```

### 第2步：删除不必要的特殊处理
- 删除 `detectListPeriod` 方法
- 列表检测直接使用 `detectPeriod`
- 段落检测保持不变

### 第3步：重新设计测试
- 38个现有测试中，8个失败的需要重新设计
- 遵循上述原则：最小场景到明显场景
- 添加更多的误报防范测试

### 第4步：验证
```bash
# 运行测试，预期结果：
# Tests: 38 total
# Passed: >= 34 (基于设计要求)
# 失败的测试应该是那些违反设计参数的场景
```

## 预期测试结果

| 测试类型 | 数量 | 说明 |
|---------|------|------|
| 短序列循环 | 7 | 验证4次重复阈值 |
| 段落重复 | 8 | 验证6块和周期性 |
| 列表重复 | 8 | 验证6行和周期性 |
| 通用周期 | 4 | 验证不同周期长度 |
| 边界情况 | 4 | 验证检查点和极端值 |
| 误判防范 | 4 | 验证不误报 |
| 状态管理 | 2 | 验证检查点管理 |
| 配置参数 | 1 | 验证配置生效 |

## 总结

这不是妥协，而是**回到设计初心**：
- ✓ 恢复原始参数（经过科学设计）
- ✓ 重新设计测试（遵循设计意图）
- ✓ 确保真实死循环被检测
- ✓ 避免误报，保护用户体验
- ✓ 代码简洁一致
