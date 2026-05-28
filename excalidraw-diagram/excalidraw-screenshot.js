#!/usr/bin/env node

/**
 * Excalidraw 截图工具
 * 用法: node excalidraw-screenshot.js <input.excalidraw> [output.png]
 * 
 * 功能: 读取 .excalidraw 文件，渲染成 SVG，用 Playwright 截图
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ============ 1. Excalidraw → SVG 渲染器 ============

function renderExcalidrawToSvg(data) {
  const elements = data.elements.filter(e => !e.isDeleted);
  
  let svgContent = '';
  
  // 收集所有箭头引用的 marker
  const hasArrows = elements.some(e => e.type === 'arrow');
  
  // 渲染矩形
  elements.filter(e => e.type === 'rectangle').forEach(el => {
    const fill = getFill(el);
    const stroke = el.strokeColor || '#1e1e1e';
    const strokeWidth = el.strokeWidth || 2;
    const rx = el.roundness ? 8 : 0;
    const dashArray = el.strokeStyle === 'dashed' ? ' stroke-dasharray="8 4"' : '';
    const opacity = el.opacity !== undefined && el.opacity < 100 ? ` fill-opacity="${el.opacity / 100}"` : '';
    
    svgContent += `  <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${rx}" ry="${rx}"${dashArray}${opacity}/>\n`;
  });
  
  // 渲染箭头
  elements.filter(e => e.type === 'arrow').forEach(el => {
    if (!el.points || el.points.length < 2) return;
    const x1 = el.x + el.points[0][0];
    const y1 = el.y + el.points[0][1];
    const x2 = el.x + el.points[1][0];
    const y2 = el.y + el.points[1][1];
    svgContent += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${el.strokeColor || '#3b82f6'}" stroke-width="${el.strokeWidth || 2}" marker-end="url(#arrowhead)"/>\n`;
  });
  
  // 渲染文本
  elements.filter(e => e.type === 'text').forEach(el => {
    const fontSize = el.fontSize || 20;
    const fill = el.strokeColor || '#1e1e1e';
    const fontFamily = 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif';
    const lines = (el.text || el.originalText || '').split('\n');
    
    if (el.textAlign === 'center') {
      // 多行居中文本
      const baseX = el.x + (el.width || 0) / 2;
      const lineHeight = (el.lineHeight || 1.25) * fontSize;
      const totalHeight = lines.length * lineHeight;
      const startY = el.y + (el.height || 0) / 2 - totalHeight / 2 + fontSize;
      
      svgContent += `  <text font-size="${fontSize}" fill="${fill}" font-family="${fontFamily}" text-anchor="middle">\n`;
      lines.forEach((line, i) => {
        const y = startY + i * lineHeight;
        svgContent += `    <tspan x="${baseX}" y="${y}">${escapeXml(line)}</tspan>\n`;
      });
      svgContent += `  </text>\n`;
    } else {
      // 左对齐文本
      const lineHeight = (el.lineHeight || 1.25) * fontSize;
      svgContent += `  <text x="${el.x}" y="${el.y + fontSize}" font-size="${fontSize}" fill="${fill}" font-family="${fontFamily}">\n`;
      lines.forEach((line, i) => {
        const dy = i === 0 ? 0 : lineHeight;
        const y = el.y + fontSize + i * lineHeight;
        svgContent += `    <tspan x="${el.x}" y="${y}">${escapeXml(line)}</tspan>\n`;
      });
      svgContent += `  </text>\n`;
    }
  });
  
  // 计算 SVG viewBox
  const textElements = elements.filter(e => e.type === 'text');
  const rectElements = elements.filter(e => e.type === 'rectangle');
  const allElements = [...rectElements, ...textElements];
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allElements.forEach(el => {
    minX = Math.min(minX, el.x || 0);
    minY = Math.min(minY, el.y || 0);
    maxX = Math.max(maxX, (el.x || 0) + (el.width || 200));
    maxY = Math.max(maxY, (el.y || 0) + (el.height || 50));
  });
  
  const padding = 40;
  const viewBoxX = minX - padding;
  const viewBoxY = minY - padding;
  const viewBoxW = maxX - minX + padding * 2;
  const viewBoxH = maxY - minY + padding * 2;
  
  // 组装完整 SVG
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxW}" height="${viewBoxH}" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}">\n`;
  
  // 箭头标记定义
  if (hasArrows) {
    svg += `  <defs>\n`;
    svg += `    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">\n`;
    svg += `      <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6"/>\n`;
    svg += `    </marker>\n`;
    svg += `  </defs>\n`;
  }
  
  // 白色背景
  svg += `  <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="white"/>\n`;
  
  svg += svgContent;
  svg += `</svg>`;
  
  return { svg, width: viewBoxW, height: viewBoxH };
}

function getFill(el) {
  if (el.fillStyle === 'solid' && el.backgroundColor && el.backgroundColor !== 'transparent') {
    return el.backgroundColor;
  }
  if (el.fillStyle === 'solid') {
    return 'white';
  }
  return 'none';
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============ 2. 本地服务器 ============

function createServer(htmlContent) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

// ============ 3. Playwright 截图 ============

async function screenshot(htmlContent, outputPath, width = 1600, height = 1000) {
  const { chromium } = require('playwright');
  
  // 启动本地服务器
  const { server, port } = await createServer(htmlContent);
  
  // msedge 路径
  const msedgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  
  let browser;
  try {
    browser = await chromium.launch({ 
      headless: true,
      executablePath: msedgePath
    });
    const page = await browser.newPage({ viewport: { width, height } });
    
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // 等待渲染完成
    
    // 获取实际内容尺寸并调整 viewport
    const svgEl = await page.$('svg');
    if (svgEl) {
      const box = await svgEl.boundingBox();
      if (box) {
        await page.setViewportSize({
          width: Math.ceil(box.width) + 20,
          height: Math.ceil(box.height) + 20
        });
      }
    }
    
    await page.screenshot({ path: outputPath, fullPage: true, type: 'png' });
    console.log(`✅ 截图已保存: ${outputPath}`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

// ============ 4. HTML 模板 ============

function buildHtml(svgContent) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: white; display: inline-block; }
    svg { display: block; }
  </style>
</head>
<body>
${svgContent}
</body>
</html>`;
}

// ============ 5. 主流程 ============

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Excalidraw 截图工具
━━━━━━━━━━━━━━━━━━━

用法:
  node excalidraw-screenshot.js <input.excalidraw> [output.png]

参数:
  input.excalidraw   Excalidraw JSON 文件路径
  output.png         输出图片路径 (默认: 同目录下 <filename>.png)

示例:
  node excalidraw-screenshot.js diagram.excalidraw
  node excalidraw-screenshot.js diagram.excalidraw output/screenshot.png
`);
    process.exit(0);
  }
  
  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] 
    ? path.resolve(args[1])
    : path.join('/tmp', path.basename(inputPath).replace(/\.excalidraw$/i, '.png'));
  
  // 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // 读取 Excalidraw 文件
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 文件不存在: ${inputPath}`);
    process.exit(1);
  }
  
  console.log(`📖 读取文件: ${path.basename(inputPath)}`);
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  
  // 渲染 SVG
  console.log(`🎨 渲染 SVG...`);
  const { svg, width, height } = renderExcalidrawToSvg(data);
  console.log(`   尺寸: ${Math.round(width)} x ${Math.round(height)}`);
  
  // 生成 HTML
  const html = buildHtml(svg);
  
  // 截图
  console.log(`📸 截图中...`);
  await screenshot(html, outputPath);
}

main().catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
