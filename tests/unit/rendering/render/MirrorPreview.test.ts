// chart-preview 08 · 预览镜像（照 Bestdori `styleMirror`）：**整条轨道水平镜像** ——
// 车道左右互换（`lane → 6 - lane`），方向键整组（本体 + 箭头）一起翻到另一侧。
//
// 断言手法：镜像后的绘制结果应当与"左右对调后的那条音符"**逐点相同**（同一套精灵几何），
// 这样测的是"整轨一致镜像"，而不是某一个内部字段。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderNotes } from '@/src/rendering/render';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BD = 4;
const LANES = 7;

const geometry = new ChartGeometry(bpm120, { endBeat: 8 }, SURFACE);
const viewport = { scrollX: 0, scrollY: 0, scale: 1, virtualWidth: 0, virtualHeight: 0 };

/** 渲染一条音符，收集 spriteIcon 收到的全部 canvasX（方向键整组 = 每个本体 + 箭头各一枚） */
function drawnXs(note: ChartNote, mirror: boolean): number[] {
  const xs: number[] = [];
  const rc = {
    geometry, viewport, surface: SURFACE, dpr: 1, beatDisplay: BD, chartEndBeat: 8,
    notes: [note], selectedItems: [], selectionBox: null, slideBuffer: null, hoverPos: null,
    clipboard: [], markerSeconds: null, armedTool: null,
    spriteIcon: {
      render: (_c: unknown, cfg: { canvasX: number }) => { xs.push(cfg.canvasX); },
      renderDecorator: () => undefined,
    },
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: false, mirror },
  } as unknown as RenderCtx;
  renderNotes(makeNoopCtx(), makeCoords(geometry, viewport, BD, [note], mirror), rc, [{ note, index: 0 }]);
  return xs;
}

const single = (lane: number): ChartNote => ({ type: 'Single', lane, beat: 2 });
const dir = (type: 'LDirectional' | 'RDirectional', lane: number): ChartNote =>
  ({ type, lane, beat: 2, length: 2 }) as ChartNote;

describe('chart-preview 08 · 预览镜像：车道 → x 映射', () => {
  it('镜像 = 车道对调（lane ↔ 6-lane），两次镜像回到原样', () => {
    const plain = makeCoords(geometry, viewport, BD, []);
    const mirrored = makeCoords(geometry, viewport, BD, [], true);
    for (let lane = 0; lane < LANES; lane++) {
      expect(mirrored.getNoteVirtualX(lane)).toBe(plain.getNoteVirtualX(LANES - 1 - lane));
      expect(mirrored.getNoteVirtualX(LANES - 1 - lane)).toBe(plain.getNoteVirtualX(lane));
    }
    // y（时间轴）不受镜像影响
    expect(mirrored.getNoteVirtualY(3, 2)).toBe(plain.getNoteVirtualY(3, 2));
  });

  it('镜像不改 geometry 自己的换算（命中/圈选那一路照旧）', () => {
    const { trackBgX } = geometry.trackGeometry(1);
    const cx = trackBgX + geometry.noteVirtualX(0);   // lane 0 的中心画布 x
    expect(geometry.laneBeatFromCanvas(cx, 0, viewport, BD)?.lane).toBe(0);
  });
});

describe('chart-preview 08 · 预览镜像：音符绘制逐点一致', () => {
  it('单键：lane 0 镜像后 = lane 6 不镜像（严格同一组 x）', () => {
    expect(drawnXs(single(0), true)).toEqual(drawnXs(single(6), false));
    expect(drawnXs(single(4), true)).toEqual(drawnXs(single(2), false));
  });

  it('单键：x 关于轨道中心对称', () => {
    const { trackBgX, trackBgWidth } = geometry.trackGeometry(1);
    const center = trackBgX + trackBgWidth / 2;
    const [plainX] = drawnXs(single(0), false);
    const [mirroredX] = drawnXs(single(0), true);
    // 精灵以中心对齐 → 两枚锚点关于轨道中心对称（宽度相同，锚点偏移同号不参与）
    expect(mirroredX! - center).toBeCloseTo(center - plainX!, 6);
  });

  it('方向键：整组连箭头翻面（L@6 镜像 = R@0 不镜像），整组锚点数也一致', () => {
    const mirrored = drawnXs(dir('LDirectional', 6), true);
    expect(mirrored.length).toBeGreaterThan(1);              // 本体 + 箭头
    expect(mirrored).toEqual(drawnXs(dir('RDirectional', 0), false));
  });

  it('不设开关（编辑器现状）：lane 0 仍在最左（镜像未生效）', () => {
    const [left] = drawnXs(single(0), false);
    const [right] = drawnXs(single(6), false);
    expect(left!).toBeLessThan(right!);
  });
});
