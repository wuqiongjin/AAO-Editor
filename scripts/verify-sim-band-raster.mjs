// chart-preview 65 · 动态预览带体材质的**浏览器像素验收**（单测锁测的替代证据）。
//
// 为什么还要真浏览器：单测的假 ctx 能读 RGBA 缓冲，但读不到 `putImageData → drawImage`
// 在真 canvas 上的合成 / 平滑 / 皮肤贴图运行时采样。本脚本在 dev server 的空壳页里
// import **产品代码本身**（`loadSimAssets` / `drawSimFrameAt` / `visibleSimBandGroups`），
// 用真 canvas 出帧，逐像素反算有效 α，并与内联 B 复算（逐像素剖面真值）同位比对。
//
// 验收项（票 65「锁测」④，共 8 条断言）：
//   ① 横截面中心 / 亮缘 / 软边 α；② 无段间横行条纹；③ 普通带纵向两端实中间虚、
//      SP 纵向恒定；④ 皮肤切换跟随；⑤ 交叉叠亮；⑥ 与内联 B 复算同位剖面一致。
//
// 用法（需先 `bash scripts/dev.sh`；云环境自动取 CNB_VSCODE_PROXY_URI 的 5173 端口）：
//   node scripts/verify-sim-band-raster.mjs [--url=<对外访问地址>]
// 退出码：0 = 全部达标；1 = 有断言不达标；2 = 素材缺件（跑不了）。
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
// 云环境（AGENTS.md）：CNB_VSCODE_PROXY_URI 形如 https://<id>-{{port}}.cnb.run ⇒ 换 5173；
// 本地 / 普通远程开发走 localhost。一律先 `bash scripts/dev.sh` 起服务。
const proxy = process.env.CNB_VSCODE_PROXY_URI;
const url = opt('url', proxy ? proxy.replace('{{port}}', '5173') : 'http://127.0.0.1:5173/');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.route('**/__band65.html', (route) =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>band65</title>' }),
);
await page.goto(new URL('__band65.html', url).href, { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async () => {
  const [field, assetsMod, geom, skinMod, settingsMod, bandGeom, rasterMod] = await Promise.all([
    import('/src/preview/video/sim/simField.ts'),
    import('/src/preview/video/sim/simAssets.ts'),
    import('/src/preview/video/sim/simGeometry.ts'),
    import('/src/rendering/skin/noteSkin.ts'),
    import('/src/settings/AppSettings.ts'),
    import('/src/rendering/slideBandGeometry.ts'),
    import('/src/preview/video/sim/simBandRaster.ts'),
  ]);
  const defaults = settingsMod.defaultSettings('en');
  const noteIcons = skinMod.buildActiveNoteIcons(skinMod.normalizeNoteSkinSelection(defaults.visual.noteSkin));
  const noopSprite = { render() {}, renderDecorator() {} };
  const m = geom.fieldMetrics(1334, 750);
  const W = Math.round(m.w), H = Math.round(m.h);
  const CX = Math.round(m.centerX);
  const BG_G = 16; // SIM_FALLBACK_BG #0d1017 的绿通道
  const SECONDS = 1.5;
  const OPACITY = 0.8;

  const sceneOf = (notes) => ({
    notes,
    beatDisplay: 4,
    noteSpeed: 9.5,
    noteSize: 1,
    slideOpacity: OPACITY,
    simultaneousClickLines: false,
    colorAssist: false,
    mirror: false,
  });
  const slide = (points) => ({ type: 'Slide', connections: points });
  /** 16 点、中间 hidden ⇒ 整条传染 SP（hidden 点不产生命中特效，采样行不被污染） */
  const spSlide = () => slide(Array.from({ length: 17 }, (_, i) => ({
    beat: 2 + (2 * i) / 16, lane: 3, ...(i > 0 && i < 16 ? { hidden: true } : {}),
  })));
  const normalSlide = () => slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 3 }]);

  const loadAssets = async (skin) => {
    const a = await assetsMod.loadSimAssets({
      servers: ['jp'],
      bandSrc: `/assets/skins/${skin}/longNoteLine.png`,
      bandSpSrc: `/assets/skins/${skin}/longNoteLine2.png`,
    });
    // 只留带体材质：场地图 / 背景 / 判定线 / 精灵都不画 ⇒ 底色恒为近黑，可反算有效 α
    return { ...a, background: null, field: null, playLine: null, sprites: null, missing: a.missing };
  };

  const skin00 = await loadAssets('skin00');
  const skin05 = await loadAssets('skin05');
  if (skin00.missing) return { missing: true };

  /** 用产品出帧函数画一帧，返回 RGBA 位图与该秒的带体分组 */
  const draw = (notes, assets) => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scene = sceneOf(notes);
    const chart = field.buildSimChart(scene, noteIcons);
    field.drawSimFrameAt(ctx, { chart, scene, metrics: m, assets, noteIcons, spriteIcon: noopSprite }, SECONDS);
    return {
      data: ctx.getImageData(0, 0, W, H).data,
      groups: field.visibleSimBandGroups(chart, scene, m, SECONDS),
    };
  };
  /** 绿通道反算带体有效 α（底色 = 近黑，体色取该材质采样出的 RGB） */
  const alphaOf = (data, x, y, rgbG) =>
    (data[(y * W + x) * 4 + 1] - BG_G) / (rgbG - BG_G);
  const profileRow = (data, y, rgbG, half) => {
    let peak = 0, peakX = CX;
    for (let x = CX - 90; x <= CX + 90; x++) {
      const a = alphaOf(data, x, y, rgbG);
      if (a > peak) { peak = a; peakX = x; }
    }
    const center = alphaOf(data, CX, y, rgbG);
    const innerEdge = alphaOf(data, CX + Math.max(1, Math.round(half * 0.94)), y, rgbG);
    const outer = alphaOf(data, CX + Math.round(half) + 2, y, rgbG);
    return { center, peak, peakX, innerEdge, outer };
  };
  /** 该行带半宽（从产品分组的四边形逐点插值；与光栅内核同口径） */
  const halfAt = (groups, y) => {
    for (const g of groups) {
      for (const q of g.quads) {
        const y0 = q[0].y, y1 = q[3].y;
        if (y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
        const t = Math.abs(y1 - y0) < 1e-6 ? 0 : (y - y0) / (y1 - y0);
        const h0 = (q[1].x - q[0].x) / 2, h1 = (q[2].x - q[3].x) / 2;
        return h0 + (h1 - h0) * t;
      }
    }
    return 0;
  };
  /** 中心线逐行 α 的最大跌幅（暗缝指标：段间横纹会在这里冒尖） */
  const maxDip = (data, rgbG, from, to) => {
    let dip = 0, prev = -1;
    for (let y = from; y <= to; y++) {
      const a = alphaOf(data, CX, y, rgbG);
      if (prev >= 0) dip = Math.max(dip, prev - a);
      prev = a;
    }
    return dip;
  };

  // ---------------------------------------------------------------- 产品像素
  const sp = draw([spSlide()], skin00);
  const normal = draw([normalSlide()], skin00);
  const cross = draw([spSlide(), spSlide()], skin00);
  const otherSkin = draw([spSlide()], skin05);
  const rgbGSp = skin00.bandRasterSp.rgb[1];
  const rgbGNormal = skin00.bandRaster.rgb[1];
  const rgbGSp05 = skin05.bandRasterSp.rgb[1];
  const Y = 400;
  const half = halfAt(sp.groups, Y);
  const spRow = profileRow(sp.data, Y, rgbGSp, half);
  const normalRow = profileRow(normal.data, Y, rgbGNormal, halfAt(normal.groups, Y));
  const crossRow = profileRow(cross.data, Y, rgbGSp, half);
  const skin05Row = profileRow(otherSkin.data, Y, rgbGSp05, half);
  const spTop = alphaOf(sp.data, CX, 200, rgbGSp);
  const spMid = alphaOf(sp.data, CX, Y, rgbGSp);
  const normalTop = alphaOf(normal.data, CX, 200, rgbGNormal);
  const normalMid = alphaOf(normal.data, CX, Y, rgbGNormal);
  const productDip = maxDip(sp.data, rgbGSp, 180, 580);

  // ---------------------------------------------------------------- 内联 B 复算（真值，100% 光栅）
  // 票 65 定案的逐像素剖面真值：同一份 17 点剖面、逐设备像素行扫描、
  // 像素内 screen 合成；只画上面那条 SP 直带，用同一行 y 比横截面形状。
  const img = new Image();
  img.src = '/assets/skins/skin00/longNoteLine2.png';
  await img.decode();
  const sample = rasterMod.readSimBandImage(img);
  const profile = sample?.profile ?? [0.38, 0.38, 0.39, 0.40, 0.41, 0.43, 0.45, 0.48, 0.52, 0.56, 0.61, 0.67, 0.74, 0.82, 0.89, 0.62, 0.25];
  const buf = new Uint8ClampedArray(W * H * 4);
  for (const g of sp.groups) {
    const nodes = [];
    g.quads.forEach((q, i) => {
      if (i === 0) nodes.push({ x: (q[0].x + q[1].x) / 2, y: q[0].y, half: (q[1].x - q[0].x) / 2 });
      nodes.push({ x: (q[3].x + q[2].x) / 2, y: q[3].y, half: (q[2].x - q[3].x) / 2 });
    });
    nodes.sort((a, b) => a.y - b.y); // B 变体按 y 单调扫描（产品内核靠 splitBandAtFolds + 反向归一）
    let j = 0;
    for (let y = 0; y < H; y++) {
      const yCss = y + 0.5;
      while (j < nodes.length - 2 && nodes[j + 1].y < yCss) j++;
      const a = nodes[j], b = nodes[j + 1];
      if (!a || !b || yCss < a.y || yCss > b.y) continue;
      const t = (yCss - a.y) / Math.max(1e-6, b.y - a.y);
      const cx = a.x + (b.x - a.x) * t;
      const h = a.half + (b.half - a.half) * t;
      if (h <= 0) continue;
      const left = cx - h, right = cx + h;
      for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
        if (x < 0 || x >= W) continue;
        const ic = x + 0.5;
        const cov = Math.min(Math.max(Math.min(ic - left, right - ic), 0), 1);
        if (cov <= 0) continue;
        const av = bandGeom.sampleProfileAt(profile, (ic - cx) / h) * cov * OPACITY;
        if (av <= 0) continue;
        const p = (y * W + x) * 4;
        buf[p + 3] = Math.round(255 * (1 - (1 - buf[p + 3] / 255) * (1 - av)));
      }
    }
  }
  const bAlpha = (x, y) => buf[(y * W + x) * 4 + 3] / 255;
  let bPeak = 0;
  for (let x = CX - 90; x <= CX + 90; x++) bPeak = Math.max(bPeak, bAlpha(x, Y));
  const bCenter = bAlpha(CX, Y);
  const bEdge = bAlpha(CX + Math.max(1, Math.round(half * 0.94)), Y);
  let bDip = 0, bPrev = -1;
  for (let y = 180; y <= 580; y++) {
    const a = bAlpha(CX, y);
    if (bPrev >= 0) bDip = Math.max(bDip, bPrev - a);
    bPrev = a;
  }

  let lutDiff = 0;
  for (let i = 0; i < skin00.bandRasterSp.cross.length; i++) {
    lutDiff = Math.max(lutDiff, Math.abs(skin00.bandRasterSp.cross[i] - skin05.bandRasterSp.cross[i]));
  }
  return {
    canvas: `${W}×${H}`,
    singleCenter: spRow.center,
    singlePeak: spRow.peak,
    peakOffset: Math.abs(spRow.peakX - CX),
    softEdge: spRow.innerEdge,
    outer: spRow.outer,
    productDip,
    bDip,
    spTop, spMid, normalTop, normalMid,
    overlapCenter: crossRow.center,
    skinExpected: skin00.bandRasterSp.cross[0] * OPACITY,
    skin05Expected: skin05.bandRasterSp.cross[0] * OPACITY,
    skin00Center: spMid,
    skin05Center: skin05Row.center,
    skinLutDiff: lutDiff,
    skin00Peak: spRow.peak,
    skin05Peak: skin05Row.peak,
    productShape: { center: spRow.center / spRow.peak, edge: spRow.innerEdge / spRow.peak },
    inlineBShape: { center: bCenter / bPeak, edge: bEdge / bPeak },
    normalRowPeak: normalRow.peak,
  };
});

if (out.missing) {
  console.error('[band65] 仿真场素材缺件（assetsMissing），无法做真素材像素验收；先跑 `npm run assets:sync`');
  await browser.close();
  process.exit(2);
}

const checks = [
  ['横截面：中心半透明、亮缘更亮（不是平涂）',
    out.singleCenter > 0.15 && out.singleCenter < 0.8 && out.singlePeak > out.singleCenter * 1.6,
    `中心 α=${out.singleCenter.toFixed(3)} / 亮缘 α=${out.singlePeak.toFixed(3)}（峰位距中心 ${out.peakOffset}px）`],
  ['横截面：亮缘在两侧、最外一圈软边回落',
    out.peakOffset > 5 && out.softEdge < out.singlePeak * 0.8 && out.outer < 0.08,
    `0.94·half α=${out.softEdge.toFixed(3)} / 带外 α=${out.outer.toFixed(3)}`],
  ['无段间横行条纹（中心线逐行最大跌幅 < 0.05）',
    out.productDip < 0.05,
    `产品 maxDip=${out.productDip.toFixed(4)} / 内联 B maxDip=${out.bDip.toFixed(4)}`],
  ['SP 纵向恒定（贴图上沿与中段同亮）',
    Math.abs(out.spTop - out.spMid) < 0.05,
    `上 α=${out.spTop.toFixed(3)} / 中 α=${out.spMid.toFixed(3)}`],
  ['普通带纵向两端实、中间虚（整条一次）',
    out.normalTop > out.normalMid * 1.2,
    `上 α=${out.normalTop.toFixed(3)} / 中 α=${out.normalMid.toFixed(3)}（峰 α=${out.normalRowPeak.toFixed(3)}）`],
  ['交叉叠亮（两条重叠比单条明显更亮）',
    out.overlapCenter > out.spMid + 0.1,
    `重叠 α=${out.overlapCenter.toFixed(3)} / 单条 α=${out.spMid.toFixed(3)}`],
  ['皮肤切换跟随：两种皮肤的采样剖面不同且像素跟着变',
    out.skinLutDiff > 0.01 && Math.abs(out.skin00Peak - out.skin05Peak) > 0.01
      && Math.abs(out.skin00Center - out.skinExpected) < 0.06
      && Math.abs(out.skin05Center - out.skin05Expected) < 0.06,
    `LUT 最大差=${out.skinLutDiff.toFixed(3)}；亮缘 α ${out.skin00Peak.toFixed(3)} → ${out.skin05Peak.toFixed(3)}；` +
    `中心期望/实测 ${out.skinExpected.toFixed(3)}/${out.skin00Center.toFixed(3)} 与 ${out.skin05Expected.toFixed(3)}/${out.skin05Center.toFixed(3)}`],
  ['与内联 B 算法（同图精确复算）同位剖面一致',
    Math.abs(out.productShape.center - out.inlineBShape.center) < 0.15
      && Math.abs(out.productShape.edge - out.inlineBShape.edge) < 0.2,
    `产品 中心/峰=${out.productShape.center.toFixed(3)} 边/峰=${out.productShape.edge.toFixed(3)}；` +
    `内联 B 中心/峰=${out.inlineBShape.center.toFixed(3)} 边/峰=${out.inlineBShape.edge.toFixed(3)}`],
];

let failures = 0;
console.log(`[band65] ${url} canvas=${out.canvas}`);
for (const [name, ok, detail] of checks) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}
await browser.close();
process.exit(failures === 0 ? 0 : 1);
