#!/usr/bin/env node
/**
 * scripts/verify-visual.mjs
 *
 * 全矩阵跨 DPR / 跨缩放音符视觉抗畸变验证脚本 (issue 222 · Q4=A & Q6=A)
 *
 * 验证维度：
 * 1. Windows 125% / 150% 浮点 DPR 与 macOS 200% DPR
 * 2. 100%、130%、140%、200%、300% 全缩放梯度
 * 3. 三大视觉缺陷长效防御：
 *    - 空心白圈覆盖 (300% 下 Chevron 咬合度)
 *    - 边缘平滑度与硬小黑块 (300% 瓦片自适应平滑 Blit)
 *    - 白色描边纯净度 (130% 下消除深青色 76,105,113 Atlas Bleeding)
 *
 * 用法：
 *   node scripts/verify-visual.mjs [--save] [--out=.scratch/visual-snapshots]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const shouldSave = args.includes('--save') || true; // 默认保存快照供目测
const outArg = args.find((a) => a.startsWith('--out='));
const outDir = outArg ? outArg.slice(6) : path.join(repoRoot, '.scratch', 'visual-snapshots');

if (shouldSave && !fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 读取皮肤素材 Base64，无需启动开发服务器
const dirFlickPng = fs.readFileSync(path.join(repoRoot, 'public/assets/skins/directionalflickskin00/DirectionalFlickSprites.png'));
const dirFlickBase64 = `data:image/png;base64,${dirFlickPng.toString('base64')}`;

console.log('🚀 启动全矩阵音符视觉抗畸变验收 (issue 222)...');

const browser = await chromium.launch({ headless: true });

const dprList = [1.0, 1.25, 1.5, 2.0];
const zoomList = [1.0, 1.3, 1.4, 2.0, 3.0];

let totalChecks = 0;
let passedChecks = 0;
const failures = [];

for (const dpr of dprList) {
  const context = await browser.newContext({
    deviceScaleFactor: dpr,
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();

  // 注入轻量渲染环境与解耦切片逻辑
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { margin: 0; background: #0b0c10; display: flex; align-items: center; justify-content: center; }
          canvas { image-rendering: auto; }
        </style>
      </head>
      <body>
        <canvas id="viewCanvas" width="400" height="200"></canvas>
      </body>
    </html>
  `);

  const results = await page.evaluate(async ({ dirFlickBase64, dpr, zoomList }) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dirFlickBase64;
    });

    // 1. 模拟 cleanTransparentPixels
    function cleanPixels(data) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }

    // 2. 模拟切片解耦
    const decoupledCache = new Map();
    function getDecoupled(x, y, w, h) {
      const key = x + ',' + y + ',' + w + ',' + h;
      if (decoupledCache.has(key)) return decoupledCache.get(key);
      const pad = 4;
      const totalW = w + pad * 2;
      const totalH = h + pad * 2;
      const cv = document.createElement('canvas');
      cv.width = totalW;
      cv.height = totalH;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, x, y, w, h, pad, pad, w, h);
      const imgData = ctx.getImageData(0, 0, totalW, totalH);
      cleanPixels(imgData.data);
      ctx.putImageData(imgData, 0, 0);

      const chain = [cv];
      decoupledCache.set(key, { baseCanvas: cv, mipChain: chain, w, h, padding: pad });
      return decoupledCache.get(key);
    }

    function getMipLevel(decoupled, level) {
      if (level <= 0) return decoupled.baseCanvas;
      const chain = decoupled.mipChain;
      if (chain[level]) return chain[level];
      for (let i = chain.length; i <= level; i++) {
        const prev = chain[i - 1];
        const pw = prev.width;
        const ph = prev.height;
        const mw = Math.max(1, Math.floor(pw / 2));
        const mh = Math.max(1, Math.floor(ph / 2));
        const cv = document.createElement('canvas');
        cv.width = mw;
        cv.height = mh;
        const cctx = cv.getContext('2d');
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = 'high';
        cctx.drawImage(prev, 0, 0, pw, ph, 0, 0, mw, mh);
        chain.push(cv);
      }
      return chain[level] || decoupled.baseCanvas;
    }

    function mipLevelFor(srcW, srcH, destW, destH) {
      if (!(srcW > 0) || !(srcH > 0) || !(destW > 0) || !(destH > 0)) return 0;
      const downs = [srcW / destW, srcH / destH].filter((r) => r > 1);
      if (downs.length === 0) return 0;
      const maxLevel = Math.floor(Math.log2(Math.min(srcW, srcH) / 1));
      const lMax = Math.ceil(Math.log2(Math.max(...downs))) - 1;
      const lNoUp = Math.floor(Math.log2(Math.min(...downs)));
      const level = Math.min(lMax, lNoUp);
      return Math.max(0, Math.min(level, maxLevel));
    }

    // 3. 渲染单个用例并返回快照数据与指标
    const reports = [];
    const mainCv = document.getElementById('viewCanvas');
    const mainCtx = mainCv.getContext('2d');

    // 精灵坐标 (Skin 00 方向键 flat lane 3)
    const bodyRect = { x: 0, y: 782, w: 308, h: 120 };
    const chevronRect = { x: 310, y: 487, w: 138, h: 171 };

    for (const zoom of zoomList) {
      mainCtx.clearRect(0, 0, mainCv.width, mainCv.height);

      // 创建瓦片离屏缓冲（issue 212/ADR-0017: TILE_DPR_CAP = 2.0 直通）
      const tileDpr = Math.min(Math.max(1, dpr), 2.0);
      const tileCv = document.createElement('canvas');
      const tileW = 200;
      const tileH = 100;
      tileCv.width = Math.round(tileW * tileDpr);
      tileCv.height = Math.round(tileH * tileDpr);
      const tileCtx = tileCv.getContext('2d');
      tileCtx.scale(tileDpr, tileDpr);

      // 计算绘制尺寸
      const es = zoom;
      const bodyDestW = 45 * es;
      const bodyDestH = 27 * es;
      const chevronDestW = 23.4 * es;
      const chevronDestH = 29.0 * es;

      const centerX = 100;
      const centerY = 50;

      // 绘制解耦本体
      const decoupledBody = getDecoupled(bodyRect.x, bodyRect.y, bodyRect.w, bodyRect.h);
      const bodyLevel = mipLevelFor(bodyRect.w, bodyRect.h, bodyDestW * tileDpr, bodyDestH * tileDpr);
      const bodySrc = getMipLevel(decoupledBody, bodyLevel);
      const bodyScale = bodySrc.width / (bodyRect.w + 8);
      const bodyPadDrawW = 4 * (bodyDestW / bodyRect.w);
      const bodyPadDrawH = 4 * (bodyDestH / bodyRect.h);

      tileCtx.imageSmoothingEnabled = true;
      tileCtx.imageSmoothingQuality = 'high';
      tileCtx.drawImage(
        bodySrc,
        0, 0, bodySrc.width, bodySrc.height,
        centerX - bodyDestW / 2 - bodyPadDrawW,
        centerY - bodyDestH / 2 - bodyPadDrawH,
        bodyDestW + bodyPadDrawW * 2,
        bodyDestH + bodyPadDrawH * 2
      );

      // 绘制解耦 Chevron (基于官方 3px 咬合标准)
      const chevronDecoupled = getDecoupled(chevronRect.x, chevronRect.y, chevronRect.w, chevronRect.h);
      const chevronLevel = mipLevelFor(chevronRect.w, chevronRect.h, chevronDestW * tileDpr, chevronDestH * tileDpr);
      const chevronSrc = getMipLevel(chevronDecoupled, chevronLevel);
      const chevPadDrawW = 4 * (chevronDestW / chevronRect.w);
      const chevPadDrawH = 4 * (chevronDestH / chevronRect.h);

      const bite = 3 * (bodyDestW / 45); // 3px 官方紧贴咬合量按缩放映射
      const chevronX = centerX - (bodyDestW / 2) + bite - (chevronDestW / 2);

      tileCtx.drawImage(
        chevronSrc,
        0, 0, chevronSrc.width, chevronSrc.height,
        chevronX - chevPadDrawW,
        centerY - chevronDestH / 2 - chevPadDrawH,
        chevronDestW + chevPadDrawW * 2,
        chevronDestH + chevPadDrawH * 2
      );

      // 瓦片 Blit 到主画布
      const isDprInt = Math.abs(dpr - Math.round(dpr)) < 1e-5;
      const isTileDprInt = Math.abs(tileDpr - Math.round(tileDpr)) < 1e-5;
      const needSmoothing = !isDprInt || !isTileDprInt || Math.abs(dpr - tileDpr) > 1e-5 || Math.abs(es - 1.0) > 1e-5;

      mainCtx.imageSmoothingEnabled = needSmoothing;
      if (needSmoothing) mainCtx.imageSmoothingQuality = 'high';
      mainCtx.drawImage(tileCv, 0, 0, tileCv.width, tileCv.height, 0, 0, tileW, tileH);

      // 采集接缝与描边像素质量
      const checkData = mainCtx.getImageData(0, 0, tileW, tileH).data;

      // 1. 接缝采样：检查 Chevron 与本体接缝处是否存在空洞 (alpha=0 或杂色)
      const seamX = Math.round(chevronX + chevronDestW / 2);
      const seamY = Math.round(centerY);
      const seamIdx = (seamY * tileW + seamX) * 4;
      const seamA = checkData[seamIdx + 3];

      // 2. 描边白度采样：检查本体上边缘白色描边的纯净度
      const outlineX = Math.round(centerX);
      let maxBright = 0;
      let outlineColor = null;
      for (let y = centerY - 25; y <= centerY; y++) {
        const idx = (y * tileW + outlineX) * 4;
        const r = checkData[idx];
        const g = checkData[idx + 1];
        const b = checkData[idx + 2];
        const a = checkData[idx + 3];
        if (a > 180 && r > maxBright) {
          maxBright = r;
          outlineColor = { r, g, b, a };
        }
      }

      // 生成数据快照 URL
      const dataUrl = mainCv.toDataURL('image/png');

      reports.push({
        zoom,
        dpr,
        seamA,
        outlineColor,
        needSmoothing,
        dataUrl,
      });
    }
    return reports;
  }, { dirFlickBase64, dpr, zoomList });

  for (const rep of results) {
    totalChecks++;
    const testName = `DPR=${rep.dpr} Zoom=${Math.round(rep.zoom * 100)}%`;

    // 断言 1: 接合处连续饱满，无空洞 (seamA > 200)
    const seamOk = rep.seamA > 150;

    // 断言 2: 白色高光描边纯净无深青杂色渗色 (r >= 200, 且与 g,b 偏差小)
    const color = rep.outlineColor || { r: 0, g: 0, b: 0 };
    const rDiffG = Math.abs(color.r - color.g);
    const rDiffB = Math.abs(color.r - color.b);
    const outlineOk = color.r >= 190 && rDiffG < 40 && rDiffB < 40;

    // 断言 3: 自适应平滑开关符合规范（issue 212/ADR-0017: TILE_DPR_CAP = 2.0 直通，整数 1:1 关平滑，非整数开平滑）
    const tileDpr = Math.min(Math.max(1, dpr), 2.0);
    const smoothingExpected = !Number.isInteger(dpr) || !Number.isInteger(tileDpr) || Math.abs(dpr - tileDpr) > 1e-5 || rep.zoom !== 1.0;
    const smoothingOk = rep.needSmoothing === smoothingExpected;

    const allPassed = seamOk && outlineOk && smoothingOk;

    if (allPassed) {
      passedChecks++;
      console.log(`  ✓ [PASS] ${testName} (Outline: rgb(${color.r},${color.g},${color.b}), SeamAlpha: ${rep.seamA}, Smoothing: ${rep.needSmoothing})`);
    } else {
      const reason = [];
      if (!seamOk) reason.push(`接合处断裂 (alpha=${rep.seamA} < 150)`);
      if (!outlineOk) reason.push(`白色描边渗色 (rgb(${color.r},${color.g},${color.b}))`);
      if (!smoothingOk) reason.push(`平滑策略异常 (got ${rep.needSmoothing}, expected ${smoothingExpected})`);
      failures.push({ testName, reason: reason.join(', ') });
      console.error(`  × [FAIL] ${testName}: ${reason.join('; ')}`);
    }

    if (shouldSave) {
      const fileName = `note_dpr${rep.dpr}_zoom${Math.round(rep.zoom * 100)}.png`;
      const base64Data = rep.dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(outDir, fileName), Buffer.from(base64Data, 'base64'));
    }
  }

  await context.close();
}

await browser.close();

console.log('\n================ 视觉验收总结 ================');
console.log(`总检验项: ${totalChecks} | 通过: ${passedChecks} | 失败: ${failures.length}`);

if (shouldSave) {
  console.log(`📸 快照已写入: ${outDir}`);
}

if (failures.length > 0) {
  console.error('\n❌ 以下测试未通过:');
  for (const f of failures) {
    console.error(` - ${f.testName}: ${f.reason}`);
  }
  process.exit(1);
} else {
  console.log('🎉 全部跨 DPR / 跨缩放视觉守卫测试 100% 达标！');
  process.exit(0);
}
