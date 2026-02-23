src\assets\codicons\codicon.css
src\assets\codicons\codicon.ttf

---

这是 Visual Studio Code 中使用的 **Codicon (Code Icons)** 图标字体文件的 CSS 代码。让我分析其主要作用：

## 核心功能

### 1. **图标字体系统**
- 定义了一个名为 "codicon" 的图标字体
- 通过 `@font-face` 加载 TTF 字体文件
- 提供了 400+ 个图标字符，通过 Unicode 私用区域（`\ea60` 到 `\ec33`）映射

### 2. **图标使用方式**

```html
<!-- 基础用法 -->
<i class="codicon codicon-add"></i>
<i class="codicon codicon-search"></i>

<!-- 带修饰符的用法 -->
<i class="codicon codicon-sync codicon-modifier-spin"></i>
<i class="codicon codicon-loading codicon-modifier-spin"></i>
```

### 3. **图标分类**

主要包含以下几类图标：

- **版本控制/Git**：`git-branch`、`git-commit`、`git-pull-request`、`repo`
- **编辑器操作**：`add`、`edit`、`save`、`copy`、`paste`
- **调试相关**：`debug-start`、`debug-stop`、`debug-step-over`
- **文件/文件夹**：`file`、`folder`、`file-code`、`file-media`
- **UI 元素**：`chevron-down`、`menu`、`close`、`search`
- **状态指示**：`error`、`warning`、`info`、`pass`
- **符号图标**：`symbol-class`、`symbol-function`、`symbol-variable`

### 4. **修饰符功能**

- **`codicon-modifier-spin`**：旋转动画（用于加载、同步等图标）
- **`codicon-modifier-disabled`**：半透明效果（表示禁用状态）
- **`codicon-modifier-hidden`**：完全透明（用于条件显示）

### 5. **CSS 特性**

- 使用 `:before` 伪元素显示图标字符
- 支持多个类名指向同一个图标（如 `add` 和 `plus` 是同一个图标）
- 设置了字体渲染优化：抗锯齿、平滑渲染
- 禁止用户选择图标文本

## 在 VSCode 插件中的应用

开发 VSCode 插件时，你可以：

```typescript
// 在 Webview 中使用
const icon = '<span class="codicon codicon-git-branch"></span>';

// 在状态栏中使用
const statusBarItem = vscode.window.createStatusBarItem();
statusBarItem.text = "$(sync) Syncing...";  // 使用内置图标语法

// 在 TreeView 中使用
treeItem.iconPath = new vscode.ThemeIcon('git-branch');
```

这个图标系统为 VSCode 提供了统一、可缩放、易于样式化的图标解决方案，是整个编辑器 UI 的重要组成部分。


=======

src\assets\icons\icon.png:插件图标

src\assets\icons\panel_dark.png
src\assets\icons\panel_light.png:特殊状态下的插件图标(例如左侧栏)

