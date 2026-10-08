// 仿真场像素验收脚本（chart-preview 05 锁测③，本地开发用，需 dev server + playwright）：
//   建工程 → 新增谱面（贴样例代码）→ 打开该谱 → 预览页 → 切「动态预览」→ 抓**场地 canvas 的原生位图**
//   （`toDataURL`，= 用户看到的像素）+ 页面截图，并打印人工验收清单要看的那几项。
//
// 用法：node scripts/sim-shot.mjs [谱面JSON路径] [输出前缀]
// （默认样例谱 `docs/resource/SampleChartCode/` 为本地语料、不入 git，缺失时自备 JSON 路径。）
// 环境变量：VIEWPORT=1680x1000（视口）/ DSF=2（设备像素比）/ URL=http://127.0.0.1:5173/
//
// 人工验收清单（数字由本脚本打印，观感要人眼看 `${out}-*.png`）：
//   1. 场地比例 = 1334:750（打印 w/h ≈ 1.7787），背景 / 场地图 / 场地判定线三图都在；
//   2. 音符：越远的越小越靠中靠上（伪透视），大小与位置对照 Bestdori 模拟器同一秒的截图；
//   3. 带体：长条 / 滑条是四边形带子（SP 曲线分段转折），颜色取自皮肤带体图；
//   4. 特效：命中处有轨道闪 + 打击环（tap 青 / flick 粉 / skill 黄 / 方向键紫橙）；
//   5. combo：右下 0.85W × 0.4375H 一带的数字随播放增长；
//   6. 播放条：播放/暂停、进度可拖、时间码推进；倍速（±0.25 步进 / 自定义输入 / 常用档菜单）与音量就位
//      （「回开头」「循环」两钮按 2026-10-07 验收回修撤销）。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const chartPath = process.argv[2] ?? 'docs/resource/SampleChartCode/Official/30_EX.json';
const out = process.argv[3] ?? '/tmp/sim';
const chartCode = readFileSync(chartPath, 'utf8');

const [vw, vh] = (process.env.VIEWPORT ?? '1680x1000').split('x').map(Number);
const dsf = Number(process.env.DSF ?? 2);
const url = process.env.URL ?? 'http://127.0.0.1:5173/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// 1. 新建工程
await page.getByRole('button', { name: '创建第一个工程' }).first().click();
await page.getByLabel('工程名称').fill('仿真场排障');
await page.locator('[role="dialog"] button', { hasText: '创建' }).last().click();
await page.waitForTimeout(1200);

// 2. 工程详情：新增谱面（贴谱面代码；该弹窗主按钮叫「添加」）
await page.getByRole('button', { name: '新增谱面' }).first().click();
await page.waitForTimeout(400);
await page.getByPlaceholder('粘贴 Bestdori 风格 JSON，或留空建一张空谱面').fill(chartCode);
await page.locator('[role="dialog"] button', { hasText: '添加' }).last().click();
await page.waitForTimeout(1800);

// 3. 打开刚导入的那张谱（新工程自带一张空白首谱，取最后一个「打开」）
await page.getByRole('button', { name: '打开' }).last().click();
await page.waitForTimeout(2500);

// 4. 预览页 → 动态预览
await page.getByRole('button', { name: /预览/ }).first().click();
await page.waitForTimeout(1500);
await page.locator('.preview-modes__btn', { hasText: '动态' }).first().click();
await page.waitForTimeout(1500);

if (await page.locator('.pv-stage.is-empty').count()) {
  // 没跑过归档脚本的机器：这是 04 定案的空态，不是失败
  console.log('[空态]', (await page.locator('.pv-stage.is-empty').textContent())?.trim());
  console.log('[空态命令]', await page.locator('.pv-empty__cmd').textContent());
  await page.screenshot({ path: `${out}-empty.png` });
  await browser.close();
  process.exit(0);
}

await page.waitForSelector('.pv-field__canvas', { timeout: 20000 });
await page.waitForTimeout(1200);

const box = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return b && { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };
};
const stage = await box('.preview-stage');
const field = await box('.pv-field__canvas');
const bar = await box('.pv-bar');
console.log('[stage]', stage);
console.log('[field]', field, field ? `比例 ${(field.w / field.h).toFixed(4)}（设计面 ${(1334 / 750).toFixed(4)}）` : '');
console.log('[bar]', bar);
console.log('[位图]', await page.evaluate(() => {
  const c = document.querySelector('.pv-field__canvas');
  return c ? `${c.width} × ${c.height}（CSS ${c.style.width} × ${c.style.height}）` : null;
}));

/** 抓场地原生位图 + 当前时间码 */
const grab = async (suffix) => {
  const data = await page.evaluate(() => document.querySelector('.pv-field__canvas').toDataURL('image/png'));
  writeFileSync(`${out}-${suffix}.png`, Buffer.from(data.split(',')[1], 'base64'));
  const time = await page.locator('.pv-bar__time').first().textContent();
  console.log(`[${suffix}] timecode=${time}`);
};

await grab('paused0');
await page.screenshot({ path: `${out}-page0.png` });

// 5. 播 ~2.5 秒（无音频时走合成时间线；有音频放 BGM + 键音）
await page.getByRole('button', { name: '播放' }).first().click();
await page.waitForTimeout(2600);
await grab('playing');
await page.screenshot({ path: `${out}-page-playing.png` });
await page.getByRole('button', { name: '暂停' }).first().click();
await page.waitForTimeout(400);

// 6. 拖进度条到谱面中段 / 末段（React 的 value tracker 认它自己的 setter，直接赋值会被去重丢掉）
const seek = async (seconds) => {
  await page.locator('.pv-bar__seek').evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  await page.waitForTimeout(700);
};
const totalText = await page.locator('.pv-bar__time').last().textContent();
const total = Number((totalText ?? '0:00').split(':').reduce((acc, part) => acc * 60 + Number(part), 0));
await seek(Math.max(1, Math.floor(total * 0.6)));
await grab('seek-mid');
await seek(Math.max(1, Math.floor(total * 0.95)));
await grab('seek-late');

// 6.5 倍速控件（chart-preview 20）：触钮上就是当前倍速，点开是一列常用档 + 自定义输入
const rateTrigger = page.locator('.pv-rate .icon-btn');
const rateValue = () => page.locator('.pv-rate .icon-btn__label').textContent();
const rateOpen = async () => {
  await rateTrigger.click();
  await page.waitForTimeout(300);
};
// 手填是"敲一下就生效"，所以这里**不按回车**（越界的才需要回车 / 失焦来钳回）
const rateType = async (text, confirm = false) => {
  await page.locator('.pv-rate__value').fill(text);
  if (confirm) await page.locator('.pv-rate__value').press('Enter');
  await page.waitForTimeout(200);
};
console.log('[倍速] 初值（触钮上的文字）', await rateValue());
await rateOpen();
console.log('[倍速面板]', await page.locator('.pv-rate__option').allTextContents());
const ratePanel = await box('.pv-rate__panel');
const rateCustom = await box('.pv-rate__custom');
console.log('[倍速面板盒]', ratePanel, '（触钮盒', await box('.pv-rate'), '）');
// 自定义那行（含末尾的 ×）必须整行落在面板里
console.log('[倍速自定义行]', rateCustom, '未溢出面板 =',
  !!(ratePanel && rateCustom && rateCustom.x + rateCustom.w <= ratePanel.x + ratePanel.w));
await page.screenshot({ path: `${out}-page-rate-menu.png` });
await page.locator('.pv-rate__option').filter({ hasText: /^1\.5×$/ }).click();
await page.waitForTimeout(200);
console.log('[倍速] 选 1.5× 后', await rateValue());
await rateOpen();
await rateType('1.35');
console.log('[倍速] 手填 1.35（不按回车）→', await rateValue());
await rateType('9');
console.log('[倍速] 手填 9 但未确认 →', await rateValue(), '（越界不即时生效，输完才钳回）');
await rateType('9', true);
console.log('[倍速] 回车确认后 →', await rateValue());
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}-page-rate.png` });

// 7. 「设置」面板：动态形态该有「仿真场」（音符速度 + 镜向），不该有标记 / 导出信息
await page.locator('.preview-toolbar').getByRole('button', { name: '设置' }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}-page-settings.png` });
console.log('[设置面板]', await page.locator('.pdp__group-title').allTextContents());

await browser.close();
console.log('[done]', out);
