// issue 186：片段粘贴态的幽灵。
// ① 带 BPM 时把**将写入的 BPM** 画成虚线 + 沟槽数值（不含 BPM 档一条都不画）；
// ② 幽灵的 y 必须按"落子后"的时间线算 —— 倒流区片段要预览出折返形状（不能永远朝正方向延伸）；
// ③ 数值与线同行居中、走实线数值同一条布局链（用户定案：不做让行、不偏离线）。
import { describe, expect, it } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { buildPatternPastePayload } from '@/src/chart/patterns/paste';
import type { Pattern } from '@/src/chart/patterns/types';
import type { ChartNote } from '@/src/chart/types';
import { makeCoords } from '@/src/rendering/coords';
import { renderToolPreview } from '@/src/rendering/render';
import { GUTTER_LABEL_FONT_PX, bpmLabelAnchorY } from '@/src/rendering/gutterLabels';
import type { RenderCtx } from '@/src/rendering/types';
import { makeRecordingCtx } from '@/tests/support/canvas';

const CHART_BPM: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };

/** 倒流区片段：起点 −120 → 贴到 120 的谱面上以后，落点之后的时间轴反向（折返） */
const BACKFLOW: Pattern = {
  id: 'p1',
  name: '片段 1',
  createdAt: 1,
  notes: [
    { type: 'Single', beat: 2, lane: 3 } as ChartNote,
    { type: 'Single', beat: 3, lane: 4 } as ChartNote,
  ],
  bpmContext: { startBpm: -120, events: [] },
};

function makeRig(pattern: Pattern, withBpm: boolean) {
  const geometry = new ChartGeometry([{ beat: 0, bpm: 120 }], { seconds: 6 }, SURFACE);
  // 视口滚到让 beat 2 落在画布中段（布局轴：越晚的音符 y 越小，scrollY=0 时 beat 2 远在画布上方）
  const viewport = { scrollX: 0, scrollY: Math.max(0, geometry.noteVirtualY(2, 0, 1, 4) - SURFACE.h / 2), scale: 1 };
  const c = makeCoords(geometry, viewport, 4, CHART_BPM);
  const track = geometry.trackGeometry(1);
  const hoverCy = c.virtualToCanvas(0, c.getNoteVirtualY(2)).y;
  const anchored = c.getLaneBeatFromCanvas(track.trackBgX + track.trackBgWidth / 2, hoverCy)!;
  /** 每次精灵绘制的落点（断言折返形状用） */
  const drawnAt: number[] = [];
  const rc = {
    geometry,
    viewport,
    surface: SURFACE,
    chartEndBeat: geometry.chartEndBeat,
    beatDisplay: 4,
    notes: CHART_BPM,
    clipboard: [],
    armedTool: 'paste',
    hoverPos: { cx: track.trackBgX + track.trackBgWidth / 2, cy: hoverCy },
    pastePayloadAt: (anchorBeat: number) => buildPatternPastePayload(
      { pattern, withBpm },
      { anchorBeat, targetNotes: CHART_BPM, beatDisplay: 4 },
    ),
    noteIcons: new Proxy({}, { get: () => () => ({ out: { w: 10, h: 10 } }) }),
    spriteIcon: new Proxy({}, { get: () => (_ctx: unknown, opts: { canvasY: number }) => { drawnAt.push(opts.canvasY); } }),
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
  } as unknown as RenderCtx;
  return { c, rc, anchorBeat: anchored.preciseBeat, track, drawnAt };
}

describe('issue 186 · 片段粘贴幽灵的 BPM 虚线', () => {
  it('载荷里的 BPM 画成中性虚线，数值写在轨道左侧沟槽（不是轨道内）', () => {
    const { c, rc, anchorBeat, track } = makeRig(BACKFLOW, true);
    const { proxy, calls } = makeRecordingCtx();
    renderToolPreview(proxy, c, rc);

    const dashes = calls.filter(([k]) => k === 'setLineDash').map(([, v]) => v[0]);
    expect(dashes[0]).toEqual([6, 4]);

    const fills = calls.filter(([k]) => k === 'fillText') as [string, [string, number, number]][];
    const label = fills.find(([, v]) => v[0] === '-120');
    expect(label).toBeDefined();
    expect(label![1][1]).toBeLessThan(track.trackBgX); // 沟槽在轨道左缘之外

    // 横线落在"锚点那一拍"的 y 上
    expect(calls.filter(([k]) => k === 'moveTo').map(([, v]) => v[1])).toContain(
      c.virtualToCanvas(0, c.getNoteVirtualY(anchorBeat, 0)).y,
    );
  });

  it('倒流片段：幽灵按落子后的时间线折返（第二枚音符画到锚点下方，不是继续向上）', () => {
    const plain = makeRig(BACKFLOW, false);
    const { proxy: plainCtx } = makeRecordingCtx();
    renderToolPreview(plainCtx, plain.c, plain.rc);
    // 不带 BPM：两枚音符沿正方向排（第二枚更靠上 → canvasY 更小）
    expect(plain.drawnAt).toHaveLength(2);
    expect(plain.drawnAt[1]).toBeLessThan(plain.drawnAt[0]!);

    const folded = makeRig(BACKFLOW, true);
    const { proxy: foldedCtx } = makeRecordingCtx();
    renderToolPreview(foldedCtx, folded.c, folded.rc);
    // 带 BPM：落点之后时间轴反向 → 第二枚折回下方
    expect(folded.drawnAt).toHaveLength(2);
    expect(folded.drawnAt[1]).toBeGreaterThan(folded.drawnAt[0]!);
  });

  it('不含 BPM 档 → 一条虚线都不画（落子也不会写线）', () => {
    const { c, rc } = makeRig(BACKFLOW, false);
    const { proxy, calls } = makeRecordingCtx();
    renderToolPreview(proxy, c, rc);
    expect(calls.filter(([k]) => k === 'setLineDash')).toHaveLength(0);
  });
});

describe('issue 186 · 幽灵 BPM 数值的位置', () => {
  it('与线同一行居中（走实线数值同一条布局链，不做任何让行）', () => {
    const { c, rc, track } = makeRig(BACKFLOW, true);
    const { proxy, calls } = makeRecordingCtx();
    renderToolPreview(proxy, c, rc);

    const fills = calls.filter(([k]) => k === 'fillText') as [string, [string, number, number]][];
    const label = fills.find(([, v]) => v[0] === '-120');
    expect(label).toBeDefined();
    // 同为沟槽右对齐：x 落在轨道左缘之外
    expect(label![1][1]).toBeLessThan(track.trackBgX);
    // y 与该拍位的 BPM 标线同一行（`bpmLabelAnchorY` 的居中锚点），与实线数值完全同款
    const lineY = c.virtualToCanvas(0, c.getNoteVirtualY(2)).y;
    expect(label![1][2]).toBe(bpmLabelAnchorY(2, lineY, GUTTER_LABEL_FONT_PX, SURFACE.h));
    expect(calls.filter(([k]) => k === 'textBaseline').map(([, v]) => v[0])).toContain('middle');
  });
});
