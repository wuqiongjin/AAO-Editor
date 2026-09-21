// issue 105 · 倒流区渲染与视觉（权威 = ADR-0010 结论 11 / ADR-0009 §5）。
//
// 票面的三条 **Playwright 像素实测**已按 issue 104 先例转为**手工验收**（清单见
// `.scratch/basic-editor/issues/105-倒流区渲染与视觉.md`），故本文件把能在 node 环境钉死的
// 渲染口径逐条锁住：
//   ① 修法 1 —— 负值（倒流区）BPM **数值**换色，且**只换数值**（BPM 横线仍走主题主色）；
//   ② 修法 2 —— 网格 / BPM 线按**各自布局坐标**逐元素求 y：折返带上同一纵向区间被多层经过时
//      "向上层 + 回程层 + 再向上层"的线都画得出来（无单调假定）；
//   ③ 修法 3 —— 折返自叠走 `splitBandAtFolds` + 逐行光栅（ADR-0009 §5 触发条件 =「布局折返」），
//      自叠处 source-over 只增不减（叠亮）→ 零黑线洞；
//   ④ 末尾附静态源码断言（照 BackflowGeometry / EditorAudioSessionRefactor 惯例）。
// 测试谱 = ADR-0010 附录 B 的加陡版（与 `BackflowGeometry.test.ts` 同谱）：
//   `[{beat:0,bpm:120}, {beat:5,bpm:-240}, {beat:6.5,bpm:120}]`
//   → pos: beat5 = 1100（折返带顶）／beat6 = 990（回程层）／beat7 = 1045（再向上层）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { renderBpmLabels, renderBpmLines, renderBoundLines, renderGrid, END_TEXT_COLOR } from '@/src/visual/render';
import { rasterBandRuns, splitBandAtFolds, type BandRaster, type BandPoint } from '@/src/visual/slideBandGeometry';
import { gridBpmNegativeColor, gridThemeBpmColor } from '@/src/visual/gridStyle';
import type { BpmTimelineEvent } from '@/src/chart/geometry/BpmTimeline';
import type { ChartNote } from '@/src/chart/types';
import type { RenderCtx } from '@/src/visual/types';
import { makeRecordingCtx, fillTexts, type RecordedCall } from '@/tests/support/canvas';
import { repoRoot } from '@/tests/support/source';

const FOLD: BpmTimelineEvent[] = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -240 }, { beat: 6.5, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const DURATION = 2.5; // 谱面长度 = t(5) = t(7.25)：折返带顶
const BEAT_DISPLAY = 4;
/** scrollY=700 时折返带（虚拟Y 900–1065）落在画布 y ∈ [200, 365]，三层全部可见 */
const VIEWPORT = { scrollX: 0, scrollY: 700, scale: 1 };

const bpmNote = (beat: number, bpm: number): ChartNote => ({ type: 'BPM', beat, bpm } as ChartNote);

function makeRig(notes: ChartNote[] = []) {
  const geometry = new ChartGeometry(FOLD, { seconds: DURATION }, SURFACE);
  const viewport = { ...VIEWPORT };
  const c = makeCoords(geometry, viewport, BEAT_DISPLAY, notes);
  const rc = {
    geometry, viewport, surface: SURFACE, chartEndBeat: geometry.chartEndBeat, beatDisplay: BEAT_DISPLAY,
    notes,
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
  } as unknown as RenderCtx;
  return { geometry, viewport, c, rc };
}

/** fillText 序列：文本 + 该次绘制生效的 fillStyle（drawGutterLabel 先设色后写字） */
function labeledFills(calls: RecordedCall[]): { text: string; color: string }[] {
  const out: { text: string; color: string }[] = [];
  let color = '';
  for (const [k, args] of calls) {
    if (k === 'fillStyle') color = String(args[0]);
    else if (k === 'fillText') out.push({ text: String(args[0]), color });
  }
  return out;
}

describe('issue 105 修法 1 · 负值 BPM 数值换色（倒流区唯一视觉标识）', () => {
  it('正/负事件并排：正值走主题主色、负值走该主题的倒流色；文字保留负号（原样）', () => {
    const positive = bpmNote(5, 120);   // pos 1100 → 画布 y 200
    const negative = bpmNote(6.5, -240); // pos 935 → 画布 y 365
    const { c, rc } = makeRig([positive, negative]);
    const { proxy, calls } = makeRecordingCtx();
    renderBpmLabels(proxy, c, rc, [{ note: positive, index: 0 }, { note: negative, index: 1 }]);
    expect(labeledFills(calls)).toEqual([
      { text: '120', color: gridThemeBpmColor('vivid') },
      { text: '-240', color: gridBpmNegativeColor('vivid') },
    ]);
    expect(fillTexts(calls).length).toBe(2);
  });

  it('负值色随主题走（每个主题都取自己的倒流色，不是写死的品红）', () => {
    const negative = bpmNote(6.5, -240);
    for (const gridStyle of ['mono', 'amber', 'cyan', 'vivid'] as const) {
      const { geometry, viewport, c } = makeRig([negative]);
      const rc = {
        geometry, viewport, surface: SURFACE, chartEndBeat: geometry.chartEndBeat, beatDisplay: BEAT_DISPLAY,
        notes: [negative],
        display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1, gridStyle },
      } as unknown as RenderCtx;
      const { proxy, calls } = makeRecordingCtx();
      renderBpmLabels(proxy, c, rc, [{ note: negative, index: 0 }]);
      expect(labeledFills(calls)[0]!.color).toBe(gridBpmNegativeColor(gridStyle));
    }
  });

  it('换色**不扩到 BPM 横线**（票面口径）：横线仍按主题主色画，位置 = 各自布局坐标', () => {
    const onDescending = bpmNote(6, -240); // 回程层 pos 990 → y 310
    const onAscending = bpmNote(7, 120);   // 再向上层 pos 1045 → y 255
    const { c, rc } = makeRig([onDescending, onAscending]);
    const { proxy, calls } = makeRecordingCtx();
    renderBpmLines(proxy, c, rc, [{ note: onDescending, index: 0 }, { note: onAscending, index: 1 }]);
    const strokes = calls.filter(([k]) => k === 'strokeStyle').map(([, v]) => v[0]);
    expect(strokes).toEqual([gridThemeBpmColor('vivid'), gridThemeBpmColor('vivid')]);
    const ys = calls.filter(([k]) => k === 'moveTo').map(([, v]) => v[1] as number);
    expect(ys).toEqual([310, 255]);
    // 同一折返带上"回程层的线"在画布上比"再向上层的线"更低（y 更大）——逆序排列是保真，不是故障
    expect(ys[0]).toBeGreaterThan(ys[1]!);
  });
});

describe('issue 105 修法 2 · 网格线按各自布局坐标逐拍求 y（允许折返重叠）', () => {
  /** 渲染网格并收集横线：按 trackBgX 起点的 moveTo → lineWidth → stroke 配对 */
  function gridStrokes() {
    const { c, rc } = makeRig();
    const { proxy, calls } = makeRecordingCtx();
    renderGrid(proxy, c, rc);
    const trackBgX = c.trackGeometry(1).trackBgX;
    const out: { y: number; width: number }[] = [];
    let width = 0;
    let pendingX: number | null = null;
    let pendingY: number | null = null;
    for (const [k, args] of calls) {
      if (k === 'lineWidth') width = args[0] as number;
      else if (k === 'moveTo') { pendingX = args[0] as number; pendingY = args[1] as number; }
      else if (k === 'stroke' && pendingY !== null && pendingX === trackBgX) {
        out.push({ y: pendingY, width });
        pendingX = null;
        pendingY = null;
      }
    }
    return { out, c };
  }

  it('折返带三层各自的整拍线都画出来（旧实现按 beat 窗口反推只会剩一层）', () => {
    const { out, c } = gridStrokes();
    const beatYs = out.filter((s) => s.width === 2).map((s) => s.y);
    const yOf = (beat: number) => c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    // 折返带内三个整拍：beat5（顶）／beat6（回程层，比 beat5 低）／beat7（再向上层，比 beat6 高）
    for (const beat of [5, 6, 7]) {
      expect(beatYs.some((y) => Math.abs(y - yOf(beat)) < 1e-6)).toBe(true);
    }
    expect(yOf(6)).toBeGreaterThan(yOf(7)); // 拍序 6 → 7，画布 y 却变小 = 折返
    expect(yOf(7)).toBeGreaterThan(yOf(5));
  });

  it('子节拍线同样逐点独立求 y：回程层内的 5.25 落在顶层与 beat6 之间', () => {
    const { out, c } = gridStrokes();
    const yOf = (beat: number) => c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    const subY = yOf(5.25); // pos 1072.5：位于 beat5(顶) 与 beat6(回程) 之间
    expect(out.some((s) => s.width !== 2 && Math.abs(s.y - subY) < 1e-6)).toBe(true);
    expect(subY).toBeGreaterThan(yOf(5));
    expect(subY).toBeLessThan(yOf(6));
  });

  it('START·END 线按各自布局坐标画：END 落在折返带顶（与 beat5 同位）——折返重叠是保真', () => {
    const { c, rc } = makeRig();
    const { proxy, calls } = makeRecordingCtx();
    renderBoundLines(proxy, c, rc);
    const endY = c.virtualToCanvas(0, c.beatToVirtualY(rc.chartEndBeat)).y;
    expect(labeledFills(calls)).toEqual([{ text: 'END', color: END_TEXT_COLOR }]); // START(y=1300) 在画布外
    // 竖沟槽段的两段虚线都在同一个 END 布局坐标上（与 beat5 的网格线/BPM 线重合）
    const gutterYs = calls.filter(([k]) => k === 'moveTo').map(([, v]) => v[1] as number);
    expect(gutterYs).toEqual([endY, endY]);
    expect(endY).toBeCloseTo(c.virtualToCanvas(0, c.beatToVirtualY(5)).y, 6);
  });
});

describe('issue 105 修法 3 · 折返自叠沿用 ADR-0009 §5（splitBandAtFolds + 逐行光栅）', () => {
  const HALF = 15; // 车道横向半宽 = LANE_WIDTH × scale × noteSize / 2
  const PROFILE = [0.2, 0.4, 0.6, 0.8, 1];

  /** 折返的滑条中心线（真实布局坐标）：beat 4.5 → 5.8 → 6.2 → 7 在画布 y 上先上后下再上 */
  function foldCenterLine() {
    const { c } = makeRig();
    const beats = [4.5, 5.8, 6.2, 7];
    return beats.map((beat, lane) => {
      const p = c.virtualToCanvas(c.getNoteVirtualX(lane), c.getNoteVirtualY(beat));
      return { x: p.x, y: p.y };
    });
  }

  const rasterOf = (runs: BandPoint[][]) => rasterBandRuns({
    runs, half: HALF, profile: PROFILE, rgb: [75, 227, 113], sx: 1, sy: 1, baseAlpha: 1,
  })!;

  /** 设备像素 = CSS 像素（sx=sy=1）时按绝对坐标取 α */
  const alphaAt = (r: BandRaster, x: number, y: number): number => {
    const i = Math.floor(x) - r.bxDev;
    const j = Math.floor(y) - r.byDev;
    if (i < 0 || j < 0 || i >= r.bw || j >= r.bh) return 0;
    return r.data[(j * r.bw + i) * 4 + 3]! / 255;
  };

  it('布局折返（点序单调、画布 y 非单调）触发切分：多段且每段内 y 同向', () => {
    const pts = foldCenterLine();
    expect(pts.length).toBe(4);
    // 点序（beat）单调递增，但画布 y 非单调 → 这正是 ADR-0009 §5 的「布局折返」
    expect(pts[1]!.y).toBeLessThan(pts[0]!.y);
    expect(pts[2]!.y).toBeGreaterThan(pts[1]!.y);
    expect(pts[3]!.y).toBeLessThan(pts[2]!.y);
    const runs = splitBandAtFolds(pts);
    expect(runs.length).toBeGreaterThan(1);
    for (const run of runs) {
      const dirs = run.slice(1)
        .map((p, i) => Math.sign(p.y - run[i]!.y))
        .filter((s) => s !== 0);
      expect(new Set(dirs).size).toBe(1);
    }
  });

  it('自叠处只叠亮不相消：重叠行的 α ≥ 单臂渲染的 α，且行内有墨（零黑线洞）', () => {
    const pts = foldCenterLine();
    const runs = splitBandAtFolds(pts);
    const both = rasterOf(runs);
    // 回程臂单独渲染作对照（抽掉它，重叠区就只剩再向上臂）
    const descending = runs.find((run) => run[run.length - 1]!.y - run[0]!.y > 0)!;
    const single = rasterOf([descending]);

    const yLo = Math.max(Math.ceil(Math.min(...pts.map((p) => p.y))), Math.ceil(Math.min(...descending.map((p) => p.y))));
    const yHi = Math.min(Math.floor(Math.max(...descending.map((p) => p.y))), Math.floor(Math.max(...pts.map((p) => p.y))));
    let brighterPixels = 0;
    let inkRows = 0;
    for (let y = yLo; y < yHi; y++) {
      let rowInk = false;
      for (let x = Math.min(...pts.map((p) => p.x)) - HALF; x <= Math.max(...pts.map((p) => p.x)) + HALF; x++) {
        const aSingle = alphaAt(single, x, y);
        const aBoth = alphaAt(both, x, y);
        expect(aBoth).toBeGreaterThanOrEqual(aSingle - 1e-9); // 绝不比单臂更暗（旧环带构造在此相消成洞）
        if (aBoth > 0) rowInk = true;
        if (aBoth > aSingle + 1e-9) brighterPixels++;
      }
      if (rowInk) inkRows++;
    }
    expect(inkRows).toBeGreaterThan(0);        // 重叠区内行行有墨（无黑线洞）
    expect(brighterPixels).toBeGreaterThan(0); // 两臂真重叠 → 有像素被叠亮
  });
});

describe('issue 105 · 渲染口径（静态源码断言）', () => {
  const renderSrc = readFileSync(join(repoRoot, 'src/visual/render.ts'), 'utf-8');

  it('负值取色只有一个消费点，且按 bpm 正负分派（「横线不换色」由上面的行为断言看守）', () => {
    expect(renderSrc.match(/gridBpmNegativeColor\(/g)).toHaveLength(1); // render.ts 内仅 renderBpmLabels 调用
    expect(renderSrc).toMatch(/bpm < 0 \? negativeColor : positiveColor/);
  });

  it('折返自叠沿用 ADR-0009 §5 口径：SP 带条走 splitBandAtFolds + 逐行光栅', () => {
    // 修法 3 本轮确认「已由 issue 09 八轮落地、无需改码」——故这里锁的是**该通路仍在用**
    //（真渲染路径 `renderSpBandStrip` 需要 DOM 变换，node 环境测不到，见「已知边界」）
    expect(renderSrc).toMatch(/splitBandAtFolds\(pts\)/);
    expect(renderSrc).toMatch(/rasterBandRuns\(\{\s*runs,/);
  });

  it('网格枚举由布局坐标派生（visibleBeatRanges），逐拍独立求 y（无单调假定）', () => {
    expect(renderSrc).toContain('for (const r of geometry.visibleBeatRanges(viewport, viewHeightCss))');
    expect(renderSrc).toContain('const y = c.virtualToCanvas(0, c.beatToVirtualY(beat)).y');
  });
});
