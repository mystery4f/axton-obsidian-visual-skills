#!/usr/bin/env node
/**
 * Excalidraw Fix — AI 参数化精准修复（可扩展注册表模式）
 *
 * 【铁律】所有对 .excalidraw 文件的直接修改必须通过 fix.js 执行。
 * AI 禁止直接编辑 JSON 坐标，只允许描述操作意图，由 fix.js 负责坐标计算和执行。
 *
 * 【扩展规则】需要新操作类型时：
 *   1. 在 OPS 表中新增一个条目
 *   2. 按相同签名实现：handler(op, ctx) → void（抛出错误表示失败）
 *   3. 更新下方「操作列表」注释
 *   4. 更新 SKILL.md 的 fix.js 操作表
 *
 * ctx 提供:
 *   ctx.elements     - 元素数组
 *   ctx.elMap        - id → element 映射
 *   ctx.file         - 文件路径
 *   ctx.getEl(id)    - 安全获取元素（不存在则抛错）
 *   ctx.rect(el)     - 获取元素边界矩形
 *   ctx.center(el)   - 获取元素中心点
 *   ctx.isContainer(el)  - 判断是否为实心容器
 *   ctx.isLayerBg(el)    - 判断是否为层背景
 *
 * 用法:
 *   node fix.js <diagram.excalidraw> --ops '<JSON数组>'
 *   node fix.js <diagram.excalidraw> --file ops.json
 *   echo '<JSON>' | node fix.js <diagram.excalidraw>
 */

const fs = require('fs');

// ── Helper Library ────────────────────────────────────
function rect(el) {
  const h = el.type === 'text'
    ? (el.fontSize || 16) * (el.lineHeight || 1.25)
    : (el.height || (el.fontSize || 16) * (el.lineHeight || 1.25));
  return { x: el.x, y: el.y, w: el.width, h, r: el.x + el.width, b: el.y + h };
}
function center(el) {
  const r = rect(el);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
function isContainer(el) {
  if (!['rectangle', 'ellipse', 'diamond'].includes(el.type)) return false;
  if (el.strokeStyle === 'dashed' && el.width > 300) return false;
  if ((el.opacity || 100) < 80) return false;
  if (el.width < 20 || el.height < 12) return false;
  return true;
}
function isLayerBg(el) {
  if (el.type !== 'rectangle') return false;
  if ((el.opacity || 100) < 50) return true;
  if (el.width > 800 && el.height > 100) return true;
  return false;
}

// ============================================================
//  操作注册表 — 在此添加新操作
//  模板:  operationName: (op, ctx) => { ... }
//         op  = 用户传入的 JSON 对象（含 action + 自定义字段）
//         ctx = 上下文对象（见顶部文档）
// ============================================================
const OPS = {

  // ── resize: 调整容器尺寸 ──
  resize: (op, ctx) => {
    const el = ctx.getEl(op.id);
    if (op.width !== undefined) el.width = op.width;
    if (op.height !== undefined) el.height = op.height;
  },

  // ── reposition: 移动元素 ──
  reposition: (op, ctx) => {
    const el = ctx.getEl(op.id);
    if (op.x !== undefined) el.x = op.x;
    if (op.y !== undefined) el.y = op.y;
  },

  // ── center: 文字在指定容器中居中（axis: "x"|"y"|"both"，默认 "both"）──
  center: (op, ctx) => {
    if (!op.in) throw new Error('center 需要 in 参数指定容器');
    const text = ctx.getEl(op.id);
    const box = ctx.getEl(op.in);
    const axis = op.axis || 'both';
    if (axis === 'x' || axis === 'both') {
      text.x = Math.round(box.x + box.width / 2 - text.width / 2);
    }
    if (axis === 'y' || axis === 'both') {
      text.y = Math.round(box.y + (box.height - (text.fontSize || 16) * (text.lineHeight || 1.25)) / 2);
    }
  },

  // ── centerAll: 自动对全图所有文字居中（axis: "x"|"y"|"both"，默认 "both"）──
  centerAll: (op, ctx) => {
    const containers = ctx.elements.filter(e => isContainer(e) && !isLayerBg(e));
    const axis = op.axis || 'both';
    let c = 0;
    for (const text of ctx.elements.filter(e => e.type === 'text' && !e.isDeleted)) {
      const tc = center(text);
      const candidates = containers.filter(b => {
        const rb = rect(b);
        return tc.x >= rb.x && tc.x <= rb.r && tc.y >= rb.y && tc.y <= rb.b;
      });
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => a.width * a.height - b.width * b.height);
      const box = candidates[0];
      if (axis === 'x' || axis === 'both') {
        text.x = Math.round(box.x + box.width / 2 - text.width / 2);
      }
      if (axis === 'y' || axis === 'both') {
        text.y = Math.round(box.y + (box.height - (text.fontSize || 16) * (text.lineHeight || 1.25)) / 2);
      }
      c++;
    }
    console.log(`  → ${c} 处文字居中`);
  },

  // ── addBackground: 给文字加背景框 ──
  addBackground: (op, ctx) => {
    const text = ctx.getEl(op.id);
    const pad = op.padding || 8;
    const color = op.color || '#fff3bf';
    const stroke = op.stroke || '#f59e0b';
    const boxId = op.boxId || (op.id + '-bg');

    if (ctx.elMap[boxId] && !ctx.elMap[boxId].isDeleted) {
      console.log(`  ⚠️  背景框已存在: ${boxId}，跳过`);
      return;
    }

    // z-order: 插入到文字元素之前，确保文字渲染在背景之上
    const textIdx = ctx.elements.findIndex(e => e.id === op.id);
    const bgEl = {
      id: boxId, type: 'rectangle',
      x: text.x - pad, y: text.y - pad / 2,
      width: text.width + pad * 2 + 4,  // +4 防 P9: autoResize 宽度略小于实际渲染
      height: (text.fontSize || 16) * (text.lineHeight || 1.25) + pad,
      angle: 0, strokeColor: stroke, backgroundColor: color,
      fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid',
      roughness: 1, opacity: op.opacity || 80, groupIds: [],
      roundness: { type: 3 }, seed: Date.now() % 100000,
      version: 1, isDeleted: false, boundElements: null,
      updated: 1, link: null, locked: false
    };
    if (textIdx >= 0) {
      ctx.elements.splice(textIdx, 0, bgEl);
    } else {
      ctx.elements.push(bgEl);
    }
  },

  // ── deleteElement: 软删除元素 ──
  deleteElement: (op, ctx) => {
    ctx.getEl(op.id).isDeleted = true;
  },

  // ── setStyle: 批量设置样式属性 ──
  setStyle: (op, ctx) => {
    const el = ctx.getEl(op.id);
    const keys = ['fontSize', 'strokeColor', 'backgroundColor', 'fillStyle',
      'strokeWidth', 'strokeStyle', 'opacity', 'fontFamily',
      'textAlign', 'roundness', 'text', 'originalText', 'lineHeight'];
    for (const k of keys) {
      if (op[k] !== undefined) el[k] = op[k];
    }
  },

  // ── alignRow: 同行元素均匀间距 ──
  alignRow: (op, ctx) => {
    if (!op.ids || op.ids.length < 2) throw new Error('alignRow 需要至少 2 个 id');
    const items = op.ids.map(ctx.getEl);
    items.sort((a, b) => a.x - b.x);

    const gap = op.gap ?? Math.round(
      items.slice(1).reduce((s, e, i) =>
        s + (e.x - (items[i].x + items[i].width)), 0) / (items.length - 1)
    );
    const y = op.y ?? items[0].y;
    let cx = op.startX ?? items[0].x;

    for (let i = 0; i < items.length; i++) {
      items[i].x = cx;
      items[i].y = y;
      cx += items[i].width + gap;
    }
    console.log(`  → ${items.length} items, gap=${gap}, y=${y}`);
  },

  // ── alignColumn: 同列元素均匀间距 ──
  alignColumn: (op, ctx) => {
    if (!op.ids || op.ids.length < 2) throw new Error('alignColumn 需要至少 2 个 id');
    const items = op.ids.map(ctx.getEl);
    items.sort((a, b) => a.y - b.y);

    const gap = op.gap ?? Math.round(
      items.slice(1).reduce((s, e, i) =>
        s + (e.y - (items[i].y + (items[i].height || 40))), 0) / (items.length - 1)
    );
    const x = op.x ?? items[0].x;
    let cy = op.startY ?? items[0].y;

    for (let i = 0; i < items.length; i++) {
      items[i].x = x;
      items[i].y = cy;
      cy += (items[i].height || 40) + gap;
    }
    console.log(`  → ${items.length} items, gap=${gap}, x=${x}`);
  },

  // ── distributeEven: 均匀分布（x 轴或 y 轴） ──
  distributeEven: (op, ctx) => {
    if (!op.ids || op.ids.length < 2) throw new Error('distributeEven 需要至少 2 个 id');
    const items = op.ids.map(ctx.getEl);
    const axis = op.axis || 'x';

    if (axis === 'x') {
      items.sort((a, b) => a.x - b.x);
      const totalW = items.reduce((s, e) => s + e.width, 0);
      const space = op.totalWidth ?? (items.at(-1).x + items.at(-1).width - items[0].x);
      const gap = Math.round((space - totalW) / (items.length - 1));
      let cx = items[0].x;
      for (let i = 1; i < items.length; i++) {
        items[i].x = cx + items[i - 1].width + gap;
        cx = items[i].x;
      }
    } else {
      items.sort((a, b) => a.y - b.y);
      const totalH = items.reduce((s, e) => s + (e.height || 40), 0);
      const space = op.totalHeight ?? (items.at(-1).y + (items.at(-1).height || 40) - items[0].y);
      const gap = Math.round((space - totalH) / (items.length - 1));
      let cy = items[0].y;
      for (let i = 1; i < items.length; i++) {
        items[i].y = cy + (items[i - 1].height || 40) + gap;
        cy = items[i].y;
      }
    }
    console.log(`  → ${items.length} items on ${axis}-axis`);
  },

  // ── fitText: 容器自适应文字 ──
  fitText: (op, ctx) => {
    const box = ctx.getEl(op.boxId);
    const text = ctx.getEl(op.textId);
    const pad = op.padding || 12;
    const neededW = text.width + pad * 2;
    const neededH = (text.fontSize || 16) * (text.lineHeight || 1.25) + pad * 2;
    let changed = false;
    if (box.width < neededW) { box.width = Math.ceil(neededW); changed = true; }
    if (box.height < neededH) { box.height = Math.ceil(neededH); changed = true; }
    if (changed) {
      text.x = Math.round(box.x + box.width / 2 - text.width / 2);
      text.y = Math.round(box.y + (box.height - (text.fontSize || 16) * (text.lineHeight || 1.25)) / 2);
    }
    console.log(`  → ${op.boxId} ${changed ? `→ ${box.width}×${box.height}` : '(无需调整)'}`);
  },

  // ── expandLayer: 层背景自动扩展包住子元素 ──
  expandLayer: (op, ctx) => {
    const layer = ctx.getEl(op.layerId);
    const margin = op.margin || 20;
    const children = ctx.elements.filter(e =>
      e.id !== layer.id && !e.isDeleted &&
      ['rectangle', 'ellipse', 'diamond', 'text'].includes(e.type)
    );

    const inside = children.filter(c => {
      const cc = center(c);
      return cc.x >= layer.x && cc.x <= layer.x + layer.width &&
             cc.y >= layer.y && cc.y <= layer.y + layer.height;
    });

    if (inside.length === 0) { console.log('  ⚠️  层内无子元素'); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of inside) {
      const r = rect(c);
      if (r.x < minX) minX = r.x; if (r.y < minY) minY = r.y;
      if (r.r > maxX) maxX = r.r; if (r.b > maxY) maxY = r.b;
    }
    layer.x = minX - margin;
    layer.y = minY - margin;
    layer.width = maxX - minX + margin * 2;
    layer.height = maxY - minY + margin * 2;
    console.log(`  → (${layer.x},${layer.y}) ${layer.width}×${layer.height}`);
  },

  // ── addArrow: 添加箭头 ──
  addArrow: (op, ctx) => {
    if (!op.from || !op.to) throw new Error('addArrow 需要 from 和 to');
    const id = op.id || ('arrow-' + Date.now());
    ctx.elements.push({
      id, type: 'arrow',
      x: op.from.x, y: op.from.y,
      width: op.to.x - op.from.x, height: op.to.y - op.from.y,
      angle: 0, strokeColor: op.strokeColor || '#3b82f6', backgroundColor: 'transparent',
      fillStyle: 'solid', strokeWidth: op.strokeWidth || 2, strokeStyle: 'solid',
      roughness: 1, opacity: 100, groupIds: [], roundness: { type: 2 },
      seed: Date.now() % 100000, version: 1, isDeleted: false,
      boundElements: null, updated: 1, link: null, locked: false,
      points: [[0, 0], [op.to.x - op.from.x, op.to.y - op.from.y]],
      lastCommittedPoint: null, startBinding: null, endBinding: null,
      startArrowhead: null, endArrowhead: 'arrow'
    });
  },

  // ── moveGroup: 整体平移一组元素（adjustArrows: 自动同步箭头，默认 true）──
  moveGroup: (op, ctx) => {
    if (!op.ids) throw new Error('moveGroup 需要 ids');
    const dx = op.dx || 0, dy = op.dy || 0;
    const movedSet = new Set(op.ids);
    for (const id of op.ids) ctx.getEl(id).x += dx, ctx.getEl(id).y += dy;

    // 自动同步两端都在移动组内的箭头
    let arrowsAdjusted = 0;
    const adjustArrows = op.adjustArrows !== false;
    if (adjustArrows && (dx !== 0 || dy !== 0)) {
      for (const el of ctx.elements) {
        if (el.type !== 'arrow' || el.isDeleted) continue;
        const lastPt = el.points?.at(-1);
        const endX = el.x + (lastPt ? lastPt[0] : (el.width || 0));
        const endY = el.y + (lastPt ? lastPt[1] : (el.height || 0));
        // 找箭头两端落在哪个元素内
        const srcEl = ctx.elements.find(e => e.id !== el.id && !e.isDeleted
          && ['rectangle','ellipse','diamond','text'].includes(e.type)
          && el.x >= rect(e).x - 2 && el.x <= rect(e).r + 2
          && el.y >= rect(e).y - 2 && el.y <= rect(e).b + 2);
        const dstEl = ctx.elements.find(e => e.id !== el.id && !e.isDeleted
          && ['rectangle','ellipse','diamond','text'].includes(e.type)
          && endX >= rect(e).x - 2 && endX <= rect(e).r + 2
          && endY >= rect(e).y - 2 && endY <= rect(e).b + 2);
        const srcMoved = srcEl && movedSet.has(srcEl.id);
        const dstMoved = dstEl && movedSet.has(dstEl.id);
        if (srcMoved && dstMoved) {
          el.x += dx; el.y += dy;
          arrowsAdjusted++;
        }
      }
    }
    const extra = arrowsAdjusted > 0 ? ` +${arrowsAdjusted} 箭头` : '';
    console.log(`  → ${op.ids.length} items${extra} (${dx > 0 ? '+' : ''}${dx}, ${dy > 0 ? '+' : ''}${dy})`);
  },

  // ── cloneElement: 克隆元素 ──
  cloneElement: (op, ctx) => {
    const src = ctx.getEl(op.id);
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = op.newId || (op.id + '-clone');
    clone.x += (op.dx || 0);
    clone.y += (op.dy || 0);
    ctx.elements.push(clone);
  },

  // ★ 在此添加新操作 ★
  // 模板:
  // newOperation: (op, ctx) => {
  //   const el = ctx.getEl(op.id);
  //   // ... 你的逻辑 ...
  //   // 如需报错: throw new Error('message');
  //   // 如需日志: console.log('  → done');
  // },

};

// ============================================================
//  CLI & Execute
// ============================================================
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  const opNames = Object.keys(OPS).sort().join(', ');
  console.log(`
Excalidraw Fix — AI 参数化精准修复

用法: node fix.js <diagram.excalidraw> --ops '<JSON数组>'
      node fix.js <diagram.excalidraw> --file ops.json
      echo '<JSON>' | node fix.js <diagram.excalidraw>

可用操作: ${opNames}
`);
  process.exit(0);
}

// 解析参数
const fileArg = args.find(a => !a.startsWith('--'));
if (!fileArg) { console.error('❌ 缺少文件参数'); process.exit(1); }
if (!fs.existsSync(fileArg)) { console.error('❌ 文件不存在: ' + fileArg); process.exit(1); }

let ops;
const opsIdx = args.indexOf('--ops'), fileIdx = args.indexOf('--file');
if (opsIdx >= 0 && args[opsIdx + 1]) {
  ops = JSON.parse(args[opsIdx + 1]);
} else if (fileIdx >= 0 && args[fileIdx + 1]) {
  ops = JSON.parse(fs.readFileSync(args[fileIdx + 1], 'utf8'));
} else {
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch (_) {}
  if (stdin.trim()) ops = JSON.parse(stdin);
}
if (!ops) { console.error('❌ 无操作参数。用 --ops, --file, 或 stdin 传入'); process.exit(1); }
if (!Array.isArray(ops)) ops = [ops];

// 加载文件
const data = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
const elements = data.elements || [];
const elMap = {};
for (const el of elements) elMap[el.id] = el;

const ctx = {
  elements, elMap, file: fileArg,
  getEl(id) { const e = elMap[id]; if (!e) throw new Error(`元素不存在: ${id}`); return e; },
  rect, center, isContainer, isLayerBg
};

// 执行
let ok = 0, fail = 0;
for (const op of ops) {
  const handler = OPS[op.action];
  if (!handler) {
    console.error(`✗ 未知操作: ${op.action}（可用: ${Object.keys(OPS).join(', ')}）`);
    fail++;
    continue;
  }
  try {
    handler(op, ctx);
    console.log(`✓ ${op.action.padEnd(14)} ${op.id || ''}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${op.action} ${op.id || ''}: ${e.message}`);
    fail++;
  }
}

// 保存
// 保存前清理不规范字段
for (const el of elements) {
  const remove = ['versionNonce','index','frameId','rawText','hasTextLink'];
  for (const f of remove) if (f in el) delete el[f];
  if (el.roundness === null) delete el.roundness;
  if (Array.isArray(el.boundElements) && el.boundElements.length===0) el.boundElements=null;
  if (el.updated !== undefined) el.updated = 1;
}

if (data.appState) {
  data.appState.gridSize = null;
  data.appState.viewBackgroundColor = '#ffffff';
}
if (!data.files) data.files = {};
fs.writeFileSync(fileArg, JSON.stringify(data, null, 2), 'utf8');
console.log(`\n${ok} 成功 / ${fail} 失败 → ${fileArg}`);
