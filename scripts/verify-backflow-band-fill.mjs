// issue 45 · 倒流区带体填充的浏览器位图验收（锁测的**替代证据**，照 issue 115 先例）。
//
// 为什么不是单测：记录型 ctx 不做光栅化——nonzero 抵消发生在**光栅阶段**（票 Comments 的最小
// canvas 实验：一对几何重合、绕向相反的四边形进同一条路径一次 fill ⇒ 内部 0 px；同向 ⇒ 正常填充；
// 零面积 ⇒ 本来就不填充）。单测锁的是"路径点绕向一致"（SimField.test.ts 的 issue 45 锁测），
// 锁不了"像素到底填没填上"——那必须真浏览器抓位图。
//
// 做什么：载入 dzilas 150030（真实倒流区谱面：225 BPM，beat 48/108/168/228 起各有一段 −225
// 回折）→ 动态预览 → 暂停态 seek 到倒流区内若干秒（5.0 / 8.0 / 11.0 / 12.5）→ 抓
// `.pv-field__canvas` 位图。期望带体四边形由**真实 drawSimFrameAt**（node 侧记录型 ctx，设计面
// 1334×750）算出，按画布缩放映射到位图：每条四边形的**中线**（两腰中点连线）采样，像素必须落在
// 带体色族（绿：g 显著大于 r/b）里。修前：重合反向对抵消成洞 ⇒ 中线采不到绿 ⇒ 红。
//
// 用法（需 dev server + playwright）：
//   node scripts/verify-backflow-band-fill.mjs [谱面JSON路径] [--url=http://127.0.0.1:5173/] [--label=after]
//   [--seek=5.0,8.0,11.0,12.5] [--viewport=1680x1000]
// A/B 对照（修前基线）：另起一个 HEAD worktree 的 dev server，同命令换 --url / --label。
// worktree 缺 gitignore 的运行时产物（键音注册表 / 素材），先补件再起服务；
// 起服务一律走 scripts/dev.sh（AGENTS.md），端口用 DEV_PORT 覆盖：
//   git worktree add --detach /tmp/wt45 HEAD
//   ln -s "$PWD/node_modules" /tmp/wt45/node_modules
//   ln -s "$PWD/public/assets" /tmp/wt45/public/assets
//   mkdir -p /tmp/wt45/src/audio/gen /tmp/wt45/src/rendering/skin/gen /tmp/wt45/src/assets/audio
//   cp src/audio/gen/*.ts /tmp/wt45/src/audio/gen/ && cp src/rendering/skin/gen/*.ts /tmp/wt45/src/rendering/skin/gen/
//   ln -s "$PWD/src/assets/audio/keysounds" /tmp/wt45/src/assets/audio/keysounds
//   (cd /tmp/wt45 && DEV_PORT=5174 bash scripts/dev.sh) &
//   node scripts/verify-backflow-band-fill.mjs --url=http://127.0.0.1:5174/ --label=before
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  console.error('需要先安装 esbuild（vite 的传递依赖）才能把 TS 模块打进内存执行。');
  process.exit(2);
}

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const chartPath = argv.find((a) => !a.startsWith('--')) ?? 'docs/resource/StressTestChart/Community/dzilas/150030.json';
const url = opt('url', 'http://127.0.0.1:5173/');
const label = opt('label', 'after');
const SEEK_SECONDS = (opt('seek', '5.0,8.0,11.0,12.5')).split(',').map(Number);
const viewport = opt('viewport', '1680x1000');
const [vw, vh] = viewport.split('x').map(Number);

// ───────────────────── node 侧：真实模块 → 该秒应可见的带体四边形 ─────────────────────
// Vite 的 `?inline` 二进制导入（键音 mp3 等）esbuild 不认识，打个桩：本脚本只走 beat→秒 与
// 带体几何，不碰音频。
const stubBinary = {
  name: 'stub-binary',
  setup(build) {
    build.onResolve({ filter: /\.(mp3|png|jpe?g|webp|wav|ogg|gif|svg|css)(\?.*)?$/ }, (args) => ({
      path: args.path, namespace: 'binary-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'binary-stub' }, () => ({
      contents: 'export default "stub";', loader: 'js',
    }));
  },
};

// 场景字段取**应用新设置的默认值**（`AppSettings.ts` 的 `DEFAULT_PREVIEW_SETTINGS` /
// `DEFAULT_APP_SETTINGS.display` + `UIProvider.tsx` 的 `beatDisplay` 初值 4）——与浏览器里那份
// settings 同源，否则接近窗口 T 对不上，可见四边形集合就错位。（那两处默认值变时这里要同步。）
// （`simAssets` 不进打包：它模块顶层读 Vite 专有的 `import.meta.env`，node 侧跑不了；
// 而 simField 只按 type 引它——空素材替身照它的 `emptySimAssets` 字面值在下面重建一份。）
const ENTRY = `
export { buildSimChart, drawSimFrameAt } from './src/preview/video/sim/simField';
export { buildActiveNoteIcons, normalizeNoteSkinSelection } from './src/rendering/skin/noteSkin';
export { fieldMetrics, SIM_BAND_COLORS, SIM_BAND_MATERIAL, SIM_BAND_MATERIAL_SP } from './src/preview/video/sim/simGeometry';
`;
const bundled = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
  plugins: [stubBinary],
});
const sim = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

/** 照 `simAssets.emptySimAssets` 的字面值（node 侧没有图：带体色走 SIM_BAND_COLORS 兜底） */
const emptySimAssets = () => ({
  background: null,
  field: null,
  playLine: null,
  bandColor: sim.SIM_BAND_COLORS.band,
  bandColorSp: sim.SIM_BAND_COLORS.sp,
  bandMaterial: sim.SIM_BAND_MATERIAL,
  bandMaterialSp: sim.SIM_BAND_MATERIAL_SP,
  sprites: null,
  missing: true,
  server: null,
});

/** 记录型假 2d context（与 tests/support/canvas.ts 同口径：属性赋值与方法调用都录进 calls） */
function makeRecordingCtx() {
  const calls = [];
  const overrides = {
    // 轨道闪的渐变（drawLaneFlash）：记录型 ctx 不光栅化，给个能接 addColorStop 的桩
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const key = String(prop);
      if (key === 'canvas') return { width: 0, height: 0 };
      if (key in overrides) return overrides[key];
      if (key === 'save' || key === 'restore') return () => { calls.push([key, []]); };
      return (...args) => { calls.push([key, args]); };
    },
    set(_t, prop, value) { calls.push([String(prop), [value]]); return true; },
  });
  return { proxy, calls };
}

/**
 * 从记录里切出带体填充批次（fillStyle 为带体色的 beginPath…fill），与单测锁测同一取法。
 * issue 46 起带体还有亮缘 `stroke` 与它的裁剪路径 `clip`：两者也是路径终点，必须把当前
 * 点集切走，否则亮缘的点会被算进下一个 fill 批次。
 */
function bandQuadsOf(calls) {
  const bandColors = new Set([sim.SIM_BAND_COLORS.band, sim.SIM_BAND_COLORS.sp]);
  const batches = [];
  let cur = null;
  let quads = [];
  let fillStyle = '';
  for (const [k, args] of calls) {
    if (k === 'fillStyle') fillStyle = String(args[0]);
    else if (k === 'moveTo') { cur = [{ x: args[0], y: args[1] }]; quads.push(cur); }
    else if (k === 'lineTo' && cur) cur.push({ x: args[0], y: args[1] });
    else if (k === 'fill' || k === 'stroke' || k === 'clip') {
      if (k === 'fill' && quads.length > 0 && bandColors.has(fillStyle)) batches.push(quads);
      quads = [];
      cur = null;
    }
  }
  return batches;
}

const signedArea = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

const chartJson = JSON.parse(fs.readFileSync(chartPath, 'utf8'));
const scene = {
  notes: chartJson,
  beatDisplay: 4,
  noteSpeed: 9.5,
  noteSize: 1,
  slideOpacity: 0.8,
  simultaneousClickLines: true,
  colorAssist: true,
  mirror: false,
};
const icons = sim.buildActiveNoteIcons(sim.normalizeNoteSkinSelection({}));
const chart = sim.buildSimChart(scene, icons);
const metrics = sim.fieldMetrics(1334, 750);
const noopSprite = { render() {}, renderDecorator() {} };

/** 该秒应可见的带体四边形（设计 px）：真 drawSimFrameAt 记录型 ctx，零面积（同拍水平段）剔除 */
function expectedQuads(seconds) {
  const { proxy, calls } = makeRecordingCtx();
  sim.drawSimFrameAt(proxy, {
    scene, chart, metrics,
    assets: emptySimAssets(),
    noteIcons: icons,
    spriteIcon: noopSprite,
  }, seconds);
  return bandQuadsOf(calls).flat().filter((q) => Math.abs(signedArea(q)) > 1);
}

// ───────────────────── 浏览器侧：载入 → seek → 抓位图 → 中线采样 ─────────────────────
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

console.log(`[${label}] ${url} chart=${chartPath} seek=[${SEEK_SECONDS.join(', ')}]s viewport=${viewport}`);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// 1. 新建工程（空态 → 创建第一个工程；名称 → 创建）
await page.getByRole('button', { name: '创建第一个工程' }).first().click();
await page.getByLabel('工程名称').fill('倒流区带体验收');
await page.locator('[role="dialog"] button', { hasText: '创建' }).last().click();
await page.waitForTimeout(1200);

// 2. 新增谱面（贴谱面代码）
// 1.5MB 的受控 textarea 不用 locator.fill：Playwright 的 fill 事后回读校验会撞上 React 的
// 异步刷新，大值下必然超时。改走原生 value setter + input 事件（React 受控输入的标准注入法）。
await page.getByRole('button', { name: '新增谱面' }).first().click();
await page.waitForTimeout(400);
await page.waitForSelector('[role="dialog"] textarea');
await page.evaluate((text) => {
  const ta = document.querySelector('[role="dialog"] textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, fs.readFileSync(chartPath, 'utf8'));
await page.waitForTimeout(300);
await page.locator('[role="dialog"] button', { hasText: '添加' }).last().click();
await page.waitForTimeout(2500);

// 3. 打开刚导入的那张谱
await page.getByRole('button', { name: '打开' }).last().click();
await page.waitForTimeout(2500);

// 4. 预览页 → 动态预览
await page.getByRole('button', { name: /预览/ }).first().click();
await page.locator('.preview-modes__btn', { hasText: '动态' }).first().click();
await page.waitForSelector('.pv-field__canvas', { timeout: 20000 });
await page.waitForTimeout(1500);

const PREVIEW_BAR = '.play-bar--preview ';
/** 暂停态双击时间码输入秒数（mm:ss.s）→ 跳到该帧（照 sim-shot.mjs 的口径） */
const seekTo = async (seconds) => {
  const mm = Math.floor(seconds / 60);
  const ss = (seconds - mm * 60).toFixed(1);
  await page.locator(`${PREVIEW_BAR}.play-bar__time-current`).dblclick();
  await page.locator(`${PREVIEW_BAR}.play-bar__time-input`).fill(`${mm}:${ss}`);
  await page.locator(`${PREVIEW_BAR}.play-bar__time-input`).press('Enter');
  await page.waitForTimeout(600);
  return page.locator(`${PREVIEW_BAR}.play-bar__time-current`).textContent();
};

/**
 * 抓当前帧位图并逐四边形采样中线。quads 为设计 px，按画布缩放映射：
 * 设计面恒 1334:750（fitDesignSurface 的 contain），故 bitmap/design 是各向同一把尺。
 */
const measureFrame = async (quads) => {
  return page.evaluate(({ quads }) => {
    const c = document.querySelector('.pv-field__canvas');
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const sx = c.width / 1334;
    const sy = c.height / 750;
    const at = (x, y) => {
      const xi = Math.min(c.width - 1, Math.max(0, Math.round(x)));
      const yi = Math.min(c.height - 1, Math.max(0, Math.round(y)));
      const i = (yi * c.width + xi) * 4;
      return [img[i], img[i + 1], img[i + 2]];
    };
    // 带体色族：绿显著占优（#5fd68a / #8fe6c0 及其皮肤取样 / 0.8 α 叠暗底后的家族）
    const isBand = ([r, g, b]) => g > r + 20 && g > b + 20 && g > 70;
    let greenTotal = 0;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        if (img[i + 1] > img[i] + 20 && img[i + 1] > img[i + 2] + 20 && img[i + 1] > 70) greenTotal++;
      }
    }
    const perQuad = quads.map((q) => {
      const p = q.map((pt) => ({ x: pt.x * sx, y: pt.y * sy }));
      // 中线 = 两腰（p0p1 与 p2p3）中点的连线；顺带各偏 30% 腰宽采一行，防结点精灵压中线
      const m01 = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      const m23 = { x: (p[2].x + p[3].x) / 2, y: (p[2].y + p[3].y) / 2 };
      const rows = [[m01, m23]];
      for (const t of [-0.3, 0.3]) {
        rows.push([
          { x: m01.x + (p[1].x - p[0].x) * t, y: m01.y + (p[1].y - p[0].y) * t },
          { x: m23.x + (p[3].x - p[2].x) * t, y: m23.y + (p[3].y - p[2].y) * t },
        ]);
      }
      let hits = 0;
      let total = 0;
      for (const [a, b] of rows) {
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          if (isBand(at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))) hits++;
          total++;
        }
      }
      return { hits, total, ratio: hits / total };
    });
    return { canvas: { w: c.width, h: c.height }, greenTotal, perQuad };
  }, { quads });
};

let failures = 0;
for (const seconds of SEEK_SECONDS) {
  const quads = expectedQuads(seconds);
  const timecode = await seekTo(seconds);
  const { canvas, greenTotal, perQuad } = await measureFrame(quads);
  const aspect = (canvas.w / canvas.h).toFixed(4);
  const bad = perQuad.filter((r) => r.ratio < 0.6);
  const ok = bad.length === 0 && quads.length > 0;
  if (!ok) failures++;
  console.log(
    `[${label}] s=${seconds.toFixed(1)} timecode=${timecode} canvas=${canvas.w}×${canvas.h}（比例 ${aspect}，设计面 1.7787）` +
    ` quads=${quads.length} 带体色像素≈${greenTotal}` +
    ` 中线达标 ${perQuad.length - bad.length}/${perQuad.length}` +
    (bad.length ? ` 未达标比值=[${bad.map((r) => r.ratio.toFixed(2)).join(', ')}]` : '') +
    ` → ${ok ? 'PASS' : 'FAIL'}`,
  );
}

await browser.close();
console.log(`[${label}] ${failures === 0 ? '全部通过' : `${failures} 个秒数未通过`}`);
process.exit(failures === 0 ? 0 : 1);
