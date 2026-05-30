---
name: excalidraw-diagram
description: Generate Excalidraw diagrams from text content. Supports three output modes - Obsidian (.md), Standard (.excalidraw), and Animated (.excalidraw with animation order). Triggers on "Excalidraw", "画图", "流程图", "思维导图", "可视化", "diagram", "标准Excalidraw", "standard excalidraw", "Excalidraw动画", "动画图", "animate".
metadata:
  version: 5.2.0
---

# Excalidraw Diagram Generator

Create Excalidraw diagrams from text content with multiple output formats.

## Subagent 执行模式

**本 skill 的核心流程：生成图表 → 保存到目标路径。**

> ⚠️ **避免递归嵌套**：不要在 subagent 调用中使用 `skill: ["excalidraw-diagram"]`，否则 worker 也会尝试再套一层 subagent 导致无限嵌套。改为在 task 中直接写明所有规范。

> ⚠️ **视觉检查**：系统会自动使用 `image-recognizer` subagent 处理图片识别任务，无需手动配置评分流程。

### 脚本路径

所有辅助脚本位于本 skill 目录下：

```
SKILL_DIR = excalidraw-diagram skill 所在目录
{SKILL_DIR}/auto-layout.js              # 🔧 自动排版 v2（10 pass 算法引擎）
{SKILL_DIR}/fix.js                       # 🎯 AI 参数化精准修复
{SKILL_DIR}/flowchart-to-excalidraw.js   # .md → .excalidraw
{SKILL_DIR}/excalidraw-screenshot.js     # .excalidraw → .png

```

### 临时文件规范

所有中间产物（截图、修复脚本、元素摘要等）**必须放到临时目录**，不得污染源文件所在目录。

> ⚠️ **Windows 路径问题**：`/tmp/` 在 Windows 上不生效，实际路径为 `C:\Users\<用户名>\AppData\Local\Temp`。
> 传给 `image-recognizer` subagent 时，**截图/摘要路径必须用 Windows 绝对路径**（如 `C:\Users\10781\AppData\Local\Temp\架构图.preview.png`），
> 不能用 `/tmp/` 简写——subagent 是独立进程，不会自动解析 `/tmp/` 到 Windows 路径，每次都要重找很久。

| 文件类型 | 路径格式（Linux/macOS） | 路径格式（Windows） |
|----------|------------------------|---------------------|
| 截图 | `/tmp/<name>.preview.png` | `C:\Users\<用户名>\AppData\Local\Temp\<name>.preview.png` |
| 修复脚本 | `/tmp/<name>.fix.js` | `C:\Users\<用户名>\AppData\Local\Temp\<name>.fix.js` |

### 铁律：发现问题时修脚本，不绕过

当在生成或优化过程中发现 JS 脚本（`auto-layout.js`、`fix.js`、`excalidraw-screenshot.js` 等）的 bug 或不足时：

1. **必须同时修复脚本本身**——不能只用手动调整绕过问题
2. **在「常见问题模式库」中记录新模式**——症状、根因、修复方案
3. **如果修复了脚本 bug，在对应 P 条目中标注「已修复」**，避免重复排查

> 核心原则：修一次脚本 = 以后所有图表都受益。只修当前图表 = 下次还会踩坑。

### 铁律：修改必须通过 fix.js

> ⛔ **禁止直接编辑 JSON 坐标**。所有对 `.excalidraw` 文件的手动修改必须通过 `fix.js` 参数化执行。
> AI 只描述操作意图（"把 box1 改成 240px 宽，把 text1 在 box1 中居中"），坐标计算和文件写入由 fix.js 完成。

```bash
# ✅ 正确：通过 fix.js 参数化
node fix.js diagram.excalidraw --ops '[{"action":"resize","id":"box1","width":240}]'

# ❌ 错误：直接编辑 JSON
# 禁止 write/edit 工具直接修改 .excalidraw 文件内容
```

### 简化流程

```
步骤 1: 生成图表 → 保存到目标路径
步骤 2: 如需视觉检查 → 转图片后由 image-recognizer 自动识别（临时文件放 temp 目录，Windows 用绝对路径）
```

### 步骤 1: 生成图表

通过 subagent 使用 `delegate` agent + `mimo-v2.5` 模型生成 Excalidraw JSON。

在 task 中传入完整的需求描述，并**粘贴下方对应章节的全部内容**（Design Rules、Color Palette、JSON Structure、Element Template、Output Formats、Common Mistakes）。

**调用方式：**
```
subagent({
  agent: "delegate",
  model: "mimo-v2.5",
  task: "生成 Excalidraw 图表。\n\n用户请求：[具体内容]\n\n输出模式：[Obsidian / Standard / Animated]\n图表类型：[流程图 / 思维导图 / 层级图 / 关系图 等]\n\n请严格按照以下规范执行...\n[粘贴完整规范]\n\n生成完成后用 write 工具保存到：[目标路径]\n文件名：[主题].[类型].[扩展名]"
})
```

### 步骤 2: 视觉检查（可选）

如需检查图表视觉效果，可转换为图片后由 `image-recognizer` 自动识别。

> ⚠️ `excalidraw-screenshot.js` 只接受 `.excalidraw` 纯 JSON 格式。如果是 Obsidian `.md` 格式（frontmatter + 代码块），需先从 ` ```json ` 代码块中提取 JSON 到临时目录再截图。

```bash
# .excalidraw → .png（临时文件放 temp 目录）
# Linux/macOS:
node "{SKILL_DIR}/excalidraw-screenshot.js" "<input.excalidraw>" "/tmp/<name>.preview.png"
# Windows:
node "{SKILL_DIR}/excalidraw-screenshot.js" "<input.excalidraw>" "C:\Users\<用户名>\AppData\Local\Temp\<name>.preview.png"
```

然后用 `image-recognizer` subagent 查看截图（Windows 用绝对路径）：
```
subagent({
  subagent_type: "image-recognizer",
  prompt: "请检查以下 Excalidraw 图表截图的视觉效果——层容器包覆、箭头可见、元素重叠、z-order、标签一致性、层间间距、文字跨列、行间距。\n对每个问题指出大致位置。\n\n截图路径：C:\Users\<用户名>\AppData\Local\Temp\<name>.preview.png"
})
```
image-recognizer 返回的文字分析直接包含所有视觉问题，主 agent 根据返回结果用 fix.js 修复即可。

### 步骤 3: 展示给用户

用 `file://` 路径展示图片或直接告知文件保存路径：

```bash
# Windows: 用默认图片查看器打开
start "" "<output.png>"
```

如用户要求调整，直接编辑 .md/.excalidraw 文件后重新生成。

### 对已有 Excalidraw 文件的优化流程

当用户提供已有的 Excalidraw 文件要求优化排版时，**必须遵循铁律**——所有修改通过 fix.js：

根据文件格式不同分两种路径：

#### 格式 A：`.excalidraw` 文件（纯 JSON）

**优先用 `auto-layout.js` 自动修复**，不要一上来就手写坐标：

1. **自动排版**（安全 pass，禁用 balance-spacing）：
   ```bash
   node auto-layout.js "<文件>.excalidraw" --passes=clean-fields,fit-containers,center-text,fix-text-overlaps,align-rows,expand-layers,fix-font-size,detect-overlap,score
   ```
   > ⚠️ `balance-spacing` 可能导致层间重叠（P12），默认跳过。仅当层间距明显不均时才单独启用。
2. **AI 精准微调**：如有残留问题，用 `fix.js` 参数化修复
   ```bash
   node fix.js "<文件>.excalidraw" --ops '[{"action":"resize","id":"box1","width":240},{"action":"centerAll"}]'
   ```
3. 截图验证：`node excalidraw-screenshot.js "<文件>.excalidraw" "<temp>/<name>.preview.png"`
4. 用 `image-recognizer` 查看截图（⚠️ Windows 用绝对路径，见上方临时文件规范），确认效果

#### 格式 B：Obsidian `.md` 文件（frontmatter + JSON 代码块）

⚠️ **多了提取 JSON + 重写 .md 两步**，`auto-layout.js` 和 `excalidraw-screenshot.js` 都不能直接吃 `.md` 格式：

1. ~~用 `read` 读取原 `.md` 文件~~ **不要 read** —— compressed-json 内容不可读，读它浪费 token
2. **提取 JSON**：
   - 如果是 `compressed-json` 格式：用 `flowchart-to-excalidraw.js` 解压到 `<temp>/<name>.tmp.excalidraw`
   - 如果是 `json` 格式：用脚本提取 ` ```json ` 代码块到 `<temp>/<name>.tmp.excalidraw`
3. **自动排版**：`node auto-layout.js "<temp>/<name>.tmp.excalidraw"`
4. 截图验证：`node excalidraw-screenshot.js "<temp>/<name>.tmp.excalidraw" "<temp>/<name>.preview.png"`
5. 用 `image-recognizer` 查看截图确认效果（⚠️ **路径必须用 Windows 绝对路径**，见临时文件规范）
6. **⛔ 必须回写 .md**：将修复后的 JSON 替换回原 `.md` 文件的 ` ```json ` 代码块中（用 `json` 格式不用 `compressed-json`，插件两者都认）。**这一步不是可选的——不做等于白优化。**

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

## 优化前强制检查清单

> ⛔ 评分 100 不代表完美，评分低也不代表很烂（见 P16）！以下 8 项必须逐项确认，即使 auto-layout 评满分也要检查。
> ⛔ 多列布局（尤其是右列有横跨多层的层背景时）：禁用 `expand-layers`（P14）和 `balance-spacing`（P12/P15），只跑 safe passes。

| # | 检查项 | 诊断命令 | 通过标准 |
|---|--------|---------|---------|
| 1 | 层容器包住子元素 | `--passes=expand-layers` | 无文字/元素溢出层边框 |
| 2 | 箭头可见性 | 截图目视 | 箭头长度 >= 10px，不被框挤压 |
| 3 | 文字跨列污染 | image-recognizer 截图目视 | 单行文字不横跨到邻列 |
| 4 | 行间距 >= 8px | `--score` 看"文字间距过紧" | 0 处罚 |
| 5 | 层标签对齐一致 | 截图目视 | 所有层标签同一对齐方式（居中或左对齐） |
| 6 | 容器尺寸适配文字 | `--passes=fit-containers` | 无容器溢出（resized=0 为佳） |
| 7 | 字段规范 | `--score` 看"不规范字段" | 0 处罚 |
| 8 | 层间距均匀 | `--passes=balance-spacing` | 偏差 < 20px |

---

## 常见问题模式库

> 以下模式来自实战积累。遇到类似症状直接套用修复，不必从头诊断。

### P1: 文字偏移（x 坐标 = 容器中心，不是左边缘）
**症状**: 所有有容器的文字向右偏约半宽。**诊断**: `--score` 显示 N 处"文字未居中"。**修复**: `{"action":"centerAll"}`

### P2: 层容器包不住子元素
**症状**: 子元素溢出层背景框底部或右侧。**诊断**: `--passes=expand-layers` + 截图。**根因**: 文字元素高度未纳入计算。**修复**: `{"action":"expandLayer","layerId":"panel-key","margin":24}` + `{"action":"resize","id":"panel-key","width":1200}`（恢复统一宽度）

### P3: 箭头被相邻框挤压（gap < 10px）
**症状**: 箭头几乎不可见，被两侧矩形框吞掉。**诊断**: image-recognizer 截图目视。**修复**: `{"action":"alignRow","ids":["box-o1","box-o2","box-o3"],"y":390,"gap":20}` + 同步移动关联文字和箭头

### P4: 文字行间距过紧（gap < 8px）
**症状**: 上下两行文字紧贴。**诊断**: image-recognizer 截图目视。**修复**: 用 `reposition` 调各行 y 坐标，保持 gap >= 8px

### P5: 单行长文字横跨左右两列
**症状**: 一行文字宽 700+px，延伸入右侧列与其他文字视觉重叠。**诊断**: `grep` 检查 width > 500 的 text。**修复**: 拆分文本为 2 行 `"text":"第一行\n第二行"`，宽度自然缩减

### P6: 层标签对齐不一致
**症状**: 某个层标签左对齐，其余居中或反之。**诊断**: 截图目视。**修复**: 统一 y 坐标和 textAlign

### P7: fix.js 写入后引回不规范字段
**症状**: `--score` 显示 N 个"元素含不规范字段"。**修复**: 每次 fix.js 后接 `auto-layout.js --passes=clean-fields`

### P8: alignColumn / alignRow 对 text 元素高度计算错误
**症状**: alignColumn 后 text 间距异常大或异常小。**根因**: `fix.js` 中 `items[i].height || 40` 对 text 无 height 属性时用 40px 代替实际 `fontSize × lineHeight`。**修复**: 不用 alignColumn 处理 text，改用 `reposition` 逐元素精确定位

### P9: addBackground 背景框偏窄
**症状**: 文字 1-2px 溢出背景框右边界。**根因**: `addBackground` 用 `text.width + pad*2`，但 autoResize 的 width 可能略小于实际渲染宽度。**修复**: 背景框 width 额外 +4px

### P10: 背景框遮挡文字（z-order 错误）
**症状**: `addBackground` 后文字"消失"在背景框后面。**根因**: `ctx.elements.push()` 把背景加到数组末尾，Excalidraw 按数组顺序渲染（后渲染在上层）。**修复**: 改用 `ctx.elements.splice(textIdx, 0, bgEl)` 把背景插入到文字元素之前

### P11: 虚线小框内文字无法居中
**症状**: 虚线框内的文字（如 POLLING）无法被 `centerAll` 居中。**根因**: `isContainer()` 无条件排除所有 `strokeStyle === 'dashed'` 的框，但虚线小框（< 300px）也是合法容器。**修复**: `isContainer` 改为 `el.strokeStyle === 'dashed' && el.width > 300`，只排除虚线大分组框

### P12: balance-spacing 导致层重叠
**症状**: 自动排版后 Task 层和 Service 层的虚线边框重叠。**根因**: `balance-spacing` 取层间 gap 平均值时不设下限，gap 小到负数时强行均等化导致层挤压。**修复**: avgGap 加 `Math.max(20, ...)` 保底 20px；**紧急回滚**：禁用 `balance-spacing` pass 重跑 auto-layout

### P14: expand-layers 破坏多列布局
**症状**: expand-layers 后评分反而从 46 掉到 1，重叠数翻倍。**根因**: 原图是两列布局（左列 5 层垂直流 + 右列治理层横跨全高），expand-layers 把每层背景扩展到覆盖全部子元素后，层间原有的小重叠被放大成大面积交叠。**修复**: **多列布局（特别是有横跨右列的层时）禁用 `expand-layers`**，原图的空间分配是设计好的，扩展只会破坏。

### P15: balance-spacing 打乱层的垂直顺序
**症状**: balance-spacing 后 SP-API 交互层从第 2 层跳到第 4 层位置，内容流断裂。**根因**: `balance-spacing` 按几何 y 坐标排序后均等化间距，但多列布局中层与内容不是简单的一维堆叠——右列治理层比左列任意单层都高，按 y 排序会把左列后续层挤到下方。**紧急回滚**：重跑 `flowchart-to-excalidraw.js` 恢复原始文件。**修复**: 多列布局禁用 `balance-spacing`（见 P12）。

### P16: auto-layout 评分 ≠ 视觉质量
**症状**: 评分 46/100 (D) 但 visual 审查 8/9 PASS。**根因**: `detect-overlap` 把侧注元素在层背景内、层间小重叠等设计意图全报成 bug，拉低评分。**处理**: 评分低不要慌，**以 visual 审查结果为准**。只在 visual 审查 FAIL 的项上用 fix.js 修，评分分数自身可忽略。

### P17: 格式 B 流程漏回写是最常见翻车
**症状**: 优化完 `.excalidraw` 就停了，用户打开 `.flowchart.md` 还是旧图。**根因**: 格式 B 的步骤 6"重写 .md"容易被当可选步骤跳过。**修复**: `.excalidraw` 只是中转文件，优化完成后必须用脚本把 JSON 替换回 `.flowchart.md` 的 ` ```json ` 代码块，然后删除中转 `.excalidraw`。

### P19: center 垂直居中把面板标签丢进内容区
**症状**: 用 `center` 把层标签（如"关键设计决策层"）在面板中居中后，标签跑到内容中间和右侧文字重叠。**根因**: `center` 默认同时做 x+y 双向居中，把标签从面板顶部拉到中间。**修复**: `{"action":"center","id":"lbl-key","in":"panel-key","axis":"x"}` 只做水平居中。**预防**: 层标签用 `axis:"x"`，内容文字用默认 `both`。

### P20: moveGroup 移框忘移箭头
**症状**: moveGroup 把一排框右移 20px 后，箭头停在原位，框跑了。**根因**: `moveGroup` 只移动 ids 列表中的元素，不知道箭头连在哪些框上。**修复**: 用 `moveGroup` 的 `adjustArrows:true`（默认），两端都在移动组内的箭头自动同步。**注意**: 只有源框也能在移动组内才自动同步；一端移一端不动的箭头需手动 `deleteElement` + `addArrow`。

### P18: 算法排版有边界，最终靠人修
**核心认知**: auto-layout 和 fix.js 的 align/balance 类操作都是几何算法，不懂语义。多层、多列、横跨的复杂布局（如左右分栏 + 虚线层背景），算法排出来的结果往往比原图更差。**优化原则**: 优先保持原图的空间设计意图，只用 `clean-fields` / `fit-containers` / `center-text` / `fix-font-size` 这 4 个 safe pass 做规范化。对齐和间距问题**靠 visual 审查识别出来以后，人工用 fix.js 的 `reposition` / `moveGroup` 精准调**，不扔给算法全自动解决。

> 补充：image-recognizer 看图识别问题并返回文字分析，主 agent 根据分析结果理解布局意图后手写 fix.js ops 修复。

### P13: align-rows 后箭头被框遮住
**症状**: align-rows 移动容器后，箭头起点仍在旧位置，被框边缘遮挡。**根因**: `passAlignRows` 只同步了关联文字，未同步箭头位置。**修复**: 预计算 arrow→{src,dst} 映射，容器移动后重新计算箭头 x + points，确保起点贴源框右沿、终点贴目标框左沿

### 视觉审核

通过 `image-recognizer` subagent 看截图完成所有审核，返回的文字分析直接作为审核结果。主 agent 无需单独读任何 txt 文件。

**审核项（全部由 image-recognizer 覆盖）：**

| 检查项 | 说明 |
|--------|------|
| 层容器包覆 | 所有子元素完全在层边框内，有无溢出 |
| 箭头可见 | 箭头是否被框"吞掉"，两端可见距离是否足够 |
| 元素重叠 | 文字叠文字、框叠框（不含容器内文字） |
| z-order | 背景框是否遮挡了文字 |
| 标签对齐 | 所有层标签是否统一对齐方式（居中/左对齐） |
| 层间间距 | 各层之间垂直间隙是否明显不均 |
| 文字跨列 | 单行文字是否横跨到邻列 |
| 行间距 | 上下文字是否紧贴 |

**image-recognizer 提示词模板：**

```
你是一个图表视觉审查员。只输出 PASS 或 FAIL。不使用模糊词。

【铁律】
- 每项只有一个结论: PASS 或 FAIL
- FAIL 必须给出大致位置（如"Task 层右下角"、"第 3 个箭头左侧"）
- 不要估像素、不要读数、不要做坐标分析——你只描述你看到了什么
- 不要总结、不要建议、不要"整体评价"

【审查清单】

1. 层容器包覆 — 逐层检查所有虚线框。子元素有无溢出？
2. 箭头可见 — 每个箭头两端是否清晰可见，没有被相邻框遮挡？
3. 元素重叠 — 有无文字叠文字、框叠框？（同容器内不算）
4. z-order — 有无文字被背景框遮住看不见？
5. 标签一致性 — 所有层标签命名格式、对齐方式是否统一？
6. 层间间距 — 各层之间的垂直间隙是否明显不均匀？

【输出格式】
PASS: 1,3,4,6
FAIL: 2(第3个箭头被框吞掉), 5(治理层层标签左对齐其余居中)
```

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

本目录还包含四个辅助脚本：

### auto-layout.js
**自动排版引擎 v2**，算法驱动的布局优化，10 个 Pass：

```bash
node auto-layout.js <input.excalidraw> [output] [--dry-run] [--verbose]
node auto-layout.js <input.excalidraw> --passes fit-containers,center-text,score
node auto-layout.js <input.excalidraw> --score              # 仅评分
node auto-layout.js <input.excalidraw> --padding 16          # 自定义内边距
```

**所有 Pass：**

| # | Pass | 功能 | 算法 |
|---|------|------|------|
| 1 | `clean-fields` | 清理不规范字段 | 遍历删除 versionNonce/index/frameId/rawText |
| 2 | `fit-containers` | 容器自适应扩展 | 文字超出 → 自动扩展容器宽/高（含 padding） |
| 3 | `center-text` | 文字居中 | 容器中心对齐（排除层标签） |
| 4 | `fix-text-overlaps` | 文字防重叠 | 检测交叠 → 最小位移方向推开 |
| 5 | `align-rows` | 行对齐 | 同行元素间距均匀化，同步移动关联文字 |
| 6 | `expand-layers` | 层背景扩展 | 层背景自动包住所有子元素 |
| 7 | `fix-font-size` | 字号规范化 | 14px 以下 → 16px |
| 8 | `balance-spacing` | 层间距均衡 | 层间 gap 统一为平均值 |
| 9 | `detect-overlap` | 重叠检测 | 排除包含关系、容器内文字 |
| 10 | `score` | 视觉评分 | 综合评分 0-100（A/B/C/D） |

**核心改进 (v2)：**
- 文字高度统一用 `fontSize × lineHeight` 计算（不再依赖过期的 `el.height`）
- 自动识别并排除层级标签（大字号、左边缘、短文本）
- fit-containers 防止容器碰撞
- align-rows 预计算 text→container 映射，同步移动

### fix.js
**AI 参数化精准修复**，操作注册表模式，轻松扩展。AI 只描述意图，脚本负责执行：

```bash
node fix.js <diagram.excalidraw> --ops '<JSON数组>'
node fix.js <diagram.excalidraw> --file ops.json
echo '<JSON>' | node fix.js <diagram.excalidraw>
```

**ctx 上下文（handler 可用）：**
- `ctx.elements` — 元素数组
- `ctx.elMap` — id→元素映射
- `ctx.getEl(id)` — 安全获取（不存在则抛错）
- `ctx.rect(el)` / `ctx.center(el)` — 边界矩形/中心点
- `ctx.isContainer(el)` / `ctx.isLayerBg(el)` — 元素分类

**已注册操作：**

| 操作 | 说明 | 关键参数 |
|------|------|---------|
| `resize` | 调整容器尺寸 | `id`, `width`, `height` |
| `reposition` | 移动元素坐标 | `id`, `x`, `y` |
| `center` | 文字在指定容器居中 | `id`, `in`(容器id), `axis`("x"\|"y"\|"both",默认both) |
| `centerAll` | 全图自动居中 | `axis`("x"\|"y"\|"both",默认both) |
| `addBackground` | 给文字加背景框 | `id`, `color`, `padding`, `stroke` |
| `deleteElement` | 软删除元素 | `id` |
| `setStyle` | 批量设置样式/text | `id`, `fontSize`, `text`, `originalText`, `strokeColor`... |
| `alignRow` | 同行均匀间距 | `ids[]`, `y`, `gap`, `startX` |
| `alignColumn` | 同列均匀间距 | `ids[]`, `x`, `gap`, `startY` |
| `distributeEven` | 均匀分布(x/y轴) | `ids[]`, `axis` |
| `fitText` | 容器自适应文字 | `boxId`, `textId`, `padding` |
| `expandLayer` | 扩展层背景 | `layerId`, `margin` |
| `addArrow` | 添加箭头 | `from{x,y}`, `to{x,y}` |
| `moveGroup` | 整体平移（自动同步箭头） | `ids[]`, `dx`, `dy`, `adjustArrows`(默认true) |
| `cloneElement` | 克隆元素 | `id`, `newId`, `dx`, `dy` |

#### 扩展新操作

当需要 fix.js 不支持的操作时，按以下步骤扩展：

1. 在 `fix.js` 的 `OPS` 表中新增条目
2. 按模板实现 handler：
   ```javascript
   newOp: (op, ctx) => {
     const el = ctx.getEl(op.id);
     // ... 使用 ctx.rect() / ctx.center() 等工具函数 ...
     // 直接修改 el 的属性（ctx.elements 是引用）
     // 报错: throw new Error('原因')
   },
   ```
3. 在此文档表中新增一行
4. 测试：`node fix.js test.excalidraw --ops '[{"action":"newOp","id":"x"}]'`

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

- 默认输出到系统临时目录（Linux: `/tmp/`，Windows: `%LOCALAPPDATA%\Temp`）
- 支持中文渲染，自动计算 viewBox

### extract-elements.js
将 `.excalidraw` JSON 文件提取为精简的元素摘要文本（60KB+ → ~6KB）。调试排查时可用，日常流程中不再需要。

```bash
node extract-elements.js <input.excalidraw> <temp>/<name>.elements.txt
```

- **必须指定输出到临时目录**（Windows 用绝对路径），不要默认输出到源文件同目录
- 每个元素只保留：id、type、坐标、尺寸、字号、颜色、文本内容
