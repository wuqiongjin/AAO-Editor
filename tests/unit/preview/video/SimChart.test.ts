// 仿真场派生表与一帧绘制（chart-preview 05 的锁测②）。
// 锁「口径一致」（票面「复用与边界」）那几条：`beat < 0` 不渲染 / 不计 combo（ADR-0014）、
// 带体取点走 `displayConnections` 同一显示投影（ADR-0009 §2.2）、倒流区不另立一套（ADR-0010）、
// combo 与键音同一份事件表（`AudioTiming.buildKeyEvents`）、镜向含方向箭头翻面。
import { describe, expect, it } from 'vitest';
import type { ChartNote, SingleNote, SlideNote } from '@/src/chart/types';
import { beatToSeconds, getBpmEvents } from '@/src/audio/AudioTiming';
import { comboNodePreciseBeats } from '@/src/chart/editing/NoteEditing';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import {
  buildSimChart,
  drawSimFrameAt,
  simComboAt,
  SIM_FALLBACK_BG,
  type SimChart,
  type SimFrameInput,
  type SimScene,
} from '@/src/preview/video/sim/simField';
import { emptySimAssets } from '@/src/preview/video/sim/simAssets';
import { fieldMetrics } from '@/src/preview/video/sim/simGeometry';
import { fillTexts, makeRecordingCtx, propValues } from '@/tests/support/canvas';

const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));
const spriteIcon = new CanvasSpriteIcon();

const single = (beat: number, lane: number, extra: Partial<SingleNote> = {}): SingleNote => ({
  type: 'Single', beat, lane, ...extra,
});
type ConnSpec = { beat: number; lane: number; hidden?: boolean; flick?: boolean };
const slide = (points: ConnSpec[]): SlideNote => ({ type: 'Slide', connections: points.map((p) => ({ ...p })) });

const scene = (notes: ChartNote[], over: Partial<SimScene> = {}): SimScene => ({
  notes,
  beatDisplay: 4,
  noteSpeed: 9.5,
  noteSize: 1,
  slideOpacity: 0.8,
  simultaneousClickLines: true,
  colorAssist: false,
  mirror: false,
  ...over,
});

const chartOf = (notes: ChartNote[], over: Partial<SimScene> = {}): SimChart => buildSimChart(scene(notes, over), icons);

const frameOf = (notes: ChartNote[], over: Partial<SimScene> = {}): SimFrameInput => {
  const sceneInput = scene(notes, over);
  return {
    scene: sceneInput,
    chart: buildSimChart(sceneInput, icons),
    metrics: fieldMetrics(1334, 750),
    assets: emptySimAssets(),
    noteIcons: icons,
    spriteIcon,
  };
};

/** 带渐变替身的记录型假 ctx（自绘特效会建线性渐变） */
const recordingCtx = () => makeRecordingCtx({ createLinearGradient: () => ({ addColorStop: () => undefined }) });

describe('buildSimChart · 元素表', () => {
  it('单键：beat → 秒（默认 120 BPM，半秒一拍）、标记 → 击打样式', () => {
    const c = chartOf([single(4, 3), single(2, 0, { flick: true }), single(1, 6, { skill: true })]);
    expect(c.elements.map((e) => e.time)).toEqual([0.5, 1, 2]);
    expect(c.elements.map((e) => e.kind)).toEqual(['skill', 'flick', 'tap']);
    expect(c.elements.map((e) => e.lane)).toEqual([6, 0, 3]);
  });

  it('beat < 0 的击打物不渲染、不键音，但**计 combo**（开播即已过线，ADR-0014 / CONTEXT「负 beat 击打物」）', () => {
    const c = chartOf([single(-1, 3), single(0, 3)]);
    expect(c.elements).toHaveLength(1); // 只画 beat 0 那颗
    expect(c.hitTimes).toEqual([-0.5, 0]); // 负 beat 的时刻是负数
    expect(simComboAt(c, 0)).toBe(2); // 开播那一刻两颗都算
    expect(simComboAt(c, 10)).toBe(2);
  });

  it('BPM / System 不入元素表（不渲染不发声）', () => {
    const c = chartOf([{ type: 'BPM', beat: 0, bpm: 180 }, { type: 'System', beat: 0, data: 'cmd_fever_ready' }, single(1, 0)]);
    expect(c.elements).toHaveLength(1);
    expect(c.elements[0]!.time).toBeCloseTo(1 / 3); // 180 BPM → 每拍 1/3 秒
  });

  it('方向键：整组覆盖轨道（本体数 = ceil(length)）+ 侧别', () => {
    const c = chartOf([{ type: 'RDirectional', beat: 0, lane: 2, length: 3 }]);
    expect(c.elements[0]!.kind).toBe('directional');
    expect(c.elements[0]!.dirSide).toBe('R');
    expect(c.elements[0]!.dirLanes).toEqual([2, 3, 4]);
  });

  it('方向键长度取原值：本体数 ceil，长度本身留给外侧箭头定位（源数据允许小数，ADR-0014 §3）', () => {
    const c = chartOf([{ type: 'RDirectional', beat: 0, lane: 2, length: 2.5 }]);
    expect(c.elements[0]!.length).toBe(2.5); // 给 dirGroup：箭头按 (length − 1) 条轨道落位
    expect(c.elements[0]!.dirLanes).toEqual([2, 3, 4]); // ceil(2.5) = 3 条本体
  });

  it('镜向：车道对调 + 方向箭头翻面（整组覆盖的轨道集合不变）', () => {
    const c = chartOf([{ type: 'RDirectional', beat: 0, lane: 2, length: 3 }, single(0, 1)], { mirror: true });
    const dir = c.elements.find((e) => e.kind === 'directional')!;
    const tap = c.elements.find((e) => e.kind === 'tap')!;
    expect(dir.dirSide).toBe('L');
    expect([...dir.dirLanes!].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(tap.lane).toBe(5);
  });
});

describe('buildSimChart · 滑条与带体', () => {
  it('hidden 中间结点不画图标，但带体照走它的走序（SP 曲线就是这些采样点）', () => {
    const c = chartOf([slide([{ beat: 0, lane: 3 }, { beat: 1, lane: 5, hidden: true }, { beat: 2, lane: 6 }])]);
    expect(c.elements).toHaveLength(2); // 只有两个可见端点
    expect(c.elements.map((e) => e.lane)).toEqual([3, 6]);
    expect(c.bands).toHaveLength(2); // 经 hidden 结点的两段
    expect(c.bands.map((b) => [b.lane0, b.lane1])).toEqual([[3, 5], [5, 6]]);
    expect(c.bands.every((b) => b.sp)).toBe(true); // 含 hidden → 整条传染 SP（ADR-0009 §5）
  });

  it('带体取点走显示投影：非单调点序按 beat 稳定排序后铺（数据原样不动）', () => {
    const c = chartOf([slide([{ beat: 0, lane: 3 }, { beat: 2, lane: 5 }, { beat: 1, lane: 2 }])]);
    expect(c.bands.map((b) => [b.lane0, b.lane1])).toEqual([[3, 2], [2, 5]]);
    expect(c.bands.map((b) => [b.t0, b.t1])).toEqual([[0, 0.5], [0.5, 1]]);
  });

  it('全 hidden 的滑条：画布上没有任何效果（元素与带体都空，数据保留）', () => {
    const c = chartOf([slide([{ beat: 0, lane: 3, hidden: true }, { beat: 1, lane: 4, hidden: true }])]);
    expect(c.elements).toEqual([]);
    expect(c.bands).toEqual([]);
  });

  it('带体按谱面数组序、同一条滑条一个分组（issue 46：后放置者在上）', () => {
    const c = chartOf([
      // 先放但更晚的滑条（2s → 3s）
      slide([{ beat: 4, lane: 0 }, { beat: 6, lane: 6 }]),
      // 后放但更早的滑条（0s → 1s）：旧实现按进场时刻重排会把两条的上下关系翻过来
      slide([{ beat: 0, lane: 0 }, { beat: 2, lane: 6 }]),
    ]);
    expect(c.bands.map((b) => [b.t0, b.t1])).toEqual([[2, 3], [0, 1]]);
    expect(c.bands.map((b) => b.slide)).toEqual([0, 1]);
  });

  it('combo 走画布那份枚举（单键/方向键各 1、滑条逐非 hidden 结点；BPM / System 不计）', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      single(1, 0),
      slide([{ beat: 2, lane: 3 }, { beat: 3, lane: 5, hidden: true }, { beat: 4, lane: 6 }]),
      single(-2, 1),
    ];
    const c = chartOf(notes);
    // 与 `NoteEditing.comboNodePreciseBeats` 同一枚举（折成秒、按播放时钟排序）
    const bpm = getBpmEvents(notes);
    expect(c.hitTimes).toEqual(
      comboNodePreciseBeats(notes, 4).map((b) => beatToSeconds(bpm, b)).sort((a, b) => a - b),
    );
    expect(simComboAt(c, 0.4)).toBe(1); // 负 beat 那颗（beat −2 → −1s）开播即已过线
    expect(simComboAt(c, 0.5)).toBe(2);
    expect(simComboAt(c, 2)).toBe(4); // beat 4 = 2s；hidden 那一点不计数
  });
});

describe('buildSimChart · 倒流区（ADR-0010）', () => {
  // beat 4 起一条负 BPM（−120，每拍回退 0.5 秒）到 beat 8 恢复：
  // beat 0 → 0s、beat 4 → 2s、beat 6 → 1s、beat 8 → 0s（布局轴折返）
  const backflow: ChartNote[] = [
    { type: 'BPM', beat: 0, bpm: 120 },
    { type: 'BPM', beat: 4, bpm: -120 },
    { type: 'BPM', beat: 8, bpm: 120 },
    slide([{ beat: 5, lane: 3 }, { beat: 6, lane: 5 }, { beat: 7, lane: 2 }]),
    single(6, 0),
  ];

  it('折返带的两端时刻照实折返（不排序、不重写时间）', () => {
    const c = chartOf(backflow);
    // 滑条三点 beat 5 / 6 / 7 → 1.5s / 1s / 0.5s：带子两段的上下关系随折返反过来
    // （带表按**谱面数组序**，故 1.5→1 那一段在前；绘制序 = 后放置者在上，见 issue 46）
    expect(c.bands.map((b) => [b.t0, b.t1])).toEqual([[1.5, 1], [1, 0.5]]);
    // 元素按**播放时钟**升序排（折返层里先到的是 beat 7 那一点）
    expect(c.elements.map((e) => e.time)).toEqual([0.5, 1, 1, 1.5]);
  });

  it('combo 仍按播放时钟（只增不减）：每个元素只算一次通过', () => {
    const c = chartOf(backflow);
    const bpm = getBpmEvents(backflow);
    expect(c.hitTimes).toEqual(
      comboNodePreciseBeats(backflow, 4).map((b) => beatToSeconds(bpm, b)).sort((a, b) => a - b),
    );
    // 1.2s 前已过线三件：滑条 beat 7（0.5s）、滑条 beat 6 与单键 beat 6（各 1s）
    expect(simComboAt(c, 1.2)).toBe(3);
    expect(simComboAt(c, 1.6)).toBe(4);
  });
});

describe('buildSimChart · 同时点击线', () => {
  it('同拍（同 tick）一组、按 lane 升序；滑条端点参与、hidden 中间结点不参与', () => {
    const c = chartOf([
      single(2, 5),
      single(2, 1),
      slide([{ beat: 2, lane: 3 }, { beat: 2, lane: 4, hidden: true }, { beat: 3, lane: 4 }]),
    ]);
    expect(c.simultaneous).toHaveLength(1);
    expect(c.simultaneous[0]!.lanes).toEqual([1, 3, 5]);
    expect(c.simultaneous[0]!.time).toBe(1);
  });

  it('单点不成组（长度 < 2 不画）', () => {
    expect(chartOf([single(1, 3)]).simultaneous).toEqual([]);
  });

  it('subBeat 折算进同拍判定（beat + subBeat/beatDisplay 同值即成组）', () => {
    const c = chartOf([single(1, 0), single(0, 1, { subBeat: 4 })]);
    expect(c.simultaneous).toHaveLength(1);
    expect(c.simultaneous[0]!.lanes).toEqual([0, 1]);
  });
});

describe('drawSimFrameAt · 一帧绘制', () => {
  it('缺素材也照画一帧（场地底色 + 音符层 + 特效 + combo），任意秒都不抛错', () => {
    const f = frameOf([single(2, 3), slide([{ beat: 2, lane: 3 }, { beat: 4, lane: 5, hidden: true }, { beat: 6, lane: 1 }])]);
    const { proxy, calls } = recordingCtx();
    for (const seconds of [0, 0.5, 1.2, 2, 2.05, 3, 3.2, 10]) {
      expect(() => drawSimFrameAt(proxy, f, seconds)).not.toThrow();
    }
    expect(propValues(calls, 'fillStyle')).toContain(SIM_FALLBACK_BG); // 场地底色铺满
    expect(fillTexts(calls).map(([, [text]]) => text)).toContain('COMBO'); // HUD 是自绘文本
  });

  it('combo 只数已过线的：命中前不写，命中后写当前值', () => {
    const f = frameOf([single(1, 3), single(2, 0)]);
    const before = recordingCtx();
    drawSimFrameAt(before.proxy, f, 0.4);
    expect(fillTexts(before.calls)).toHaveLength(0);

    const after = recordingCtx();
    drawSimFrameAt(after.proxy, f, 1.6);
    expect(fillTexts(after.calls).map(([, [text]]) => text)).toEqual(['2', 'COMBO']);
  });
});
