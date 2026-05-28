#!/usr/bin/env node

/**
 * Excalidraw 元素摘要提取工具
 * 用法: node extract-elements.js <input.excalidraw> [output.json]
 * 
 * 功能: 从 .excalidraw 文件中提取每个元素的关键属性，输出精简摘要
 */

const fs = require('fs');
const path = require('path');

function extractElements(data) {
  if (!data.elements) return [];

  return data.elements
    .filter(e => !e.isDeleted)
    .map(e => {
      const base = {
        id: e.id,
        type: e.type,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
      };

      // 文本相关
      if (e.type === 'text') {
        base.text = e.text || e.originalText || '';
        base.fontSize = e.fontSize;
        base.strokeColor = e.strokeColor;
        base.textAlign = e.textAlign;
      }
      // 形状相关
      else if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
        base.strokeColor = e.strokeColor;
        base.backgroundColor = e.backgroundColor;
        base.fillStyle = e.fillStyle;
        base.strokeStyle = e.strokeStyle;
        base.opacity = e.opacity;
      }
      // 箭头/线条
      else if (e.type === 'arrow' || e.type === 'line') {
        base.strokeColor = e.strokeColor;
        base.points = e.points;
        base.strokeStyle = e.strokeStyle;
      }

      // containerId 表示文本绑定到某个容器
      if (e.containerId) {
        base.containerId = e.containerId;
      }

      // groupIds 非空时保留
      if (e.groupIds && e.groupIds.length > 0) {
        base.groupIds = e.groupIds;
      }

      return base;
    });
}

function generateTextSummary(elements) {
  let lines = [];
  lines.push(`元素总数: ${elements.length}\n`);

  // 按 y 排序（从上到下），y 相同按 x 排序（从左到右）
  const sorted = [...elements].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const e of sorted) {
    if (e.type === 'text') {
      lines.push(`[text] id=${e.id} x=${Math.round(e.x)} y=${Math.round(e.y)} w=${Math.round(e.width)} h=${Math.round(e.height)} fontSize=${e.fontSize} color=${e.strokeColor} | "${e.text}"${e.containerId ? ` → container=${e.containerId}` : ''}`);
    } else if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
      lines.push(`[${e.type}] id=${e.id} x=${Math.round(e.x)} y=${Math.round(e.y)} w=${Math.round(e.width)} h=${Math.round(e.height)} fill=${e.backgroundColor} stroke=${e.strokeColor}${e.opacity < 100 ? ` opacity=${e.opacity}` : ''}${e.strokeStyle !== 'solid' ? ` style=${e.strokeStyle}` : ''}`);
    } else if (e.type === 'arrow' || e.type === 'line') {
      const pts = (e.points || []).map(p => `(${Math.round(p[0])},${Math.round(p[1])})`).join('→');
      lines.push(`[${e.type}] id=${e.id} start=(${Math.round(e.x)},${Math.round(e.y)}) points=${pts}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Excalidraw 元素摘要提取工具
━━━━━━━━━━━━━━━━━━━━━━━━━━━

用法:
  node extract-elements.js <input.excalidraw> [output.txt]

参数:
  input.excalidraw   Excalidraw JSON 文件路径
  output.txt         输出摘要文件路径 (默认: 同目录下 <filename>.elements.txt)

选项:
  --json             输出 JSON 格式而非文本摘要
`);
    process.exit(0);
  }

  const inputPath = path.resolve(args[0]);
  const outputFormat = args.includes('--json') ? 'json' : 'text';
  const defaultOutput = inputPath.replace(/\.excalidraw$/i, '.elements.txt');
  const outputPath = args.find(a => !a.startsWith('-') && a !== args[0])
    ? path.resolve(args.find(a => !a.startsWith('-') && a !== args[0]))
    : defaultOutput;

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 文件不存在: ${inputPath}`);
    process.exit(1);
  }

  console.log(`📖 读取文件: ${path.basename(inputPath)}`);
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const elements = extractElements(data);

  let output;
  if (outputFormat === 'json') {
    output = JSON.stringify(elements, null, 2);
  } else {
    output = generateTextSummary(elements);
  }

  // 统计
  const stats = {};
  elements.forEach(e => { stats[e.type] = (stats[e.type] || 0) + 1; });
  console.log(`✨ 提取元素: ${elements.length} 个`);
  Object.entries(stats).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`✅ 摘要已保存: ${outputPath}`);
}

main().catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
