// chart-preview 03 · 面板模型的排布数学（纯函数）：面板数 / 面板 → 布局轴窗口 / 可见区间 /
// 指针 → pos·秒 / 宽图排布与画布上限。
//
// 口径来源：ADR-0016 §1.1（面板 = 布局轴上的定长窗口，面板按序号横向排开）与「一个旋钮」
// （缩放推出面板宽 / 每面板秒数；面板高跟容器）。倒流区的单值性走 ADR-0010 结论（y→秒恒单值）。
import { describe, expect, it } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import {
  DEFAULT_PREVIEW_ZOOM,
  PANEL_W_PER_ES,
  PREVIEW_ZOOM_RANGE,
  esForZoom,
  makePanelLayout,
  normalizePreviewZoom,
  panelPointerAt,
  panelPosRange,
  panelScrollY,
  panelWidthForEs,
  planSheetExport,
  sheetCellRect,
  visiblePanelRange,
} from '@/src/preview/static/panelLayout';

const BPM120: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
/** 120bpm：1 拍 = 0.5s；440 虚拟 px/秒 */
const PX_PER_SECOND = 440;

function layoutOf(opts: {
  notes?: ChartNote[];
  duration?: number;
  panelH?: number;
  zoom?: number;
  verticalRatio?: number;
} = {}) {
  return makePanelLayout({
    notes: opts.notes ?? BPM120,
    chartDuration: opts.duration ?? 40,
    verticalRatio: opts.verticalRatio ?? 1,
    panelH: opts.panelH ?? 400,
    es: esForZoom(opts.zoom ?? 1),
  });
}

describe('chart-preview 03 · 面板模型：一个旋钮', () => {
  it('面板宽由缩放推出：13 车道宽（289 CSS px @ 100%，2026-10-02 二次重定基）', () => {
    expect(PANEL_W_PER_ES).toBe(13 * 30);
    expect(panelWidthForEs(esForZoom(1))).toBeCloseTo(289, 6);   // 390 × 0.74 = 288.6 → 取整
    expect(layoutOf({ zoom: 1 }).panelW).toBeCloseTo(289, 6);
    expect(layoutOf({ zoom: 2 }).panelW).toBeCloseTo(577, 6);
    expect(layoutOf({ zoom: 0.5 }).panelW).toBeCloseTo(144, 6);
  });

  it('面板宽取整（2026-09-30 验收回修「画面有点糊」）：位图缓冲恒为整数，面板不再落在半像素上', () => {
    for (const zoom of [0.3, 0.35, 0.75, 1, 1.05, 1.55, 2.35, 2.95, 3]) {
      const es = esForZoom(zoom);
      const w = panelWidthForEs(es);
      expect(Number.isInteger(w)).toBe(true);
      expect(Math.abs(w - PANEL_W_PER_ES * es)).toBeLessThanOrEqual(0.5);   // 取整只挪半个像素以内
      expect(layoutOf({ zoom }).panelW).toBe(w);
    }
  });

  it('缩放连续可调，但夹在 30%..300%（滑杆与滚轮共用 normalizePreviewZoom）', () => {
    expect(PREVIEW_ZOOM_RANGE).toMatchObject({ min: 0.3, max: 3 });
    expect(normalizePreviewZoom(1.37)).toBeCloseTo(1.37, 6);
    expect(normalizePreviewZoom(9)).toBe(PREVIEW_ZOOM_RANGE.max);
    expect(normalizePreviewZoom(0.01)).toBe(PREVIEW_ZOOM_RANGE.min);
    expect(normalizePreviewZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PREVIEW_ZOOM);
  });

  it('标准档每面板 ≈1.65 秒（289 宽 / 537 高）；Bestdori 130px 档（≈3.66 秒）落在 zoom ≈ 0.45', () => {
    const standard = layoutOf({ panelH: 537, zoom: 1 });
    expect(standard.secondsPerPanel).toBeCloseTo(537 / 0.74 / PX_PER_SECOND, 6);
    expect(standard.secondsPerPanel).toBeGreaterThan(1.6);
    expect(standard.secondsPerPanel).toBeLessThan(1.7);

    const bestdori = layoutOf({ panelH: 537, zoom: 0.45 });   // es ≈ 1/3 → 面板宽回到 130
    expect(bestdori.panelW).toBe(130);
    expect(bestdori.secondsPerPanel).toBeGreaterThan(3.5);
    expect(bestdori.secondsPerPanel).toBeLessThan(3.8);
  });

  it('缩放↑ → 轨道变宽、每面板时间缩短、面板数变多（横向滑条自然出现）', () => {
    const base = layoutOf();
    const zoomIn = layoutOf({ zoom: 2 });
    expect(zoomIn.panelW).toBeGreaterThan(base.panelW);
    expect(zoomIn.secondsPerPanel).toBeCloseTo(base.secondsPerPanel / 2, 6);
    expect(zoomIn.panelCount).toBeGreaterThan(base.panelCount);   // ceil 口径：33 → 66，不保证正好翻倍
  });

  it('面板数 = ceil(chartEndVirtualY ÷ (panelH / es))；整除数不多出空面板', () => {
    // 40s → 17,600 虚拟 px；面板高 400、es = 0.74 → 窗口 540.54 → 32.56… → 33 个面板
    const layout = layoutOf({ panelH: 400, zoom: 1 });
    expect(layout.geometry.chartEndVirtualY).toBeCloseTo(40 * PX_PER_SECOND, 6);
    expect(layout.windowVirtualY).toBeCloseTo(400 / 0.74, 6);
    expect(layout.panelCount).toBe(Math.ceil(layout.geometry.chartEndVirtualY / layout.windowVirtualY));
    expect(layout.panelCount).toBe(33);

    // 正好整除（浮点安全）：20s（8,800 虚拟 px）÷ 窗口 1,100（面板高 814 = 1100 × 0.74）= 恰好 8 个，不该冒第 9 个
    const exact = layoutOf({ duration: 20, panelH: 814, zoom: 1 });
    expect(exact.windowVirtualY).toBeCloseTo(1100, 6);
    expect(exact.panelCount).toBe(8);
  });

  it('面板 k 的布局轴窗口 = [k·W, (k+1)·W)；面板高变化 → 每面板秒数跟着变（Bestdori 语义）', () => {
    const layout = layoutOf({ panelH: 400, zoom: 1 });
    expect(panelPosRange(layout, 0)).toEqual({ posMin: 0, posMax: layout.windowVirtualY });
    expect(panelPosRange(layout, 3)).toEqual({ posMin: 3 * layout.windowVirtualY, posMax: 4 * layout.windowVirtualY });

    const shorter = layoutOf({ panelH: 200, zoom: 1 });
    expect(shorter.secondsPerPanel).toBeCloseTo(layout.secondsPerPanel / 2, 6);
    expect(shorter.panelCount).toBe(66);   // ceil 口径：33 → 66，不是正好翻倍
  });

  it('面板 k 的 scrollY：画布顶正好落在窗口上缘 (k+1)·W 上', () => {
    const layout = layoutOf({ panelH: 400, zoom: 1 });
    const k = 4;
    const scrollY = panelScrollY(layout, k);
    expect(scrollY).toBeCloseTo(layout.geometry.chartEndVirtualY - k * layout.windowVirtualY, 6);
    // 画布顶 (canvasY = 0) 与画布底 (canvasY = panelH) 的 pos 正是窗口的两端
    expect(panelPointerAt(layout, k, 0).pos).toBeCloseTo((k + 1) * layout.windowVirtualY, 6);
    expect(panelPointerAt(layout, k, layout.panelH).pos).toBeCloseTo(k * layout.windowVirtualY, 6);
    // 第 0 个面板 = 谱面最开头那段（左起 = 时间最早）
    expect(panelPointerAt(layout, 0, layout.panelH).pos).toBeCloseTo(0, 6);
  });
});

describe('chart-preview 03 · 可见面板区间', () => {
  const layout = layoutOf({ panelH: 400, zoom: 1 });   // panelW = 289、33 个面板

  it('scrollLeft / 视口宽 → [floor(scrollLeft/panelW), floor((scrollLeft+viewW)/panelW)]', () => {
    expect(visiblePanelRange(layout, 0, 1155)).toEqual({ lo: 0, hi: 3 });     // 1155 = 289 × 4 - 1
    expect(visiblePanelRange(layout, 1445, 1155)).toEqual({ lo: 5, hi: 8 });  // 1445 = 289 × 5
    expect(visiblePanelRange(layout, 578, 289)).toEqual({ lo: 2, hi: 3 });    // 右缘正好落在边界：那一格也算
    expect(visiblePanelRange(layout, 578, 288)).toEqual({ lo: 2, hi: 2 });    // 差 1px 不到边界：不多算
  });

  it('两端钳进 [0, panelCount-1]；尺寸未知 / 面板数为 0 时给空区间', () => {
    expect(visiblePanelRange(layout, -50, 100)).toEqual({ lo: 0, hi: 0 });
    expect(visiblePanelRange(layout, 99999, 500).hi).toBe(layout.panelCount - 1);
    expect(visiblePanelRange(layout, 0, 0)).toEqual({ lo: 0, hi: 0 });
    const empty = makePanelLayout({ notes: BPM120, chartDuration: 0, verticalRatio: 1, panelH: 400, es: esForZoom(1) });
    expect(empty.panelCount).toBe(0);
    expect(visiblePanelRange(empty, 0, 500)).toEqual({ lo: 0, hi: -1 });
  });
});

describe('chart-preview 03 · 面板内指针 → pos / 秒', () => {
  it('线性直读：面板顶 = 窗口上缘秒、面板底 = 窗口下缘秒，不吸附', () => {
    const layout = layoutOf({ panelH: 400, zoom: 1 });   // 每面板 540.54/440 ≈ 1.23s
    const k = 5;
    const top = panelPointerAt(layout, k, 0);
    const bottom = panelPointerAt(layout, k, layout.panelH);
    const mid = panelPointerAt(layout, k, layout.panelH / 2);

    expect(top.seconds).toBeCloseTo((k + 1) * layout.secondsPerPanel, 6);
    expect(bottom.seconds).toBeCloseTo(k * layout.secondsPerPanel, 6);
    expect(mid.seconds).toBeCloseTo((top.seconds + bottom.seconds) / 2, 6);
    expect(panelPointerAt(layout, k, 37).seconds).toBeCloseTo(top.seconds - 37 / layout.es / PX_PER_SECOND, 6);
  });

  it('倒流区里 y → 秒恒单值（走布局轴直读），而 y → 拍是多值', () => {
    // 0..40 拍 +120bpm，40..48 拍 -120bpm（倒流），48 拍起 +120bpm
    const backflow: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'BPM', beat: 40, bpm: -120 },
      { type: 'BPM', beat: 48, bpm: 120 },
    ];
    // 折返区在时间轴上占 pos ∈ [16s, 20s]（= 虚拟 px 7,040..8,800；20s 处 -120bpm 折回 4 秒）；
    // 面板 14（窗口 540.54 → [7,568, 8,108]）整个落在这段里
    const layout = layoutOf({ notes: backflow, duration: 30, panelH: 400, zoom: 1 });
    const k = 14;

    // 折叠段（时间轴回退那一段）里的某个 y：秒单值、拍多解
    const ys = Array.from({ length: 21 }, (_, i) => (i / 20) * layout.panelH);
    const seconds = ys.map((y) => panelPointerAt(layout, k, y).seconds);
    for (let i = 1; i < seconds.length; i++) {
      expect(seconds[i]!).toBeLessThan(seconds[i - 1]!);   // 面板内 y 向下 = 时间向后，严格单调（单值）
    }

    const multi = ys
      .map((y) => {
        const virtualY = panelScrollY(layout, k) + y / layout.es;
        return layout.geometry.virtualYSolutions(virtualY, layout.es).length;
      })
      .filter((n) => n > 1);
    expect(multi.length).toBeGreaterThan(0);   // 折返带上「同一个 y」确实对应多个拍解

    // 秒读数与布局轴（geometry）那一份逐点一致：预览没有自己的第二套换算
    for (const y of ys) {
      const virtualY = panelScrollY(layout, k) + y / layout.es;
      expect(panelPointerAt(layout, k, y).seconds).toBeCloseTo(
        layout.geometry.virtualYToSeconds(virtualY, layout.es),
        9,
      );
    }
  });
});

describe('chart-preview 03 · 宽图排布与画布上限', () => {
  const PANEL_W = 130;
  const PANEL_H = 537;

  it('单行宽图：宽 = 面板数 × 面板宽、高 = 一格面板（3 分钟谱 ≈ 50 面板 ≈ 6,500 px 宽）', () => {
    const plan = planSheetExport({ panelCount: 45, panelW: PANEL_W, panelH: PANEL_H, dpr: 2 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows).toBe(1);
    expect(plan.cols).toBe(45);
    expect(plan.sheetW).toBe(45 * PANEL_W);
    expect(plan.sheetH).toBe(PANEL_H);
    expect(plan.bufferW).toBe(45 * PANEL_W * 2);
    expect(plan.bufferH).toBe(PANEL_H * 2);
    expect(plan.downscaled).toBe(false);
  });

  it('宽度超单边上限才折行：列数取满（行数最少），仍在上限内', () => {
    const plan = planSheetExport({ panelCount: 600, panelW: PANEL_W, panelH: PANEL_H, dpr: 2 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.cols).toBe(Math.floor(65535 / (PANEL_W * 2)));   // 252 列
    expect(plan.rows).toBe(3);
    expect(plan.bufferW).toBeLessThanOrEqual(65535);
    expect(plan.bufferH).toBeLessThanOrEqual(65535);
  });

  it('面积超限 → 降密度（dpr 2 → 1），而不是画爆', () => {
    const plan = planSheetExport({ panelCount: 1200, panelW: PANEL_W, panelH: PANEL_H, dpr: 2 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.dpr).toBe(1);
    expect(plan.downscaled).toBe(true);
    expect(plan.bufferW * plan.bufferH).toBeLessThanOrEqual(2 ** 28);
  });

  it('降密度也过不去 → 拒绝出图（带原因），不硬画', () => {
    const plan = planSheetExport({
      panelCount: 20, panelW: PANEL_W, panelH: PANEL_H, dpr: 2,
      limits: { maxSidePx: 200, maxAreaPx: 10_000 },
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.detail).toContain('上限');
  });

  it('没有面板可导出 → 直接拒绝', () => {
    expect(planSheetExport({ panelCount: 0, panelW: PANEL_W, panelH: PANEL_H, dpr: 2 }).ok).toBe(false);
  });

  it('格子坐标：逐行铺满（第 k 格 = 第 k 列 / 行）', () => {
    const plan = planSheetExport({ panelCount: 600, panelW: PANEL_W, panelH: PANEL_H, dpr: 2 });
    if (!plan.ok) throw new Error('plan 不该失败');
    expect(sheetCellRect(plan, 0)).toEqual({ x: 0, y: 0, w: PANEL_W, h: PANEL_H });
    expect(sheetCellRect(plan, plan.cols)).toEqual({ x: 0, y: PANEL_H, w: PANEL_W, h: PANEL_H });
    expect(sheetCellRect(plan, plan.cols - 1)).toEqual({
      x: (plan.cols - 1) * PANEL_W, y: 0, w: PANEL_W, h: PANEL_H,
    });
  });
});
