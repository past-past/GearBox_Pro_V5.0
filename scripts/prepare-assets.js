#!/usr/bin/env node
/**
 * 将前端第三方依赖完整本地化到 src/renderer/vendor/：
 *  1. 复制 node_modules/three/build/three.min.js -> src/renderer/vendor/three.min.js
 *  2. 编译 Tailwind CSS v3 -> src/renderer/vendor/tailwind.css
 *  3. 校验本地资源非空且 index.html 无外部 CDN 引用
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const vendorDir = path.join(rootDir, 'src', 'renderer', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

// 1. Copy three.min.js from local node_modules
const threeSrc = path.join(rootDir, 'node_modules', 'three', 'build', 'three.min.js');
const threeDst = path.join(vendorDir, 'three.min.js');
if (!fs.existsSync(threeSrc)) {
  console.error('[prepare-assets] 未找到 node_modules/three/build/three.min.js，请先执行 npm install');
  process.exit(1);
}
fs.copyFileSync(threeSrc, threeDst);
console.log(`[prepare-assets] 已复制 three.min.js (${fs.statSync(threeDst).size} bytes)`);

// 2. Compile Tailwind CSS locally
const twCli = path.join(rootDir, 'node_modules', 'tailwindcss', 'lib', 'cli.js');
const twConfig = path.join(rootDir, 'tailwind.config.js');
const twInput = path.join(rootDir, 'src', 'renderer', 'styles', 'tailwind-input.css');
const twOutput = path.join(vendorDir, 'tailwind.css');

if (!fs.existsSync(twCli)) {
  console.error('[prepare-assets] 未找到 tailwindcss CLI，请先执行 npm install');
  process.exit(1);
}

execFileSync(process.execPath, [twCli, '-c', twConfig, '-i', twInput, '-o', twOutput, '--minify'], {
  cwd: rootDir,
  stdio: 'inherit'
});

const cssSize = fs.statSync(twOutput).size;
if (cssSize < 10000) {
  console.error(`[prepare-assets] 编译后的 tailwind.css 体积异常 (${cssSize} bytes)，请检查 tailwind.config.js`);
  process.exit(1);
}
console.log(`[prepare-assets] 已本地编译 tailwind.css (${cssSize} bytes)`);

// 3. Verify index.html has zero CDN links
const indexHtml = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
const headPart = indexHtml.slice(0, indexHtml.indexOf('</head>'));
for (const cdn of ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
  if (headPart.includes(cdn)) {
    console.error(`[prepare-assets] 检测到未移除的外部 CDN 链接: ${cdn}`);
    process.exit(1);
  }
}
console.log('[prepare-assets] 全部本地资源校验通过（零外链，支持完全离线运行）。');
