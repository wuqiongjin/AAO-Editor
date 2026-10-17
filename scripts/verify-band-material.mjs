// issue 46 · 动态预览带体材质 / 叠亮的浏览器像素验收（单测锁测的**替代证据**）。
//
// 为什么不是单测：记录型 ctx 只记录"画了什么路径、用什么 α"，看不到**光栅后的叠亮**。
// 本脚本用一条**零外部依赖的合成谱**（两条同轨、错开时间的竖滑条）在真浏览器里出帧：
//   - y=250 只有后放那条（单层），y=500 两条都覆盖（双层）；
//   - 同一条带体上：中线 vs 两侧亮缘。
// 期望：① 单层体半透明（不是平涂）；② 双层处明显更亮（跨滑条二次合成）；
//       ③ 亮缘比中线亮（材质有亮边）。
//
// 用法（需 dev server + playwright）：
//   node scripts/verify-band-material.mjs [--url=http://127.0.0.1:5173/] [--seek=0:01.5]
// 退出码：0 = 全部达标；1 = 有断言不达标。
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:5173/');
const seek = opt('seek', '0:01.5');

// 合成谱：两条同轨（lane 3）竖滑条，时间错开 0.5s。1.5s 时上一条只到 y=369，下一条到 y=123
const CHART = JSON.stringify([
  { type: 'BPM', beat: 0, bpm: 120 },
  { type: 'Slide', connections: [{ beat: 0, lane: 3 }, { beat: 4, lane: 3 }] },
  { type: 'Slide', connections: [{ beat: 1, lane: 3 }, { beat: 5, lane: 3 }] },
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

await page.getByRole('button', { name: '创建第一个工程' }).first().click();
await page.getByLabel('工程名称').fill('带体材质验收');
await page.locator('[role="dialog"] button', { hasText: '创建' }).last().click();
await page.waitForTimeout(1200);

await page.getByRole('button', { name: '新增谱面' }).first().click();
await page.waitForTimeout(400);
await page.waitForSelector('[role="dialog"] textarea');
// 1.5MB 级受控 textarea 不用 locator.fill（React 异步刷新会撞回读校验）：原生 setter + input
await page.evaluate((text) => {
  const ta = document.querySelector('[role="dialog"] textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, CHART);
await page.waitForTimeout(300);
await page.locator('[role="dialog"] button', { hasText: '添加' }).last().click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: '打开' }).last().click();
await page.waitForTimeout(2000);

await page.getByRole('button', { name: /预览/ }).first().click();
await page.locator('.preview-modes__btn', { hasText: '动态' }).first().click();
await page.waitForSelector('.pv-field__canvas', { timeout: 20000 });
await page.waitForTimeout(1500);

const BAR = '.play-bar--preview ';
await page.locator(`${BAR}.play-bar__time-current`).dblclick();
await page.locator(`${BAR}.play-bar__time-input`).fill(seek);
await page.locator(`${BAR}.play-bar__time-input`).press('Enter');
await page.waitForTimeout(800);

const timecode = await page.locator(`${BAR}.play-bar__time-current`).textContent();
const m = await page.evaluate(() => {
  const c = document.querySelector('.pv-field__canvas');
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const sx = c.width / 1334;
  const sy = c.height / 750;
  // 设计坐标 → 位图（fieldMetrics(1334,750)：centerX 667 / laneWidth 154 / laneHeight 615）
  const px = (x, y) => {
    const xi = Math.min(c.width - 1, Math.max(0, Math.round(x * sx)));
    const yi = Math.min(c.height - 1, Math.max(0, Math.round(y * sy)));
    const i = (yi * c.width + xi) * 4;
    return [img[i], img[i + 1], img[i + 2], img[i + 3]];
  };
  const rowMax = (y, x0, x1) => {
    let best = [0, 0, 0, 0];
    for (let x = x0; x <= x1; x++) {
      const p = px(x, y);
      if (p[1] > best[1]) best = p;
    }
    return best;
  };
  /** 体色 (75,227,113) 叠背景：绿通道反算有效 α（背景取同 y、带体外的空白列） */
  const alpha = (x, y, bgX) => {
    const bg = px(bgX, y)[1];
    const g = px(x, y)[1];
    return (g - bg) / (227 - bg);
  };
  return {
    canvas: `${c.width}×${c.height}`,
    singleAlpha: alpha(667, 250, 400),
    overlapAlpha: alpha(667, 500, 400),
    singleCenter: px(667, 250),
    singleRim: rowMax(250, 640, 700),
  };
});

const checks = [
  ['单层体半透明（非平涂）', m.singleAlpha > 0.2 && m.singleAlpha < 0.8, `α=${m.singleAlpha.toFixed(3)}`],
  ['双层重叠更亮（跨滑条二次合成）', m.overlapAlpha > m.singleAlpha + 0.12,
    `重叠 α=${m.overlapAlpha.toFixed(3)} vs 单层 α=${m.singleAlpha.toFixed(3)}`],
  ['亮缘比中线亮（有亮边）', m.singleRim[1] > m.singleCenter[1] + 20,
    `亮缘 g=${m.singleRim[1]} vs 中线 g=${m.singleCenter[1]}`],
];

let failures = 0;
console.log(`[band-material] ${url} seek=${seek}（timecode=${timecode}）canvas=${m.canvas}`);
for (const [name, ok, detail] of checks) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
