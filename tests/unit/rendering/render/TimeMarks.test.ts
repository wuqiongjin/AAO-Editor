// chart-preview 08：沟槽时间刻度（`timeMarks`，照 Bestdori 的 chartTime）的行为锁。
//
// 两件事最容易写错，各锁一条：
//   1. 落点走**秒 → 布局轴**（`secondsToVirtualY`）落在整秒上（倒流区里"秒 → 拍"多解，秒单值）；
//   2. **窄档**面板的沟槽只有 ~30px（130px 宽 = zoom ≈ 45%，轨道占 70px），标签盒放不下时**钳制**
//      而不是隐藏 —— 隐藏等于时间标记在小缩放下没有任何效果（默认档 289px 宽时沟槽 66px、放得下，
//      所以这条用窄档锁；导出档加大不改变本用例的口径，见 issue 13 的复核记录）。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { formatTimeCompact } from '@/src/chart/geometry/TimeFormat';
import { makeCoords } from '@/src/rendering/coords';
import { measureGutterLabelWidth } from '@/src/rendering/gutterLabels';
import { renderTimeMarks } from '@/src/rendering/render';
import type { RenderCtx } from '@/src/rendering/types';
import { makeRecordingCtx, fillTexts } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
/** 编辑器画布档（900px 高、es = 1 → 同屏 ≈2.05 秒） */
const CANVAS = { w: 750, h: 900 };
/** 预览窄档（zoom ≈ 45%：130 × 400、es = 1/3 → 两侧沟槽各 30px；默认档 289 宽沟槽 66px） */
const PANEL = { w: 130, h: 400 };
const PANEL_ES = 1 / 3;

function renderAt(
  timeMarks: number,
  opts: { topSeconds?: number; surface?: { w: number; h: number }; scale?: number; labelScale?: number } = {},
) {
  const surface = opts.surface ?? CANVAS;
  const scale = opts.scale ?? 1;
  const geometry = new ChartGeometry(bpm120, { endBeat: 60 }, surface);
  const probe = makeCoords(geometry, { scrollX: 0, scrollY: 0, scale }, 4, []);
  // 画布顶（y = 0）落在 topSeconds 上：谱面时间向上（画布底 = 更早）
  const scrollY = probe.secondsToVirtualY(opts.topSeconds ?? 0);
  const viewport = { scrollX: 0, scrollY, scale };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = {
    geometry, viewport, surface, chartEndBeat: geometry.chartEndBeat, beatDisplay: 4,
    display: {
      noteSize: 1, slideOpacity: 1, simultaneousClickLines: true,
      labelScale: opts.labelScale ?? 1, timeMarks,
    },
  } as unknown as RenderCtx;
  const { proxy, calls } = makeRecordingCtx();
  renderTimeMarks(proxy, c, rc);
  return { calls, c };
}

const texts = (calls: ReturnType<typeof renderAt>['calls']) => fillTexts(calls).map((t) => t[1][0]);

describe('chart-preview 08 · 紧凑时间码', () => {
  it('分钟不补零：0:25 / 1:05 / 12:30（沟槽里少一位就多一分放得下）', () => {
    expect(formatTimeCompact(0)).toBe('0:00');
    expect(formatTimeCompact(25)).toBe('0:25');
    expect(formatTimeCompact(65)).toBe('1:05');
    expect(formatTimeCompact(750.9)).toBe('12:30');
    expect(formatTimeCompact(-5)).toBe('0:00');
    expect(formatTimeCompact(Number.NaN)).toBe('0:00');
  });
});

describe('chart-preview 08 · 沟槽时间刻度', () => {
  it('0 / 缺省 = 不画（一行也不落）', () => {
    const none = renderAt(0);
    expect(none.calls.filter(([k]) => k === 'fillText' || k === 'stroke')).toEqual([]);
  });

  it('按间隔落在整秒上：1 秒档 → 0:00 / 0:01 / 0:02；5 秒档 → 只剩 0:10', () => {
    expect(texts(renderAt(1, { topSeconds: 2 }).calls)).toEqual(['0:00', '0:01', '0:02']);
    expect(texts(renderAt(5, { topSeconds: 12 }).calls)).toEqual(['0:10']);
    expect(texts(renderAt(10, { topSeconds: 12 }).calls)).toEqual(['0:10']);
  });

  it('每枚刻度带一条贴轨道左缘的短线（刻度线在沟槽里、不进轨道）', () => {
    const { calls, c } = renderAt(5, { topSeconds: 12 });
    const { trackStartX } = c.trackGeometry(1);
    const xs = calls.filter(([k]) => k === 'moveTo' || k === 'lineTo').map(([, args]) => args[0] as number);
    expect(xs).toEqual([trackStartX - 4, trackStartX - 1]);
    expect(xs.every((x) => x < trackStartX)).toBe(true);
  });

  it('预览窄面板：标签盒放不下时钳进画布（而不是像 BPM 数值那样整体隐藏）', () => {
    const narrowPanel = { w: 90, h: 400 };
    const { calls, c } = renderAt(5, { topSeconds: 10, surface: narrowPanel, scale: PANEL_ES, labelScale: 0.7 });
    const fills = fillTexts(calls);
    expect(fills.map((t) => t[1][0])).toEqual(['0:10']);

    const fontPx = Math.round(21 * 0.7 * PANEL_ES);                 // 预览档字号联动 scale
    const textWidth = measureGutterLabelWidth('0:10', fontPx);   // 无 ctx → 0.62em 估算
    const { trackStartX } = c.trackGeometry(PANEL_ES);
    const naturalX = trackStartX - Math.round(8 * PANEL_ES);     // 内带锚点（贴轨道左外缘 − 8px * scale）
    const x = fills[0]![1][1];
    expect(naturalX - textWidth).toBeLessThan(0);        // 前提：自然锚点下确实放不下
    expect(x).toBeGreaterThan(naturalX);                 // 被右移了
    expect(x - textWidth).toBeGreaterThanOrEqual(0);     // 标签盒完整落在画布内
  });

  it('刻度枚举跟着视口走（窗外的整秒不画）', () => {
    // 5 秒档 + 画布只看得见 [9.87, 12.08] 附近：10 在窗内，0 与 15 都在窗外
    expect(texts(renderAt(5, { topSeconds: 12 }).calls)).toEqual(['0:10']);
    // 把画布顶挪到 100 秒处：只剩 100（同一把尺换算成 1:40）
    expect(texts(renderAt(5, { topSeconds: 100 }).calls)).toEqual(['1:40']);
  });
});
