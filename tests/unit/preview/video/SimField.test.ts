// 仿真场一帧的"画在哪儿"（chart-preview 18）：两条硬 bug 的回归网 ——
//   问题 5：可见窗口取反（`[seconds − T, seconds]`）⇒ 音符除"正好压线"外一个都不画；
//   问题 4：场地图 / 判定线拉满画布 ⇒ 素材自带的轨道标记与车道线跟音符错位（应"设计 px 1:1"）。
//
// 单测为什么够：出帧是纯函数（`drawSimFrameAt(ctx, frame, seconds)`）——把精灵换成记录替身，
// 就能看清"这一秒画了哪些元素、画在哪个矩形"；**光栅观感**仍归 `scripts/sim-shot.mjs` 的位图人工核对。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hasAssetSnapshot } from '@/tests/support/assetSnapshot';
import type { ChartNote, SingleNote, SlideNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import type { SimHudAssets, SimSprites } from '@/src/preview/video/sim/simAssets';
import {
  buildSimChart,
  drawSimFrameAt,
  drawSimBackground,
  drawSimHudLayer,
  prepareSimFieldBitmap,
  SIM_FALLBACK_BG,
  STAGE_COVER_INTRO_STYLE,
  visibleSimBandGroups,
  type SimFrameInput,
  type SimFrameLayers,
  type SimScene,
} from '@/src/preview/video/sim/simField';
import { emptySimAssets } from '@/src/preview/video/sim/simAssets';
import { HUD_SPRITES, LETTER_TEXTS, SIM_HUD, plusAgesAt, scoreIncrement } from '@/src/preview/video/sim/simHud';
import {
  videoHudAlphaAt,
  videoHudWindows,
  type VideoHudTimeline,
} from '@/src/preview/video/encode/exportSpec';
import {
  aaoFrameRect,
  aaoStageBackgroundRect,
  approachSeconds,
  backgroundRect,
  comboPopScale,
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
import { fillTexts, makeRecordingCtx, propValues, type RecordedCall } from '@/tests/support/canvas';

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

it('静止场地按最终物理像素和播放时的高质量滤波合成', () => {
  const { proxy, calls } = recordingCtx();
  const bitmap = {} as ImageBitmap;
  const dimensions: number[][] = [];
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(w: number, h: number) { dimensions.push([w, h]); }
    getContext() { return proxy; }
    transferToImageBitmap() { return bitmap; }
  });
  try {
    const frame = frameOf([], makeRecordingSprite().spriteIcon);
    frame.assets.background = {} as HTMLImageElement;
    expect(prepareSimFieldBitmap(frame, 1.25)).toBe(bitmap);
    expect(dimensions).toEqual([[1668, 938]]);
    expect(propValues(calls, 'imageSmoothingQuality')).toContain('high');
    expect(calls.find(([k]) => k === 'setTransform')?.[1]).toEqual([1668 / 1334, 0, 0, 938 / 750, 0, 0]);
  } finally {
    vi.unstubAllGlobals();
  }
});

// 84 × issue 80：相框封面必须跟背景一起烤进**同一张**场地底图 —— 播放期仍然只 drawImage 一次，
// 不会因为多了一张封面就每帧多一层缩放 / 裁剪。漏进播放期 = 帧预算里多一笔（高刷尤其要命）。
it('AAO 背景 + 相框封面一起进场地底图（播放期不重画封面）', () => {
  const { proxy, calls } = recordingCtx();
  const bitmap = {} as ImageBitmap;
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return proxy; }
    transferToImageBitmap() { return bitmap; }
  });
  try {
    const frame = frameOf([], makeRecordingSprite().spriteIcon);
    const bg = { width: 2048, height: 1024 } as unknown as HTMLImageElement;
    const cover = { width: 512, height: 512 } as unknown as ImageBitmap;
    frame.assets.background = bg;
    frame.assets.stageFrame = { cover };
    expect(prepareSimFieldBitmap(frame, 1)).toBe(bitmap);
    // 底图烘焙顺序：背景图 → 相框封面（之后才是场地图 / 判定线 / 亮度罩）
    const drawn = calls.filter(([k]) => k === 'drawImage').map(([, a]) => (a as unknown[])[0]);
    expect(drawn.slice(0, 2)).toEqual([bg, cover]);
  } finally {
    vi.unstubAllGlobals();
  }
});

// 同一口径的另一半：有底图时**整块场地层都不再重画**（背景 / 相框封面 / 场地图 / 判定线）。
// 这条是 issue 80 的底线 —— 谁把某层偷偷挪回播放期，先在这里红。
it('有场地底图时播放帧不重画背景 / 相框封面', () => {
  const { proxy, calls } = recordingCtx();
  const frame = frameOf([], makeRecordingSprite().spriteIcon);
  const bg = { width: 2048, height: 1024 } as unknown as HTMLImageElement;
  const cover = { width: 512, height: 512 } as unknown as ImageBitmap;
  frame.assets.background = bg;
  frame.assets.stageFrame = { cover };
  const bitmap = {} as ImageBitmap;
  drawSimFrameAt(proxy, frame, 0, { fieldBitmap: bitmap });
  const drawn = calls.filter(([k]) => k === 'drawImage').map(([, a]) => (a as unknown[])[0]);
  expect(drawn[0]).toBe(bitmap);
  expect(drawn).not.toContain(bg);
  expect(drawn).not.toContain(cover);
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
        putImageData: (...args: unknown[]) => { scratch.calls.push(['putImageData', args]); },
      }),
    };
    return canvas as unknown as HTMLCanvasElement;
  });
});
afterAll(() => __setSimBandRasterCanvasFactoryForTests(null));

/** 65/66：出帧后直接读回写的 RGBA（缓冲 = 场地 × 变换缩放 × 该帧档位） */
function drawnFrame(
  frame: SimFrameInput,
  seconds: number,
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
  layers?: SimFrameLayers,
) {
  const { proxy, calls } = recordingCtx(overrides);
  drawSimFrameAt(proxy, frame, seconds, layers);
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
    drawSimFrameAt(proxy, withSprites([single(2, 3)], spriteIcon, sprites), 1.05, { hud: false }); // combo 1
    const sources = calls.filter(([k]) => k === 'drawImage').map(([, args]) => args[0]);
    expect(sources).toContain(sprites.digits);
    expect(sources).toContain(sprites.combo);
    // combo 不走文本回落；判定字（51/71）这份 assets 没给 judgeskin ⇒ 纯字占位，不算进来
    // 2026-11-08 验收：AUTO 默认关，纯字是 PERFECT
    expect(calls.filter(([k, a]) => k === 'fillText'
      && !['AUTO', 'PERFECT'].includes((a as unknown[])[0] as string))).toEqual([]);
  });

  // 51 / 71：判定字走 judgeskin 的一格，位置钉在场中央（不跟轨道）
  it('判定字（71）：AUTO 开时切 AUTO 那一格，字心 0.497W × 判定线上 0.10H', () => {
    const { spriteIcon } = makeRecordingSprite();
    const judge = { width: 512, height: 256, naturalWidth: 512, naturalHeight: 256 } as unknown as HTMLImageElement;
    const base = withSprites([single(2, 3)], spriteIcon, null);
    const frame: SimFrameInput = {
      ...base,
      scene: { ...base.scene, autoMode: true },
      assets: { ...base.assets, judge },
    };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.05, { hud: false }); // 命中后 0.05s

    const drawn = calls.filter(([k]) => k === 'drawImage').map(([, a]) => a as unknown[]);
    const hit = drawn.find((a) => a[0] === judge);
    expect(hit).toBeTruthy();
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = hit as number[];
    expect([sx, sy, sw, sh]).toEqual([289, 177, 205, 79]);
    const m = frame.metrics;
    expect((dx as number) + (dw as number) / 2).toBeCloseTo(m.w * 0.497, 5);
    expect((dy as number) + (dh as number) / 2).toBeCloseTo(m.laneHeight - m.h * 0.1, 5);
    // 命中瞬间会"弹一下"（0.8 → 1.1 → 1），所以只断言**基准高度 × 弹放系数**
    expect(dh).toBeCloseTo(m.h * 0.08 * comboPopScale(0.05), 5);
    expect(dh).toBeLessThanOrEqual(m.h * 0.08 * 1.1 + 1e-9);
    // 有图集就不该再画纯字
    expect(calls.filter(([k, a]) => k === 'fillText'
      && ['AUTO', 'PERFECT'].includes((a as unknown[])[0] as string))).toEqual([]);
  });

  it('判定字（71 · 2026-11-08 验收）：未设置 `autoMode` 时默认关 ⇒ 切 PERFECT 那一格', () => {
    const { spriteIcon } = makeRecordingSprite();
    const judge = { width: 512, height: 256, naturalWidth: 512, naturalHeight: 256 } as unknown as HTMLImageElement;
    const base = withSprites([single(2, 3)], spriteIcon, null);
    const frame: SimFrameInput = { ...base, assets: { ...base.assets, judge } };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.05, { hud: false });
    const hit = calls.filter(([k]) => k === 'drawImage').map(([, a]) => a as unknown[]).find((a) => a[0] === judge);
    expect(hit?.slice(1, 5)).toEqual([0, 177, 287, 79]);
  });

  it('判定字（71）：`autoMode: false` 回到 PERFECT 那一格（两档共用同一条绘制链）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const judge = { width: 512, height: 256, naturalWidth: 512, naturalHeight: 256 } as unknown as HTMLImageElement;
    const base = withSprites([single(2, 3)], spriteIcon, null);
    const frame: SimFrameInput = {
      ...base,
      scene: { ...base.scene, autoMode: false },
      assets: { ...base.assets, judge },
    };
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.05, { hud: false });
    const hit = calls.filter(([k]) => k === 'drawImage').map(([, a]) => a as unknown[]).find((a) => a[0] === judge);
    expect(hit?.slice(1, 5)).toEqual([0, 177, 287, 79]);
  });

  it('缺精灵时 combo 回落自绘文本（不空着）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, withSprites([single(2, 3)], spriteIcon, null), 1.05, { hud: false });
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
    // 顶栏的 ▽ 刻度也走 `fill`，这里只关心轨道闪 ⇒ 把 HUD 收掉
    drawSimFrameAt(flashOver.proxy, frame, 1.3, { hud: false }); // 命中后 0.3s：闪已收
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
    const cached = {} as ImageBitmap;
    const cachedFrame = recordingCtx();
    drawSimFrameAt(cachedFrame.proxy, frame, 0, { fieldBitmap: cached });
    expect(cachedFrame.calls.filter(([k]) => k === 'drawImage').map(([, args]) => args)).toEqual([
      [cached, 0, 0, frame.metrics.w, frame.metrics.h],
    ]);
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

  it.skipIf(!hasAssetSnapshot)('按住期间接触点画**滑条端点**（票 25 #2 + 77：全轨统一扁平端帽）', () => {
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
    // 票 77：任意轨位都取 FLAT_LANE 那张；逐轨 note_long_<lane> 自带舞台透视倾角（外轨歪）
    const flat = icons.slideEndpointFor(3);
    expect(endpoint.sx).toBe(flat.x);
    expect(endpoint.sy).toBe(flat.y);
    expect(endpoint.src).toBe(flat.src);
    // 端点与单键同一个盒子（自然比，noteSize = 1）
    const box = simNoteRect(frame.metrics, 1, 1, 120 / 308);
    expect(endpoint.w).toBeCloseTo(box.w, 6);
    expect(endpoint.h).toBeCloseTo(box.h, 6);

    // 三档轨位（含非整数插值会取到的偏轨）：同一张扁平图（不再随轨位换图），落点仍各自随轨位走
    for (const lane of [0, 2, 6]) {
      const rec = makeRecordingSprite();
      const laneFrame: SimFrameInput = {
        ...frameOf([slide([{ beat: 2, lane }, { beat: 8, lane }])], rec.spriteIcon),
        assets: { ...emptySimAssets(), missing: false, sprites },
      };
      drawSimFrameAt(recordingCtx().proxy, laneFrame, 2.5);
      expect(rec.draws).toHaveLength(1);
      expect(rec.draws[0]!.sx).toBe(flat.x);
      expect(rec.draws[0]!.sy).toBe(flat.y);
      expect(rec.draws[0]!.x).toBeCloseTo(laneCenterX(laneFrame.metrics, lane, 1), 6);
    }

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

  it.skipIf(!hasAssetSnapshot)('经过中间结点后按住帽换中间结点款；hidden 采样点不触发换款', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const sprites = fakeSprites() as unknown as SimSprites;
    // A(1s, 头端点) → H(1.5s, hidden) → B(2s, 中间结点) → H(2.5s, hidden) → C(4s, 尾端点)：
    // 按住窗口依次 (1,1.5] (1.5,2] (2,2.5] (2.5,4]，只在玩家经过 B 之后换款。
    const frame: SimFrameInput = {
      ...frameOf([slide([
        { beat: 2, lane: 0 },
        { beat: 3, lane: 1, hidden: true },
        { beat: 4, lane: 2 },
        { beat: 5, lane: 3, hidden: true },
        { beat: 8, lane: 4 },
      ])], spriteIcon),
      assets: { ...emptySimAssets(), sprites },
    };
    const endpoint = icons.slideEndpointFor(3);
    const among = icons.slideAmongFor(3);
    // 按住帽恒压判定线上（canvasY = laneHeight）；接近中的结点还在上方（fieldY = laneHeight × A）
    const capAt = (seconds: number) => {
      draws.length = 0;
      drawSimFrameAt(recordingCtx().proxy, frame, seconds);
      return draws.filter((d) => d.y === frame.metrics.laneHeight);
    };

    for (const [seconds, want] of [
      [1.25, endpoint], [1.75, endpoint], [2.25, among], [2.75, among],
    ] as const) {
      const caps = capAt(seconds);
      expect(caps).toHaveLength(1);
      expect([caps[0]!.sx, caps[0]!.sy, caps[0]!.src]).toEqual([want.x, want.y, want.src]);
    }
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
  it.each([SIM_BAND_RASTER_SCALE, SIM_BAND_RASTER_SCALE_FULL] as const)('稀疏带体只回写局部覆盖区域（scale=%s）', (scale) => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon, scale);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.5);
    drawSimFrameAt(proxy, frame, 1.6);
    const scratch = lastScratch!;
    const writes = scratch.calls.filter(([key]) => key === 'putImageData');
    expect(writes).toHaveLength(2);
    for (const [, args] of writes) {
      const area = args.length === 7 ? Number(args[5]) * Number(args[6]) : scratch.width * scratch.height;
      expect(area).toBeLessThan(scratch.width * scratch.height / 4);
    }
  });

  it('时间块筛选与原全表路径等价：倒流、跨窗长段、同刻段、边界和回跳保留叠放序', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const padding = Array.from({ length: 160 }, (_, i) => slide([
      { beat: 1000 + i * 4, lane: 0 }, { beat: 1002 + i * 4, lane: 6 },
    ]));
    const frame = frameOf([
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'BPM', beat: 16, bpm: -120 },
      { type: 'BPM', beat: 32, bpm: 120 },
      ...padding.slice(0, 80),
      slide([{ beat: 0, lane: 0 }, { beat: 64, lane: 6 }]),
      slide([{ beat: 8, lane: 6 }, { beat: 20, lane: 0 }, { beat: 40, lane: 5 }]),
      slide([{ beat: 4, lane: 2 }, { beat: 4, lane: 5 }, { beat: 8, lane: 3 }]),
      ...padding.slice(80),
    ], spriteIcon);
    frame.assets = { ...frame.assets, sprites: fakeSprites() as unknown as SimSprites };
    // 手工构造的段表保留全表兼容路径，可作已知旧行为的对照。
    const reference = { ...frame, chart: { ...frame.chart, bands: [...frame.chart.bands] } };
    for (const seconds of [0, 0.001, 2, 4, 7.999, 8, 8.001, 0.5]) {
      expect(groupsAt(frame, seconds)).toEqual(groupsAt(reference, seconds));
      draws.length = 0;
      const indexed = drawnFrame(frame, seconds);
      const spriteDraws = [...draws];
      draws.length = 0;
      const full = drawnFrame(reference, seconds);
      expect(draws).toEqual(spriteDraws); // 含按住帽的先后序、款式与位置
      expect(indexed.image.data.every((v, i) => v === full.image.data[i])).toBe(true);
      const particles = (calls: RecordedCall[]) => calls.filter(([key, args]) =>
        key === 'drawImage' && args[0] === frame.assets.sprites!.particles);
      expect(particles(indexed.calls)).toEqual(particles(full.calls));
    }
  });

  it.each([SIM_BAND_RASTER_SCALE, SIM_BAND_RASTER_SCALE_FULL])('带体连续出帧不再复制整张 RGBA（scale=%s）', (scale) => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon, scale);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.5);
    const image = lastScratch!.image!;
    const copy = vi.spyOn(image.data, 'set');
    try {
      drawSimFrameAt(proxy, frame, 1.6);
      drawSimFrameAt(proxy, frame, 1.7);
      expect(copy.mock.calls.length).toBe(0);
      expect(lastScratch!.image).toBe(image);
      expect(image.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    } finally {
      copy.mockRestore();
    }
  });

  it.each([SIM_BAND_RASTER_SCALE, SIM_BAND_RASTER_SCALE_FULL])('复用带体像素会清掉旧轨位，且不同画布互不覆盖（scale=%s）', (scale) => {
    const { spriteIcon } = makeRecordingSprite();
    const atLane = (lane: number) => frameOf([
      slide([{ beat: 0, lane }, { beat: 4, lane }]),
    ], spriteIcon, scale);
    const { proxy } = recordingCtx();
    drawSimFrameAt(proxy, atLane(0), 1.5);
    const reused = lastScratch!.image!;
    const previous = reused.data.slice();
    drawSimFrameAt(proxy, atLane(6), 1.5);
    expect(reused.data.some((v, i) => v !== previous[i])).toBe(true);
    const current = reused.data.slice();
    const fresh = drawnFrame(atLane(6), 1.5).image;
    expect(fresh.data.every((v, i) => v === current[i])).toBe(true);
    drawSimFrameAt(proxy, atLane(0), 1.5);
    expect(reused.data.every((v, i) => v === previous[i])).toBe(true);
    expect(fresh.data.every((v, i) => v === current[i])).toBe(true);
  });

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

  it('票 74 回修 · noteAlpha 让带体像素 α 折半（与 slideOpacity 同一道 baseAlpha）', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame = frameOf([verticalSlide()], spriteIcon);
    const full = drawnFrame(frame, 1.5);
    const half = drawnFrame(frame, 1.5, {}, { noteAlpha: 0.5 });
    expect(alphaAt(half.image, CX, ROW)).toBeCloseTo(alphaAt(full.image, CX, ROW) / 2, 2);
  });

  it('票 74 回修 · noteAlpha 只作用音符 / 双押线精灵，缺省仍是 1', () => {
    const { spriteIcon, draws } = makeRecordingSprite();
    const frame = frameOf([single(2, 3)], spriteIcon);
    const faded = recordingCtx();
    drawSimFrameAt(faded.proxy, frame, 0.5, { noteAlpha: 0.5 });
    expect(draws).toHaveLength(1);
    expect(draws[0]!.alpha).toBe(0.5);

    draws.length = 0;
    const plain = recordingCtx();
    drawSimFrameAt(plain.proxy, frame, 0.5);
    expect(draws).toHaveLength(1);
    expect(draws[0]!.alpha).toBe(1);
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
  it('实时可使用带体渲染器，失败回到 50%，导出仍使用显式的 100%', () => {
    const { spriteIcon } = makeRecordingSprite();
    const notes = [verticalSlide()];
    const frame = frameOf(notes, spriteIcon);
    const { proxy, calls } = recordingCtx();
    const bandRenderer = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    drawSimFrameAt(proxy, frame, 1.5, { bandRenderer });
    expect(bandRenderer).toHaveBeenCalledTimes(1);
    const [ctx, groups, normal, sp, opacity, metrics] = bandRenderer.mock.calls[0]!;
    expect(ctx === proxy).toBe(true);
    expect(groups).toEqual(groupsAt(frame, 1.5));
    expect(normal).toBe(frame.assets.bandRaster);
    expect(sp).toBe(frame.assets.bandRasterSp);
    expect(opacity).toBe(frame.scene.slideOpacity);
    expect(metrics).toBe(frame.metrics);
    expect(calls.filter(([key, args]) => key === 'drawImage' && args.length === 9)).toHaveLength(0);

    const fallback = drawnFrame(frame, 1.5, {}, { bandRenderer });
    expect(fallback.image.width).toBe(Math.round(frame.metrics.w * SIM_BAND_RASTER_SCALE));
    const exported = drawnFrame(frameOf(notes, spriteIcon, SIM_BAND_RASTER_SCALE_FULL), 1.5, {}, { bandRenderer });
    expect(exported.image.width).toBe(frame.metrics.w);
    expect(bandRenderer).toHaveBeenCalledTimes(2);
  });

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

/** 顶栏素材假图（node 无 DOM；只按对象身份认谁被画了） */
const fakeHud = (over: Partial<SimHudAssets> = {}): SimHudAssets => {
  const im = (w: number, h: number) =>
    ({ width: w, height: h, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement);
  return {
    scoreFill: im(661, 22),
    pauseBtn: im(64, 64),
    starFlow: im(110, 100),
    autoLive: im(512, 113),
    scoreBar: im(593, 132),
    lifeBar: im(540, 115),
    ...over,
  };
};
const NO_HUD = fakeHud({ scoreFill: null, pauseBtn: null, starFlow: null, autoLive: null, scoreBar: null, lifeBar: null });

const hudFrame = (notes: ChartNote[], hud: SimHudAssets, autoMode = false): SimFrameInput => {
  const { spriteIcon } = makeRecordingSprite();
  const f = frameOf(notes, spriteIcon);
  return { ...f, scene: { ...f.scene, autoMode }, assets: { ...f.assets, hud } };
};

const drawnTexts = (calls: RecordedCall[]) => fillTexts(calls).map(([, [text]]) => text);

describe('drawSimFrameAt · 打歌 HUD 顶栏（票 71 / 72）', () => {
  it('顶栏五件全缺：7 位分数 / 等级字母 / 生命计数照画，降级描边框不抛错、不自造字样', () => {
    const { proxy, calls } = recordingCtx();
    expect(() => drawSimFrameAt(proxy, hudFrame([single(2, 3)], NO_HUD), 1.2)).not.toThrow();
    const t = drawnTexts(calls);
    // 先 5 笔等级字母，紧接着 7 位定宽分数（单音符谱全命中 = 满分）；后面还有 combo 的 '1'
    expect(t.slice(0, 5)).toEqual(['C', 'B', 'A', 'S', 'SS']);
    expect(t.slice(5, 12).join('')).toBe('1000000');
    expect(t).toContain('1000/1000');
    expect(t).toContain('SS');
    expect(t.join('')).not.toContain('AUTO PLAY');
    // 分数框 / 生命框各一次降级描边
    expect(calls.filter(([k]) => k === 'stroke').length).toBeGreaterThanOrEqual(2);
  });

  it('`hud: false` 收掉整层（结尾段的舞台只要场地）', () => {
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, hudFrame([single(2, 3)], NO_HUD), 1.2, { hud: false });
    expect(drawnTexts(calls)).not.toContain('1000/1000');
  });

  // 票 76：HUD 提成跨段独立层，整层要能淡入 / 淡出。内部几个元件各自写
  // globalAlpha（等级字母 / ▽刻度 / +增量 / 星点），只在外层设一次会被它们覆盖掉。
  it('`hudAlpha` 是整层倍率：自写 globalAlpha 的等级字母 / 刻度也一起收', () => {
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, hudFrame([single(2, 3)], NO_HUD), 1.2, { hudAlpha: 0.5 });
    const alphas = propValues(calls, 'globalAlpha') as number[];
    const near = (v: number) => alphas.some((a) => Math.abs(a - v) < 1e-9);
    expect(near(0.5)).toBe(true);                                  // 外层 ambient
    expect(near(SIM_HUD.letterAlpha * 0.5)).toBe(true);            // 等级字母
    expect(near(SIM_HUD.letterAlpha * 0.92 * 0.5)).toBe(true);     // ▽ 刻度
    const plain = recordingCtx();
    drawSimFrameAt(plain.proxy, hudFrame([single(2, 3)], NO_HUD), 1.2);
    expect((propValues(plain.calls, 'globalAlpha') as number[]).some((a) => a === 0.5)).toBe(false);
  });

  it('`drawSimHudLayer` 单独画顶栏：showGameUi 关掉 / alpha=0 一笔不画', () => {
    const frame = hudFrame([single(2, 3)], NO_HUD);
    const { proxy, calls } = recordingCtx();
    drawSimHudLayer(proxy, frame, 1.2, 0.5);
    expect(drawnTexts(calls)).toContain('1000/1000');
    const off = recordingCtx();
    drawSimHudLayer(off.proxy, { ...frame, scene: { ...frame.scene, showGameUi: false } }, 1.2, 1);
    expect(drawnTexts(off.calls)).not.toContain('1000/1000');
    const zero = recordingCtx();
    drawSimHudLayer(zero.proxy, frame, 1.2, 0);
    expect(zero.calls.length).toBe(0);
  });

  it('▽ 刻度三角形按 SIM_HUD.tickH 画（5 枚顶点间距 = tickH × s）', () => {
    const frame = hudFrame([single(2, 3)], NO_HUD);
    const s = frame.metrics.w / 1920;
    const tickH = SIM_HUD.tickH * s;
    const tickW = tickH * 1.35;
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.2);
    let ticks = 0;
    for (let i = 0; i < calls.length - 2; i++) {
      if (calls[i]![0] !== 'moveTo' || calls[i + 1]![0] !== 'lineTo' || calls[i + 2]![0] !== 'lineTo') continue;
      const [x0, y0] = calls[i]![1] as number[];
      const [x1, y1] = calls[i + 1]![1] as number[];
      const [x2, y2] = calls[i + 2]![1] as number[];
      if (Math.abs(y1 - y0) < 1e-6 && Math.abs(x1 - x0 - tickW) < 1e-6
        && Math.abs(y2 - y0 - tickH) < 1e-6 && Math.abs(x2 - x0 - tickW / 2) < 1e-6) ticks++;
    }
    expect(ticks).toBe(LETTER_TEXTS.length);
  });

  it('AUTO LIVE 胶囊只在 autoMode 开时画，落在 (36,142) 278×51（2026-11-22 上移 8）', () => {
    const autoLive = fakeHud().autoLive;
    const frame = hudFrame([single(2, 3)], { ...NO_HUD, autoLive }, true);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.2);
    const hit = calls.filter(([k]) => k === 'drawImage')
      .map(([, a]) => a as unknown[]).find((a) => a[0] === autoLive);
    expect(hit?.slice(1, 5)).toEqual([0, 0, 512, 113]);
    const s = frame.metrics.w / 1920;
    expect(hit?.[5]).toBeCloseTo(36 * s, 5);
    expect(hit?.[6]).toBeCloseTo(142 * s, 5);
    expect(hit?.[7]).toBeCloseTo(278 * s, 5);
    expect(hit?.[8]).toBeCloseTo((113 / 512) * 278 * s, 5);

    const off = { ...frame, scene: { ...frame.scene, autoMode: false } };
    const r = recordingCtx();
    drawSimFrameAt(r.proxy, off, 1.2);
    expect(r.calls.filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === autoLive)).toEqual([]);
  });

  it('分数组件走 4 切片，切点对齐物理像素列 + 相邻片同源重叠（不出现透背景的竖线）', () => {
    const scoreBar = fakeHud().scoreBar;
    const frame = hudFrame([single(2, 3)], { ...NO_HUD, scoreBar });
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.2);
    const draws = calls.filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === scoreBar)
      .map(([, a]) => a as unknown[]);
    expect(draws).toHaveLength(4);
    // 源区左右各多带一个物理像素（同源 bleed），起点仍在原切图坐标附近
    const starts = [0, 60, 250, 560];
    draws.forEach((a, i) => expect(Math.abs((a[1] as number) - starts[i]!)).toBeLessThan(3));
    for (const d of draws.slice(1)) expect(Number.isInteger(d[5])).toBe(true);
  });

  it('非整数 CTM（dpr 1.25）下内部切点仍落在整数物理像素列上', () => {
    const a = 1.25;
    const { proxy, calls } = makeRecordingCtx({
      getTransform: () => ({ a, b: 0, c: 0, d: a, e: 0, f: 0 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    });
    const scoreBar = fakeHud().scoreBar;
    const frame = hudFrame([single(2, 3)], { ...NO_HUD, scoreBar });
    drawSimFrameAt(proxy, frame, 1.2);
    const draws = calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === scoreBar)
      .map(([, v]) => v as unknown[]);
    expect(draws).toHaveLength(4);
    // 第 2..4 片的左沿 = 切点 − 1/a；乘回 a 必须是整数设备列
    for (const d of draws.slice(1)) expect(Number.isInteger((d[5] as number) * a)).toBe(true);
  });

  it('0 分（首音命中前）分数条是空槽：不画官方渐变条、不叠四芒星；命中后恢复', () => {
    const hud = fakeHud();
    const frame = hudFrame([single(2, 3)], hud); // 120 BPM ⇒ 命中在 1s
    const barDraws = (c: RecordedCall[]) => c.filter(([k, v]) =>
      k === 'drawImage' && (v as unknown[])[0] === hud.scoreFill);
    const zero = recordingCtx();
    drawSimFrameAt(zero.proxy, frame, 0.2);
    expect(barDraws(zero.calls)).toEqual([]);
    expect(zero.calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === hud.starFlow)).toEqual([]);
    // 分数组件本身照画，只是槽里是空的
    expect(zero.calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === hud.scoreBar))
      .toHaveLength(4);
    const hit = recordingCtx();
    drawSimFrameAt(hit.proxy, frame, 1.2);
    expect(barDraws(hit.calls)).toHaveLength(1);
  });

  it('`+增量` = 满分 / 可击打物总数，命中后停留时长内可见', () => {
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, hudFrame([single(2, 3), single(4, 0)], NO_HUD), 1.2);
    expect(drawnTexts(calls)).toContain('+500000');
    const late = recordingCtx();
    drawSimFrameAt(late.proxy, hudFrame([single(2, 3)], NO_HUD), 2.0);
    expect(drawnTexts(late.calls)).not.toContain('+1000000');
  });

  it('高密度谱面：窗口内每次命中各画一条 +inc，不设上限、不合并（2026-11-09 回退）', () => {
    const notes = Array.from({ length: 12 }, (_, i) => single(2 + i * 0.2, 3));
    const inc = scoreIncrement(notes.length);
    const frame = hudFrame(notes, NO_HUD);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 2.0);
    const plus = drawnTexts(calls).filter((text) => text.startsWith('+'));
    // 窗口 `(2 - plusDur, 2]` 里每一次命中各一条同值文本；期望条数由同一份
    // `plusAgesAt` 推（边界按年龄比，别自己拿浮点减法重算），换默认档不必手改数字。
    const expected = plusAgesAt(frame.chart, 2, SIM_HUD.plusDur).length;
    expect(plus).toHaveLength(expected);
    expect(new Set(plus)).toEqual(new Set([`+${inc}`]));
    expect(plus.reduce((sum, text) => sum + Number(text.slice(1)), 0)).toBe(inc * expected);
  });

  it('2026-11-14 · `+增量` 两段运动落到绘制：冲刺到位后只微移并淡出', () => {
    // 采样两条 `+inc`：一条在冲刺段中点、一条在尾段近末。年龄一律按当前默认档推，
    // 谱面拍数按「帧时刻 − 想要的年龄」反推（120 BPM ⇒ beat/2 = 秒），换档不必再改谱面。
    const sec = 2;
    const { plusDur: dur, plusDashFrac: dashFrac } = SIM_HUD;
    const youngAge = dur * dashFrac * 0.5;
    const oldAge = dur * (dashFrac + (1 - dashFrac) * 0.9);
    const beatOf = (age: number) => (sec - age) * 2;
    const frame = hudFrame([single(beatOf(oldAge), 3), single(beatOf(youngAge), 3)], NO_HUD);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, sec);
    let alpha = 1;
    const plus: { x: number; alpha: number }[] = [];
    for (const [k, a] of calls) {
      if (k === 'globalAlpha') alpha = Number(a[0]);
      if (k === 'fillText' && String(a[0]).startsWith('+')) plus.push({ x: Number(a[1]), alpha });
    }
    expect(plus).toHaveLength(2);
    const s = frame.metrics.w / 1920;
    const x = SIM_HUD.boxX * s;
    const w = SIM_HUD.boxW * s;
    const rightmost = x + w * (SIM_HUD.plusX + SIM_HUD.plusDX);
    // `plusAgesAt` 给的是**降序**年龄（最老的在最前）
    const old = plus[0]!;
    const young = plus[1]!;
    // 冲刺段那条还在半途、亮度已近满；尾段那条已越过最右侧、只剩极小的额外位移且正在淡出
    expect(young.x).toBeLessThan(rightmost);
    expect(young.alpha).toBeGreaterThan(0.9);
    expect(old.x).toBeGreaterThan(rightmost);
    expect(old.x - rightmost).toBeLessThan(w * SIM_HUD.plusDriftDX + 1e-6);
    expect(old.alpha).toBeLessThan(0.2);
  });

  it('SS+ 档：填充条取官方渐变条 A 整段，并叠 12 枚四芒星流动', () => {
    const hud = fakeHud();
    const notes = Array.from({ length: 10 }, (_, i) => single((i + 1) * 2, 3));
    const frame = hudFrame(notes, hud);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 10);
    const bar = calls.filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === hud.scoreFill)
      .map(([, a]) => a as unknown[]).find((a) => a.length === 9);
    expect(bar?.slice(1, 5)).toEqual([0, 0, 661, 22]);
    expect(calls.filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === hud.starFlow)).toHaveLength(12);
    const boxEnd = calls.findLastIndex(([k, a]) => k === 'drawImage' && a[0] === hud.scoreBar);
    const firstStar = calls.findIndex(([k, a]) => k === 'drawImage' && a[0] === hud.starFlow);
    expect(calls.slice(boxEnd + 1, firstStar).filter(([k]) => k === 'clip')).toHaveLength(1);
  });

  it('票 76 回修 · 内容秒冻结时 SS+ 星点仍按独立相位时钟流动，直到分数条完全消失', () => {
    const hud = fakeHud();
    const notes = Array.from({ length: 10 }, (_, i) => single((i + 1) * 2, 3));
    const frame = hudFrame(notes, hud);
    const starXs = (flowSeconds: number, alpha = 1): number[] => {
      const { proxy, calls } = recordingCtx();
      drawSimHudLayer(proxy, frame, 10, alpha, flowSeconds);
      return calls
        .filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === hud.starFlow)
        .map(([, a]) => (a as unknown[])[5] as number);
    };
    const atEnd = starXs(10);
    expect(atEnd).toHaveLength(12);
    expect(starXs(10)).toEqual(atEnd);
    const later = starXs(11.3);
    expect(later).toHaveLength(12);
    expect(later.some((x, i) => Math.abs(x - atEnd[i]!) > 1e-6)).toBe(true);
    expect(starXs(12.1, 0.5)).toHaveLength(12);
    expect(starXs(12.1, 0)).toHaveLength(0);
  });

  // WebCodecs 帧循环单测跑不动：用与 frameDriver 同式的时间线把真实 alpha 窗接进绘制层，
  // 锁住「跟随到分数条完全消失」而非手造 alpha。
  it('票 76 回修 · 退场窗内星点仍按连续秒流动，alpha 归零那一帧才收干净', () => {
    const hud = fakeHud();
    const notes = Array.from({ length: 10 }, (_, i) => single((i + 1) * 2, 3));
    const frame = hudFrame(notes, hud);
    const simStart = 8.4;
    const chartSeconds = 10;                            // 末帧秒：满分 / SS+，与 frameDriver 一样钳住
    const tl: VideoHudTimeline = {
      openEnd: 6.75,
      endingAt: simStart + chartSeconds,
      stampDur: 3,
    };
    const w = videoHudWindows(tl);
    const mid = (w.outAt + w.outEnd) / 2;
    const starsAt = (t: number): number[] => {
      const { proxy, calls } = recordingCtx();
      drawSimHudLayer(proxy, frame, chartSeconds, videoHudAlphaAt(t, tl), t - simStart);
      return calls
        .filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === hud.starFlow)
        .map(([, a]) => (a as unknown[])[5] as number);
    };
    expect(videoHudAlphaAt(w.outAt, tl)).toBe(1);
    expect(videoHudAlphaAt(mid, tl)).toBeGreaterThan(0);
    expect(videoHudAlphaAt(mid, tl)).toBeLessThan(1);
    expect(videoHudAlphaAt(w.outEnd, tl)).toBe(0);
    const atOut = starsAt(w.outAt);
    const atMid = starsAt(mid);
    expect(atOut).toHaveLength(12);
    expect(atMid).toHaveLength(12);
    expect(atMid.some((x, i) => Math.abs(x - atOut[i]!) > 1e-6)).toBe(true);
    expect(starsAt(w.outEnd)).toHaveLength(0);
  });

  it('生命 gauge 按实机截图：上亮绿 / 下深绿两段渐变，不再切洋红色块', () => {
    const stops: [number, string][] = [];
    const { proxy, calls } = makeRecordingCtx({
      createLinearGradient: () => ({
        addColorStop: (p: number, c: string) => { stops.push([p, c]); },
      }),
    });
    const hud = fakeHud();
    drawSimFrameAt(proxy, hudFrame([single(2, 3)], hud), 1.2);
    expect(stops).toEqual(expect.arrayContaining([
      [0, SIM_HUD.lifeGaugeTop],
      [SIM_HUD.lifeGaugeSplit, SIM_HUD.lifeGaugeTop],
      [1, SIM_HUD.lifeGaugeBottom],
    ]));
    const boxes = calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === hud.scoreFill)
      .map(([, v]) => (v as unknown[]).slice(1, 5));
    expect(boxes).not.toContainEqual([303, 112, 39, 22]);
    expect(boxes).not.toContainEqual([360, 123, 39, 22]);
  });

  it('2026-11-14 · 生命填充内缩：露出空槽自带的深色框，渐变也跟着内沿走', () => {
    const grads: number[][] = [];
    const { proxy, calls } = makeRecordingCtx({
      createLinearGradient: (...args) => {
        grads.push(args as number[]);
        return { addColorStop: () => undefined };
      },
    });
    const frame = hudFrame([single(2, 3)], fakeHud());
    drawSimFrameAt(proxy, frame, 1.2);

    const s = frame.metrics.w / 1920;
    const ky = SIM_HUD.lifeH * s / HUD_SPRITES.lifeBar[3];
    const b = HUD_SPRITES.lifeBand;
    const outerX = SIM_HUD.lifeX * s + b.x * ky;
    const outerY = SIM_HUD.lifeY * s + b.y * ky;
    const outerW = SIM_HUD.lifeW * s
      - (HUD_SPRITES.lifeBar[2] - b.x - b.w) * ky - b.x * ky;
    const outerH = b.h * ky;
    const d = SIM_HUD.lifeGaugeInset * ky;
    expect(d).toBeGreaterThan(0); // 0 就退回盖住暗框的旧效果

    const rects = calls.filter(([k]) => k === 'fillRect').map(([, a]) => a as number[]);
    const near = (got: number[], want: number[]) =>
      got.length === 4 && got.every((v, i) => Math.abs(v - want[i]!) < 1e-6);
    expect(rects.some((r) => near(r, [outerX + d, outerY + d, outerW - 2 * d, outerH - 2 * d]))).toBe(true);
    expect(rects.some((r) => near(r, [outerX, outerY, outerW, outerH]))).toBe(false);
    // 渐变必须架在内沿上，否则上段亮绿会被 clip 裁掉
    expect(grads.some((g) => g.length === 4 && Math.abs(g[1]! - (outerY + d)) < 1e-6
      && Math.abs(g[3]! - (outerY + outerH - d)) < 1e-6)).toBe(true);
  });

  it('已有生命条贴图时，实时出帧复用贴图并省去一道裁剪', () => {
    const frame = hudFrame([single(2, 3)], fakeHud());
    const baseline = recordingCtx();
    drawSimFrameAt(baseline.proxy, frame, 1.2);
    const prepared = recordingCtx();
    const canvas = {} as HTMLCanvasElement;
    const lifeGauge = { canvas, x: 1, y: 2, w: 30, h: 5 };
    drawSimFrameAt(prepared.proxy, frame, 1.2, { lifeGauge });

    expect(prepared.calls).toContainEqual(['drawImage', [canvas, 1, 2, 30, 5]]);
    expect(prepared.calls.filter(([k]) => k === 'clip')).toHaveLength(
      baseline.calls.filter(([k]) => k === 'clip').length - 1,
    );
  });

  it('顶部状态栏只用一枚总开关：关掉时四件全收，缺省照画', () => {
    const hud = fakeHud();
    const base = hudFrame([single(2, 3)], hud, true);
    const off: SimFrameInput = { ...base, scene: { ...base.scene, showGameUi: false } };
    const offRec = recordingCtx();
    drawSimFrameAt(offRec.proxy, off, 1.2);
    for (const img of [hud.scoreBar, hud.lifeBar, hud.scoreFill, hud.pauseBtn, hud.autoLive]) {
      expect(offRec.calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === img)).toEqual([]);
    }
    expect(drawnTexts(offRec.calls)).not.toContain('1000/1000');

    const on = recordingCtx();
    drawSimFrameAt(on.proxy, base, 1.2);
    expect(on.calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === hud.scoreBar)).toHaveLength(4);
    expect(on.calls.filter(([k, v]) => k === 'drawImage' && (v as unknown[])[0] === hud.lifeBar)).toHaveLength(4);
    expect(drawnTexts(on.calls)).toContain('1000/1000');
  });
});

// chart-preview 84 · ADR-0018 §7：应用自带背景包「AAO 舞台」的相框封面。
// 锁的是**绘制顺序**（这是单测唯一能看到的那一层 —— 合成结果要靠 sim-shot 出图人眼验收）：
//   兜底底色 → 背景图 → 相框封面 → 亮度黑罩
// 封面在黑罩之前 ⇒ 跟着亮度一起压暗（票 84 Q7=B"亮度照吃"）；在黑罩之前、场地图之前 ⇒
// 轨道那层半透玻璃把相框压暗、车道线压在它上面，音符下落时仍看得见轨道（Q3'）。
describe('drawSimBackground · 相框封面（票 84）', () => {
  const m = fieldMetrics(1334, 750);
  const bg = { width: 2048, height: 1024, tag: 'bg' } as unknown as CanvasImageSource;
  const cover = { width: 600, height: 600, tag: 'cover' } as unknown as CanvasImageSource;
  /** 底色 / 黑罩是 fillRect，图是 drawImage —— 只留这两类笔触读顺序 */
  const paintOps = (calls: RecordedCall[]) => calls.filter(([k]) => k === 'drawImage' || k === 'fillRect');

  it('封面画在背景图之后、亮度黑罩之前（跟着亮度压暗，且不盖住场地图）', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, bg, 0.7, 1, { stageFrame: { cover } });
    const ops = paintOps(calls);
    expect(ops).toHaveLength(4);
    expect(ops[0]![0]).toBe('fillRect'); // 兜底底色
    expect((ops[1]![1] as unknown[])[0]).toBe(bg);
    expect((ops[2]![1] as unknown[])[0]).toBe(cover);
    expect(ops[3]![0]).toBe('fillRect'); // 亮度黑罩最后 → 封面也被压暗
  });

  it('自带包取景走自然比例（1.32W / 2:1 / 图顶贴顶），不是幕布那条 1.525 倍拉伸', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, bg, 1, 1, { stageFrame: { cover } });
    const r = aaoStageBackgroundRect(m);
    // drawImage 的第 0 个参数是图本身，后面才是目标矩形
    expect((calls.filter(([k]) => k === 'drawImage')[0]![1] as number[]).slice(1)).toEqual([r.x, r.y, r.w, r.h]);
    expect(r.h).toBeCloseTo(r.w / 2, 6);
    expect(r.y).toBe(0);
  });

  it('封面按 cover 铺进相框矩形：目标 = 相框区，源按比例居中裁（不拉伸）', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, bg, 1, 1, { stageFrame: { cover } });
    const args = calls.filter(([k]) => k === 'drawImage')[1]![1] as number[];
    const f = aaoFrameRect(m);
    expect(args.slice(5)).toEqual([f.x, f.y, f.w, f.h]);
    expect(args[3]! / args[4]!).toBeCloseTo(f.w / f.h, 3); // 源裁切后与相框同比 ⇒ 无拉伸
    expect(args[3]!).toBeLessThanOrEqual(600);
  });

  it('coverAlpha 单独压封面：开场③段 = 0 ⇒ 相框空着、背景图照旧（票 84 回修）', () => {
    const zero = recordingCtx();
    drawSimBackground(zero.proxy, m, bg, 0.7, 1, { stageFrame: { cover }, coverAlpha: 0 });
    expect(zero.calls.filter(([k]) => k === 'drawImage')).toHaveLength(1); // 只剩背景图

    const half = recordingCtx();
    drawSimBackground(half.proxy, m, bg, 0.7, 1, { stageFrame: { cover }, coverAlpha: 0.5 });
    expect(half.calls.filter(([k]) => k === 'drawImage')).toHaveLength(2); // 封面回来了（半透明）
  });

  it('没给封面（别的背景包 / 工程没封面）就只画背景，不画相框', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, bg, 0.7, 1);
    const ops = paintOps(calls);
    expect(ops).toHaveLength(3); // 底色 → 背景图 → 黑罩
    expect(calls.filter(([k]) => k === 'drawImage')).toHaveLength(1);
  });

  it('背景图缺件（空态）时不画相框，也不压黑', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, null, 0.7, 1, { stageFrame: { cover } });
    expect(paintOps(calls)).toHaveLength(1); // 只剩兜底底色
  });

  // 2026-11-23 用户在原型里定档；原型不入库 ⇒ 这份常量是唯一真相，改错没人拦
  it('封面登场力度常量：缩放 1.2 / 扫光带宽 0.26 / 扫光 0.65 / 屏沿线宽 0.014 / 屏沿 1.1', () => {
    expect(STAGE_COVER_INTRO_STYLE).toEqual({
      scaleFrom: 1.2,
      sweepBand: 0.26,
      sweep: 0.65,
      edgeWidth: 0.014,
      edge: 1.1,
    });
  });

  it('力度覆盖真的进绘制：`scaleFrom` 换成 2 ⇒ 半程缩放 1.125×（1.2 缺省不吃这个断言）', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, bg, 1, 1, {
      stageFrame: { cover },
      coverIntro: 0.5,
      coverIntroStyle: { scaleFrom: 2 },
    });
    // 第 0 张是背景图，第 1 张是相框封面：drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
    const args = calls.filter(([k]) => k === 'drawImage')[1]![1] as number[];
    // p = 0.5 ⇒ easeOutCubic = 0.875 ⇒ scale = 2 − (2 − 1) × 0.875 = 1.125
    expect(args[7]!).toBeCloseTo(aaoFrameRect(m).w * 1.125, 6);
  });
});

// chart-preview 42 · ADR-0018 §4：自定义图铺设计面，与 AAO / 幕布互斥。
describe('drawSimBackground · 自定义 liveFit（票 42）', () => {
  const m = fieldMetrics(1334, 750);
  const portrait = { width: 1080, height: 1920, tag: 'portrait' } as unknown as CanvasImageSource;
  const cover = { width: 600, height: 600, tag: 'cover' } as unknown as CanvasImageSource;
  const bg = { width: 2048, height: 1024, tag: 'bg' } as unknown as CanvasImageSource;

  it('cover：铺满设计面 1334×750，不走幕布矩形', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, portrait, 1, 1, { liveFit: 'cover' });
    const imgCalls = calls.filter(([k]) => k === 'drawImage');
    expect(imgCalls).toHaveLength(1);
    const args = imgCalls[0]![1] as number[];
    expect(args.slice(5)).toEqual([0, 0, 1334, 750]);
  });

  it('contain：完整显示竖图，左右留边（目标宽 < 设计面宽）', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, portrait, 1, 1, { liveFit: 'contain' });
    const args = calls.filter(([k]) => k === 'drawImage')[0]![1] as number[];
    // drawImage(img, dx, dy, dw, dh) ⇒ args[0] 是图
    expect(args[4]).toBeCloseTo(750, 5); // dh = 满高
    expect(args[3]!).toBeLessThan(1334); // dw 留边
    expect(args[2]).toBeCloseTo(0, 5);
  });

  it('liveFit 有值时不画相框（就算传了 stageFrame）', () => {
    const { proxy, calls } = recordingCtx();
    drawSimBackground(proxy, m, bg, 1, 1, { liveFit: 'cover', stageFrame: { cover } });
    const imgs = calls.filter(([k]) => k === 'drawImage').map(([_, args]) => (args as unknown[])[0]);
    expect(imgs).toEqual([bg]);
    expect(imgs).not.toContain(cover);
  });
});
