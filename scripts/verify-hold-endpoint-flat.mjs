#!/usr/bin/env node
/**
 * 票 77 · 滑条按住端帽扁平化的素材侧像素验收。
 *
 * 为什么不是单测：帧级单测只能看到"取了哪张源矩形"（`SimField.test.ts` 的 `sx/sy`），
 * 看不到那张图的光栅是不是歪的。本脚本在真 canvas 上量 `note_long_0..6` 的绿色椭圆环：
 * 上半弧与下半弧的绿色墨迹 x 质心之差 = 透视剪切量，|lane − 3| 越大越大、左右反号。
 * 结论须与票内扁平口径合起来看：`slideEndpointFor()` 恒取 `FLAT_LANE=3`（`NoteSkin.test.ts`），
 * 且按住帧也走它（`SimField.test.ts`），所以屏上出现的始终是这里量出的那张端正图。
 *
 * 用法：node scripts/verify-hold-endpoint-flat.mjs
 * 退出码：0 = 扁平轨端正 + 外轨确实歪（说明不能按轨取图）；1 = 有断言不达标。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAT_LANE = 3;

// 注册表是生成的 TS，但 `long` 段是纯 JSON 形状；只取第一个包（skin00，默认 slide 包）。
const registry = readFileSync(resolve(root, 'src/rendering/skin/gen/noteSkinRegistry.gen.ts'), 'utf8');
const block = registry.match(/"long":\s*\[([\s\S]*?)\n\s*\]/)?.[1];
if (!block) throw new Error('注册表里找不到 note_long 源矩形');
const rects = [...block.matchAll(/"x":\s*(-?\d+),\s*"y":\s*(-?\d+),\s*"w":\s*(\d+),\s*"h":\s*(\d+)/g)]
  .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
if (rects.length !== 7) throw new Error(`默认包应有 7 张 note_long，实际 ${rects.length}`);

const png = readFileSync(resolve(root, 'public/assets/skins/skin00/RhythmGameSprites.png')).toString('base64');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const shifts = await page.evaluate(async ({ dataUrl, rects }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    // 绿色墨迹判据与构建期量墨迹同款；只统计椭圆环，不含中间那条水平长条。
    const isInk = (i) => {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      return a > 127 && g > 120 && g > r + 40 && g > b + 40;
    };
    return rects.map(({ x, y, w, h }) => {
      let topX = 0, topN = 0, botX = 0, botN = 0;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const i = ((y + dy) * img.width + (x + dx)) * 4;
          if (!isInk(i)) continue;
          if (dy < h / 2) { topX += dx; topN++; } else { botX += dx; botN++; }
        }
      }
      return topN && botN ? botX / botN - topX / topN : NaN;
    });
  }, { dataUrl: `data:image/png;base64,${png}`, rects });

  const flat = shifts[FLAT_LANE];
  const checks = [
    ['FLAT_LANE 那张端正（上下弧错位 < 4px）', Number.isFinite(flat) && Math.abs(flat) < 4, flat],
    ['外侧两轨明显歪（> 15px）且左右反号', Math.abs(shifts[0]) > 15 && Math.abs(shifts[6]) > 15 && shifts[0] * shifts[6] < 0,
      [shifts[0], shifts[6]]],
    ['剪切量随 |lane − FLAT_LANE| 单调', Math.abs(shifts[0]) > Math.abs(flat) && Math.abs(shifts[6]) > Math.abs(flat)],
  ];
  console.log('[hold-endpoint-flat] note_long_0..6 上下弧 x 质心差（源像素）：');
  console.log('  ' + shifts.map((s, i) => `lane${i}=${s.toFixed(1)}`).join('  '));
  let failures = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  }
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
}
