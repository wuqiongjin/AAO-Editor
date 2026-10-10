// 首个音符抵线卡顿 · 冷路径时间线探针（issue 167 调研产出，只读不改应用代码）
//
// 用途：量化「首次打开程序 / 换未用过皮肤后首次播放」时谱面画布播放冷路径的全部主线程位图工作：
//   1) rAF 帧间隔（gapP50 / gapMax / gapsOver25）—— 用户可见卡顿的直接信号；
//   2) 按离屏画布聚合的 drawImage 成本（瓦片光栅 / 瓦片 blit / 静态层，含首次出现时间戳）；
//   3) 每张图片源首次进入 drawImage（首用解码嫌疑）；
//   4) longtask（>50ms 长任务）。
//
// 用法（需 dev server，见 AGENTS.md；URL 走对外地址或 127.0.0.1:5173）：
//   node scripts/first-note-hitch-probe.mjs                          # 浏览器 + 默认 30_EX
//   URL=https://<云预览地址>/ node …                                 # 本地浏览器进程渲染云端 dev server（贴近日常形态）
//   HEADED=1 node …                                                  # 有头模式（默认无头；有头 = 真实 GPU 合成路径）
//   CHART=docs/resource/StressTestChart/Official/684_SP.json MEASURE_MS=9000 node …
//   ELECTRON=1 node …                                                # Electron 桌面壳（需本机有显示器/音频设备）
//   xvfb-run -a node …                                               # 容器/CI 无显示环境跑 Electron（客户端 = 容器
//                                                                     CPU，仅作对照基线，不等于用户实机）
// 环境变量：CHART=谱面JSON路径 / MEASURE_MS=单次播放采样窗口 ms / URL=dev server 地址 / ELECTRON=1
//
// 参考硬件基线（2026-10-10，云开发容器，浏览器与 Electron 一致）：
//   30_EX 与最密官方 SP 谱 684_SP（1462 可见 + 2313 hidden）：303~543 帧/窗口，
//   gap p50 16.7ms、max ≤21.5ms、gapsOver25=0、longtask=0；
//   冷首播全部画布工作合计 12~20ms（热播 <1ms）——机制在参考硬件上不可见，需在用户实机跑出量级。
// 用户机判读：heavyFrames（单帧 drawMs>6）与 gapsOver25 出现的时刻 ≈ 首音符抵线前后、且仅冷首播出现
//   → 坐实「播放期补建链无预算单任务」；把 JSON 输出整体回填到 issue 167。
import { chromium, _electron as electron } from 'playwright';
import { readFileSync } from 'node:fs';

const useElectron = process.env.ELECTRON === '1';
const chartCode = readFileSync(process.env.CHART ?? 'docs/resource/SampleChartCode/Official/30_EX.json', 'utf8');
const measureMs = Number(process.env.MEASURE_MS ?? 5000);

const INIT = () => {
  const S = { armed: false, t0: 0, frames: [], canvases: [], srcFirstDraw: [], longTasks: [] };
  Object.defineProperty(window, '__probe', { value: S });
  const proto = CanvasRenderingContext2D.prototype;
  const origDraw = proto.drawImage;
  let frameDrawMs = 0, frameDraws = 0;
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => {
    if (S.armed) {
      S.frames.push({ t: performance.now() - S.t0, drawMs: frameDrawMs, draws: frameDraws });
      frameDrawMs = 0; frameDraws = 0;
    }
    return cb(t);
  });
  proto.drawImage = function (...args) {
    const t0 = performance.now();
    try { return origDraw.apply(this, args); } finally {
      if (!S.armed) return;
      const dt = performance.now() - t0;
      frameDrawMs += dt; frameDraws += 1;
      const cv = this.canvas;
      if (cv) {
        if (!cv.__probeBucket) {
          cv.__probeBucket = { w: cv.width, h: cv.height, ms: 0, n: 0, firstT: performance.now() - S.t0 };
          S.canvases.push(cv.__probeBucket);
        }
        cv.__probeBucket.ms += dt;
        cv.__probeBucket.n += 1;
      }
      const src = args[0];
      const tag = src && (src.currentSrc || src.src);
      if (tag && !src.__probeSeen) {
        src.__probeSeen = true;
        S.srcFirstDraw.push({ src: String(tag).split('/').pop().slice(0, 60), t: performance.now() - S.t0, ms: Math.round(dt * 100) / 100, w: src.naturalWidth ?? -1, h: src.naturalHeight ?? -1 });
      }
    }
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (S.armed) S.longTasks.push({ t: Math.round(e.startTime - S.t0), d: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
};

let page;
if (useElectron) {
  const app = await electron.launch({ cwd: process.cwd(), args: ['.', '--no-sandbox'], env: { ...process.env, NODE_ENV: 'development' } });
  page = await app.firstWindow();
  globalThis.__close = () => app.close();
} else {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  globalThis.__close = () => browser.close();
}
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.addInitScript(INIT);

await page.goto(process.env.URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: '创建第一个工程' }).first().click();
await page.getByLabel('工程名称').fill('首音符冷路径探针');
await page.locator('[role="dialog"] button', { hasText: '创建' }).last().click();
await page.getByRole('button', { name: '新增谱面' }).first().click();
await page.getByPlaceholder('粘贴 Bestdori 风格 JSON，或留空建一张空谱面').fill(chartCode);
await page.locator('[role="dialog"] button', { hasText: '添加' }).last().click();
await page.getByRole('button', { name: '打开' }).last().click();
await page.locator('.play-bar--workspace .play-bar__play-btn').waitFor({ state: 'visible' });
await page.waitForTimeout(2500);

const playButton = page.locator('.play-bar--workspace .play-bar__play-btn');
const currentTime = page.locator('.play-bar--workspace .play-bar__time-current');

async function resetToZero() {
  await currentTime.dblclick();
  const input = page.locator('.play-bar--workspace .play-bar__time-input');
  await input.fill('0');
  await input.press('Enter');
  await page.waitForTimeout(200);
}

async function measure(label) {
  await page.evaluate(() => {
    const S = window.__probe;
    S.frames.length = 0; S.canvases.length = 0; S.srcFirstDraw.length = 0; S.longTasks.length = 0;
    S.t0 = performance.now();
    S.armed = true;
  });
  await playButton.click();
  await page.waitForTimeout(measureMs);
  await playButton.click();
  const r = await page.evaluate(() => {
    const S = window.__probe;
    S.armed = false;
    const gaps = [];
    for (let i = 1; i < S.frames.length; i += 1) gaps.push(S.frames[i].t - S.frames[i - 1].t);
    gaps.sort((a, b) => b - a);
    return {
      rafFrames: S.frames.length,
      gapP50: Math.round((gaps[Math.floor(gaps.length / 2)] ?? 0) * 10) / 10,
      gapMax: Math.round((gaps[0] ?? 0) * 10) / 10,
      gapsOver25: gaps.filter((g) => g > 25).length,
      heavyFrames: S.frames.filter((f) => f.drawMs > 6).slice(0, 12).map((f) => ({ at: Math.round(f.t), drawMs: Math.round(f.drawMs * 10) / 10, draws: f.draws })),
      topCanvases: [...S.canvases].sort((a, b) => b.ms - a.ms).slice(0, 10)
        .map((e) => ({ size: `${e.w}x${e.h}`, ms: Math.round(e.ms * 10) / 10, n: e.n, firstT: Math.round(e.firstT) })),
      srcFirstDraw: S.srcFirstDraw.slice(0, 12),
      longTasks: S.longTasks,
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(r));
}

await measure('cold-first-play');
await resetToZero();
await measure('warm-second-play');
await resetToZero();

await page.getByRole('button', { name: /素材/ }).first().click();
const skinCard = page.locator('.skin-preset:not(.is-active)').first();
const unusedPreset = skinCard.locator('button.skin-pill');
await unusedPreset.waitFor({ state: 'visible' });
const skinName = (await skinCard.locator('strong').textContent())?.trim();
await unusedPreset.click();
await page.getByRole('button', { name: /工作台/ }).first().click();
await playButton.waitFor({ state: 'visible' });
await page.waitForTimeout(1500);
await measure(`unused-skin-first-play:${skinName}`);
await resetToZero();
await measure(`unused-skin-second-play:${skinName}`);

await globalThis.__close();
