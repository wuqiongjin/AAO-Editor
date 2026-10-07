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
  fieldImageRect,
  fieldMetrics,
  playLineRect,
  SIM_BAND_COLORS,
} from '@/src/preview/video/sim/simGeometry';
import { makeRecordingCtx, propValues } from '@/tests/support/canvas';

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
  const draws: { x: number; y: number; w: number; h: number; scale: number; src: string }[] = [];
  const spriteIcon = {
    render(
      _ctx: unknown,
      props: {
        src: string; canvasX: number; canvasY: number; canvasSize: number;
        canvasWidth?: number; canvasHeight?: number; scale?: number;
      },
    ) {
      draws.push({
        x: props.canvasX,
        y: props.canvasY,
        w: props.canvasWidth ?? props.canvasSize,
        h: props.canvasHeight ?? props.canvasSize,
        scale: props.scale ?? 1,
        src: props.src,
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

describe('drawSimFrameAt · 场地三图的矩形（问题 4）', () => {
  it('场地图 / 判定线按素材的"设计 px 1:1"矩形画，不拉满画布', () => {
    const { spriteIcon } = makeRecordingSprite();
    const frame: SimFrameInput = {
      ...frameOf([single(2, 3)], spriteIcon),
      assets: {
        ...emptySimAssets(),
        missing: false,
        // 背景不给（stub 无尺寸 ⇒ `drawCover` 自己跳过这一笔，不参与断言）
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
