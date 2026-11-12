// 仿真场一帧的"画在哪儿"（chart-preview 18）：两条硬 bug 的回归网 ——
//   问题 5：可见窗口取反（`[seconds − T, seconds]`）⇒ 音符除"正好压线"外一个都不画；
//   问题 4：场地图 / 判定线拉满画布 ⇒ 素材自带的轨道标记与车道线跟音符错位（应"设计 px 1:1"）。
//
// 单测为什么够：出帧是纯函数（`drawSimFrameAt(ctx, frame, seconds)`）——把精灵换成记录替身，
// 就能看清"这一秒画了哪些元素、画在哪个矩形"；**光栅观感**仍归 `scripts/sim-shot.mjs` 的位图人工核对。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasAssetSnapshot } from '@/tests/support/assetSnapshot';
import type { ChartNote, SingleNote, SlideNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import type { SimSprites } from '@/src/preview/video/sim/simAssets';
import {
  buildSimChart,
  drawSimFrameAt,
  SIM_FALLBACK_BG,
  visibleSimBandGroups,
  type SimFrameInput,
  type SimScene,
} from '@/src/preview/video/sim/simField';
import { emptySimAssets } from '@/src/preview/video/sim/simAssets';
import {
  approachSeconds,
  backgroundRect,
  fieldImageRect,
  fieldMetrics,
  laneCenterX,
  playLineRect,
  simDualLineThickness,
  simNoteRect,
} from '@/src/preview/video/sim/simGeometry';
import {
  SIM_BAND_RASTER_MATERIAL,
  SIM_BAND_RASTER_MATERIAL_SP,
  SIM_BAND_RASTER_SCALE,
  SIM_BAND_RASTER_SCALE_FULL,
  __setSimBandRasterCanvasFactoryForTests,
  type SimBandRasterGroup,
  type SimBandRasterScale,
} from '@/src/preview/video/sim/simBandRaster';
import { splitBandAtFolds } from '@/src/rendering/slideBandGeometry';
import { makeRecordingCtx, propValues, type RecordedCall } from '@/tests/support/canvas';

const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));

const single = (beat: number, lane: number, extra: Partial<SingleNote> = {}): SingleNote => ({
  type: 'Single', beat, lane, ...extra,
});
const slide = (points: { beat: number; lane: number; hidden?: boolean }[]): SlideNote => ({
  type: 'Slide', connections: points.map((p) => ({ ...p })),
});

const scene = (notes: ChartNote[]): SimScene => ({
  notes,
  beatDisplay: 4,
  noteSpeed: 9.5,
  noteSize: 1,
  slideOpacity: 0.8,
  simultaneousClickLines: true,
  colorAssist: false,
  mirror: false,
});

/** 记录型精灵替身（node 环境没有图集：真 `CanvasSpriteIcon` 一笔都画不出来） */
function makeRecordingSprite() {
  /** `sx/sy` = 精灵源矩形左上角（逐轨取图的断言要靠它分辨"同一张图集里的哪一张"） */
  const draws: { x: number; y: number; w: number; h: number; scale: number; src: string; sx: number; sy: number; alpha: number }[] = [];
  const spriteIcon = {
    render(
      ctx: unknown,
      props: {
        src: string; canvasX: number; canvasY: number; canvasSize: number;
        canvasWidth?: number; canvasHeight?: number; scale?: number; x: number; y: number;
      },
    ) {
      draws.push({
        x: props.canvasX,
        y: props.canvasY,
        w: props.canvasWidth ?? props.canvasSize,
        h: props.canvasHeight ?? props.canvasSize,
        scale: props.scale ?? 1,
        src: props.src,
        sx: props.x,
        sy: props.y,
        alpha: (ctx as { globalAlpha?: number })?.globalAlpha ?? 1,
      });
    },
    renderDecorator() { /* flick 顶部箭头：本文件不关心 */ },
  } as unknown as CanvasSpriteIcon;
  return { spriteIcon, draws };
}

/** 缺省走真实的实时路径；导出测试显式给 100%，避免测试替身掩盖默认档位回归。 */
function frameOf(notes: ChartNote[], spriteIcon: CanvasSpriteIcon, scale?: SimBandRasterScale): SimFrameInput {
  const frame = {
    scene: scene(notes),
    chart: buildSimChart(scene(notes), icons),
    metrics: fieldMetrics(1334, 750),
    assets: emptySimAssets(),
    noteIcons: icons,
    spriteIcon,
  };
  return scale === undefined ? frame : { ...frame, bandRasterScale: scale };
}

/** 记录型 ctx：补一个合法变换（65 的带体光栅按它换算设备像素密度） */
const recordingCtx = (overrides: Record<string, (...args: unknown[]) => unknown> = {}) => makeRecordingCtx({
  createLinearGradient: () => ({ addColorStop: () => undefined }),
  getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }),
  ...overrides,
});

/** 65：离屏 RGBA 缓冲的假画布（记录 createImageData / putImageData，能直接读像素） */
interface FakeScratch {
  width: number;
  height: number;
  image: { width: number; height: number; data: Uint8ClampedArray } | null;
  calls: RecordedCall[];
}
let lastScratch: FakeScratch | null = null;

beforeAll(() => {
  __setSimBandRasterCanvasFactoryForTests(() => {
    const scratch: FakeScratch = { width: 0, height: 0, image: null, calls: [] };
    lastScratch = scratch;
    const canvas = {
      get width() { return scratch.width; },
      set width(v: number) { scratch.width = v; },
      get height() { return scratch.height; },
      set height(v: number) { scratch.height = v; },
      getContext: () => ({
        createImageData: (w: number, h: number) => {
          scratch.calls.push(['createImageData', [w, h]]);
          scratch.image = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          return scratch.image;
        },
        putImageData: (img: unknown) => { scratch.calls.push(['putImageData', [img]]); },
      }),
    };
    return canvas as unknown as HTMLCanvasElement;
  });
});
afterAll(() => __setSimBandRasterCanvasFactoryForTests(null));

/** 65/66：出帧后直接读回写的 RGBA（缓冲 = 场地 × 变换缩放 × 该帧档位） */
function drawnFrame(frame: SimFrameInput, seconds: number, overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  const { proxy, calls } = recordingCtx(overrides);
  drawSimFrameAt(proxy, frame, seconds);
  const scratch = lastScratch!;
  return { calls, scratch, image: scratch.image! };
}
const alphaAt = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number): number =>
  image.data[(y * image.width + x) * 4 + 3]! / 255;
const rgbAt = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] => {
  const p = (y * image.width + x) * 4;
  return [image.data[p]!, image.data[p + 1]!, image.data[p + 2]!];
};
/** 出帧函数里的可见带体分组（同一份可见窗口 / 过线端插值，几何断言都从它取） */
const groupsAt = (frame: SimFrameInput, seconds: number): SimBandRasterGroup[] =>
  visibleSimBandGroups(frame.chart, frame.scene, frame.metrics, seconds);

/** 默认 120 BPM：beat → 秒 = beat / 2；noteSpeed 9.5 ≤ 11 ⇒ T = (12 − noteSpeed)/2 = 1.25s */
const T = approachSeconds(9.5);

describe('drawSimFrameAt · 音符的可见窗口（问题 5）', () => {
  it('接近中的音符每帧都画（Δ ∈ [−T, 0]）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const frame = frameOf([single(2, 3)], spriteIcon); // beat 2 → 1s
    const { proxy } = recordingCtx();

    drawSimFrameAt(proxy, frame, 0.5); // Δ = −0.5
    expect(draws).toHaveLength(1);
    expect(draws[0]!.y).toBeLessThan(frame.metrics.laneHeight); // 在判定线上方（还没过线）
    expect(draws[0]!.scale).toBeGreaterThan(0);

    draws.length = 0;
    drawSimFrameAt(proxy, frame, 1); // Δ = 0：正好压线
    expect(draws).toHaveLength(1);
    expect(draws[0]!.y).toBeCloseTo(frame.metrics.laneHeight, 6);
  });

  it('已经过线的音符不画（Δ > 0）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frameOf([single(2, 3)], spriteIcon), 1.5);
    expect(draws).toEqual([]);
  });

  it('窗口边界：Δ = −T 画、Δ = −T − ε 不画', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const { proxy } = recordingCtx();
    const frame = frameOf([single(2, 3)], spriteIcon);
    drawSimFrameAt(proxy, frame, 1 - T);
    expect(draws).toHaveLength(1);
    draws.length = 0;
    drawSimFrameAt(proxy, frame, 1 - T - 1e-6);
    expect(draws).toEqual([]);
  });

  it('同一帧里"还没过线的"都在：远的近的共处一帧，各画一次', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const { proxy } = recordingCtx();
    // 1s / 2s / 3s 三颗，T = 1.25s ⇒ t=2s 时窗口 = [2, 3.25]：2s（压线）与 3s 都在，1s 已过
    drawSimFrameAt(proxy, frameOf([single(2, 3), single(4, 0), single(6, 6)], spriteIcon), 2);
    expect(draws).toHaveLength(2);
  });

  it('带体的时间窗口没被改坏：接近中照画、整段过线后不画', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 5 }])], spriteIcon);
    // 65：带体不再进 ctx 路径，改从出帧的分组函数读（同一份可见窗口）
    expect(groupsAt(frame, 1.5)).toHaveLength(1); // 带体末端 2s（还没过线）
    expect(groupsAt(frame, 2.5)).toHaveLength(0); // 整段已过线
    const { calls } = drawnFrame(frame, 1.5);
    expect(calls.filter(([k]) => k === 'fillRect').length).toBeGreaterThan(0); // 场地底色仍在
  });

  it('打击特效仍只画命中后 0.32s 内的（窗口没被改坏）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([single(2, 3)], spriteIcon);
    const hit = recordingCtx();
    drawSimFrameAt(hit.proxy, frame, 1.05); // 命中后 0.05s：轨道闪 + 打击环
    expect(hit.calls.filter(([k]) => k === 'arc').length).toBeGreaterThan(0);
    const after = recordingCtx();
    drawSimFrameAt(after.proxy, frame, 1.4); // 命中后 0.4s：已出窗口
    expect(after.calls.filter(([k]) => k === 'arc')).toEqual([]);
  });
});

/** Bestdori 自家精灵的假图（node 无 DOM ⇒ 染色 / 生成圆走"退回"分支） */
const fakeSprites = (over: Partial<Record<'digits' | 'combo' | 'particles', null>> = {}) => {
  const img = (w: number, h: number) => ({ width: w, height: h, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement);
  return {
    digits: over.digits === null ? null : img(720, 96),
    combo: over.combo === null ? null : img(150, 41),
    particles: over.particles === null ? null : img(1024, 1024),
  };
};

describe('drawSimFrameAt · Bestdori 精灵（chart-preview 21）', () => {
  const withSprites = (notes: ChartNote[], spriteIcon: CanvasSpriteIcon, sprites: SimSprites | null): SimFrameInput => ({
    ...frameOf(notes, spriteIcon),
    assets: { ...emptySimAssets(), missing: false, sprites },
  });

  it('combo 用 digits 数字位图 + combo 标签图（有精灵时不再画文本）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const sprites = fakeSprites() as unknown as SimSprites;
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, withSprites([single(2, 3)], spriteIcon, sprites), 1.05); // 命中后 0.05s → combo 1
    const sources = calls.filter(([k]) => k === 'drawImage').map(([, args]) => args[0]);
    expect(sources).toContain(sprites.digits);
    expect(sources).toContain(sprites.combo);
    expect(calls.filter(([k]) => k === 'fillText')).toEqual([]); // 回落路径不走
  });

  it('缺精灵时 combo 回落自绘文本（不空着）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, withSprites([single(2, 3)], spriteIcon, null), 1.05);
    expect(calls.filter(([k]) => k === 'fillText').length).toBeGreaterThan(0);
  });

  it('命中特效按窗口画 particles 图块（0.6s 后收手）、轨道闪仍在 0.2s 内', () => {
    const { spriteIcon } = makeRecordingSprite();
    const sprites = fakeSprites() as unknown as SimSprites;
    const frame = withSprites([single(2, 3)], spriteIcon, sprites);

    const hit = recordingCtx();
    drawSimFrameAt(hit.proxy, frame, 1.05); // 命中后 0.05s
    expect(hit.calls.filter(([k]) => k === 'drawImage').map(([, args]) => args[0])).toContain(sprites.particles);
    expect(hit.calls.filter(([k]) => k === 'fill').length).toBeGreaterThan(0); // 轨道闪（三角楔）

    const flashOver = recordingCtx();
    drawSimFrameAt(flashOver.proxy, frame, 1.3); // 命中后 0.3s：闪已收（特效仍在窗口内）
    expect(flashOver.calls.filter(([k]) => k === 'fill')).toEqual([]);

    const allOver = recordingCtx();
    drawSimFrameAt(allOver.proxy, frame, 1.7); // 命中后 0.7s：特效也收手（combo 仍在画，不在断言内）
    expect(allOver.calls.filter(([k, args]) => k === 'drawImage' && args[0] === sprites.particles)).toEqual([]);
  });

  it('程序化回落：缺精灵时仍画圆 / 环（arc）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const hit = recordingCtx();
    drawSimFrameAt(hit.proxy, withSprites([single(2, 3)], spriteIcon, null), 1.05);
    expect(hit.calls.filter(([k]) => k === 'arc').length).toBeGreaterThan(0);
  });
});

describe('drawSimFrameAt · 场地三图的矩形（问题 4）', () => {
  it('场地图 / 判定线按素材的"设计 px 1:1"矩形画，不拉满画布', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame: SimFrameInput = {
      ...frameOf([single(2, 3)], spriteIcon),
      assets: {
        ...emptySimAssets(),
        missing: false,
        // 背景单独有例（票 23 #2③ 走 `backgroundRect`）：这里只要两张图，背景不给
        background: null,
        field: {} as HTMLImageElement,
        playLine: {} as HTMLImageElement,
      },
    };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 0);

    const dests = calls
      .filter(([k]) => k === 'drawImage')
      .map(([, args]) => args as unknown[]);
    expect(dests).toHaveLength(2);
    const rectOf = (args: unknown[]) => ({ x: args[1], y: args[2], w: args[3], h: args[4] });
    expect(rectOf(dests[0]!)).toEqual(fieldImageRect(frame.metrics));
    expect(rectOf(dests[1]!)).toEqual(playLineRect(frame.metrics));
    // 底色仍是"铺满画布"的第一笔（场地缺图时那层近黑底）
    expect(propValues(calls, 'fillStyle')).toContain(SIM_FALLBACK_BG);
  });

  it('两张素材的轨道标尺 = laneWidth（判定线 7 个标记 / 场地图底边车道）', () => {
    const m = fieldMetrics(1334, 750);
    // 判定线素材 1800px 宽、7 个标记间距 154px（居中）⇒ 落到画布上的间距 = laneWidth（差 < 1%：
    // 1.35 × 1334 = 1800.9 与素材的 1800 差 0.05%）
    const lineSpacing = 154 * (playLineRect(m).w / 1800);
    expect(Math.abs(lineSpacing - m.laneWidth) / m.laneWidth).toBeLessThan(0.01);
    // 场地图素材 1160px 宽、底边车道间距实测 154.3px ⇒ 与 laneWidth 差 < 1%
    const fieldLaneSpacing = 154.3 * (fieldImageRect(m).w / 1160);
    expect(Math.abs(fieldLaneSpacing - m.laneWidth) / m.laneWidth).toBeLessThan(0.01);
  });
});

/** 65：带体四边形不再经 ctx 路径，直接从出帧分组取（顶点序仍是 a 左/右 → b 右/左） */
function firstVertices(frame: SimFrameInput, seconds: number): { x: number; y: number }[] {
  return groupsAt(frame, seconds)[0]!.quads[0]!;
}

/** 四边形 a 边（头两个顶点）的中点 —— 即"过线那一端"的接触点 */
function aEdgeCenterX(vertices: { x: number }[]): number {
  return (vertices[0]!.x + vertices[1]!.x) / 2;
}

describe('drawSimFrameAt · 带体过线端沿带子行进（票 23 #1）', () => {
  /** lane 中心 x（A = 1 的判定线上） */
  const laneX = (lane: number) => laneCenterX(fieldMetrics(1334, 750), lane, 1);

  it('横向滑条过线后：接触点的 x 单调趋近未过线端的 lane（旧写法钉在 lane0、原地不动）', () => {
    const { spriteIcon } = makeRecordingSprite();
    // lane 3 → 5 的跨轨滑条：1s → 2s。取 1.4 / 1.5 / 1.6 三帧 —— 都在"首结点已过线（1.0s）、
    // 末结点还没到线（2.0s）"的区间里，且已出首结点的命中特效窗（0.32s）⇒ 路径命令只剩带体那一个四边形
    const frame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 5 }])], spriteIcon);
    const centers = [1.4, 1.5, 1.6].map((seconds) => {
      const { proxy } = recordingCtx();
      drawSimFrameAt(proxy, frame, seconds);
      const vertices = firstVertices(frame, seconds);
      expect(vertices).toHaveLength(4);
      // 过线端钉在场地判定线上（A = 1）
      expect(vertices[0]!.y).toBeCloseTo(frame.metrics.laneHeight, 6);
      return aEdgeCenterX(vertices);
    });

    // 3 → 5 的线性插值：1.4s → lane 3.8、1.5s → lane 4.0、1.6s → lane 4.2
    expect(centers[0]!).toBeCloseTo(laneX(3.8), 4);
    expect(centers[1]!).toBeCloseTo(laneX(4), 4);
    expect(centers[2]!).toBeCloseTo(laneX(4.2), 4);

    // 单调趋近未过线端（lane 5）：旧写法三帧都停在 laneX(3)
    const target = laneX(5);
    expect(Math.abs(target - centers[0]!)).toBeGreaterThan(Math.abs(target - centers[1]!));
    expect(Math.abs(target - centers[1]!)).toBeGreaterThan(Math.abs(target - centers[2]!));
    expect(centers[0]!).toBeGreaterThan(laneX(3));
  });

  it('t1 === t0（同刻两点）：不除零、不出 NaN，两端各守自己的轨位', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 2, lane: 5 }])], spriteIcon);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1); // 同刻两点：这一秒正好双双压线

    const vertices = firstVertices(frame, 1);
    expect(vertices).toHaveLength(4);
    for (const p of vertices) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // 没有"沿带子行进"可言（两端同一时刻）：各自钉在自己的 lane 中心上
    const half = frame.metrics.laneWidth / 2;
    expect(vertices.map((p) => p.x)).toEqual([
      laneX(3) - half, laneX(3) + half, laneX(5) + half, laneX(5) - half,
    ]);
  });

  it('同一秒里带体过线端与 drawHoldEffects 的按住位重合（同一条插值，不许两份）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const sprites = fakeSprites() as unknown as SimSprites;
    // lane 0 → 4：按住位在 1.7s 落到 lane 2.8（同一条插值）。
    // 取 1.7s 而不是 1.5s：首结点（1.0s）的命中特效窗是 0.6s，0.7s 后才只剩"按住"这一路画 particles
    const frame: SimFrameInput = {
      ...frameOf([slide([{ beat: 2, lane: 0 }, { beat: 4, lane: 4 }])], spriteIcon),
      assets: { ...emptySimAssets(), missing: false, sprites },
    };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.7);

    const bandX = aEdgeCenterX(firstVertices(frame, 1.7));
    expect(bandX).toBeCloseTo(laneX(2.8), 4);
    // 按住环 = 连按特效那枚 `connectionRing`（图像 = particles，左缘为正 —— 另两枚旋转环以 0,0 为中心）
    const ring = calls.find(([k, args]) =>
      k === 'drawImage' && args[0] === sprites.particles && (args[5] as number) > 0)!;
    const ringX = (ring[1][5] as number) + (ring[1][7] as number) / 2;
    expect(ringX).toBeCloseTo(bandX, 6);
  });
});

// 以下钉子钉的是皮肤包图集的真实精灵矩形（源格比 / 逐轨取图 / 端帽与结点区分），
// 无快照环境（PR 门禁走最小合法桩，release-pipeline 10）跳过；push / tag_push 门禁有真快照，全量执行。
describe('drawSimFrameAt · 音符盒子 / 同时点击线 / 背景取景（票 23 #2）', () => {
  it.skipIf(!hasAssetSnapshot)('音符按精灵源格的自然比画：高/宽 = 120/308（修前吃设计盒的 36:21.6 = 1.667）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const frame = frameOf([single(2, 3)], spriteIcon);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1); // 压线帧：A = 1

    const note = draws[0]!;
    const rect = simNoteRect(frame.metrics, 1, 1, 120 / 308);
    expect(note.w).toBeCloseTo(rect.w, 6);
    expect(note.h).toBeCloseTo(rect.h, 6);
    expect(note.w / note.h).toBeCloseTo(308 / 120, 6);
  });

  it.skipIf(!hasAssetSnapshot)('方向键本体也走精灵源格比（同单键一个盒子口径，只差设计宽 45）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const frame = frameOf([{ type: 'LDirectional', beat: 2, lane: 3, length: 1 }], spriteIcon);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1); // 压线帧：A = 1

    const body = draws[0]!; // 本体先画、外侧箭头后画
    const rect = simNoteRect(frame.metrics, 1, 1, 120 / 308, 45);
    expect(body.w).toBeCloseTo(rect.w, 6);
    expect(body.h).toBeCloseTo(rect.h, 6);
    expect(body.w / body.h).toBeCloseTo(308 / 120, 6);
  });

  it.skipIf(!hasAssetSnapshot)('同时点击线：一组一根跨全程（端点轨之间），粗细走 0.118 系数（修前逐 gap 一根 / 0.3 粗）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const m = fieldMetrics(1334, 750);
    // 同一 tick 上的 lane 0 / 3 / 6：修前逐 gap 拉两根，且粗细 = 0.3 × laneWidth
    const frame = frameOf([single(2, 0), single(2, 3), single(2, 6)], spriteIcon);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1);

    const lines = draws.filter((d) => d.src === icons.simultaneousLine!.src);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.w).toBeCloseTo(laneCenterX(m, 6, 1) - laneCenterX(m, 0, 1), 6);
    expect(lines[0]!.h).toBeCloseTo(simDualLineThickness(m, 1, 1), 6);
    expect(lines[0]!.y).toBeCloseTo(m.laneHeight, 6); // 压在场地判定线上
  });

  it.skipIf(!hasAssetSnapshot)('方向键本体**逐轨**取图（票 25 #1：图集 0..6 各自带该轨位的舞台倾角）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    // LDirectional 锚 lane 3、长度 3 ⇒ 占 lane 3 / 2 / 1（向左）。修前三枚全是扁平轨（lane 3）那张，
    // 整组同一个倾角 ⇒ 外侧本体不贴舞台平面。
    const frame = frameOf([{ type: 'LDirectional', beat: 2, lane: 3, length: 3 }], spriteIcon);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1); // 压线帧：A = 1

    const bodies = draws.slice(0, 3); // 本体先画，外侧箭头是第 4 笔
    for (const lane of [3, 2, 1]) {
      const want = icons.dirLaneFor('L', lane);
      expect(bodies.find((d) => d.sx === want.x && d.sy === want.y)).toBeTruthy();
    }
    // 三枚互不相同（同一张图集里的三张不同子图）
    expect(new Set(bodies.map((d) => `${d.sx},${d.sy}`)).size).toBe(3);
    // 且**不是**全组扁平轨那张（dirFor 恒回 lane 3）
    const flat = icons.dirFor('L', 3);
    expect(bodies.filter((d) => d.sx === flat.x && d.sy === flat.y)).toHaveLength(1);
    // 尺寸仍是"设计宽 45 + 精灵源格比"那个盒子（票 23 #2 的口径没动）
    const rect = simNoteRect(frame.metrics, 1, 1, 120 / 308, 45);
    expect(bodies[0]!.w).toBeCloseTo(rect.w, 6);
    expect(bodies[0]!.h).toBeCloseTo(rect.h, 6);

    // 越界轨照**钳到边界**那张画（与 bundle 的 clamp(K+3, 0, 6) 同口径）：lane 6 向右 length 3
    // ⇒ 占 lane 6/7/8，7/8 都落到 dirR[6]
    draws.length = 0;
    const frameR = frameOf([{ type: 'RDirectional', beat: 2, lane: 6, length: 3 }], spriteIcon);
    drawSimFrameAt(recordingCtx().proxy, frameR, 1);
    const edge = icons.dirLaneFor('R', 6);
    expect(draws.slice(0, 3).filter((d) => d.sx === edge.x && d.sy === edge.y)).toHaveLength(3);
  });

  it.skipIf(!hasAssetSnapshot)('按住期间接触点画**滑条端点**（票 25 #2：bundle 漏誊的那段 `y.forEach`）', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const sprites = fakeSprites() as unknown as SimSprites;
    // lane 0 → 4：1s → 4s。取 2.5s ⇒ 按住位 = lane 2，且末结点（4s）还没进可见窗（T = 1.25s）
    // ⇒ 这一帧的精灵绘制只剩"按住端点"这一笔（带体 / 环走 ctx，不进 draws）
    const frame: SimFrameInput = {
      ...frameOf([slide([{ beat: 2, lane: 0 }, { beat: 8, lane: 4 }])], spriteIcon),
      assets: { ...emptySimAssets(), missing: false, sprites },
    };
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 2.5);

    expect(draws).toHaveLength(1);
    const endpoint = draws[0]!;
    expect(endpoint.x).toBeCloseTo(laneCenterX(frame.metrics, 2, 1), 6); // 随插值轨位走
    expect(endpoint.y).toBeCloseTo(frame.metrics.laneHeight, 6); // 压在判定线上
    // 逐轨精灵（就近取整 = lane 2），不是扁平轨那张
    const want = icons.slideEndpointLaneFor(2);
    expect(endpoint.sx).toBe(want.x);
    expect(endpoint.sy).toBe(want.y);
    expect(endpoint.src).toBe(icons.slideEndpointFor(2).src);
    // 端点与单键同一个盒子（自然比，noteSize = 1）
    const box = simNoteRect(frame.metrics, 1, 1, 120 / 308);
    expect(endpoint.w).toBeCloseTo(box.w, 6);
    expect(endpoint.h).toBeCloseTo(box.h, 6);

    // issue 36：即使在命中特效窗口内（since <= 0.6s），端点本体绘制时的 globalAlpha 恒为 1（不受粒子环污染）
    const duringHit = makeRecordingSprite();
    drawSimFrameAt(
      recordingCtx().proxy,
      { ...frame, spriteIcon: duringHit.spriteIcon },
      1.2, // 起点在 1.0s，1.2s 时命中特效正处于活跃衰减中（since = 0.2s）
    );
    expect(duringHit.draws).toHaveLength(1);
    expect(duringHit.draws[0]!.alpha).toBe(1);

    // 松手（过了段终点）就不再画
    const after = makeRecordingSprite();
    drawSimFrameAt(
      recordingCtx().proxy,
      { ...frame, spriteIcon: after.spriteIcon },
      4.5,
    );
    expect(after.draws).toEqual([]);
  });

  it('背景按 backgroundRect 的取景矩形画（不再是 cover 居中裁两侧）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const background = { naturalWidth: 2048, naturalHeight: 1024 } as HTMLImageElement;
    const frame: SimFrameInput = {
      ...frameOf([single(2, 3)], spriteIcon),
      assets: { ...emptySimAssets(), missing: false, background, field: null, playLine: null },
    };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 0);

    const dest = calls.find(([k, args]) => k === 'drawImage' && args[0] === background)!;
    expect({ x: dest[1][1], y: dest[1][2], w: dest[1][3], h: dest[1][4] }).toEqual(backgroundRect(frame.metrics));
  });

  it('背景亮度（票 43）：黑罩落在**背景图之后、场地图之前**，只压背景层', () => {
    const { spriteIcon } = makeRecordingSprite();
    const background = { naturalWidth: 2048, naturalHeight: 1024 } as HTMLImageElement;
    const field = { naturalWidth: 1160, naturalHeight: 610 } as HTMLImageElement;
    const notes = [single(2, 3)];
    const frame: SimFrameInput = {
      ...frameOf(notes, spriteIcon),
      // 亮度 0.4 ⇒ 黑罩 alpha = 0.6
      scene: { ...scene(notes), bgBrightness: 0.4 },
      assets: { ...emptySimAssets(), missing: false, background, field, playLine: null },
    };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 0);

    const bgIdx = calls.findIndex(([k, args]) => k === 'drawImage' && args[0] === background);
    const dimIdx = calls.findIndex(([k, args]) => k === 'fillStyle' && args[0] === 'rgba(0, 0, 0, 0.6)');
    const fieldIdx = calls.findIndex(([k, args]) => k === 'drawImage' && args[0] === field);
    expect(bgIdx).toBeGreaterThan(-1);
    expect(dimIdx).toBeGreaterThan(bgIdx);
    expect(fieldIdx).toBeGreaterThan(dimIdx);
  });

  it('背景亮度 = 1（默认）不叠黑罩；没有背景图也不压（缺素材空态不被无故压黑）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const notes = [single(2, 3)];
    const background = { naturalWidth: 2048, naturalHeight: 1024 } as HTMLImageElement;
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, { ...frameOf(notes, spriteIcon), assets: { ...emptySimAssets(), background } }, 0);
    expect(calls.some(([k, args]) => k === 'fillStyle' && String(args[0]).startsWith('rgba(0, 0, 0,'))).toBe(false);

    const noImg = recordingCtx();
    drawSimFrameAt(noImg.proxy, {
      ...frameOf(notes, spriteIcon),
      scene: { ...scene(notes), bgBrightness: 0 },
      assets: emptySimAssets(),
    }, 0);
    expect(noImg.calls.some(([k, args]) => k === 'fillStyle' && String(args[0]).startsWith('rgba(0, 0, 0,'))).toBe(false);
  });
});

// ---------------------------------------------------------------- issue 45 / 46 / 47 锁测（65 起改按新画法断言）

/** BPM 事件（负 BPM = 倒流折返：其后的 beat 时间往回走） */
const bpm = (beat: number, value: number): ChartNote => ({ type: 'BPM', beat, bpm: value });

/** 多边形的有符号面积（shoelace；canvas 坐标 y 向下，正向流带体为负、倒流段为正） */
function signedArea(pts: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 四边形点集的规范化键（与顶点序无关）—— 判"两枚几何重合"用 */
const quadKey = (q: { x: number; y: number }[]) =>
  q.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join(' ');

/** 与光栅内核同口径把四边形折成中心线点（独立构造，锁"折返被切两臂"这条几何事实） */
function nodesFromQuads(quads: { x: number; y: number }[][]): { x: number; y: number }[] {
  const nodes: { x: number; y: number }[] = [];
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i]!;
    if (i === 0) nodes.push({ x: (q[0]!.x + q[1]!.x) / 2, y: q[0]!.y });
    nodes.push({ x: (q[3]!.x + q[2]!.x) / 2, y: q[3]!.y });
  }
  return nodes;
}

/** lane 3 的竖直滑条：像素采样时中心线恒在 x = centerX，半宽只随 A 变 */
const verticalSlide = () => slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 3 }]);
/** 含 hidden 中间结点 ⇒ 整条传染 SP（ADR-0009 §5） */
const verticalSpSlide = () => slide([
  { beat: 0, lane: 3 }, { beat: 2, lane: 3, hidden: true }, { beat: 4, lane: 3 },
]);

const CX = Math.floor(fieldMetrics(1334, 750).centerX * SIM_BAND_RASTER_SCALE);
const ROW = 250;

describe('drawSimFrameAt · 带体逐像素光栅（chart-preview 65）', () => {
  it('每帧 1 次 putImageData + 1 次 drawImage 回贴；缓冲 = 场地 × 50%', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon);
    const { calls, scratch, image } = drawnFrame(frame, 1.5);
    expect(scratch.calls.filter(([k]) => k === 'putImageData')).toHaveLength(1);
    // 回贴 = 唯一那笔 9 参数 drawImage（src, sx, sy, sw, sh, dx, dy, dw, dh）
    const blits = calls.filter(([k, args]) => k === 'drawImage' && args.length === 9);
    expect(blits).toHaveLength(1);
    expect(blits[0]![1].slice(5, 9)).toEqual([0, 0, frame.metrics.w, frame.metrics.h]);
    expect(image.width).toBe(Math.round(frame.metrics.w * SIM_BAND_RASTER_SCALE));
    expect(image.height).toBe(Math.round(frame.metrics.h * SIM_BAND_RASTER_SCALE));
  });

  it('缓冲尺寸随 metrics / 变换缩放；导出链路的平移落在回贴目标上', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon);
    const smaller = drawnFrame({ ...frame, metrics: fieldMetrics(667, 375) }, 1.5);
    expect(smaller.image.width).toBe(Math.round(667 * SIM_BAND_RASTER_SCALE));
    expect(smaller.image.height).toBe(Math.round(375 * SIM_BAND_RASTER_SCALE));

    // frameDriver 的 ctx：缩放 1 + 平移 (field.x, field.y)；这里用 2× 缩放验证两轴都吃到
    const scaled = drawnFrame(frame, 1.5, { getTransform: () => ({ a: 2, d: 2, e: 10, f: 20 }) });
    expect(scaled.image.width).toBe(Math.round(1334 * 2 * SIM_BAND_RASTER_SCALE));
    expect(scaled.image.height).toBe(Math.round(750 * 2 * SIM_BAND_RASTER_SCALE));
    const blits = scaled.calls.filter(([k, args]) => k === 'drawImage' && args.length === 9);
    expect(blits[0]![1].slice(5, 9)).toEqual([10, 20, 1334 * 2, 750 * 2]);
  });

  it('横截面来自皮肤贴图剖面：中心暗 / 亮缘亮 / 最外软边回落，不是平涂', () => {
    const { spriteIcon } = makeRecordingSprite();
    const { image } = drawnFrame(frameOf([verticalSlide()], spriteIcon), 1.5);
    const center = alphaAt(image, CX, ROW);
    let peak = { alpha: 0, x: 0 };
    for (let x = CX - 60; x <= CX + 60; x++) {
      const a = alphaAt(image, x, ROW);
      if (a > peak.alpha) peak = { alpha: a, x };
    }
    expect(center).toBeGreaterThan(0.1);
    expect(center).toBeLessThan(0.8);
    expect(peak.alpha).toBeGreaterThan(center * 1.5);
    expect(Math.abs(peak.x - CX)).toBeGreaterThan(5);
    expect(alphaAt(image, CX + 30, ROW)).toBeLessThan(peak.alpha); // 最外软边
  });

  it('slideOpacity 线性作用于像素 α（不是图层 globalAlpha）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon);
    const full = drawnFrame(frame, 1.5);
    const low = drawnFrame({ ...frame, scene: { ...frame.scene, slideOpacity: 0.4 } }, 1.5);
    expect(alphaAt(low.image, CX, ROW)).toBeCloseTo(alphaAt(full.image, CX, ROW) / 2, 2);
  });

  it('普通 / SP 各取自己的预加载材质；缺图（材质字段不在）回落 skin00 兜底剖面', () => {
    const { spriteIcon } = makeRecordingSprite();
    const zeroCross = new Float32Array(1025);
    const normal = frameOf([verticalSlide()], spriteIcon);
    const sp = frameOf([verticalSpSlide()], spriteIcon);
    expect(groupsAt(normal, 1.5)[0]!.sp).toBe(false);
    expect(groupsAt(sp, 1.5)[0]!.sp).toBe(true);
    const noBandPixels = (image: { data: Uint8ClampedArray }) =>
      !image.data.some((v, i) => i % 4 === 3 && v > 0);
    // 把普通材质清零：SP 帧不受影响；反过来清零 SP：普通帧不受影响
    expect(noBandPixels(drawnFrame({
      ...sp, assets: { ...emptySimAssets(), bandRaster: { ...SIM_BAND_RASTER_MATERIAL, cross: zeroCross } },
    }, 1.5).image)).toBe(false);
    expect(noBandPixels(drawnFrame({
      ...sp, assets: { ...emptySimAssets(), bandRasterSp: { ...SIM_BAND_RASTER_MATERIAL_SP, cross: zeroCross } },
    }, 1.5).image)).toBe(true);
    // 完全不带材质字段（外部构造的 frame）⇒ 兜底剖面照画，不抛错
    const bare = {
      ...normal,
      assets: { ...emptySimAssets(), bandRaster: undefined, bandRasterSp: undefined } as unknown as SimFrameInput['assets'],
    };
    expect(alphaAt(drawnFrame(bare, 1.5).image, CX, ROW)).toBeGreaterThan(0.1);
  });

  it('两条滑条交叉：按谱面数组序分组（后放置者在上），重叠处像素叠亮', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([
      slide([{ beat: 0, lane: 3 }, { beat: 4, lane: 5 }]),
      slide([{ beat: 0, lane: 5 }, { beat: 4, lane: 3 }]),
    ], spriteIcon);
    const groups = groupsAt(frame, 1.5);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.quads.length)).toEqual([1, 1]);
    const centerX = (q: { x: number; y: number }[]) => (q[0]!.x + q[1]!.x) / 2;
    expect(centerX(groups[0]!.quads[0]!)).toBeCloseTo(laneCenterX(frame.metrics, 4.5, 1), 4);
    expect(centerX(groups[1]!.quads[0]!)).toBeCloseTo(laneCenterX(frame.metrics, 3.5, 1), 4);

    const one = drawnFrame(frameOf([verticalSlide()], spriteIcon), 1.5);
    const two = drawnFrame({ ...frameOf([verticalSlide(), verticalSlide()], spriteIcon) }, 1.5);
    const single = alphaAt(one.image, CX, ROW);
    expect(alphaAt(two.image, CX, ROW)).toBeGreaterThan(single + 0.1);
    expect(rgbAt(two.image, CX, ROW)).toEqual([...SIM_BAND_RASTER_MATERIAL.rgb]); // 后写者的体色
  });
});

/** 回贴那一笔之前的 imageSmoothingEnabled（票 66：100% 不放大 ⇒ 不该开双线性） */
const smoothingAtBlit = (calls: RecordedCall[]): unknown => {
  const i = calls.findIndex(([k, args]) => k === 'drawImage' && args.length === 9);
  for (let j = i - 1; j >= 0; j--) {
    if (calls[j]![0] === 'imageSmoothingEnabled') return calls[j]![1][0];
  }
  return undefined;
};
/** 30 条同时可见、相互重叠的竖直带，用于密集带体回归。 */
const denseBands = (): ChartNote[] => Array.from({ length: 30 }, () => verticalSlide());

describe('drawSimFrameAt · 实时固定 50% / 导出 100%（chart-preview 66）', () => {
  it('显式比例：100% 建全尺寸缓冲且不放平滑；50% 建半尺寸缓冲并双线性放大', () => {
    const { spriteIcon } = makeRecordingSprite();
    const full = drawnFrame(frameOf([verticalSlide()], spriteIcon, SIM_BAND_RASTER_SCALE_FULL), 1.5);
    expect(full.image.width).toBe(fieldMetrics(1334, 750).w);
    expect(full.image.height).toBe(fieldMetrics(1334, 750).h);
    expect(smoothingAtBlit(full.calls)).toBe(false);
    const blits = full.calls.filter(([k, args]) => k === 'drawImage' && args.length === 9);
    expect(blits).toHaveLength(1);
    expect(blits[0]![1].slice(5, 9)).toEqual([0, 0, fieldMetrics(1334, 750).w, fieldMetrics(1334, 750).h]);

    const low = drawnFrame(frameOf([verticalSlide()], spriteIcon, SIM_BAND_RASTER_SCALE), 1.5);
    expect(low.image.width).toBe(Math.round(fieldMetrics(1334, 750).w * SIM_BAND_RASTER_SCALE));
    expect(smoothingAtBlit(low.calls)).toBe(true);
  });

  it.each([1, 1.25, 1.5, 2])('实时缺省：density=%s 时稀疏和密集带体都固定 50%', (density) => {
    const { spriteIcon } = makeRecordingSprite();
    for (const notes of [[verticalSlide()], denseBands()]) {
      const frame = frameOf(notes, spriteIcon);
      const drawn = drawnFrame(frame, 1.5, { getTransform: () => ({ a: density, d: density, e: 0, f: 0 }) });
      expect(drawn.image.width).toBe(Math.round(frame.metrics.w * density * 0.5));
      expect(drawn.image.height).toBe(Math.round(frame.metrics.h * density * 0.5));
      expect(smoothingAtBlit(drawn.calls)).toBe(true);
    }
  });

  it.each(['sparse', 'dense'])('导出显式 100%%：%s 带体仍画全分辨率缓冲', (kind) => {
    const { spriteIcon } = makeRecordingSprite();
    const notes = kind === 'dense' ? denseBands() : [verticalSlide()];
    const exported = drawnFrame(frameOf(notes, spriteIcon, SIM_BAND_RASTER_SCALE_FULL), 1.5);
    expect(exported.image.width).toBe(fieldMetrics(1334, 750).w);
    expect(exported.image.height).toBe(fieldMetrics(1334, 750).h);
    expect(smoothingAtBlit(exported.calls)).toBe(false);
  });

  it('同一画布：稀疏入场、空白、密集段和恢复稀疏都复用半尺寸缓冲', () => {
    const { spriteIcon } = makeRecordingSprite();
    const { proxy } = recordingCtx();
    const sparse = frameOf([verticalSlide()], spriteIcon);
    const dense = frameOf(denseBands(), spriteIcon);
    drawSimFrameAt(proxy, sparse, 1.5);
    const scratch = lastScratch!;
    const image = scratch.image!;
    expect(image.width).toBe(Math.round(sparse.metrics.w * 0.5));
    for (const [frame, seconds] of [[sparse, 0], [dense, 1.5], [sparse, 1.5]] as const) {
      drawSimFrameAt(proxy, frame, seconds);
      expect(lastScratch).toBe(scratch);
      expect(scratch.image).toBe(image);
    }
    expect(scratch.calls.filter(([name]) => name === 'createImageData')).toHaveLength(1);
  });
});

describe('drawSimFrameAt · 几何不变量未动（issue 45 / 47）', () => {
  it('倒流折返：两组几何重合的反向四边形仍并成一条滑条，光栅按 y 单调切成两臂（像素内叠亮，不成洞）', () => {
    const notes = [
      bpm(0, 120), bpm(4, -120), bpm(8, 120),
      slide([{ beat: 4, lane: 6 }, { beat: 8, lane: 6 }, { beat: 12, lane: 6 }]),
    ];
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf(notes, spriteIcon);
    for (const seconds of [0.5, 1.0, 1.5]) {
      const groups = groupsAt(frame, seconds);
      expect(groups).toHaveLength(1);
      const quads = groups[0]!.quads;
      expect(quads).toHaveLength(2);
      expect(quadKey(quads[0]!)).toBe(quadKey(quads[1]!));
      // 65 起不再靠 nonzero 绕向归一：两臂由 splitBandAtFolds 各自成 run
      expect(splitBandAtFolds(nodesFromQuads(quads))).toHaveLength(2);
      const { image } = drawnFrame(frame, seconds);
      expect(image.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true); // 没有抵消成洞
    }
  });

  it('同拍反向水平段：两段仍并成一组，零面积（退化）结构不变', () => {
    const { spriteIcon } = makeRecordingSprite();
    const notes = [bpm(0, 120), slide([{ beat: 2, lane: 6 }, { beat: 2, lane: 4 }, { beat: 2, lane: 6 }])];
    const groups = groupsAt(frameOf(notes, spriteIcon), 0.75);
    expect(groups).toHaveLength(1);
    const quads = groups[0]!.quads;
    expect(quads).toHaveLength(2);
    expect(quadKey(quads[0]!)).toBe(quadKey(quads[1]!));
    for (const q of quads) expect(Math.abs(signedArea(q))).toBeCloseTo(0, 6);
  });

  it('noteSize=2：段宽跟着翻倍（画布 / 端点同一口径）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 2, lane: 5 }])], spriteIcon);
    const bigger = { ...frame, scene: { ...frame.scene, noteSize: 2 } };
    const q = groupsAt(bigger, 1)[0]!.quads[0]!;
    expect(Math.abs(q[1]!.x - q[0]!.x)).toBeCloseTo(frame.metrics.laneWidth * 2, 6);
  });

  it('亮缘随段宽一起放大（峰位 ∝ 半宽），不会在放大后变成发丝线', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon);
    const peakOffset = (image: { width: number; data: Uint8ClampedArray }) => {
      let best = 0;
      let at = CX;
      for (let x = CX - 80; x <= CX + 80; x++) {
        const a = alphaAt(image, x, ROW);
        if (a > best) {
          best = a;
          at = x;
        }
      }
      return Math.abs(at - CX);
    };
    const one = drawnFrame(frame, 1.5);
    const two = drawnFrame({ ...frame, scene: { ...frame.scene, noteSize: 2 } }, 1.5);
    expect(peakOffset(two.image)).toBeGreaterThan(peakOffset(one.image) * 1.5);
  });
});

