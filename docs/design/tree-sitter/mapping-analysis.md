# Tree-sitter 类型映射分析文档

## 概述

本文档描述了 tree-sitter 模块的两层类型映射系统：
1. **标准类型映射**：将各语言特定类型映射到统一的标准类型
2. **文件折叠映射**：将标准类型进一步简化为文件折叠模块使用的高层类型

## 1. 标准类型系统

基于对各个语言查询文件的分析，我们定义以下标准类型：

### 核心类型
- `class` - 类定义
- `interface` - 接口/协议/特征定义
- `function` - 函数定义
- `method` - 方法定义

### 其他类型
- `enum` - 枚举定义
- `type` - 类型别名/类型定义
- `namespace` - 命名空间/包/模块定义
- `module` - 模块定义

### 特殊类型
- `constructor` - 构造函数
- `destructor` - 析构函数
- `operator` - 运算符重载
- `accessor` - getter/setter
- `property` - 属性/字段

### C/C++特定
- `struct` - 结构体
- `union` - 联合体
- `template` - 模板
- `macro` - 宏

### 其他
- `variable` - 变量
- `other` - 其他类型

## 2. 语言特定类型映射规则

### 2.1 TypeScript/JavaScript

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.interface` | `interface` | 接口定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.type` | `type` | 类型别名 |
| `name.definition.namespace` | `namespace` | 命名空间 |
| `name.definition.module` | `module` | 模块定义 |
| `name.definition.property` | `property` | 属性定义 |
| `name.definition.constructor` | `constructor` | 构造函数 |
| `name.definition.accessor` | `accessor` | getter/setter |
| `name.definition.async_function` | `function` | 异步函数 |
| `name.definition.async_arrow` | `function` | 异步箭头函数 |
| `name.definition.lambda` | `function` | lambda函数 |

### 2.2 C语言

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.struct` | `struct` | 结构体定义 |
| `name.definition.union` | `union` | 联合体定义 |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.type` | `type` | typedef类型定义 |
| `name.definition.variable` | `variable` | 变量定义 |
| `name.definition.macro` | `macro` | 宏定义 |

### 2.3 C++

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.type` | `type` | typedef类型定义 |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.namespace` | `namespace` | 命名空间 |
| `name.definition.template` | `template` | 模板定义 |
| `name.definition.macro` | `macro` | 宏定义 |
| `name.definition.variable` | `variable` | 变量定义 |
| `name.definition.constructor` | `constructor` | 构造函数 |
| `name.definition.destructor` | `destructor` | 析构函数 |
| `name.definition.operator` | `operator` | 运算符重载 |

### 2.4 Rust

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.struct` | `struct` | 结构体定义 |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.trait` | `interface` | trait定义（映射到接口） |
| `name.definition.impl` | `other` | impl块 |
| `name.definition.impl_trait` | `other` | trait实现 |
| `name.definition.impl_for` | `other` | impl for |
| `name.definition.module` | `module` | 模块定义 |
| `name.definition.macro` | `macro` | 宏定义 |
| `name.definition.attribute` | `other` | 属性宏 |
| `name.definition.type_alias` | `type` | 类型别名 |
| `name.definition.constant` | `variable` | 常量 |
| `name.definition.static` | `variable` | 静态变量 |
| `name.definition.method` | `method` | 方法定义 |

### 2.5 Go

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.type` | `type` | 类型定义（包括接口、结构体） |
| `name.definition.var` | `variable` | 变量定义 |
| `name.definition.const` | `variable` | 常量定义 |
| `name.definition.package` | `namespace` | 包定义 |
| `name.definition.import` | `other` | 导入声明 |

### 2.6 Python

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.lambda` | `function` | lambda表达式 |
| `name.definition.generator` | `function` | 生成器函数 |
| `name.definition.comprehension` | `other` | 列表/字典/集合推导式 |
| `name.definition.type` | `type` | 类型注解 |
| `name.definition.import` | `other` | 导入语句 |

### 2.7 Java

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.interface` | `interface` | 接口定义 |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.record` | `class` | record定义（映射到类） |
| `name.definition.annotation` | `other` | 注解定义 |
| `name.definition.constructor` | `constructor` | 构造函数 |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.inner_class` | `class` | 内部类 |
| `name.definition.static_nested_class` | `class` | 静态嵌套类 |
| `name.definition.lambda` | `function` | lambda表达式 |
| `name.definition.field` | `property` | 字段定义 |
| `name.definition.module` | `module` | 模块定义 |
| `name.definition.package` | `namespace` | 包定义 |

### 2.8 PHP

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.abstract_class` | `class` | 抽象类 |
| `name.definition.final_class` | `class` | final类 |
| `name.definition.readonly_class` | `class` | readonly类 |
| `name.definition.interface` | `interface` | 接口定义 |
| `name.definition.trait` | `interface` | trait定义（映射到接口） |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.static_method` | `method` | 静态方法 |
| `name.definition.abstract_method` | `method` | 抽象方法 |
| `name.definition.final_method` | `method` | final方法 |
| `name.definition.arrow_function` | `function` | 箭头函数 |
| `name.definition.property` | `property` | 属性定义 |
| `name.definition.static_property` | `property` | 静态属性 |
| `name.definition.readonly_property` | `property` | readonly属性 |
| `name.definition.promoted_property` | `property` | 构造函数提升属性 |
| `name.definition.constant` | `variable` | 常量定义 |
| `name.definition.namespace` | `namespace` | 命名空间 |
| `name.definition.use` | `other` | use语句 |
| `name.definition.attribute` | `other` | 属性 |

### 2.9 Ruby

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.class` | `class` | 类定义 |
| `name.definition.module` | `module` | 模块定义 |
| `name.definition.constant` | `variable` | 常量定义 |
| `name.definition.mixin` | `interface` | mixin（映射到接口） |
| `name.definition.attr_accessor` | `property` | 属性访问器 |
| `name.definition.attr_reader` | `property` | 属性读取器 |
| `name.definition.attr_writer` | `property` | 属性写入器 |

### 2.10 Swift

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.interface` | `interface` | protocol定义（映射到接口） |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.static_method` | `method` | 静态方法 |
| `name.definition.initializer` | `constructor` | 初始化器 |
| `name.definition.convenience_initializer` | `constructor` | 便利初始化器 |
| `name.definition.deinitializer` | `destructor` | 反初始化器 |
| `name.definition.subscript` | `accessor` | 下标 |
| `name.definition.property` | `property` | 属性定义 |
| `name.definition.computed_property` | `property` | 计算属性 |
| `name.definition.type_alias` | `type` | 类型别名 |
| `name.definition.protocol_property` | `property` | 协议属性 |
| `name.definition.protocol_method` | `method` | 协议方法 |

### 2.11 Kotlin

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.data_class` | `class` | 数据类 |
| `name.definition.abstract_class` | `class` | 抽象类 |
| `name.definition.sealed_class` | `class` | 密封类 |
| `name.definition.enum_class` | `enum` | 枚举类 |
| `name.definition.interface` | `interface` | 接口定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.suspend_function` | `function` | 挂起函数 |
| `name.definition.extension_function` | `method` | 扩展函数 |
| `name.definition.object` | `class` | 对象声明 |
| `name.definition.companion_object` | `class` | 伴生对象 |
| `name.definition.annotation_class` | `other` | 注解类 |
| `name.definition.primary_constructor` | `constructor` | 主构造函数 |
| `name.definition.secondary_constructor` | `constructor` | 次构造函数 |
| `name.definition.property` | `property` | 属性定义 |
| `name.definition.type_alias` | `type` | 类型别名 |

### 2.12 Scala

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.object` | `class` | 对象定义 |
| `name.definition.trait` | `interface` | trait定义（映射到接口） |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.variable` | `variable` | val/var定义 |
| `name.definition.type` | `type` | 类型定义 |
| `name.definition.namespace` | `namespace` | 包定义 |

### 2.13 C#

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.class` | `class` | 类定义 |
| `name.definition.interface` | `interface` | 接口定义 |
| `name.definition.struct` | `struct` | 结构体定义 |
| `name.definition.enum` | `enum` | 枚举定义 |
| `name.definition.record` | `class` | record定义（映射到类） |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.property` | `property` | 属性定义 |
| `name.definition.event` | `other` | 事件定义 |
| `name.definition.delegate` | `type` | 委托定义 |
| `name.definition.attribute` | `other` | 属性 |
| `name.definition.type_parameter` | `other` | 类型参数 |
| `name.definition.namespace` | `namespace` | 命名空间 |

### 2.14 Elixir

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.module` | `module` | 模块定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.macro` | `macro` | 宏定义 |
| `name.definition.struct` | `class` | 结构体定义（映射到类） |
| `name.definition.guard` | `other` | 守卫定义 |
| `name.definition.behaviour` | `interface` | 行为回调（映射到接口） |
| `name.definition.test` | `function` | 测试定义 |
| `name.definition.attribute` | `other` | 模块属性 |

### 2.15 OCaml

| 原始类型 | 标准类型 | 说明 |
|---------|---------|------|
| `name.definition.module` | `module` | 模块定义 |
| `name.definition.type` | `type` | 类型定义 |
| `name.definition.function` | `function` | 函数定义 |
| `name.definition.class` | `class` | 类定义 |
| `name.definition.method` | `method` | 方法定义 |
| `name.definition.value` | `variable` | 值绑定 |

## 3. 映射原则

### 3.1 语义等价映射
- **Trait/Protocol → Interface**: Rust的trait、Swift的protocol、Scala的trait、PHP的trait都映射到`interface`
- **Struct → Class/Struct**: Go的type定义根据上下文映射，C#的struct映射到`struct`
- **Record → Class**: Java和C#的record映射到`class`
- **Object → Class**: Kotlin的object声明映射到`class`

### 3.2 函数类型统一
- 所有函数、方法、lambda、箭头函数都映射到`function`或`method`
- 异步函数不单独分类，通过metadata标记

### 3.3 容器类型
- 可以包含其他定义的类型：`class`、`interface`、`namespace`、`module`、`struct`、`union`
- 用于构建分层代码结构

### 3.4 特殊处理
- 宏定义：保留为`macro`类型
- 属性/字段：统一为`property`
- 变量/常量：统一为`variable`

## 4. 元数据提取

从AST节点提取的元数据包括：
- `isExported`: 是否导出（export、public等）
- `isAsync`: 是否异步（async、suspend等）
- `isAbstract`: 是否抽象（abstract）
- `isStatic`: 是否静态（static）
- `visibility`: 可见性（public/private/protected）

## 5. 文件折叠映射

### 5.1 设计目的

文件折叠映射为 `src/core/file-folding` 模块提供高层抽象，将标准类型进一步简化为5种核心类型，便于文件折叠和代码摘要功能。

### 5.2 折叠类型系统

```typescript
export type FoldingDefinitionType = "class" | "interface" | "function" | "type" | "other"
```

### 5.3 映射规则

| 标准类型 | 折叠类型 | 说明 |
|---------|---------|------|
| `function` | `function` | 函数定义 |
| `method` | `function` | 方法定义 |
| `constructor` | `function` | 构造函数 |
| `destructor` | `function` | 析构函数 |
| `operator` | `function` | 运算符重载 |
| `accessor` | `function` | getter/setter |
| `class` | `class` | 类定义 |
| `interface` | `interface` | 接口定义 |
| `struct` | `interface` | 结构体定义（数据结构） |
| `type` | `type` | 类型别名 |
| `enum` | `type` | 枚举定义 |
| `union` | `type` | 联合体定义 |
| `template` | `type` | 模板定义 |
| `macro` | `type` | 宏定义 |
| `namespace` | `other` | 命名空间 |
| `module` | `other` | 模块定义 |
| `property` | `other` | 属性定义 |
| `variable` | `other` | 变量定义 |
| `other` | `other` | 其他类型 |

### 5.4 映射原则

1. **函数统一**: 所有可执行的代码块（函数、方法、构造函数等）都映射到 `function`
2. **类独立**: 类定义保持独立，因为它们是主要的代码组织单元
3. **接口扩展**: 接口和结构体都映射到 `interface`，因为它们定义了数据结构契约
4. **类型聚合**: 类型相关的定义（枚举、联合体、模板、宏）都映射到 `type`
5. **其他归类**: 命名空间、模块、属性、变量等映射到 `other`

### 5.5 使用示例

```typescript
import { parseSourceCodeDefinitionsForFileFolding } from "../../services/tree-sitter"

// 获取文件折叠定义
const foldingDefs = await parseSourceCodeDefinitionsForFileFolding(filePath)

// 结果示例：
// [
//   { type: "class", name: "MyClass", startLine: 10, endLine: 50, language: "typescript" },
//   { type: "function", name: "myMethod", startLine: 15, endLine: 25, language: "typescript" },
//   { type: "type", name: "MyEnum", startLine: 55, endLine: 60, language: "typescript" }
// ]
```

## 6. 实施建议

1. **每个语言独立映射文件**: `src/services/tree-sitter/mappings/{language}.ts`
2. **统一导出**: `src/services/tree-sitter/mappings/index.ts`
3. **动态加载**: 根据文件扩展名加载对应映射
4. **可扩展性**: 新增语言只需添加映射文件
5. **分层设计**: 标准类型映射 → 文件折叠映射，满足不同场景需求