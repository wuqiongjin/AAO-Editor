import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderGrid } from '@/src/rendering/render';
import {
  GRID_STYLES,
  GRID_TIER_ORDER,
  GRID_BPM_NEGATIVE_COLORS,
  gridBpmNegativeColor,
  gridLineDash,
  gridThemeBpmColor,
  gridBpmLineColor,
  GRID_BPM_LINE_COLORS,
  gridTierOf,
  normalizeGridStyle,
  DEFAULT_GRID_STYLE,
  type GridStylePreset,
} from '@/src/rendering/gridStyle';
import type { RenderCtx } from '@/src/rendering/types';
import { makeRecordingCtx, propValues } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };

/** 感知亮度（0..255）：0.2126R + 0.7152G + 0.0722B */
const luma = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('gridTierOf 分母分层（issue 53）', () => {
  it('beatDisplay=4：1/2 → half，1/4、3/4 → quarter', () => {
    expect(gridTierOf(2, 4)).toBe('half');
    expect(gridTierOf(1, 4)).toBe('quarter');
    expect(gridTierOf(3, 4)).toBe('quarter');
  });

  it('beatDisplay=8：1/2 > 1/4、3/4 > 1/8 类', () => {
    expect(gridTierOf(4, 8)).toBe('half');
    expect(gridTierOf(2, 8)).toBe('quarter');
    expect(gridTierOf(6, 8)).toBe('quarter');
    expect(gridTierOf(1, 8)).toBe('eighth');
    expect(gridTierOf(7, 8)).toBe('eighth');
  });

  it('beatDisplay=16：全部约分定层，最细为 sixteenth', () => {
    expect(gridTierOf(8, 16)).toBe('half');
    expect(gridTierOf(4, 16)).toBe('quarter');
    expect(gridTierOf(12, 16)).toBe('quarter');
    expect(gridTierOf(2, 16)).toBe('eighth');
    expect(gridTierOf(1, 16)).toBe('sixteenth');
    expect(gridTierOf(15, 16)).toBe('sixteenth');
  });

  it('beatDisplay=2：只有 half 一层', () => {
    expect(gridTierOf(1, 2)).toBe('half');
  });
});

describe('颜色主题（issue 53 第二轮）', () => {
  it('normalizeGridStyle：四主题合法，非法/缺省回退 vivid（默认多彩）', () => {
    for (const p of ['mono', 'amber', 'cyan', 'vivid'] as const) {
      expect(normalizeGridStyle(p)).toBe(p);
    }
    expect(normalizeGridStyle('classic')).toBe(DEFAULT_GRID_STYLE); // 旧预设名回退
    expect(normalizeGridStyle(undefined)).toBe(DEFAULT_GRID_STYLE);
    expect(normalizeGridStyle(42)).toBe(DEFAULT_GRID_STYLE);
  });

  it('子层颜色亮度单调递减，最淡层 luma ≥ 90（下限远离黑）；整拍 alpha 0.45 柔化', () => {
    for (const p of ['mono', 'amber', 'cyan', 'vivid'] as const) {
      const def = GRID_STYLES[p];
      expect(def.beat.alpha).toBe(0.45); // issue 17 方案 A：整拍实线柔化
      // 虚线保持原来效果：子拍层不设单独 alpha（缺省 1），纯靠颜色承载层级
      const subTiers = ['half', 'quarter', 'eighth', 'sixteenth'] as const;
      for (const t of subTiers) {
        expect(def[t].alpha).toBeUndefined();
      }
      const ladder = subTiers.map((t) => luma(def[t].color));
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]);
      expect(luma(def.sixteenth.color)).toBeGreaterThanOrEqual(90);
    }
  });

  it('线形分层关闭（默认）：整拍实线、非整拍统一短虚线；开启后按层级阶梯', () => {
    expect(gridLineDash('beat', false, 1)).toBeNull();        // 整拍恒实线
    expect(gridLineDash('half', false, 1)).toEqual([4, 6]);   // 关闭态：非整拍统一短虚线
    expect(gridLineDash('quarter', false, 1)).toEqual([4, 6]);
    expect(gridLineDash('sixteenth', false, 2)).toEqual([8, 12]);
    expect(gridLineDash('beat', true, 1)).toBeNull();         // 开启：整拍仍实线
    expect(gridLineDash('half', true, 1)).toEqual([10, 6]);   // 1/2 长虚线
    expect(gridLineDash('quarter', true, 1)).toEqual([4, 6]);
    expect(gridLineDash('eighth', true, 2)).toEqual([3, 10]);
    expect(gridLineDash('sixteenth', true, 1)).toEqual([1, 4]);
  });

  it('BPM 数值跟随主题主色（beat 层色）；横线另走专用色（issue 163）', () => {
    for (const p of ['mono', 'amber', 'cyan', 'vivid'] as const) {
      expect(gridThemeBpmColor(p)).toBe(GRID_STYLES[p].beat.color);
    }
  });
});

describe('BPM 横线专用色（issue 163）', () => {
  const PRESETS = ['mono', 'amber', 'cyan', 'vivid'] as const;

  it('四主题取值即票面口径，且不等于整拍色、倒流数字色', () => {
    expect(gridBpmLineColor('vivid')).toBe('#6e65a8');
    expect(gridBpmLineColor('mono')).toBe('#7a72b5');
    expect(gridBpmLineColor('amber')).toBe('#5a6a9e');
    expect(gridBpmLineColor('cyan')).toBe('#8a5a9a');
    for (const p of PRESETS) {
      expect(gridBpmLineColor(p)).toBe(GRID_BPM_LINE_COLORS[p]);
      expect(gridBpmLineColor(p).toLowerCase()).not.toBe(GRID_STYLES[p].beat.color.toLowerCase());
      expect(gridBpmLineColor(p).toLowerCase()).not.toBe(GRID_BPM_NEGATIVE_COLORS[p].toLowerCase());
    }
  });
});

// ─────────────── 倒流区（负值 BPM）数值取色：issue 105 修法 1 / ADR-0010 结论 11 ───────────────
describe('倒流区 BPM 数值取色（issue 105：正/负成对随主题走）', () => {
  const PRESETS = ['mono', 'amber', 'cyan', 'vivid'] as const;
  /** 画布既有**语义色**：START 青 / END 橙 / 选中黄 / 危险红（负值色不得侵占）。
   *  主题层级色里唯一同色带的 vivid 1/16 灰粉 `#d67f9f` 不算语义色——本组饱和度明显更高
   *  （见 `gridStyle.ts` 取色说明），靠"一眼可辨"而非互斥取值。 */
  const RESERVED = ['#53b8c9', '#d97b5a', '#ffe033', '#ff5a5a'];

  it('四主题都有负值色，且与同主题正值（beat 层色）不同色', () => {
    for (const p of PRESETS) {
      const neg = gridBpmNegativeColor(p);
      expect(neg).toBe(GRID_BPM_NEGATIVE_COLORS[p]);
      expect(neg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(neg.toLowerCase()).not.toBe(GRID_STYLES[p].beat.color.toLowerCase());
    }
  });

  it('黑底（#000000）上足够亮（luma ≥ 170），且四主题取值互不相同', () => {
    const all = PRESETS.map((p) => gridBpmNegativeColor(p));
    for (const hex of all) expect(luma(hex)).toBeGreaterThanOrEqual(170);
    expect(new Set(all.map((h) => h.toLowerCase())).size).toBe(4);
  });

  it('不侵占画布既有语义色（START/END/选中/危险）', () => {
    for (const p of PRESETS) {
      expect(RESERVED).not.toContain(gridBpmNegativeColor(p).toLowerCase());
    }
  });
});

describe('renderGrid 分层绘制（issue 53）', () => {
  function renderGridAt(beatDisplay: number, opts: { gridStyle?: GridStylePreset; lineShapeTiers?: boolean } = {}) {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 } , TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 };
    const c = makeCoords(geometry, viewport, beatDisplay, []);
    const rc = {
      geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 8, beatDisplay,
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, ...opts },
    } as unknown as RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderGrid(proxy, c, rc);
    return calls;
  }

  it('默认（线形关）：整拍实线、非整拍短虚线（仅两种形态）', () => {
    const calls = renderGridAt(4);
    const dashes = calls.filter(([k]) => k === 'setLineDash').map(([, v]) => v[0]) as number[][];
    expect(dashes.some((d) => d.length === 0)).toBe(true);          // 整拍实线
    const nonEmpty = dashes.filter((d) => d.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);                      // 非整拍短虚线
    expect(nonEmpty.every((d) => d[0] === 4 && d[1] === 6)).toBe(true); // 统一 [4,6]
  });

  it('issue 78：虚线两端都贴边（lineDashOffset = dash/2，左右端相位都落在 dash 内）', () => {
    // 横线路径：moveTo(trackBgX) → lineTo(trackBgX + trackBgWidth)，长度 L = 210·es；
    // 默认形态 [4,6]·es，周期 10·es 整除 L → 修复前右端相位为 0（= 新 dash 的起点，
    // 于是末端前 [L−gap, L) 是空档）。偏移半个 dash 后两端相位一致，都从边缘起墨。
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 } , TEST_SURFACE);
    const es = 1;
    const { trackBgWidth } = geometry.trackGeometry(es);
    const dash = gridLineDash('half', false, es)!; // [4,6]
    const period = dash[0] + dash[1];

    const calls = renderGridAt(4);
    const offsets = propValues(calls, 'lineDashOffset') as number[];
    const offset = offsets.find((o) => o > 0);
    expect(offset).toBeCloseTo(dash[0] / 2, 6);

    const phase = (d: number) => (d + (offset as number)) % period;
    const EPS = 1e-3; // 只看端点邻域是否有墨（端点本身是零测点）
    expect(phase(EPS)).toBeLessThan(dash[0]);                 // 左端贴边
    expect(phase(trackBgWidth - EPS)).toBeLessThan(dash[0]);  // 右端贴边（修复前此处落在空档）
    expect(offsets[offsets.length - 1]).toBe(0);              // 绘制结束复位，不污染后续虚线
  });

  it('线形开：出现虚线段（长/短虚线）', () => {
    const calls = renderGridAt(4, { gridStyle: 'mono', lineShapeTiers: true });
    const dashes = calls.filter(([k]) => k === 'setLineDash').map(([, v]) => v[0]);
    expect(dashes.some((d) => (d as number[]).length > 0)).toBe(true);
  });

  it('非法主题回退 vivid（与显式 vivid 输出一致）', () => {
    const a = renderGridAt(4, { gridStyle: 'vivid' });
    const b = renderGridAt(4, { gridStyle: 'classic' as unknown as GridStylePreset });
    const strokes = (calls: [string, unknown[]][]) => calls.filter(([k]) => k === 'strokeStyle').map(([, v]) => v[0]);
    expect(strokes(b)).toEqual(strokes(a));
  });

  it('主题区分：vivid 与 cyan 的整拍线颜色不同', () => {
    const strokes = (calls: [string, unknown[]][]) => calls.filter(([k]) => k === 'strokeStyle').map(([, v]) => v[0]);
    expect(strokes(renderGridAt(4, { gridStyle: 'vivid' }))).not.toEqual(strokes(renderGridAt(4, { gridStyle: 'cyan' })));
  });

  it('轨道线透明度：globalAlpha = 分层 alpha × gridOpacity（第三轮补）', () => {
    const renderAt = (gridOpacity?: number) => {
      const geometry = new ChartGeometry(bpm120, { endBeat: 8 } , TEST_SURFACE);
      const viewport = { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 };
      const c = makeCoords(geometry, viewport, 4, []);
      const rc = {
        geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 8, beatDisplay: 4,
        display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, gridStyle: 'mono', gridOpacity },
      } as unknown as RenderCtx;
      const { proxy, calls } = makeRecordingCtx();
      renderGrid(proxy, c, rc);
      return calls;
    };
    // 整拍层 alpha 0.45：无设置 → 0.45；gridOpacity 0.5 → 0.225；缺省/未传 → 0.45
    const alphas = (calls: [string, unknown[]][]) => calls.filter(([k]) => k === 'globalAlpha').map(([, v]) => v[0] as number);
    expect(alphas(renderAt(undefined))).toContain(0.45);
    expect(alphas(renderAt(0.5))).toContain(0.225);
    // 子层虚线保持原来效果（alpha 缺省 1）：gridOpacity 0.5 → 1 × 0.5 = 0.5
    expect(alphas(renderAt(0.5))).toContain(0.5);
  });

  it('抽稀与层级叠加：远缩放下高层级优先保留，低层级让位（issue 53 验收）', () => {
    // scale=0.1 + scrollY 进入谱面中部：拍距 22px、1/16 距 1.375px——子拍候选大量落入高层级 5px 邻域
    const geometry = new ChartGeometry(bpm120, { endBeat: 100 } , TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: 21000, scale: 0.1 };
    const c = makeCoords(geometry, viewport, 16, []);
    const rc = {
      geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 100, beatDisplay: 16,
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, gridStyle: 'vivid' },
    } as unknown as RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderGrid(proxy, c, rc);

    // 按 stroke 配对 (y, lineWidth)：每条横线 = beginPath→moveTo(trackBgX, y)→lineTo→stroke
    // 只统计起点 x = trackBgX 的横线（轨道竖线 moveTo(x, 0) 不计入）
    const trackBgX = c.trackGeometry(0.1).trackBgX;
    const strokes: { y: number; width: number }[] = [];
    let width = 0;
    let pendingX: number | null = null;
    let pendingY: number | null = null;
    for (const [k, args] of calls) {
      if (k === 'lineWidth') width = args[0] as number;
      else if (k === 'moveTo') { pendingX = args[0] as number; pendingY = args[1] as number; }
      else if (k === 'stroke' && pendingY !== null && pendingX === trackBgX) { strokes.push({ y: pendingY, width }); pendingX = null; pendingY = null; }
    }

    // 整拍层（lineWidth 0.75，小缩放下放宽保底）：可见区间内每条整拍线全部绘制
    // y_b = (chartEndVirtualY + h/es − 220b − scrollY)·es = (31000 − 220b − 21000)·0.1 = 1000 − 22b
    const beatYs = strokes.filter(s => s.width === 0.75).map(s => s.y).sort((a, b) => a - b);
    const expectedBeats: number[] = [];
    for (let b = 0; b <= 100; b++) {
      const y = 1000 - 22 * b;
      if (y >= 0 && y <= TEST_SURFACE.h) expectedBeats.push(y);
    }
    expect(expectedBeats.length).toBeGreaterThan(30);
    expect(beatYs).toEqual(expectedBeats.sort((a, b) => a - b));

    // 抽稀属性：每条子拍线距任一整拍线 ≥ 5px，且子拍线彼此 ≥ 5px
    const subYs = strokes.filter(s => s.width < 0.75).map(s => s.y);
    for (const sy of subYs) {
      for (const by of beatYs) expect(Math.abs(sy - by)).toBeGreaterThanOrEqual(5);
    }
    for (let i = 1; i < subYs.length; i++) {
      for (let j = 0; j < i; j++) expect(Math.abs(subYs[i] - subYs[j])).toBeGreaterThanOrEqual(5);
    }
    // 抽稀确实发生：绘制数远小于候选数（~41 整拍 + ~41×15 子拍）
    expect(strokes.length).toBeLessThan(0.5 * (expectedBeats.length + expectedBeats.length * 15));
  });

  it('滚到底：多种缩放下 beat 0 整拍线整段在画布内（不贴底边裁没）', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 }, TEST_SURFACE);
    for (const scale of [0.5, 0.7, 0.88, 1, 1.1, 1.25, 1.5, 1.7, 2, 2.5]) {
      const es = geometry.effectiveScale(scale);
      const viewport = { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: es };
      const c = makeCoords(geometry, viewport, 4, []);
      const rc = {
        geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 8, beatDisplay: 4,
        display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true },
      } as unknown as RenderCtx;
      const { proxy, calls } = makeRecordingCtx();
      renderGrid(proxy, c, rc);
      const { trackBgX } = geometry.trackGeometry(es);
      const ys: number[] = [];
      let pendingX: number | null = null;
      let pendingY: number | null = null;
      let width = 0;
      for (const [k, args] of calls) {
        if (k === 'lineWidth') width = args[0] as number;
        else if (k === 'moveTo') { pendingX = args[0] as number; pendingY = args[1] as number; }
        else if (k === 'stroke' && pendingY !== null && pendingX === trackBgX && width >= Math.max(0.75, 2 * es) - 1e-6) {
          ys.push(pendingY);
          pendingX = null;
          pendingY = null;
        }
      }
      expect(ys.length, `scale=${es}`).toBeGreaterThan(0);
      const bottom = Math.max(...ys);
      const halfLw = Math.max(1, Math.max(0.75, 2 * es)) / 2;
      expect(bottom, `scale=${es}`).toBeLessThanOrEqual(TEST_SURFACE.h - halfLw + 1e-6);
      expect(bottom, `scale=${es}`).toBeGreaterThan(TEST_SURFACE.h - 8);
    }
  });
});
