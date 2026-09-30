// chart-preview 08：网格细节档（`gridDetail` = 画到第几级细分）的行为锁。
//
// 口径：数字 N = 只画"约分分母 ≤ N"的横线（`1` = 只整拍线），`'off'` = 不画横网格，
// `'all'` = 按 beatDisplay 全量（编辑器现状）。档位由 `gridDivisionOf` 判（纯函数与样式分层共用同一份约分）。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderGrid } from '@/src/rendering/render';
import type { GridDetail, RenderCtx } from '@/src/rendering/types';
import { makeRecordingCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const chartEndBeat = 8;

/** 画布上的横向网格线（起点 = 轨道左内缘的那批；轨道竖线的 moveTo 是 (x, 0)，不计入） */
function horizontalLines(gridDetail: GridDetail, beatDisplay = 4): { y: number; width: number }[] {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, SURFACE);
  // scrollY = chartEndVirtualY → 拍 0 落在画布底边，画布内正好看得到 0..4 拍（120bpm 下 1 拍 = 220px）
  const viewport = { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 };
  const c = makeCoords(geometry, viewport, beatDisplay, []);
  const rc = {
    geometry, viewport, surface: SURFACE, chartEndBeat, beatDisplay,
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, gridStyle: 'vivid', gridDetail },
  } as unknown as RenderCtx;
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
      pendingX = null; pendingY = null;
    }
  }
  return out;
}

/** 可见的整拍线（整拍层加粗：lineWidth ≥ 2）与子拍线 */
const beats = (lines: { y: number; width: number }[]) => lines.filter((l) => l.width >= 2);
const subs = (lines: { y: number; width: number }[]) => lines.filter((l) => l.width < 2);

describe('chart-preview 08 · 网格细节档（画到第几级细分）', () => {
  // 120bpm、es = 1：1 拍 = 220px、1/4 拍 = 55px → 画布内看得到 0..4 拍共 5 条整拍线（抽稀阈值 5px 不触发）
  it("'off' 不画横网格；'all' 与同值数字等价（编辑器现状）", () => {
    expect(horizontalLines('off')).toEqual([]);
    expect(horizontalLines('all').length).toBe(horizontalLines(4).length);
  });

  it('档位越细线越多：1/1 → 整拍；1/2 → 加半拍；1/4 → 加四分之一拍', () => {
    // beatDisplay = 4（编辑器默认档）：1/3 这一档在这份细分下没有对应的线（约分分母 3 不存在）
    expect(beats(horizontalLines(1))).toHaveLength(5);
    expect(horizontalLines(1)).toHaveLength(5);

    expect(beats(horizontalLines(2))).toHaveLength(5);
    expect(subs(horizontalLines(2))).toHaveLength(4);          // 拍间各一条半拍
    expect(horizontalLines(2)).toHaveLength(9);

    expect(horizontalLines(3)).toHaveLength(9);                 // 1/3 档不新增（本细分无三分之一拍）
    expect(subs(horizontalLines(4))).toHaveLength(12);          // 1/2 一条 + 两条 1/4（×4 个拍间）
    expect(horizontalLines(4)).toHaveLength(17);
  });

  it('1/3 档在 beatDisplay = 6 下真的画出三分之一拍（约分分母 3 ≤ 3 才留）', () => {
    // beatDisplay 6：拍内 5 条候选，约分分母 = k=3 → 2、k=2 / k=4 → 3、k=1 / k=5 → 6
    // 可见 0..4 拍共 4 个拍间 → 分母 2：4 条；分母 3：8 条；分母 6：8 条
    expect(subs(horizontalLines(2, 6)).length).toBe(4);         // 只留 1/2
    expect(subs(horizontalLines(3, 6)).length).toBe(12);        // 1/2 + 1/3
    expect(subs(horizontalLines(6, 6)).length).toBe(20);        // 1/2 + 1/3 + 1/6（= 'all' 同档）
    expect(beats(horizontalLines(3, 6)).length).toBe(5);
  });

  it('档位下限 1：连半拍线也不画（与旧「只整拍线」档同观感）', () => {
    const lines = horizontalLines(1);
    const subYs = subs(lines).map((l) => l.y);
    expect(subYs).toEqual([]);
    for (const b of beats(lines)) expect(b.y).toBeGreaterThanOrEqual(0);
  });
});
