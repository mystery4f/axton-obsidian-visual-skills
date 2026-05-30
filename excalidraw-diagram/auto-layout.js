#!/usr/bin/env node
/**
 * Excalidraw Auto-Layout v2
 * 自动排版引擎 — 算法驱动的布局优化
 *
 * 新增 Pass:
 *   fit-containers   - 容器自适应：文字超出容器时自动扩展容器尺寸
 *   fix-text-overlaps - 文字防重叠：检测并自动修正文字间交叠
 *   align-rows        - 行对齐：检测同行元素，均匀化间距
 *   expand-layers     - 层扩展：层背景矩形自动包住所有子元素
 *   balance-spacing   - 间距均衡：同行/列元素间距统一
 *
 * Usage:
 *   node auto-layout.js <input> [output] [--dry-run] [--verbose]
 *   node auto-layout.js <input> --passes center-text,fit-containers
 *   node auto-layout.js <input> --score          # 仅评分
 */

const fs = require('fs');
const path = require('path');

// ── CLI ──────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(`
Excalidraw Auto-Layout v2

用法: node auto-layout.js <input.excalidraw> [output] [选项]

选项:
  --passes <s1,s2>  执行的步骤（默认全部）
                     可选: clean-fields fit-containers center-text
                           fix-text-overlaps align-rows expand-layers
                           fix-font-size balance-spacing detect-overlap score
  --dry-run         仅报告，不修改
  --verbose         详细输出
  --score           仅输出视觉评分
  --padding <n>     容器内边距（默认 12）
`);
  process.exit(0);
}

const inputFile = args[0];
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('❌ 文件不存在: ' + inputFile);
  process.exit(1);
}

const isDryRun   = args.includes('--dry-run');
const isVerbose  = args.includes('--verbose');
const scoreOnly  = args.includes('--score');
const outputFile = (() => { for (let i=1;i<args.length;i++) if (!args[i].startsWith('--')) return args[i]; return inputFile; })();

// 默认全部 pass
const allPasses = ['clean-fields','fit-containers','center-text','fix-text-overlaps','align-rows','expand-layers','fix-font-size','balance-spacing','detect-overlap','score'];
const passesArg = args.find(a=>a.startsWith('--passes='));
const enabled   = passesArg ? new Set(passesArg.split('=')[1].split(',').map(s=>s.trim())) : new Set(scoreOnly ? ['score'] : allPasses);

const paddingArg = args.find(a=>a.startsWith('--padding='));
const PADDING = paddingArg ? parseInt(paddingArg.split('=')[1]) : 12;

// ── Load ──────────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(inputFile,'utf8'));
const elements = (data.elements || []).filter(e => !e.isDeleted);
const elMap = {};
for (const e of elements) elMap[e.id] = e;

const stats = {};
function stat(k, v) { stats[k] = (stats[k]||0) + v; }
function vlog(...a) { if (isVerbose) console.log(' ', ...a); }

// ── Helpers ───────────────────────────────────────────
function rect(el) {
  const h = el.type === 'text' ? (el.fontSize||16)*(el.lineHeight||1.25) : (el.height || el.fontSize * (el.lineHeight||1.25));
  return { x:el.x, y:el.y, w:el.width, h, r:el.x+el.width, b:el.y+h };
}
function overlap(a, b) {
  const ra=rect(a), rb=rect(b);
  return ra.x < rb.r && ra.r > rb.x && ra.y < rb.b && ra.b > rb.y;
}
function contains(outer, inner) {
  const ro=rect(outer), ri=rect(inner);
  return ro.x <= ri.x && ro.y <= ri.y && ro.r >= ri.r && ro.b >= ri.b;
}
function center(el) {
  const h = el.type === 'text' ? (el.fontSize||16)*(el.lineHeight||1.25) : (el.height || el.fontSize * (el.lineHeight||1.25));
  return { x: el.x + el.width/2, y: el.y + h/2 };
}
function dist(a, b) {
  const ca=center(a), cb=center(b);
  return Math.sqrt((ca.x-cb.x)**2 + (ca.y-cb.y)**2);
}

// 判断是否为层级标签（大字号、左边缘、短文本）
function isLayerLabel(el) {
  if (el.type !== 'text') return false;
  if ((el.fontSize || 16) < 18) return false;
  if (el.x > 100) return false;
  if ((el.text || '').length > 15) return false;
  return true;
}

// 判断是否为层背景（大矩形、低透明度、虚线）
function isLayerBg(el) {
  if (el.type !== 'rectangle') return false;
  if ((el.opacity||100) < 50) return true;
  if (el.width > 800 && el.height > 100) return true;
  return false;
}

// 判断是否为实心容器（容纳文字的矩形）
function isContainer(el) {
  if (!['rectangle','ellipse','diamond'].includes(el.type)) return false;
  // 虚线小框（< 300px）仍算容器，只排除虚线大框（分组框 > 300px）
  if (el.strokeStyle === 'dashed' && el.width > 300) return false;
  if ((el.opacity||100) < 80) return false;
  if (el.width < 20 || el.height < 12) return false;
  return true;
}

// 获取文字行数
function textLines(t) {
  return (t.text || '').split('\n').length;
}

// ── Pass 1: clean-fields ──────────────────────────────
function passCleanFields() {
  if (!enabled.has('clean-fields')) return;
  console.log('\n📋 Pass 1: 清理不规范字段');
  const remove = ['versionNonce','index','frameId','rawText','hasTextLink'];
  let c=0;
  for (const e of elements) {
    for (const f of remove) if (f in e) { delete e[f]; c++; }
    if (e.roundness===null) { delete e.roundness; c++; }
    if (Array.isArray(e.boundElements) && e.boundElements.length===0) { e.boundElements=null; c++; }
    if (e.updated!==undefined) e.updated=1;
  }
  stat('cleaned', c);
  console.log(`  清理了 ${c} 处不规范字段`);
}

// ── Pass 2: fit-containers ────────────────────────────
function passFitContainers() {
  if (!enabled.has('fit-containers')) return;
  console.log(`\n📦 Pass 2: 容器自适应（padding=${PADDING}px）`);

  const containers = elements.filter(isContainer);
  const texts = elements.filter(e => e.type==='text');

  let resized = 0;
  for (const text of texts) {
    if (text.containerId || isLayerLabel(text)) continue; // Excalidraw 自动管理 / 层标签跳过

    const tc = center(text);
    const candidates = containers.filter(c => {
      const rc = rect(c);
      return tc.x >= rc.x && tc.x <= rc.r && tc.y >= rc.y && tc.y <= rc.b;
    });
    if (candidates.length===0) continue;

    candidates.sort((a,b) => (a.width*a.height) - (b.width*b.height));
    const box = candidates[0];

    // 计算所需尺寸
    const lineH = text.lineHeight || 1.25;
    const lines = textLines(text);
    const neededW = text.width + PADDING * 2;
    const neededH = text.fontSize * lineH * lines + PADDING * 2;

    let changed = false;
    if (box.width < neededW) { box.width = Math.ceil(neededW); changed = true; }
    if (box.height < neededH) { box.height = Math.ceil(neededH); changed = true; }

    if (changed) {
      resized++;
      vlog(`${box.id}: ${box.width}×${box.height} (text: "${(text.text||'').substring(0,20)}")`);
      if (!isDryRun) {
        // 扩展后重新居中文字
        text.x = Math.round(box.x + box.width/2 - text.width/2);
        text.y = Math.round(box.y + (box.height - text.fontSize*lineH*lines)/2);
      }
    }
  }
  stat('resized', resized);
  console.log(`  扩展了 ${resized} 个容器`);
}

// ── Pass 3: center-text ───────────────────────────────
function passCenterText() {
  if (!enabled.has('center-text')) return;
  console.log('\n📐 Pass 3: 文字居中');

  const containers = elements.filter(isContainer);
  const texts = elements.filter(e => e.type==='text');
  let centered = 0, skipped = 0;

  for (const text of texts) {
    if (text.containerId || isLayerLabel(text)) { skipped++; continue; }

    const tc = center(text);
    const candidates = containers.filter(c => {
      const rc = rect(c);
      return tc.x >= rc.x && tc.x <= rc.r && tc.y >= rc.y && tc.y <= rc.b;
    });
    if (candidates.length===0) continue;

    candidates.sort((a,b) => (a.width*a.height) - (b.width*b.height));
    const box = candidates[0];

    const lineH = text.lineHeight||1.25;
    const lines = textLines(text);
    const idealX = Math.round(box.x + box.width/2 - text.width/2);
    const idealY = Math.round(box.y + (box.height - text.fontSize*lineH*lines)/2);

    if (Math.abs(text.x-idealX)>2 || Math.abs(text.y-idealY)>2) {
      if (!isDryRun) { text.x = idealX; text.y = idealY; }
      centered++;
    }
  }
  stat('centered', centered);
  console.log(`  修正 ${centered} 处偏移 (${skipped} 跳过/已绑定)`);
}

// ── Pass 4: fix-text-overlaps ─────────────────────────
function passFixTextOverlaps() {
  if (!enabled.has('fix-text-overlaps')) return;
  console.log('\n🔀 Pass 4: 文字防重叠');

  const texts = elements.filter(e => e.type==='text' && !e.containerId);
  let fixed = 0;

  for (let i=0; i<texts.length; i++) {
    for (let j=i+1; j<texts.length; j++) {
      const a=texts[i], b=texts[j];
      if (!overlap(a, b)) continue;

      // 优先级：大字号 > 小字号，在容器内 > 独立
      const scoreA = (a.fontSize||16) + (containersForText(a).length>0 ? 100 : 0);
      const scoreB = (b.fontSize||16) + (containersForText(b).length>0 ? 100 : 0);

      // 移动分数低的
      const [victim, anchor] = scoreA < scoreB ? [a, b] : [b, a];

      // 计算最小位移方向
      const ra=rect(victim), rb=rect(anchor);
      const moves = [
        { dx:0, dy: rb.b - ra.y, dir:'down' },       // 向下移
        { dx:0, dy: -(ra.b - rb.y), dir:'up' },       // 向上移
        { dx: rb.r - ra.x, dy:0, dir:'right' },        // 向右移
        { dx: -(ra.r - rb.x), dy:0, dir:'left' },      // 向左移
      ];
      moves.sort((a,b) => (Math.abs(a.dx)+Math.abs(a.dy)) - (Math.abs(b.dx)+Math.abs(b.dy)));
      const best = moves[0];

      if (!isDryRun) {
        victim.x += best.dx;
        victim.y += best.dy;
      }
      fixed++;
      vlog(`  "${victim.text?.substring(0,15)}" → ${best.dir} ${Math.abs(best.dx||best.dy)}px`);
      break; // 一次只修一对，避免连锁
    }
  }
  stat('overlapFixed', fixed);
  console.log(`  修正 ${fixed} 处文字重叠`);
}

// 辅助：找文字所属容器
function containersForText(text) {
  const tc = center(text);
  return elements.filter(c =>
    isContainer(c) &&
    tc.x >= c.x && tc.x <= c.x+c.width &&
    tc.y >= c.y && tc.y <= c.y+c.height
  );
}

// ── Pass 5: align-rows ────────────────────────────────
function passAlignRows() {
  if (!enabled.has('align-rows')) return;
  console.log('\n📏 Pass 5: 行对齐');

  // 仅检测实心容器（排除文字和层背景）
  const containers = elements.filter(e =>
    isContainer(e) && !isLayerBg(e) && e.width < 500
  );

  // 预计算所有 text→container 关联（在改动前建立映射）
  const textToContainer = new Map();
  const containerToTexts = new Map();
  const texts = elements.filter(e => e.type === 'text');
  for (const text of texts) {
    const tc = center(text);
    const candidates = containers.filter(c => {
      const rc = rect(c);
      return tc.x >= rc.x && tc.x <= rc.r && tc.y >= rc.y && tc.y <= rc.b;
    });
    if (candidates.length > 0) {
      candidates.sort((a,b) => a.width*a.height - b.width*b.height);
      const box = candidates[0];
      textToContainer.set(text.id, box.id);
      if (!containerToTexts.has(box.id)) containerToTexts.set(box.id, []);
      containerToTexts.get(box.id).push(text.id);
    }
  }

  // 按 y 分组容器（容差 15px）
  const rows = [];
  const used = new Set();
  for (const a of containers) {
    if (used.has(a.id)) continue;
    const row = [a];
    used.add(a.id);
    for (const b of containers) {
      if (used.has(b.id)) continue;
      if (Math.abs(a.y - b.y) <= 15) {
        row.push(b);
        used.add(b.id);
      }
    }
    if (row.length >= 2) rows.push(row);
  }

  // 预计算 arrow→容器关联
  const arrows = elements.filter(e => e.type === 'arrow' && !e.isDeleted);
  const arrowFrom = new Map(); // arrow id → {srcId, dstId}
  for (const arrow of arrows) {
    const ax = arrow.x, ay = arrow.y;
    const endX = ax + (arrow.points?.at(-1)?.[0] || arrow.width || 0);
    // 找箭头起点附近的容器（右边缘）
    const src = containers.find(c =>
      Math.abs(ax - (c.x + c.width)) < 10 &&
      ay >= c.y && ay <= c.y + c.height
    );
    // 找箭头终点附近的容器（左边缘）
    const dst = containers.find(c =>
      Math.abs(endX - c.x) < 10 &&
      ay >= c.y && ay <= c.y + c.height
    );
    if (src && dst) arrowFrom.set(arrow.id, { srcId: src.id, dstId: dst.id });
  }

  let aligned = 0;
  for (const row of rows) {
    row.sort((a,b) => a.x - b.x);

    // 计算平均间距
    let totalGap = 0;
    for (let i = 1; i < row.length; i++) {
      totalGap += row[i].x - (row[i-1].x + row[i-1].width);
    }
    const avgGap = Math.round(totalGap / (row.length - 1));

    // 均匀分布，同步移动关联文字
    let cx = row[0].x;
    for (let i = 1; i < row.length; i++) {
      const idealX = cx + row[i-1].width + avgGap;
      if (Math.abs(row[i].x - idealX) > 5) {
        const shift = idealX - row[i].x;
        if (!isDryRun) {
          row[i].x = idealX;
          // 同步移动该容器的所有关联文字
          const relatedTexts = containerToTexts.get(row[i].id) || [];
          for (const tid of relatedTexts) {
            const t = elMap[tid];
            if (t) t.x += shift;
          }
          // 同步修正关联箭头：起点贴源框右沿，终点贴目标框左沿
          for (const [arrowId, pair] of arrowFrom) {
            const arr = elMap[arrowId];
            if (!arr) continue;
            const srcBox = elMap[pair.srcId], dstBox = elMap[pair.dstId];
            if (!srcBox || !dstBox) continue;
            arr.x = srcBox.x + srcBox.width;
            const gap = dstBox.x - arr.x;
            if (gap > 0) arr.points = [[0, 0], [gap, 0]];
          }
        }
        aligned++;
      }
      cx = row[i].x;
    }
  }
  stat('rowAligned', aligned);
  console.log(`  检测到 ${rows.length} 行，对齐了 ${aligned} 个元素`);
}

// ── Pass 6: expand-layers ─────────────────────────────
function passExpandLayers() {
  if (!enabled.has('expand-layers')) return;
  console.log('\n📐 Pass 6: 层背景自动扩展');

  const layers = elements.filter(isLayerBg);
  const children = elements.filter(e =>
    !isLayerBg(e) &&
    ['rectangle','ellipse','diamond','text'].includes(e.type)
  );

  let expanded = 0;
  for (const layer of layers) {
    // 找层内的子元素
    const inside = children.filter(c => {
      const cc = center(c);
      return cc.x >= layer.x && cc.x <= layer.x+layer.width &&
             cc.y >= layer.y && cc.y <= layer.y+layer.height;
    });

    if (inside.length === 0) continue;

    // 计算边界
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const c of inside) {
      const r = rect(c);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.r > maxX) maxX = r.r;
      if (r.b > maxY) maxY = r.b;
    }

    const margin = PADDING * 2;
    const newX = minX - margin, newY = minY - margin;
    const newW = maxX - minX + margin*2, newH = maxY - minY + margin*2;

    if (newX < layer.x || newW > layer.width || newH > layer.height + 20) {
      if (!isDryRun) {
        layer.x = Math.min(layer.x, newX);
        layer.y = Math.min(layer.y, newY);
        layer.width = Math.max(layer.width, newW);
        layer.height = Math.max(layer.height, newH);
      }
      expanded++;
      vlog(`  ${layer.id}: 扩展为 ${layer.x},${layer.y} ${layer.width}×${layer.height}`);
    }
  }
  stat('layerExpanded', expanded);
  console.log(`  扩展了 ${expanded} 个层背景`);
}

// ── Pass 7: fix-font-size ─────────────────────────────
function passFixFontSize() {
  if (!enabled.has('fix-font-size')) return;
  console.log('\n🔤 Pass 7: 字号规范化');
  let c=0;
  for (const e of elements) {
    if (e.type!=='text' || e.fontSize>=16 || e.isDeleted) continue;
    if (!isDryRun) e.fontSize = 16;
    c++;
  }
  stat('fontFixed', c);
  console.log(`  提升 ${c} 处字号到 16px`);
}

// ── Pass 8: balance-spacing ───────────────────────────
function passBalanceSpacing() {
  if (!enabled.has('balance-spacing')) return;
  console.log('\n⚖️  Pass 8: 间距均衡');

  // 检测层次间距（相邻层背景之间的间距）
  const layers = elements.filter(isLayerBg).sort((a,b) => a.y - b.y);
  if (layers.length < 2) { console.log('  不足 2 个层，跳过'); return; }

  const gaps = [];
  for (let i=1; i<layers.length; i++) {
    const prevBottom = layers[i-1].y + layers[i-1].height;
    gaps.push(layers[i].y - prevBottom);
  }

  const avgGap = Math.max(20, Math.round(gaps.reduce((a,b)=>a+b,0) / gaps.length));  // 最小 20px
  let shifted = 0;

  for (let i=1; i<layers.length; i++) {
    const idealY = layers[i-1].y + layers[i-1].height + avgGap;
    const currentGap = layers[i].y - (layers[i-1].y + layers[i-1].height);

    if (Math.abs(currentGap - avgGap) > 8) {
      const shift = idealY - layers[i].y;
      if (!isDryRun) {
        layers[i].y = idealY;
        // 同步移动该层内的所有子元素
        for (const e of elements) {
          if (e.id === layers[i].id) continue;
          if (e.y >= layers[i].y - shift && e.y <= layers[i].y + layers[i].height) {
            e.y += shift;
          }
        }
      }
      shifted++;
      vlog(`  ${layers[i].id}: y+${shift}px (gap ${currentGap}→${avgGap})`);
    }
  }
  stat('spacingBalanced', shifted);
  console.log(`  均衡了 ${shifted} 个层间距 (avg=${avgGap}px)`);
}

// ── Pass 9: detect-overlap ────────────────────────────
function passDetectOverlap() {
  if (!enabled.has('detect-overlap')) return;
  console.log('\n🔍 Pass 9: 重叠检测');

  const items = elements.filter(e =>
    ['rectangle','ellipse','diamond','text'].includes(e.type) &&
    e.width < 900
  );

  const overlaps = [];
  for (let i=0; i<items.length; i++) {
    for (let j=i+1; j<items.length; j++) {
      const a=items[i], b=items[j];
      if (!overlap(a, b)) continue;
      if (contains(a,b) || contains(b,a)) continue; // 包含关系
      // 文字在容器内不算重叠
      if (a.type==='text' && isContainer(b) && contains(b,a)) continue;
      if (b.type==='text' && isContainer(a) && contains(a,b)) continue;
      overlaps.push({a:a.id, b:b.id});
    }
  }

  stat('overlaps', overlaps.length);
  if (overlaps.length>0) {
    console.log(`  ⚠️  发现 ${overlaps.length} 处重叠`);
    for (const o of overlaps.slice(0,6))
      console.log(`     ${o.a} ↔ ${o.b}`);
    if (overlaps.length>6) console.log(`     ... 还有 ${overlaps.length-6} 处`);
  } else {
    console.log('  ✅ 未发现重叠');
  }
}

// ── Pass 10: score ────────────────────────────────────
function passScore() {
  if (!enabled.has('score')) return;
  console.log('\n🎯 Pass 10: 视觉评分');

  let score = 100;
  const issues = [];

  // 检查文字大小
  const smallTexts = elements.filter(e => e.type==='text' && e.fontSize<16);
  if (smallTexts.length>0) {
    score -= smallTexts.length * 3;
    issues.push(`${smallTexts.length} 处字号 < 16px`);
  }

  // 检查重叠
  const items = elements.filter(e =>
    ['rectangle','ellipse','diamond','text'].includes(e.type) && e.width < 900
  );
  let overlaps = 0;
  for (let i=0; i<items.length; i++)
    for (let j=i+1; j<items.length; j++)
      if (overlap(items[i],items[j]) && !contains(items[i],items[j]) && !contains(items[j],items[i]))
        overlaps++;
  if (overlaps>0) {
    score -= overlaps * 5;
    issues.push(`${overlaps} 处元素重叠`);
  }

  // 检查字段规范
  const badFields = elements.filter(e => e.versionNonce || e.index || e.frameId || e.rawText);
  if (badFields.length>0) {
    score -= Math.min(badFields.length, 20);
    issues.push(`${badFields.length} 个元素含不规范字段`);
  }

  // 检查文字居中
  const containers = elements.filter(isContainer);
  let offCenter = 0;
  for (const text of elements.filter(e => e.type==='text')) {
    const tc = center(text);
    const box = containers.find(c => {
      const rc = rect(c);
      return tc.x >= rc.x && tc.x <= rc.r && tc.y >= rc.y && tc.y <= rc.b;
    });
    if (box) {
      const idealX = box.x + box.width/2 - text.width/2;
      if (Math.abs(text.x - idealX) > 3) offCenter++;
    }
  }
  if (offCenter>0) {
    score -= offCenter * 2;
    issues.push(`${offCenter} 处文字未居中`);
  }

  // 检查间距一致性
  const layers = elements.filter(isLayerBg).sort((a,b) => a.y - b.y);
  if (layers.length >= 2) {
    const gaps = [];
    for (let i=1; i<layers.length; i++)
      gaps.push(layers[i].y - (layers[i-1].y + layers[i-1].height));
    const avg = gaps.reduce((a,b)=>a+b,0)/gaps.length;
    const maxDev = Math.max(...gaps.map(g => Math.abs(g-avg)));
    if (maxDev > 20) {
      score -= 5;
      issues.push(`层间距不一致 (max偏差 ${Math.round(maxDev)}px)`);
    }
  }

  // 检查箭头可见性（相邻容器间距 >= 10px）
  const arrows = elements.filter(e => e.type==='arrow' && !e.isDeleted);
  const allContainers = elements.filter(e => isContainer(e) && !isLayerBg(e));
  let crushedArrows = 0;
  for (const arrow of arrows) {
    // 箭头终点
    const endX = arrow.x + (arrow.points?.at(-1)?.[0] || arrow.width || 0);
    const endY = arrow.y + (arrow.points?.at(-1)?.[1] || arrow.height || 0);
    // 找箭头起点和终点附近的容器
    const near = allContainers.filter(c => {
      const r = rect(c);
      const distStart = Math.abs(arrow.x - r.r) + Math.abs(arrow.y - (r.y + r.h/2));
      const distEnd = Math.abs(endX - c.x) + Math.abs(endY - (c.y + (c.height||40)/2));
      return distStart < 50 || distEnd < 50;
    });
    // 如果有两个相邻容器，检查间距
    if (near.length >= 2) {
      near.sort((a,b) => a.x - b.x);
      for (let i=1; i<near.length; i++) {
        const gap = near[i].x - (near[i-1].x + near[i-1].width);
        if (gap >= 0 && gap < 10) crushedArrows++;
      }
    }
  }
  if (crushedArrows > 0) {
    score -= crushedArrows * 10;
    issues.push(`${crushedArrows} 个箭头被挤压 (间距 < 10px)`);
  }

  // 检查文字间最小间距（边界盒相交且垂直间距 < 8px）
  const allTexts = elements.filter(e => e.type==='text' && !e.isDeleted);
  allTexts.sort((a,b) => a.y - b.y);
  let tightTexts = 0;
  for (let i=1; i<allTexts.length; i++) {
    const prev = allTexts[i-1], curr = allTexts[i];
    const pb = rect(prev), cb = rect(curr);
    // 检查水平方向是否相交（边界盒重叠才算同列问题）
    const xOverlap = pb.x < cb.r && pb.r > cb.x;
    if (!xOverlap) continue;
    const gap = curr.y - (prev.y + (prev.fontSize||16) * (prev.lineHeight||1.25));
    if (gap < 8 && gap > -10) tightTexts++;
  }
  if (tightTexts > 0) {
    score -= tightTexts * 3;
    issues.push(`${tightTexts} 处文字间距过紧 (< 8px)`);
  }

  const final = Math.max(0, Math.min(100, score));
  const grade = final >= 90 ? 'A' : final >= 75 ? 'B' : final >= 60 ? 'C' : 'D';

  console.log(`  评分: ${final}/100 (${grade})`);
  if (issues.length>0) {
    console.log('  扣分项:');
    for (const i of issues) console.log(`    · ${i}`);
  } else {
    console.log('  ✅ 无扣分项');
  }
  stat('score', final);
}

// ── Execute ───────────────────────────────────────────
console.log(`\n🔧 Excalidraw Auto-Layout v2`);
console.log(`   文件: ${path.basename(inputFile)}`);
console.log(`   模式: ${isDryRun ? '仅报告' : '修复模式'}`);
console.log(`   步骤: ${[...enabled].join(', ')}`);

passCleanFields();
passFitContainers();
passCenterText();
passFixTextOverlaps();
passAlignRows();
passExpandLayers();
passFixFontSize();
passBalanceSpacing();
passDetectOverlap();
passScore();

// ── Save ──────────────────────────────────────────────
if (!isDryRun && !scoreOnly) {
  if (data.appState) {
    data.appState.gridSize = null;
    data.appState.viewBackgroundColor = '#ffffff';
  }
  if (!data.files) data.files = {};
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\n✅ 已保存: ${outputFile}`);
}

// ── Summary ───────────────────────────────────────────
if (Object.keys(stats).length>0) {
  console.log('\n📊 修复汇总:');
  for (const [k,v] of Object.entries(stats))
    if (k !== 'score') console.log(`   ${k}: ${v}`);
}
console.log();
