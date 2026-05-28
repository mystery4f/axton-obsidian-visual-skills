---
name: excalidraw-diagram
description: Generate Excalidraw diagrams from text content. Supports three output modes - Obsidian (.md), Standard (.excalidraw), and Animated (.excalidraw with animation order). Triggers on "Excalidraw", "画图", "流程图", "思维导图", "可视化", "diagram", "标准Excalidraw", "standard excalidraw", "Excalidraw动画", "动画图", "animate".
metadata:
  version: 2.0.0
---

# Excalidraw Diagram Generator

Create Excalidraw diagrams from text content with multiple output formats.

## Subagent 执行模式

**重要：本 skill 采用多步骤流程，生成 → 转图片 → 视觉评价 → 调整优化。**

> ⚠️ **不是每次都要走评价流程**：只有在用户明确要求**评价**、**优化排版/布局/样式**、或者**已有文件需要优化**时，才走步骤 2-5 的评价调整循环。如果用户只是要求**生成图表**，直接步骤 1 生成 → 步骤 6 保存到目标路径即可。

> ⚠️ **父 agent 不要读取图片文件**，图片只由 excalidraw-reviewer subagent 读取，避免浪费 token。

> ⚠️ **避免递归嵌套**：不要在 subagent 调用中使用 `skill: ["excalidraw-diagram"]`，否则 worker 也会尝试再套一层 subagent 导致无限嵌套。改为在 task 中直接写明所有规范。

### 脚本路径

所有辅助脚本位于本 skill 目录下：

```
SKILL_DIR = excalidraw-diagram skill 所在目录
{SKILL_DIR}/flowchart-to-excalidraw.js   # .md → .excalidraw
{SKILL_DIR}/excalidraw-screenshot.js     # .excalidraw → .png
{SKILL_DIR}/extract-elements.js          # .excalidraw → .elements.txt 摘要
```

### 工作目录

进入评价流程时，先创建带时间戳的工作目录，所有中间文件统一放这里。**一次 skill 调用只创建一次，后续所有步骤共用同一目录**。

每轮迭代使用版本子目录 `v1/`、`v2/`、`v3/`，保留历史版本便于对比回溯。

```bash
# 步骤 0：创建一次，后续复用
WORK_DIR="/tmp/excalidraw-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WORK_DIR"
echo "$WORK_DIR"  # 记住这个路径，后续步骤都用它

# 每轮迭代时
ROUND=1
VERSION_DIR="$WORK_DIR/v$ROUND"
mkdir -p "$VERSION_DIR"
```

目录结构示例：
```
/tmp/excalidraw-20260529-143000/
├── v1/
│   ├── {主题}.md
│   ├── {主题}.excalidraw
│   ├── {主题}.png
│   ├── {主题}.elements.txt
│   └── review.md
├── v2/
│   ├── {主题}.md
│   ├── {主题}.excalidraw
│   ├── {主题}.png
│   ├── {主题}.elements.txt
│   └── review.md
└── v3/  (如需)
    └── ...
```

### 完整流程

```
步骤 0: mkdir -p $WORK_DIR
步骤 1: 生成初始图表 → 保存到 $WORK_DIR/v1/
步骤 2: 转换为图片 → $WORK_DIR/v1/{主题}.excalidraw / .png / .elements.txt
步骤 3: 视觉评价 → $WORK_DIR/v1/review.md
步骤 4: 父 agent 读取评价 → 编辑后保存到 $WORK_DIR/v2/{主题}.md
  ↓ 重复步骤 2-4，版本号递增（v2, v3...）
步骤 5: 展示最新版本效果图给用户 → 用户确认满意
步骤 6: 用户满意 → 从 $WORK_DIR/v{N}/ 复制到用户目标路径
```

### 步骤 1: 生成初始图表

通过 subagent 使用 `delegate` agent + `mimo-v2.5` 模型生成初始 Excalidraw JSON。

在 task 中传入完整的需求描述，并**粘贴下方对应章节的全部内容**（Design Rules、Color Palette、JSON Structure、Element Template、Output Formats、Common Mistakes）。

**判断是否需要评价：**
- 用户只要求**生成图表** → 生成后直接保存到目标路径，不走评价流程
- 用户要求**评价/优化排版/布局/样式** → 先创建 `$WORK_DIR` 和 `$WORK_DIR/v1`，生成后保存到 `$WORK_DIR/v1`，继续步骤 2-5

**调用方式：**
```
subagent({
  agent: "delegate",
  model: "mimo-v2.5",
  task: "生成 Excalidraw 图表。\n\n用户请求：[具体内容]\n\n输出模式：[Obsidian / Standard / Animated]\n图表类型：[流程图 / 思维导图 / 层级图 / 关系图 等]\n\n请严格按照以下规范执行...\n[粘贴完整规范]\n\n生成完成后用 write 工具保存到：[需要评价 → $WORK_DIR/v1，不需要评价 → 目标路径]\n文件名：[主题].[类型].[扩展名]"
})
```

> ⚠️ **需要评价时必须保存到 $WORK_DIR/v1**，不要直接写入 Obsidian 仓库。不需要评价时直接保存到用户目标路径。

### 步骤 2: 转换为图片

父 agent 直接用 bash 执行脚本：

```bash
# .md → .excalidraw
node "{SKILL_DIR}/flowchart-to-excalidraw.js" "<input.md>" "<output.excalidraw>"

# .excalidraw → .png
node "{SKILL_DIR}/excalidraw-screenshot.js" "<input.excalidraw>" "<output.png>"

# .excalidraw → 精简摘要「仅保留 id/type/坐标/字号/颜色/文本」
node "{SKILL_DIR}/extract-elements.js" "<output.excalidraw>" "<output.elements.txt>"
```

- 所有输出文件统一到 `$WORK_DIR/v{N}`（N 为当前迭代轮次）
- 对于 Standard / Animated 模式（已经是 .excalidraw），跳过第一步
- extract-elements.js 将 60KB+ JSON 压缩到 ~6KB 文本摘要，节省 reviewer token

### 步骤 3: 视觉评价

通过 subagent 调用 `excalidraw-reviewer` agent，传入 **PNG 截图**和 **元素摘要文件**（.elements.txt）。reviewer 结合视觉和数据给出精确的调整建议。

> ⚠️ **父 agent 不要自己读取图片**，直接把路径传给 subagent，避免浪费 token。
> ⚠️ **不要传完整 .excalidraw JSON**，用 extract-elements.js 提取的 .elements.txt 摘要代替，节省 token。

**调用方式：**
```
subagent({
  agent: "excalidraw-reviewer",
  task: "读取以下 Excalidraw 图表并给出视觉评价。\n\n截图路径：<output.png>\n元素摘要路径：<output.elements.txt>\n\n请先用 read 读取截图（看视觉效果），再用 read 读取 .elements.txt 摘要（分析元素数据）。\n结合两者给出评价报告，每个问题必须包含具体的元素 id、当前属性值和建议修改值。\n评价完成后，用 write 工具将报告保存到：$WORK_DIR/v{N}/review.md'"
})
```

### 步骤 4: 父 agent 编辑调整

父 agent 读取 `$WORK_DIR/v{N}/review.md` 评价报告，自己动手编辑后保存到 `$WORK_DIR/v{N+1}/{主题}.md`。

**为什么不让 subagent 编辑**：excalidraw-reviewer 擅长的是理解图片、发现问题，不代表它擅长生成/编辑 JSON。编辑工作由父 agent 自己完成更可靠。

**编辑原则：**
- **节点放不下内容就放大**：如果文字超出容器边界，加大容器的 width/height，同时调整相邻元素位置保持间距
- **评分变低不撤回**：如果新一轮评分比上一轮低，说明新问题暴露了，继续在新版本上优化，不要回退
- 每次调整后，如果元素位置变化，检查相邻元素是否需要联动移动

**操作步骤：**
1. 用 `read` 读取评价报告 `$WORK_DIR/v{N}/review.md`
2. 分析 Critical / Warning 问题
3. 用 `read` 读取上一轮 `$WORK_DIR/v{N}/{主题}.md`
4. 用 `edit` 工具直接修改 JSON 中有问题的元素（坐标、字号、颜色、尺寸等）
5. 创建 `$WORK_DIR/v{N+1}/` 目录，用 `write` 保存修改后的文件
6. 重复步骤 2-3（在新版本目录下重新转图 + 评价）验证改进效果

**迭代终止条件：**
- 总分 ≥ 80，且无 Critical 问题 → 通过
- 或已迭代 3 轮 → 强制通过

### 步骤 5: 展示给用户确认

迭代结束后，**必须**让用户看到效果图。用 `file://` 路径展示，不浪费 token 读图。

**操作：**
1. 用 bash 打开图片让用户直接查看：
   ```bash
   # Windows: 用默认图片查看器打开
   start "" "$WORK_DIR/v{N}/{主题}.png"
   # macOS: open "$WORK_DIR/v{N}/{主题}.png"
   # Linux: xdg-open "$WORK_DIR/v{N}/{主题}.png"
   ```
2. 在对话中输出文件路径，用户也可以手动打开：
   ```
   file://$WORK_DIR/v{N}/{主题}.png
   ```
3. 告知用户当前评分和主要改进情况
4. 用 `ask_user_question` 让用户选择：
   - **满意，保存** → 进入步骤 6 写入目标路径
   - **继续调整** → 用户说明调整需求 → 回到步骤 4 修改 → 重新转图展示
   - **不满意，放弃** → 不写入，告知用户结果保存在 $WORK_DIR 下可手动查看

### 步骤 6: 保存最终版本

用户确认满意后，从 /tmp 复制到目标路径。

```bash
# 从 $WORK_DIR/v{N} 复制到目标路径
cp "$WORK_DIR/v{N}/[主题].[类型].md" "<用户目标路径>"
```

如果用户始终不满意但已迭代 3 轮，告知用户所有版本在 $WORK_DIR 下，可手动查看和选择。

### 对已有 .flowchart.md 的优化流程

当用户提供已有的 .flowchart.md 文件要求优化时：

1. 先创建工作目录 `mkdir -p /tmp/excalidraw-{timestamp}` 和 `v1/`
2. 将原文件复制到 `$WORK_DIR/v1/` 作为工作副本（不在原文件上直接修改）
3. 直接从步骤 2 开始（已有文件跳过生成步骤）
4. 进入评价 → 编辑调整循环，每轮迭代版本号递增（v1, v2, v3）
5. 编辑调整由父 agent 自己完成（步骤 4）
6. 展示最新版本效果图给用户确认（步骤 5）
7. 用户满意后，将 $WORK_DIR/v{N}/ 下的工作副本写回原路径（步骤 6）

---

## Output Modes

根据用户的触发词选择输出模式：

| 触发词 | 输出模式 | 文件格式 | 用途 |
|--------|----------|----------|------|
| `Excalidraw`、`画图`、`流程图`、`思维导图` | **Obsidian**（默认） | `.md` | 在 Obsidian 中直接打开 |
| `标准Excalidraw`、`standard excalidraw` | **Standard** | `.excalidraw` | 在 excalidraw.com 打开/编辑/分享 |
| `Excalidraw动画`、`动画图`、`animate` | **Animated** | `.excalidraw` | 拖到 excalidraw-animate 生成动画 |

## Output Formats

### Mode 1: Obsidian Format (Default)

**严格按照以下结构输出，不得有任何修改：**

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'

# Excalidraw Data

## Text Elements
%%
## Drawing
\`\`\`json
{JSON 完整数据}
\`\`\`
%%
```

- Frontmatter 必须包含 `tags: [excalidraw]`，不能使用其他 frontmatter 设置
- `## Text Elements` 部分**必须留空**，插件会根据 JSON 自动填充

### Mode 2: Standard Excalidraw Format

纯 JSON 文件，可在 excalidraw.com 打开。`source` 使用 `https://excalidraw.com`。

### Mode 3: Animated Excalidraw Format

与 Standard 相同，每个元素添加 `customData.animate` 字段：

```json
"customData": { "animate": { "order": 1, "duration": 500 } }
```

- `order`: 播放顺序（1, 2, 3...），越小越先出现，相同 order 同时出现
- `duration`: 绘制时长（毫秒），默认 500
- 建议顺序：标题 → 主要框架 → 连接线 → 细节文字

---

## Diagram Types & Selection Guide

| 类型 | 英文 | 使用场景 | 做法 |
|------|------|---------|------|
| **流程图** | Flowchart | 步骤说明、工作流程、任务执行顺序 | 用箭头连接各步骤 |
| **思维导图** | Mind Map | 概念发散、主题分类、灵感捕捉 | 中心向外放射状结构 |
| **层级图** | Hierarchy | 组织结构、内容分级、系统拆解 | 自上而下或自左至右 |
| **关系图** | Relationship | 要素之间的影响、依赖、互动 | 图形间用连线表示关联 |
| **对比图** | Comparison | 两种以上方案或观点的对照分析 | 左右两栏或表格形式 |
| **时间线图** | Timeline | 事件发展、项目进度、模型演化 | 以时间为轴标注关键点 |
| **矩阵图** | Matrix | 双维度分类、任务优先级、定位 | X/Y 坐标平面安置 |
| **自由布局** | Freeform | 内容零散、灵感记录、初步信息收集 | 自由放置图块与箭头 |

---

## Design Rules

### Text & Format
- **所有文本元素必须使用** `fontFamily: 5`（Excalifont 手写字体）
- **双引号** `"` 替换为 `『』`，**圆括号** `()` 替换为 `「」`
- **字体大小**（硬性下限，低于此值不可读）：
  - 标题：20-28px（最小 20px）
  - 副标题：18-20px
  - 正文/标签：16-18px（最小 16px）
  - 次要注释：14px（慎用）
  - **绝对禁止低于 14px**
- **行高**：所有文本 `lineHeight: 1.25`
- **文字居中估算**：独立文本元素需手动计算 x 坐标
  - 估算宽度：`estimatedWidth = text.length * fontSize * 0.5`（CJK 字符用 `* 1.0`）
  - 居中公式：`x = centerX - estimatedWidth / 2`

### Layout & Design
- **画布范围**：所有元素在 0-1200 x 0-800 区域内，四周留白 50-80px
- **最小形状尺寸**：带文字的矩形/椭圆不小于 120x60px
- **元素间距**：最小 20-30px，防止重叠
- **禁止 Emoji**：如需视觉标记请使用简单图形或颜色区分

---

## Color Palette

### 文字颜色（strokeColor）

| 用途 | 色值 | 说明 |
|------|------|------|
| 标题 | `#1e40af` | 深蓝 |
| 副标题/连接线 | `#3b82f6` | 亮蓝 |
| 正文文字 | `#374151` | 深灰（白底最浅不低于 `#757575`） |
| 强调/重点 | `#f59e0b` | 金色 |

### 形状填充色（backgroundColor + fillStyle: "solid"）

| 色值 | 语义 | 适用场景 |
|------|------|---------|
| `#a5d8ff` | 浅蓝 | 输入、数据源、主要节点 |
| `#b2f2bb` | 浅绿 | 成功、输出、已完成 |
| `#ffd8a8` | 浅橙 | 警告、待处理、外部依赖 |
| `#d0bfff` | 浅紫 | 处理中、中间件、特殊项 |
| `#ffc9c9` | 浅红 | 错误、关键、告警 |
| `#fff3bf` | 浅黄 | 备注、决策、规划 |
| `#c3fae8` | 浅青 | 存储、数据、缓存 |
| `#eebefa` | 浅粉 | 分析、指标、统计 |

### 区域背景色（大矩形 + opacity: 30）

| 色值 | 语义 |
|------|------|
| `#dbe4ff` | 前端/UI 层 |
| `#e5dbff` | 逻辑/处理层 |
| `#d3f9d8` | 数据/工具层 |

### 对比度规则
- 白底上文字最浅不低于 `#757575`
- 浅色填充上用深色变体文字（如浅绿底用 `#15803d`）

---

## JSON Structure

**Obsidian 模式：**
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://github.com/zsviczian/obsidian-excalidraw-plugin",
  "elements": [...],
  "appState": { "gridSize": null, "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

**Standard / Animated 模式：**
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [...],
  "appState": { "gridSize": null, "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

---

## Element Template

**IMPORTANT**: 禁止包含 `frameId`、`index`、`versionNonce`、`rawText` 字段。`boundElements` 必须为 `null`（不是 `[]`），`updated` 必须为 `1`（不是时间戳）。

### 通用元素
```json
{
  "id": "unique-id",
  "type": "rectangle|text|arrow|ellipse|diamond",
  "x": 100, "y": 100,
  "width": 200, "height": 50,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "groupIds": [],
  "roundness": {"type": 3},
  "seed": 123456789,
  "version": 1,
  "isDeleted": false,
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false
}
```

`strokeStyle`: `"solid"`（实线）| `"dashed"`（虚线）| `"dotted"`（点线）

### 文本元素额外字段
```json
{
  "text": "显示文本",
  "fontSize": 20,
  "fontFamily": 5,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": null,
  "originalText": "显示文本",
  "autoResize": true,
  "lineHeight": 1.25
}
```

### Animated 模式额外字段
```json
"customData": { "animate": { "order": 1, "duration": 500 } }
```

---

## Common Mistakes to Avoid

- **文字偏移** — 独立 text 元素的 `x` 是左边缘，不是中心。必须用居中公式手动计算
- **元素重叠** — 放置新元素前检查与周围元素是否有至少 20px 间距
- **画布留白不足** — 内容不要贴着画布边缘，四周留 50-80px padding
- **标题没有居中于图表** — 标题应居中于下方图表的整体宽度，不是固定在 x=0
- **箭头标签溢出** — 长文字标签会超出短箭头，保持标签简短或加大箭头长度
- **对比度不够** — 浅色文字在白底上几乎不可见，不低于 `#757575`
- **字号太小** — 低于 14px 不可读，正文最小 16px

---

## Auto-save & File Naming

| 模式 | 文件名格式 | 示例 |
|------|-----------|------|
| Obsidian | `[主题].[类型].md` | `商业模式.relationship.md` |
| Standard | `[主题].[类型].excalidraw` | `商业模式.relationship.excalidraw` |
| Animated | `[主题].[类型].animate.excalidraw` | `商业模式.relationship.animate.excalidraw` |

- 保存位置：当前工作目录
- 优先使用中文文件名

## Tool Scripts

本目录还包含三个辅助脚本：

### flowchart-to-excalidraw.js
将 Obsidian Excalidraw 插件的 `.flowchart.md` 文件转换为标准 `.excalidraw` 文件。

```bash
node flowchart-to-excalidraw.js <input.flowchart.md> [output.excalidraw]
```

### excalidraw-screenshot.js
将 `.excalidraw` 文件渲染为 PNG 截图（使用系统 msedge 浏览器）。

```bash
node excalidraw-screenshot.js <input.excalidraw> [output.png]
```

- 默认输出到 `/tmp/` 目录
- 支持中文渲染，自动计算 viewBox

### extract-elements.js
将 `.excalidraw` JSON 文件提取为精简的元素摘要文本（60KB+ → ~6KB）。

```bash
node extract-elements.js <input.excalidraw> [output.txt]
```

- 默认输出到同目录下 `<filename>.elements.txt`
- 每个元素只保留：id、type、坐标、尺寸、字号、颜色、文本内容
- 用于传给 excalidraw-reviewer subagent，节省 token
