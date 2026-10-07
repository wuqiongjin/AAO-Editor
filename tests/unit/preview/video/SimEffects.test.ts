// 打击特效的**字面锁测**（chart-preview 21）：窗口 / 图块 / 尺寸（lane 单位 × noteSize）/ α 四样
// 逐条照 Bestdori bundle（`CommunityChartsNew.b534f9a9.js` 的 `0 === simTapEffect` 段），
// 常量在 `SIM_SPRITE_EFFECT`（`simGeometry`）；本文件锁两件事：
//   1. 表里的数字就是 bundle 誊出来的那几个（改了必红）；
//   2. `simField` 真的**按表画** —— 图块坐标 / 目标尺寸 / α / 锚点（居中 vs 底边贴线）逐笔对。
//
// 单测为什么够：出帧是纯函数，把画布换成记录替身就能看清"这一笔画在哪、多大、多透"。
// node 环境没有 DOM ⇒ 生成圆（径向渐变）那几笔走"不画"分支，图块那几笔照画（照样可断言）。
import { describe, expect, it } from 'vitest';
import type { ChartNote, SingleNote, SlideNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import type { SimSprites } from '@/src/preview/video/sim/simAssets';
import {
  buildSimChart,
  drawSimFrameAt,
  type SimFrameInput,
  type SimScene,
} from '@/src/preview/video/sim/simField';
import { emptySimAssets } from '@/src/preview/video/sim/simAssets';
import {
  easeInCubic,
  easeOutCubic,
  fieldMetrics,
  laneCenterX,
  SIM_SPRITE_EFFECT,
  SIM_SPRITE_EFFECT_DURATION,
} from '@/src/preview/video/sim/simGeometry';
import { SPRITE_TILE } from '@/src/preview/video/sim/simSprites';
import { makeRecordingCtx, type RecordedCall } from '@/tests/support/canvas';

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
  simultaneousClickLines: false,
  colorAssist: false,
  mirror: false,
});

/** 记录型精灵替身（node 没有图集：真 `CanvasSpriteIcon` 一笔都画不出来） */
function stubSpriteIcon(): CanvasSpriteIcon {
  return {
    render: () => undefined,
    renderDecorator: () => undefined,
  } as unknown as CanvasSpriteIcon;
}

/** Bestdori 自家精灵的假图（`particles.png` 1024² = 4×4 图块） */
const fakeSprites = (): SimSprites => {
  const img = (w: number, h: number) =>
    ({ width: w, height: h, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement);
  return { digits: img(720, 96), combo: img(150, 41), particles: img(1024, 1024) } as unknown as SimSprites;
};

const M = fieldMetrics(1334, 750); // laneWidth = 154，laneHeight = 615

function frameOf(notes: ChartNote[], sprites: SimSprites | null): SimFrameInput {
  const sc = scene(notes);
  return {
    scene: sc,
    chart: buildSimChart(sc, icons),
    metrics: M,
    assets: { ...emptySimAssets(), missing: false, sprites },
    noteIcons: icons,
    spriteIcon: stubSpriteIcon(),
  };
}

/** 一次 9 参 `drawImage` 的目标矩形与当时的 `globalAlpha`（源 = `particles` 才算特效图块） */
interface TileDraw {
  /** 源图块坐标（源图像素） */
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
  alpha: number;
}

function tileDraws(calls: RecordedCall[], source: unknown): TileDraw[] {
  const out: TileDraw[] = [];
  let alpha = 1;
  for (const [key, args] of calls) {
    if (key === 'globalAlpha') alpha = args[0] as number;
    if (key !== 'drawImage' || args[0] !== source || args.length < 9) continue;
    out.push({
      sx: args[1] as number,
      sy: args[2] as number,
      dx: args[5] as number,
      dy: args[6] as number,
      w: args[7] as number,
      h: args[8] as number,
      alpha,
    });
  }
  return out;
}

/** 图块 (col,row) 的源坐标（node 无 DOM ⇒ 不染，直接取原图子矩形） */
const at = (col: number, row: number) => ({ sx: col * SPRITE_TILE, sy: row * SPRITE_TILE });
const px = (lanes: number) => lanes * M.laneWidth;

const recordingCtx = () => makeRecordingCtx({ createLinearGradient: () => ({ addColorStop: () => undefined }) });

/** 默认 120 BPM：beat 2 = 1s */
const HIT = 1;

describe('SIM_SPRITE_EFFECT · 表里的数字（照 bundle 誊）', () => {
  const { window: W, tile: T, size: S, alpha: A } = SIM_SPRITE_EFFECT;

  it('窗口：光柱 0.4 / 圆与环 0.6 / 白圆 0.3 / 方向键斜扫 0.2', () => {
    expect(W.beam).toBe(0.4);
    expect(W.circle).toBe(0.6);
    expect(W.white).toBe(0.3);
    expect(W.flickCircle).toBe(0.2);
    expect(W.dirSweep).toBe(0.2);
    expect(W.dirArrow).toBe(0.6);
    expect(SIM_SPRITE_EFFECT_DURATION).toBe(0.6); // 扫描窗口 = 最长那一笔
  });

  it('图块：beam(0,0) / slot(1,0) / ring(2,0) / skillBeam(3,0) / star(0,1) / arrow(1,1) / 连按(2,1)(3,1)', () => {
    expect(T.beam).toEqual([0, 0]);
    expect(T.slot).toEqual([1, 0]);
    expect(T.ring).toEqual([2, 0]);
    expect(T.skillBeam).toEqual([3, 0]);
    expect(T.star).toEqual([0, 1]);
    expect(T.arrow).toEqual([1, 1]);
    expect(T.connectionRing).toEqual([2, 1]);
    expect(T.rotatingRing).toEqual([3, 1]);
  });

  it('尺寸：光柱 1.33×2、槽 1、圆 2.25×1.5、环 3×2 与 2.4×1.6、技能光柱 0.6×1.5、连按环 1.8×1.2', () => {
    expect(S.beam).toEqual([1.33, 2]);
    expect(S.slot).toBe(1);
    expect(S.circle).toEqual([2.25, 1.5]);
    expect(S.ring).toEqual([3, 2]);
    expect(S.ringInner).toEqual([2.4, 1.6]);
    expect(S.skillBeam).toEqual([0.6, 1.5]);
    expect(S.star).toEqual([2.25, 1.5]);
    expect(S.flickCircleW).toBe(1.5);
    expect(S.flickCircleH).toBe(2);
    expect(S.dirSweep).toEqual([1.5, 4]);
    expect(S.connectionRing).toEqual([1.8, 1.2]);
    expect(S.rotatingRingInner).toBe(0.75);
  });

  it('α 峰值：光柱 1 / 圆与白圆 0.5 / 环 0.8 / 连按 1', () => {
    expect(A.beam).toBe(1);
    expect(A.circle).toBe(0.5);
    expect(A.white).toBe(0.5);
    expect(A.ring).toBe(0.8);
    expect(A.connection).toBe(1);
  });
});

/** 同一份 sprites 才能按源比对：每次都新建会让 `args[0]` 对不上 */
const sprites = fakeSprites();

describe('drawSimFrameAt · tap（滑条结点同款）', () => {
  const frame = () => frameOf([single(2, 3)], sprites);

  it('命中后 0.2s：光柱（底边贴线）+ 槽 + 双环', () => {
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame(), HIT + 0.2);
    const draws = tileDraws(calls, sprites.particles);

    const p = 0.2 / SIM_SPRITE_EFFECT.window.beam;
    const pe = 0.2 / SIM_SPRITE_EFFECT.window.circle;
    const e = easeOutCubic(pe);
    expect(draws).toHaveLength(4);

    // 光柱 (0,0)：底边贴判定线（`dy + h = laneHeight`）、1.33n × 2n、α = 1 − easeIn(0.5)
    const beam = draws[0]!;
    expect(beam.sx).toBe(at(0, 0).sx);
    expect(beam.sy).toBe(at(0, 0).sy);
    expect(beam.w).toBeCloseTo(px(1.33), 6);
    expect(beam.h).toBeCloseTo(px(2), 6);
    expect(beam.dy + beam.h).toBeCloseTo(M.laneHeight, 6);
    expect(beam.alpha).toBeCloseTo(1 - easeInCubic(p), 6);

    // 槽 (1,0)：居中于命中点、1n × 1n、同一个 α
    const slot = draws[1]!;
    expect([slot.sx, slot.sy]).toEqual([at(1, 0).sx, at(1, 0).sy]);
    expect(slot.w).toBeCloseTo(px(1), 6);
    expect(slot.h).toBeCloseTo(px(1), 6);
    expect(slot.dy + slot.h / 2).toBeCloseTo(M.laneHeight, 6);
    expect(slot.alpha).toBeCloseTo(1 - easeInCubic(p), 6);

    // 双环 (2,0)：3e × 2e 与 2.4e × 1.6e，α = 0.8(1 − easeIn(p))
    const ringA = draws[2]!;
    const ringB = draws[3]!;
    expect([ringA.sx, ringA.sy]).toEqual([at(2, 0).sx, at(2, 0).sy]);
    expect(ringA.w).toBeCloseTo(px(3) * e, 6);
    expect(ringA.h).toBeCloseTo(px(2) * e, 6);
    expect(ringB.w).toBeCloseTo(px(2.4) * e, 6);
    expect(ringB.h).toBeCloseTo(px(1.6) * e, 6);
    expect(ringA.alpha).toBeCloseTo(0.8 * (1 - easeInCubic(pe)), 6);
    expect(ringB.alpha).toBeCloseTo(0.8 * (1 - easeInCubic(pe)), 6);
  });

  it('光柱 / 槽 0.4s 后收手，环留到 0.6s', () => {
    const mid = recordingCtx();
    drawSimFrameAt(mid.proxy, frame(), HIT + 0.5);
    expect(tileDraws(mid.calls, sprites.particles).map((d) => [d.sx, d.sy]))
      .toEqual([[at(2, 0).sx, at(2, 0).sy], [at(2, 0).sx, at(2, 0).sy]]);

    const over = recordingCtx();
    drawSimFrameAt(over.proxy, frame(), HIT + 0.7);
    expect(tileDraws(over.calls, sprites.particles)).toEqual([]);
  });

  it('滑条结点按 Bestdori 走 tap（不是自造的绿）', () => {
    const { proxy, calls } = recordingCtx();
    const slideFrame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 3 }])], sprites);
    drawSimFrameAt(proxy, slideFrame, HIT + 0.2); // 起点结点刚命中
    expect(tileDraws(calls, sprites.particles).some((d) => d.sx === at(0, 0).sx && d.sy === 0)).toBe(true);
  });
});

describe('drawSimFrameAt · flick / skill', () => {
  it('flick：槽（0.4s）+ 环（0.6s），环尺寸 3e × 2e', () => {
    const frame = frameOf([single(2, 3, { flick: true })], sprites);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, HIT + 0.5); // 过了槽的窗口，环还在（flick 只有**一枚**环，双环是 tap 的）
    const draws = tileDraws(calls, sprites.particles);
    expect(draws).toHaveLength(1);
    const e = easeOutCubic(0.5 / SIM_SPRITE_EFFECT.window.circle);
    expect([draws[0]!.sx, draws[0]!.sy]).toEqual([at(2, 0).sx, at(2, 0).sy]);
    expect(draws[0]!.w).toBeCloseTo(px(3) * e, 6);
    expect(draws[0]!.alpha).toBeCloseTo(0.8 * (1 - easeInCubic(0.5 / SIM_SPRITE_EFFECT.window.circle)), 6);

    const early = recordingCtx();
    drawSimFrameAt(early.proxy, frame, HIT + 0.1);
    const p = 0.1 / SIM_SPRITE_EFFECT.window.beam;
    expect(tileDraws(early.calls, sprites.particles).some(
      (d) => d.sx === at(1, 0).sx && d.sy === 0 && Math.abs(d.alpha - (1 - easeInCubic(p))) < 1e-9,
    )).toBe(true);
  });

  it('skill：技能光柱（0.6×1.5，底边贴线）+ 槽 + 星 + 环', () => {
    const frame = frameOf([single(2, 3, { skill: true })], sprites);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, HIT + 0.2);
    const draws = tileDraws(calls, sprites.particles);
    expect(draws).toHaveLength(4);
    const beam = draws[0]!;
    expect([beam.sx, beam.sy]).toEqual([at(3, 0).sx, at(3, 0).sy]);
    expect(beam.w).toBeCloseTo(px(0.6), 6);
    expect(beam.h).toBeCloseTo(px(1.5), 6);
    expect(beam.dy + beam.h).toBeCloseTo(M.laneHeight, 6);
    const star = draws[2]!;
    expect([star.sx, star.sy]).toEqual([at(0, 1).sx, at(0, 1).sy]);
    const e = easeOutCubic(0.2 / SIM_SPRITE_EFFECT.window.circle);
    expect(star.w).toBeCloseTo(px(2.25) * e, 6);
    expect(star.h).toBeCloseTo(px(1.5) * e, 6);
  });
});

describe('drawSimFrameAt · 方向键与连按', () => {
  it('方向键箭头：外移 1 lane、转 ±π/2、**底边贴判定线**', () => {
    const frame = frameOf([{ type: 'LDirectional', beat: 2, lane: 3, length: 1 } as ChartNote], sprites);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, HIT + 0.3); // 斜扫（0.2s）已过，箭头（0.6s）还在
    const draws = tileDraws(calls, sprites.particles);
    const arrow = draws.find((d) => d.sy === at(1, 1).sy);
    expect(arrow).toBeTruthy();
    // 底边贴线：`dy + h = 0`（局部坐标里判定线 = 0；居中会是 `dy + h/2 = 0`）
    expect(arrow!.dy + arrow!.h).toBeCloseTo(0, 6);
    expect(arrow!.w).toBeCloseTo(px(1), 6);
    expect(arrow!.h).toBeCloseTo(px(1), 6);
    const rotates = calls.filter(([k]) => k === 'rotate').map(([, a]) => a[0] as number);
    expect(rotates.some((r) => Math.abs(Math.abs(r) - Math.PI / 2) < 1e-9)).toBe(true);
  });

  it('连按（带体按住）：段内插值轨位上画 connectionRing(2,1) + 对转双环(3,1)', () => {
    // 带体 1s（lane 3）→ 2s（lane 5）：t = 1.5s ⇒ 按住点在 lane 4
    const frame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 5 }])], sprites);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 1.5);
    const draws = tileDraws(calls, sprites.particles);
    const ring = draws.find((d) => d.sx === at(2, 1).sx && d.sy === at(2, 1).sy);
    const rotating = draws.filter((d) => d.sx === at(3, 1).sx && d.sy === at(3, 1).sy);

    expect(ring).toBeTruthy();
    expect(ring!.w).toBeCloseTo(px(1.8), 6);
    expect(ring!.h).toBeCloseTo(px(1.2), 6);
    // 居中于判定线上的插值轨位（lane 4）
    expect(ring!.dx + ring!.w / 2).toBeCloseTo(laneCenterX(M, 4, 1), 6);
    expect(ring!.dy + ring!.h / 2).toBeCloseTo(M.laneHeight, 6);
    expect(ring!.alpha).toBe(1);

    // 旋转环：2·laneWidth × 4/3·laneWidth 与它的 0.75 倍，α 恒 1
    expect(rotating).toHaveLength(2);
    expect(rotating[0]!.w).toBeCloseTo(2 * M.laneWidth, 6);
    expect(rotating[0]!.h).toBeCloseTo((4 / 3) * M.laneWidth, 6);
    expect(rotating[1]!.w).toBeCloseTo(2 * M.laneWidth * 0.75, 6);
    expect(rotating[0]!.alpha).toBe(1);

    // 松手（过了段终点）就不再画
    const after = recordingCtx();
    drawSimFrameAt(after.proxy, frame, 2.5);
    expect(tileDraws(after.calls, sprites.particles).filter((d) => d.sy === at(2, 1).sy)).toEqual([]);
  });

  it('连按只在"正被按住"的那一段给：段起点之前不画', () => {
    const frame = frameOf([slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 5 }])], sprites);
    const { proxy, calls } = recordingCtx();
    drawSimFrameAt(proxy, frame, 0.5); // 还没到起点
    expect(tileDraws(calls, sprites.particles).filter((d) => d.sy === at(2, 1).sy)).toEqual([]);
  });
});
