// issue 115 · 滑条带体「连线顺序」像素验收工具（后续同类问题复用）。
//
// 做什么：用**真实模块** `src/chart/editing/SlideSegments.ts` 的 `displayConnections` 投影一份
// 谱面代码里的滑条，按给定（或拟合出的）画布尺度栅格化带体，与一张参考截图（Bestdori / 实机）
// 逐像素求 IoU —— 用来回答"我们的带子是不是按参考口径连的"。
//
// 为什么不是单测：本仓无 e2e 基建，带体形状是 Canvas 像素产物，单测只能锁"点序"、锁不了"看起来
// 对不对"（照 issue 106 先例）。本脚本是锁测的**替代证据**，验收线 IoU ≥ 0.8。
//
// 用法：
//   node scripts/verify-slide-band-order.mjs <png> <chart.json> [选项]
// 例（issue 115 的验收命令）：
//   node scripts/verify-slide-band-order.mjs bestdori.png docs/resource/SampleChartCode/Community/150030.json \
//        --slide=1 --beat0=2 --lane=19 --x0=11 --s=148 --y0=728.5 --dir=up
// 不知道尺度就加 `--fit`：网格搜索 (S, y0) 取 IoU 最大的组合（上下两个方向都试）。
//
// 选项：
//   --slide=<i>   谱面代码数组里的第几条 Slide/Long（默认：连接点最多的一条）
//   --beat0=<b>   该滑条首点的 beat（默认：首点 beat）
//   --lane=<px>   轨宽（参考截图上量出来的，默认 19）
//   --x0=<px>     轨道左缘 x（默认 11）
//   --s=<px>      每拍像素高度（默认 148）
//   --y0=<px>     beat0 所在画布 y（默认 728.5）
//   --dir=up|down up = 拍越大越靠上（本编辑器口径），down = 反之（默认 up）
//   --fit         网格搜索 (S, y0) 再算 IoU（慢，但对新谱/新截图不必手工标定）
//
// 依赖：本地 `esbuild`（vite 的传递依赖，仅用于把 TS 模块打进内存执行）。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  console.error('需要先安装 esbuild（vite 的传递依赖）才能把 TS 模块打进内存执行。');
  process.exit(2);
}

// ───────────────────── PNG 解码（zlib inflate + 逐行 filter 还原） ─────────────────────
function decodePng(buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || inter !== 0 || (ct !== 2 && ct !== 6)) throw new Error('unsupported png');
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      switch (f) {
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 255; break;
        }
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}

// ───────────────────── 参数 ─────────────────────
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const png = args.find((a) => !a.startsWith('--'));
const jsonPath = args.filter((a) => !a.startsWith('--'))[1];
if (!png || !jsonPath) {
  console.error('用法：node scripts/verify-slide-band-order.mjs <png> <chart.json> [--fit] [--slide=i] [--lane=px] [--x0=px] [--s=px] [--y0=px] [--dir=up|down]');
  process.exit(2);
}
const LANE_W = Number(opt('lane', 19));
const LANE_X0 = Number(opt('x0', 11));
const S_GIVEN = Number(opt('s', 148));
const Y0_GIVEN = Number(opt('y0', 728.5));
const DIR = opt('dir', 'up') === 'up' ? -1 : 1;
const FIT = args.includes('--fit');
const half = LANE_W / 2;

// ───────────────────── 真实模块 → 投影 ─────────────────────
const bundled = await esbuild.build({
  entryPoints: ['src/chart/editing/SlideSegments.ts'],
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const chart = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const slideIdx = opt('slide') !== undefined
  ? Number(opt('slide'))
  : chart.reduce((best, o, i) => {
      const n = (o.type === 'Slide' || o.type === 'Long') ? o.connections.length : -1;
      return n > best.n ? { n, i } : best;
    }, { n: -1, i: -1 }).i;
const slide = chart[slideIdx];
if (!slide || !slide.connections) throw new Error(`没有找到 Slide/Long（index=${slideIdx}）`);
const raw = slide.connections;
const view = mod.displayConnections(raw);
const BEAT0 = opt('beat0') !== undefined ? Number(opt('beat0')) : raw[0].beat;

// ───────────────────── 截图 → 绿带掩码 ─────────────────────
const img = decodePng(fs.readFileSync(png));
const { w, h, ch, data } = img;
const measured = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * ch;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  if (g >= 78 && g >= r + 24 && g >= b + 24) measured[y * w + x] = 1;
}

// ───────────────────── 栅格化 + IoU ─────────────────────
const px = (p) => LANE_X0 + (p.lane + 0.5) * LANE_W;
const py = (p, S, y0) => y0 + DIR * S * (p.beat - BEAT0);

function iou(pts, S, y0) {
  const pred = new Uint8Array(w * h);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const yA = py(a, S, y0), yB = py(b, S, y0);
    if (Math.abs(yB - yA) < 1e-9) continue; // 同拍段：零面积，两边都不画
    const lo = Math.min(yA, yB), hi = Math.max(yA, yB);
    // 只走段内整行、并把 t 夹到 [0,1]：近水平段的 floor/ceil 会把 t 外推 → 凭空多画像素
    for (let y = Math.max(0, Math.ceil(lo)); y <= Math.min(h - 1, Math.floor(hi)); y++) {
      const t = Math.min(1, Math.max(0, (y - yA) / (yB - yA)));
      const cx = px(a) + (px(b) - px(a)) * t;
      for (let xx = Math.max(0, Math.floor(cx - half)); xx <= Math.min(w - 1, Math.ceil(cx + half)); xx++) pred[y * w + xx] = 1;
    }
  }
  let inter = 0, uni = 0;
  for (let i = 0; i < w * h; i++) { const m = measured[i], p = pred[i]; if (m && p) inter++; if (m || p) uni++; }
  return uni ? inter / uni : 0;
}

let S = S_GIVEN, y0 = Y0_GIVEN;
if (FIT) {
  let best = { s: -1 };
  for (let s = 20; s <= 400; s += 1) {
    for (let yy = -4000; yy <= 4000; yy += 10) {
      const v = iou(view.conns, s, yy);
      if (v > best.s) best = { s: v, S: s, y0: yy };
    }
  }
  S = best.S; y0 = best.y0;
  console.log(`拟合尺度：S=${S} px/beat，beat ${BEAT0} @ y=${y0}（新口径 IoU ${best.s.toFixed(3)}）`);
}

console.log(`谱面：${jsonPath} [${slideIdx}]  结点 ${raw.length}  可见 ${raw.filter((c) => !c.hidden).length}`);
console.log(`截图：${png} ${w}x${h}  轨宽 ${LANE_W}  轨道左缘 x=${LANE_X0}`);
console.log(`投影（新口径 displayConnections）前 13 点：`);
console.log('  ' + view.conns.slice(0, 13).map((p) => `${p.beat}/${p.lane}`).join(' '));
console.log(`IoU  旧口径（数组序 ribbon）        = ${iou(raw, S, y0).toFixed(3)}`);
console.log(`IoU  新口径（displayConnections）   = ${iou(view.conns, S, y0).toFixed(3)}`);
console.log(`判定：${iou(view.conns, S, y0) >= 0.8 ? '通过（≥0.8）' : '未通过：形状仍与参考图不符，检查连线口径 / 尺度标定'}`);
