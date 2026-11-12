// chart-preview 65 · 带体材质与逐像素光栅内核的锁测。
//
// 单测看不到 Canvas 像素，但**纯函数内核**能直接读 RGBA 缓冲：这里锁的是画质事实
// （横截面中心 / 亮缘 / 软边、无段间横纹、纵向整条一次、自叠 / 交叉叠亮），
// 浏览器里的回贴与皮肤切换另由 scripts/verify-sim-band-raster.mjs 做像素验收。
import { describe, expect, it } from 'vitest';
import {
  buildSimBandRasterMaterial,
  makeSimBandRasterBuffer,
  rasterSimBandGroups,
  readSimBandImage,
  SIM_BAND_CROSS_LUT_SIZE,
  SIM_BAND_RASTER_MATERIAL,
  SIM_BAND_RASTER_MATERIAL_SP,
  SIM_BAND_RASTER_SCALE,
  SIM_BAND_RASTER_SCALE_FULL,
  SIM_BAND_LOD_BUDGET_PIXELS,
  SIM_BAND_LOD_ENTER_LOW_PIXELS,
  SIM_BAND_LOD_EXIT_LOW_PIXELS,
  nextSimBandRasterLodState,
  simBandCoverageCss,
  type SimBandRasterGroup,
  type SimBandRasterLodState,
  type SimBandRasterMaterial,
} from '@/src/preview/video/sim/simBandRaster';
import { bandQuad, fieldMetrics } from '@/src/preview/video/sim/simGeometry';
import { sampleProfileAt } from '@/src/rendering/slideBandGeometry';

const m = fieldMetrics(1334, 750);
const NORMAL: SimBandRasterMaterial = SIM_BAND_RASTER_MATERIAL;
const SP: SimBandRasterMaterial = SIM_BAND_RASTER_MATERIAL_SP;

/** 一条 lane 3 的竖直带，按 `steps` 个逻辑段切分（查段间横纹 / 竹节） */
function straightBand(steps: number, a0 = 0.1, a1 = 1): SimBandRasterGroup {
  const quads = [];
  for (let i = 0; i < steps; i++) {
    const from = a0 + ((a1 - a0) * i) / steps;
    const to = a0 + ((a1 - a0) * (i + 1)) / steps;
    quads.push([...bandQuad(m, { lane: 3, a: from }, { lane: 3, a: to }, 1)]);
  }
  return { slide: 0, sp: false, quads };
}

function render(groups: SimBandRasterGroup[], alpha = 0.8, scale = 0.5) {
  const cw = Math.round(m.w * scale);
  const ch = Math.round(m.h * scale);
  const buf = makeSimBandRasterBuffer(cw, ch, scale, scale);
  rasterSimBandGroups(groups, NORMAL, SP, alpha, buf);
  return buf;
}

const alphaAt = (buf: ReturnType<typeof render>, x: number, y: number): number =>
  buf.bytes[(y * buf.cw + x) * 4 + 3]! / 255;

/** 某一光栅行上的最亮 α 与它的列 */
function rowPeak(buf: ReturnType<typeof render>, y: number, x0: number, x1: number) {
  let best = 0;
  let at = -1;
  for (let x = x0; x <= x1; x++) {
    const a = alphaAt(buf, x, y);
    if (a > best) {
      best = a;
      at = x;
    }
  }
  return { alpha: best, at };
}

describe('65 · 带体贴图一次采样（17 点剖面 / 纵向 / 体色）', () => {
  /** 34×20 的合成贴图：α(x,y) = 横截面(d) × 纵向(y)，纵向均值恰为 1 */
  const W = 34;
  const H = 20;
  // 峰值 α 必须 ≤ 1：Uint8ClampedArray 会钳掉 >255 的部分，列平均就不再等于理论值
  const crossAt = (d: number) => 0.2 + 0.4 * (d / 16);
  const longAt = (y: number) => 0.7 + 0.6 * (y / (H - 1));
  const makeTexture = () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        data[p] = 11;
        data[p + 1] = 22;
        data[p + 2] = 33;
        data[p + 3] = Math.round(255 * crossAt(Math.abs(x - (W >> 1))) * longAt(y));
      }
    }
    return data;
  };
  const sample = (readbacks: number[]) => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          readbacks.push(1);
          expect(w).toBe(W);
          expect(h).toBe(H);
          return { data: makeTexture() };
        },
      }),
    } as unknown as HTMLCanvasElement;
    const img = { naturalWidth: W, naturalHeight: H } as HTMLImageElement;
    return readSimBandImage(img, () => canvas);
  };

  it('一次 getImageData 同时给出 17 点剖面 / 纵向中心列 / 体色 / 旧标量材质', () => {
    const readbacks: number[] = [];
    const s = sample(readbacks);
    expect(s).not.toBeNull();
    expect(readbacks).toHaveLength(1); // 剖面与旧材质共用同一份像素，不回读第二次
    expect(s!.profile).toHaveLength(17);
    // 贴图 α 是 8bit（量化误差 ≈ 1/255），故容差取 0.002 而非机器精度
    for (let i = 0; i < 17; i++) expect(s!.profile[i]).toBeCloseTo(crossAt(i), 2);
    expect(s!.longitudinal[0]).toBeCloseTo(0.2 * longAt(0), 2);
    expect(s!.longitudinal[16]).toBeCloseTo(0.2 * longAt(H - 1), 2);
    expect(s!.rgb).toEqual([11, 22, 33]);
    expect(s!.material.rimAlpha).toBeCloseTo(crossAt(16), 2);
    expect(s!.material.bodyAlpha).toBeGreaterThan(crossAt(0));
    expect(s!.material.bodyAlpha).toBeLessThan(crossAt(16));
    expect(s!.material.rimFrac).toBeGreaterThan(0);
  });

  it('LUT：横截面 = sampleProfileAt 展开；纵向归一化到均值 1（两端实、中间虚）', () => {
    const readbacks: number[] = [];
    const built = buildSimBandRasterMaterial(sample(readbacks), false);
    expect(built.cross).toHaveLength(SIM_BAND_CROSS_LUT_SIZE);
    const expectedProfile = Array.from({ length: 17 }, (_, k) => crossAt(k));
    for (const i of [0, 128, 512, 900, 1024]) {
      expect(built.cross[i]).toBeCloseTo(sampleProfileAt(expectedProfile, i / 1024), 2);
    }
    // 17 点 → 257 项插值 + 8bit 量化（合成贴图仅 20 行，取样 y 取整有微小偏差）
    expect(Math.abs(built.longitudinal[0]! - 0.7)).toBeLessThan(0.02);
    expect(Math.abs(built.longitudinal[256]! - 1.3)).toBeLessThan(0.02);
    expect(built.longitudinal[128]!).toBeGreaterThan(built.longitudinal[0]! + 0.2);
    expect(built.longitudinal[128]!).toBeLessThan(built.longitudinal[256]! - 0.2);
    // 均值归一：整条亮度不被纵向曲线整体抬高 / 压低
    const mean = built.longitudinal.reduce((s, v) => s + v, 0) / built.longitudinal.length;
    expect(Math.abs(mean - 1)).toBeLessThan(0.02);
    expect(built.rgb).toEqual([11, 22, 33]);
  });

  it('缺图 / 无 DOM：回落 skin00 实测剖面，SP 纵向恒定、普通带两端实', () => {
    expect(readSimBandImage(null)).toBeNull();
    expect(SIM_BAND_RASTER_MATERIAL_SP.longitudinal.every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    expect(SIM_BAND_RASTER_MATERIAL.longitudinal[0]).toBeGreaterThan(
      SIM_BAND_RASTER_MATERIAL.longitudinal[128]! * 1.8,
    );
    expect(SIM_BAND_RASTER_MATERIAL.cross[0]).toBeCloseTo(0.38, 5);
    expect(SIM_BAND_RASTER_MATERIAL_SP.cross[896]).toBeGreaterThan(
      SIM_BAND_RASTER_MATERIAL_SP.cross[0]!,
    );
    // 票 66：0.5 不再是「固定默认」，只是 LOD 的低档；常规谱 / 导出走 1
    expect(SIM_BAND_RASTER_SCALE).toBe(0.5);
    expect(SIM_BAND_RASTER_SCALE_FULL).toBe(1);
  });
});

describe('65 · 逐像素光栅（沿整条中心线连续求值）', () => {
  it('横截面：中心暗、亮缘亮、最外软边回落（与贴图剖面同形）', () => {
    const buf = render([{ slide: 0, sp: true, quads: straightBand(24).quads }]);
    const y = 300;
    const cx = Math.floor(m.centerX * 0.5);
    const center = alphaAt(buf, cx, y);
    const peak = rowPeak(buf, y, cx - 60, cx + 60);
    const edge = alphaAt(buf, cx + Math.round(buf.rx * (m.laneWidth / 2)) - 1, y);
    expect(center).toBeGreaterThan(0.1);
    expect(center).toBeLessThan(0.8);
    expect(peak.alpha).toBeGreaterThan(center * 1.5); // 亮缘 ≈ 0.89 vs 中心 0.38
    expect(Math.abs(peak.at - cx)).toBeGreaterThan(5); // 亮缘不在中心
    expect(edge).toBeLessThan(peak.alpha); // 最外 1px 软边
  });

  it('24 个逻辑段不产生段间横纹：中心线逐行 α 的最大跌幅 < 3/255', () => {
    const buf = render([{ slide: 0, sp: true, quads: straightBand(24).quads }]);
    const cx = Math.floor(m.centerX * 0.5);
    let dip = 0;
    let prev = -1;
    for (let y = Math.ceil(0.1 * m.laneHeight * 0.5) + 2; y < Math.floor(m.laneHeight * 0.5) - 2; y++) {
      const a = alphaAt(buf, cx, y);
      if (prev >= 0) dip = Math.max(dip, prev - a);
      prev = a;
    }
    expect(dip).toBeLessThan(3 / 255);
  });

  it('slideOpacity 线性作用于像素 α；SP 纵向恒定、普通带两端实中间虚', () => {
    const group = { slide: 0, sp: true, quads: straightBand(8).quads };
    const full = render([group], 0.8);
    const half = render([group], 0.4);
    const cx = Math.floor(m.centerX * 0.5);
    const y = 300;
    expect(alphaAt(half, cx, y)).toBeCloseTo(alphaAt(full, cx, y) / 2, 2);

    const spTop = alphaAt(full, cx, 40);
    const spMid = alphaAt(full, cx, 220);
    expect(Math.abs(spTop - spMid)).toBeLessThan(0.02);
    const normal = render([{ slide: 0, sp: false, quads: straightBand(8).quads }]);
    expect(alphaAt(normal, cx, 40)).toBeGreaterThan(alphaAt(normal, cx, 220) * 1.2);
  });

  it('交叉 / 自叠：同一缓冲内 screen 叠亮，后放置者的体色在上', () => {
    const one = render([straightBand(8)]);
    const two = render([straightBand(8), straightBand(8)]);
    const cx = Math.floor(m.centerX * 0.5);
    const single = alphaAt(one, cx, 300);
    const overlapped = alphaAt(two, cx, 300);
    expect(overlapped).toBeGreaterThan(single + 0.1);
    expect(overlapped).toBeCloseTo(1 - (1 - single) ** 2, 2);
    const p = (300 * two.cw + cx) * 4;
    expect(two.bytes[p]).toBe(NORMAL.rgb[0]); // RGB 取后写者（谱面数组序）
  });

  it('倒流折返：两臂在同一行各自扫到，像素内合成而非抵消成洞', () => {
    // y 从 0.2 → 0.8 → 0.2 的 V 形折返，两臂重叠在中段
    const a = [0.2, 0.5, 0.8, 0.5, 0.2];
    const quads = [];
    for (let i = 0; i + 1 < a.length; i++) {
      quads.push([...bandQuad(m, { lane: 3, a: a[i]! }, { lane: 3, a: a[i + 1]! }, 1)]);
    }
    const folded = render([{ slide: 0, sp: true, quads }]);
    const forward = render([{ slide: 0, sp: true, quads: quads.slice(0, 2) }]);
    const cx = Math.floor(m.centerX * 0.5);
    const y = 200;
    expect(alphaAt(folded, cx, y)).toBeGreaterThan(alphaAt(forward, cx, y) + 0.05);
  });

  it('缓冲尺寸只随光栅比例变化（50% 光栅 = 场地 × 比例 × 0.5）', () => {
    const buf = render([straightBand(4)], 0.8, 1);
    expect(buf.cw).toBe(m.w);
    expect(buf.ch).toBe(m.h);
    const small = render([straightBand(4)], 0.8, 0.5);
    expect(small.cw).toBe(Math.round(m.w * 0.5));
    expect(small.ch).toBe(Math.round(m.h * 0.5));
  });
});

describe('66 · 光栅分档（每帧可见带体量 → 100% / 50%）', () => {
  const fresh = (): SimBandRasterLodState => ({ pixels: 0, scale: SIM_BAND_RASTER_SCALE_FULL });
  /** 从初始态连续喂 num 帧同一覆盖量，返回最后一次的档位 */
  const settle = (coverage: number, dx: number, dy: number, num: number) => {
    let s = fresh();
    for (let i = 0; i < num; i++) s = nextSimBandRasterLodState(s, coverage, dx, dy);
    return s.scale;
  };

  it('覆盖面积 = 各四边形梯形面积之和（与扫描线像素数同量级）', () => {
    // 上底 20、下底 20、高 10 的梯形 ⇒ 200 CSS px²；同拍水平段面积为 0
    const group: SimBandRasterGroup = {
      slide: 0, sp: false,
      quads: [
        [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }],
        [{ x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
      ],
    };
    expect(simBandCoverageCss([group])).toBe(200);
    expect(simBandCoverageCss([])).toBe(0);
    // 同一条直带：覆盖量与分段数无关（连续中心线，不按逻辑段重复计）
    const coarse = simBandCoverageCss([straightBand(4)]);
    const fine = simBandCoverageCss([straightBand(24)]);
    expect(fine).toBeCloseTo(coarse, 4);
  });

  it('8ms 预算 ≈ 80 万像素；常规谱全分辨率、压力谱降 50%', () => {
    expect(SIM_BAND_LOD_BUDGET_PIXELS).toBe(800_000);
    expect(SIM_BAND_LOD_ENTER_LOW_PIXELS).toBeGreaterThan(SIM_BAND_LOD_BUDGET_PIXELS);
    expect(SIM_BAND_LOD_EXIT_LOW_PIXELS).toBeLessThan(SIM_BAND_LOD_BUDGET_PIXELS);
    expect(settle(484_000, 1, 1, 8)).toBe(SIM_BAND_RASTER_SCALE_FULL);
    expect(settle(1_014_000, 1, 1, 8)).toBe(SIM_BAND_RASTER_SCALE);
    expect(settle(2_564_000, 1, 1, 8)).toBe(SIM_BAND_RASTER_SCALE);
  });

  it('双阈值滞回：落在 65 万~90 万之间保持当前档，不来回切', () => {
    let s = fresh();
    // 从全档起，夹在滞回带里的值不会降档
    for (let i = 0; i < 20; i++) s = nextSimBandRasterLodState(s, 800_000, 1, 1);
    expect(s.scale).toBe(SIM_BAND_RASTER_SCALE_FULL);
    // 越过 90 万才降；之后夹在滞回带里不回升
    s = nextSimBandRasterLodState(s, 2_000_000, 1, 1);
    expect(s.scale).toBe(SIM_BAND_RASTER_SCALE);
    for (let i = 0; i < 20; i++) s = nextSimBandRasterLodState(s, 700_000, 1, 1);
    expect(s.scale).toBe(SIM_BAND_RASTER_SCALE);
    // 低到 65 万以下并稳定后才回到全档
    for (let i = 0; i < 8; i++) s = nextSimBandRasterLodState(s, 500_000, 1, 1);
    expect(s.scale).toBe(SIM_BAND_RASTER_SCALE_FULL);
  });

  it('EMA 平滑：帧间剧烈抖动不触发每帧切档', () => {
    let s = fresh();
    for (let i = 0; i < 3; i++) s = nextSimBandRasterLodState(s, 700_000, 1, 1);
    const scales: number[] = [];
    for (let i = 0; i < 20; i++) {
      s = nextSimBandRasterLodState(s, i % 2 === 0 ? 1_200_000 : 400_000, 1, 1);
      scales.push(s.scale);
    }
    expect(new Set(scales).size).toBe(1);
    expect(scales[0]).toBe(SIM_BAND_RASTER_SCALE_FULL);
  });

  it('density 连续值进成本公式：同一覆盖量在高画质档更早降档', () => {
    expect(settle(500_000, 1, 1, 8)).toBe(SIM_BAND_RASTER_SCALE_FULL);
    expect(settle(500_000, 1.25, 1.25, 8)).toBe(SIM_BAND_RASTER_SCALE_FULL);
    expect(settle(500_000, 1.5, 1.5, 8)).toBe(SIM_BAND_RASTER_SCALE);
    expect(settle(500_000, 2, 2, 8)).toBe(SIM_BAND_RASTER_SCALE);
  });
});
