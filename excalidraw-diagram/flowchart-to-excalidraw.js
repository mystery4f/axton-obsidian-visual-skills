#!/usr/bin/env node

/**
 * Flowchart MD → Excalidraw 转换工具
 * 用法: node flowchart-to-excalidraw.js <input.flowchart.md> [output.excalidraw]
 * 
 * 功能: 将 Obsidian Excalidraw 插件的 .flowchart.md 文件转换为标准 .excalidraw 文件
 */

const fs = require('fs');
const path = require('path');
const LZString = require('lz-string');

// ============ 1. 解析 Flowchart MD 文件 ============

function parseFlowchartMd(content) {
  // 提取 compressed-json 数据
  const match = content.match(/```compressed-json\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error('未找到 compressed-json 数据块');
  }
  
  const compressed = match[1].trim();
  return compressed;
}

// ============ 2. 解压缩 ============

function decompressJson(compressed) {
  try {
    // Obsidian Excalidraw 使用 LZString 压缩
    // 解压前需要移除所有换行符和回车符
    let cleanedData = '';
    for (let i = 0; i < compressed.length; i++) {
      const char = compressed[i];
      if (char !== '\n' && char !== '\r') {
        cleanedData += char;
      }
    }
    
    const json = LZString.decompressFromBase64(cleanedData);
    if (!json) {
      throw new Error('LZString 解压失败');
    }
    return JSON.parse(json);
  } catch (e) {
    throw new Error(`解压失败: ${e.message}`);
  }
}

// ============ 3. 提取文本元素映射 ============

function extractTextElements(mdContent) {
  const textMap = {};
  const regex = /^(.+?) \^(\w+)$/gm;
  let match;
  
  while ((match = regex.exec(mdContent)) !== null) {
    const text = match[1].trim();
    const id = match[2];
    textMap[id] = text;
  }
  
  return textMap;
}

// ============ 4. 补全文本内容 ============

function fixTextElements(data, textMap) {
  if (!data.elements) return data;
  
  data.elements = data.elements.map(el => {
    if (el.type === 'text') {
      // 如果 text 为空但 originalText 有内容，用 originalText
      if (!el.text && el.originalText) {
        el.text = el.originalText;
      }
      // 如果有 boundElements 关联的容器，尝试从 textMap 获取文本
      if (el.containerId && textMap[el.id]) {
        el.text = textMap[el.id];
        el.originalText = textMap[el.id];
      }
    }
    return el;
  });
  
  return data;
}

// ============ 5. 主流程 ============

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Flowchart MD → Excalidraw 转换工具
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用法:
  node flowchart-to-excalidraw.js <input.flowchart.md> [output.excalidraw]

参数:
  input.flowchart.md   Obsidian Excalidraw 插件生成的 flowchart 文件
  output.excalidraw    输出的 Excalidraw 文件路径 (默认: 同目录下同名 .excalidraw)

示例:
  node flowchart-to-excalidraw.js diagram.flowchart.md
  node flowchart-to-excalidraw.js diagram.flowchart.md output/diagram.excalidraw
`);
    process.exit(0);
  }
  
  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] 
    ? path.resolve(args[1])
    : inputPath.replace(/\.flowchart\.md$/i, '.excalidraw');
  
  // 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // 读取文件
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 文件不存在: ${inputPath}`);
    process.exit(1);
  }
  
  console.log(`📖 读取文件: ${path.basename(inputPath)}`);
  const mdContent = fs.readFileSync(inputPath, 'utf8');
  
  // 提取文本元素映射
  const textMap = extractTextElements(mdContent);
  console.log(`📝 提取文本元素: ${Object.keys(textMap).length} 个`);
  
  // 提取并解压缩数据
  console.log(`🔍 提取 compressed-json...`);
  const compressed = parseFlowchartMd(mdContent);
  
  console.log(`📦 解压缩数据...`);
  let data = decompressJson(compressed);
  
  // 补全文本内容
  data = fixTextElements(data, textMap);
  
  // 统计元素
  const stats = {
    total: data.elements?.length || 0,
    rectangles: data.elements?.filter(e => e.type === 'rectangle').length || 0,
    text: data.elements?.filter(e => e.type === 'text').length || 0,
    arrows: data.elements?.filter(e => e.type === 'arrow').length || 0,
  };
  
  console.log(`✨ 元素统计:`);
  console.log(`   矩形: ${stats.rectangles}`);
  console.log(`   文本: ${stats.text}`);
  console.log(`   箭头: ${stats.arrows}`);
  console.log(`   总计: ${stats.total}`);
  
  // 保存为标准 Excalidraw 格式
  const excalidrawData = {
    type: 'excalidraw',
    version: 2,
    source: 'flowchart-to-excalidraw',
    elements: data.elements || [],
    appState: data.appState || {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
    },
    files: data.files || {},
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(excalidrawData, null, 2));
  console.log(`✅ 转换完成: ${outputPath}`);
}

main().catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
