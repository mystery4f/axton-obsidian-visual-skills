# TODO

## P0: 自动布局引擎 `auto-layout.js`

用 elkjs 代替手动算坐标，核心改进。

- [ ] 安装 elkjs 依赖
- [ ] 实现两阶段生成：
  - 阶段1: 生成拓扑 JSON（节点 + 边关系，无坐标）
  - 阶段2: elkjs 计算坐标 → 合并为最终 Excalidraw JSON
- [ ] 支持布局算法选择：
  - `ELK_LAYERED` — 层级图/流程图（默认）
  - `ELK_MRTREE` — 树形/思维导图
  - `ELK_FORCE` — 关系图/自由布局
- [ ] 输入格式：从 .elements.txt 或独立的拓扑 JSON 读取节点和边
- [ ] 输出：直接修改 .excalidraw JSON 中的坐标，保留其他属性不变
- [ ] 集成到 SKILL.md 流程：步骤 2 中 `extract-elements.js` → `auto-layout.js` → 覆写 .excalidraw

## P1: 文字宽度精确计算

- [ ] 在 `extract-elements.js` 或新脚本中，用 canvas `measureText` 精确计算文字宽度
- [ ] 对比 text 和 container 的 width/height，自动标记溢出的节点
- [ ] 溢出时自动放大容器尺寸

## P2: 布局模板

- [ ] 预定义常见布局模板：上下分层、左右对比、放射状
- [ ] 模板包含：区域矩形坐标框架、节点排列规则
- [ ] 生成时选择模板，直接套用坐标框架

## P3: 流程优化

- [ ] `auto-layout.js` 完成后，reviewer 重点检查内容/颜色/可读性，布局问题由算法保证
- [ ] 减少迭代轮次预期：3 轮 → 1-2 轮
