// 预览像素验收脚本（本地开发用，需 dev server + playwright）：建工程 + 新增谱面（贴样例代码）→
// 打开该谱 → 预览页抓「面板 canvas 的原生位图」（toDataURL，= 用户看到的像素）+ 工作台对照。
// 用法：node scripts/preview-shot.mjs [谱面JSON路径] [输出前缀]
// （默认样例谱 `docs/resource/SampleChartCode/` 为本地语料、不入 git，缺失时自备 JSON 路径。）
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const chartPath = process.argv[2] ?? 'docs/resource/SampleChartCode/Official/30_EX.json';
const out = process.argv[3] ?? '/tmp/preview';
const chartCode = readFileSync(chartPath, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// 1. 新建工程（空态 → 创建第一个工程；名称 → 创建）
await page.getByRole('button', { name: '创建第一个工程' }).first().click();
await page.getByLabel('工程名称').fill('预览排障');
await page.locator('[role="dialog"] button', { hasText: '创建' }).last().click();
await page.waitForTimeout(1000);

// 2. 工程详情：新增谱面（贴谱面代码；该弹窗主按钮叫「添加」）
await page.getByRole('button', { name: '新增谱面' }).first().click();
await page.waitForTimeout(400);
await page.getByPlaceholder('粘贴 Bestdori 风格 JSON，或留空建一张空谱面').fill(chartCode);
await page.locator('[role="dialog"] button', { hasText: '添加' }).last().click();
await page.waitForTimeout(1500);

// 3. 打开导入的那张谱（详情页最后一个「打开」= 刚加的；新工程自带一张空白首谱，别看错对象）
const opens = page.getByRole('button', { name: '打开' });
console.log('[打开 count]', await opens.count());
await opens.last().click();
await page.waitForTimeout(2000);

// 4. 进预览页
await page.getByRole('button', { name: /预览/ }).first().click();
await page.waitForSelector('.spv-panel canvas', { timeout: 20000 });
await page.waitForTimeout(1800);

// 5. 全部面板原生位图
const n = await page.locator('.spv-panel canvas').count();
console.log('[panels total]', n);
for (let k = 0; k < n; k++) {
  const dataUrl = await page.evaluate((idx) => {
    const c = document.querySelectorAll('.spv-panel canvas')[idx];
    return c.toDataURL('image/png');
  }, k);
  writeFileSync(`${out}-panel${String(k).padStart(2, '0')}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

// 6. 页面截图 + 工作台对照（面积最大的 canvas = 主画布；滚到音符出现处再抓）
await page.screenshot({ path: `${out}-page.png` });
await page.getByRole('button', { name: /工作台/ }).first().click();
await page.waitForTimeout(2500);
const biggest = () => page.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')];
  const big = cs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!big) return null;
  const r = big.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, data: big.toDataURL('image/png') };
});
const before = await biggest();
if (before) {
  await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
  await page.mouse.wheel(0, -900);   // 上滚 = 更晚的拍
  await page.waitForTimeout(1200);
  const after = await biggest();
  if (after) writeFileSync(`${out}-workspace.png`, Buffer.from(after.data.split(',')[1], 'base64'));
}

await browser.close();
console.log('[done]', out);
