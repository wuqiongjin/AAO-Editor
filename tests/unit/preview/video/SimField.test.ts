// 仿真场一帧的"画在哪儿"（chart-preview 18）：两条硬 bug 的回归网 ——
//   问题 5：可见窗口取反（`[seconds − T, seconds]`）⇒ 音符除"正好压线"外一个都不画；
//   问题 4：场地图 / 判定线拉满画布 ⇒ 素材自带的轨道标记与车道线跟音符错位（应"设计 px 1:1"）。
//
// 单测为什么够：出帧是纯函数（`drawSimFrameAt(ctx, frame, seconds)`）——把精灵换成记录替身，
// 就能看清"这一秒画了哪些元素、画在哪个矩形"；**光栅观感**仍归 `scripts/sim-shot.mjs` 的位图人工核对。
import { describe, expect, it } from 'vitest';
import type { ChartNote, SingleNote, SlideNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import type { SimSprites } from '@/src/preview/video/sim/simAssets';
import {
  buildSimChart,
  drawSimFrameAt,
  SIM_FALLBACK_BG,
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
  SIM_BAND_COLORS,
} from '@/src/preview/video/sim/simGeometry';
import { makeRecordingCtx, propValues, type RecordedCall } from '@/tests/support/canvas';

const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));

const single = (beat: number, lane: number, extra: Partial<SingleNote> = {}): SingleNote => ({
  type: 'Single', beat, lane, ...extra,
});
const slide = (points: { beat: number; lane: number }[]): SlideNote => ({
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

function frameOf(notes: ChartNote[], spriteIcon: CanvasSpriteIcon): SimFrameInput {
  return {
    scene: scene(notes),
    chart: buildSimChart(scene(notes), icons),
    metrics: fieldMetrics(1334, 750),
    assets: emptySimAssets(),
    noteIcons: icons,
    spriteIcon,
  };
}

const recordingCtx = () => makeRecordingCtx({ createLinearGradient: () => ({ addColorStop: () => undefined }) });

/** 默认 120 BPM：beat → 秒 = beat / 2；T = (12 − noteSpeed)/2 = 1.25s */
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
    const approaching = recordingCtx();
    drawSimFrameAt(approaching.proxy, frame, 1.5); // 带体末端 2s（还没过线）
    expect(propValues(approaching.calls, 'fillStyle')).toContain(SIM_BAND_COLORS.band);
    const passed = recordingCtx();
    drawSimFrameAt(passed.proxy, frame, 2.5); // 整段已过线
    expect(propValues(passed.calls, 'fillStyle')).not.toContain(SIM_BAND_COLORS.band);
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

/** 帧里**最先**那批路径命令（`fillPolys`：一个四边形 = moveTo + 3×lineTo）——带体排在音符 / 特效之前 */
function firstVertices(calls: RecordedCall[]): { x: number; y: number }[] {
  return calls
    .filter(([k]) => k === 'moveTo' || k === 'lineTo')
    .slice(0, 4)
    .map(([, args]) => ({ x: args[0] as number, y: args[1] as number }));
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
      const { proxy, calls } = recordingCtx();
      drawSimFrameAt(proxy, frame, seconds);
      const vertices = firstVertices(calls);
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
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1); // 同刻两点：这一秒正好双双压线

    const vertices = firstVertices(calls);
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

    const bandX = aEdgeCenterX(firstVertices(calls));
    expect(bandX).toBeCloseTo(laneX(2.8), 4);
    // 按住环 = 连按特效那枚 `connectionRing`（图像 = particles，左缘为正 —— 另两枚旋转环以 0,0 为中心）
    const ring = calls.find(([k, args]) =>
      k === 'drawImage' && args[0] === sprites.particles && (args[5] as number) > 0)!;
    const ringX = (ring[1][5] as number) + (ring[1][7] as number) / 2;
    expect(ringX).toBeCloseTo(bandX, 6);
  });
});

describe('drawSimFrameAt · 音符盒子 / 同时点击线 / 背景取景（票 23 #2）', () => {
  it('音符按精灵源格的自然比画：高/宽 = 120/308（修前吃设计盒的 36:21.6 = 1.667）', () => {
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

  it('方向键本体也走精灵源格比（同单键一个盒子口径，只差设计宽 45）', () => {
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

  it('同时点击线：一组一根跨全程（端点轨之间），粗细走 0.118 系数（修前逐 gap 一根 / 0.3 粗）', () => {
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

  it('方向键本体**逐轨**取图（票 25 #1：图集 0..6 各自带该轨位的舞台倾角）', () => {
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

  it('按住期间接触点画**滑条端点**（票 25 #2：bundle 漏誊的那段 `y.forEach`）', () => {
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
});
