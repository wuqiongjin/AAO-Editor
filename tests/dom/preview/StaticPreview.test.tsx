// @vitest-environment jsdom
// chart-preview 03 · 静态预览画面的**行为锁**（面板懒绘制 + 记账 + hover 口径）。
//
// jsdom 没有布局引擎（tests/README 口径）：容器尺寸 / 滚动位由本文件显式注入（照
// ChartViewSession.test.tsx 的 mockLayout），断言的是"什么时候出图、出了几张、指针交给了谁"，
// 不是像素。真实光栅与观感走人工验收（票 03 锁测第 4 条）。
//
// 绘制接缝：`painterFactory` 注入记录型替身 —— 出图次数、面板号、hover 位置都可断言；
// 另有一条用例把真渲染接上假 2d context，验"读数与画布同一口径"。
import '@testing-library/jest-dom/vitest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ChartNote } from '@/src/chart/types';
import { countNotesUpToBeat } from '@/src/chart/editing/NoteEditing';
import { formatInMinuteTime } from '@/src/chart/geometry/TimeFormat';
import StaticPreviewView, { type StaticPreviewViewProps } from '@/src/preview/static/StaticPreviewView';
import type { PanelPainter, PanelPainterParams } from '@/src/preview/static/panelPainter';
import {
  DEFAULT_PREVIEW_ZOOM,
  PREVIEW_ZOOM_RANGE,
  esForZoom,
  makePanelLayout,
  normalizePreviewZoom,
  panelPointerAt,
  panelScrollY,
  panelWidthForEs,
} from '@/src/preview/static/panelLayout';
import { makeRecordingCtx, type RecordedCall } from '@/tests/support/canvas';

// jsdom 没有 ResizeObserver：本文件只关心滚动/出图协议，观察者空实现即可（尺寸由 mockLayout 注入）
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

// jsdom 没有 canvas 实现（`getContext` 会打印 "Not implemented" 噪音）：整文件给一个空实现，
// 本组用例只关心出图协议；"读数口径"那条用例自己再换成记录型 ctx。
const NOOP_CTX = makeRecordingCtx().proxy;
const ORIGINAL_GET_CONTEXT = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  // jsdom 的 canvas 无 2d 实现：类型上只能这么塞（形状兼容的假 ctx）
  HTMLCanvasElement.prototype.getContext = (() => NOOP_CTX) as typeof HTMLCanvasElement.prototype.getContext;
});
afterAll(() => { HTMLCanvasElement.prototype.getContext = ORIGINAL_GET_CONTEXT; });

const NOTES: ChartNote[] = [
  { type: 'BPM', beat: 0, bpm: 120 },
  { type: 'Single', beat: 1, lane: 0 },
  { type: 'Single', beat: 3, lane: 3 },
  { type: 'Single', beat: 5, lane: 6 },
  { type: 'LDirectional', beat: 7, lane: 2, length: 2 },
];
/** 120bpm：1 拍 = 0.5s；谱面 40s → 440 × 40 = 17,600 虚拟 px */
const CHART_DURATION = 40;
const VERTICAL_RATIO = 1;
const BEAT_DISPLAY = 16;
/** 标准缩放档（2026-10-02 二次重定基）：面板宽 289、es = 0.74，面板高 400 → 每面板 540.54 虚拟 px（≈1.23 秒）→ 33 个面板 */
const ZOOM = 1;
const PANEL_W = 289;
const PANEL_H = 400;

const SETTINGS_DISPLAY = {
  noteSize: 1,
  slideOpacity: 1,
  simultaneousClickLines: true,
  colorAssist: true,
  verticalRatio: VERTICAL_RATIO,
  imageQuality: 'standard',
  gridStyle: 'vivid',
  lineShapeTiers: false,
  gridOpacity: 0.8,
  labelScale: 1,
} as const;

const BASE_PROPS = {
  scene: {
    notes: NOTES,
    chartDuration: CHART_DURATION,
    verticalRatio: VERTICAL_RATIO,
    beatDisplay: BEAT_DISPLAY,
    settingsDisplay: SETTINGS_DISPLAY,
    noteSkin: {},
  },
  zoom: ZOOM,
} as const;

/** 面板模型（与组件同一份纯函数算出的期望值；断言不抄实现，只复用同一份数学） */
function expectedLayout(zoom = ZOOM) {
  return makePanelLayout({
    notes: NOTES,
    chartDuration: CHART_DURATION,
    verticalRatio: VERTICAL_RATIO,
    panelH: PANEL_H,
    es: esForZoom(zoom),
  });
}

interface PaintCall {
  panel: number;
  hover: { cx: number; cy: number } | null;
}

function makeRecordingFactory(sink: PaintCall[]) {
  return (params: PanelPainterParams): PanelPainter => ({
    panelW: params.layout.panelW,
    panelH: params.layout.panelH,
    es: params.layout.es,
    bufferW: Math.round(params.layout.panelW * params.dpr),
    bufferH: Math.round(params.layout.panelH * params.dpr),
    blitInto(panelIndex, _dest, _x, _y, hover) {
      sink.push({ panel: panelIndex, hover: hover ?? null });
    },
  });
}

const PANEL_RECT = {
  x: 0, y: 0, left: 0, top: 0, right: PANEL_W, bottom: PANEL_H,
  width: PANEL_W, height: PANEL_H, toJSON: () => ({}),
} as DOMRect;

/** 一次挂载会话：出图记录 + 稳定的出图器工厂（rerender 不该因此换代重画）；`real` = 用真渲染 */
function session(opts: { width?: number; height?: number; real?: boolean; props?: Partial<StaticPreviewViewProps> } = {}) {
  const calls: PaintCall[] = [];
  const painterFactory = makeRecordingFactory(calls);
  const build = (props: Partial<StaticPreviewViewProps>): ReactElement => (
    <StaticPreviewView
      {...BASE_PROPS}
      {...(opts.real ? {} : { painterFactory })}
      {...opts.props}
      {...props}
    />
  );
  const view = render(build({}));
  const host = view.container.firstElementChild as HTMLDivElement;
  const width = opts.width ?? PANEL_W * 4 - 1;
  let scrollLeft = 0;
  let height = opts.height ?? PANEL_H;
  Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(host, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (v: number) => { scrollLeft = v; },
  });
  /** 面板槽：按可访问名查（`role="img"` + 「面板 N：…」；tests/README：只按 role/text 查询） */
  const panels = () => within(host).getAllByRole('img', { name: /^面板/ });
  const sync = () => act(() => { fireEvent.scroll(host); });
  const rerender = (props: Partial<StaticPreviewViewProps>) => view.rerender(build(props));
  const scrollTo = (left: number) => {
    scrollLeft = left;
    sync();
  };
  return {
    host,
    calls,
    rerender,
    sync,
    scrollTo,
    setHeight: (next: number) => {
      height = next;
      act(() => { fireEvent(window, new Event('resize')); });
    },
    panel: (k: number) => panels()[k]!,
    /** 位图 = 面板槽里那张 canvas（canvas 没有可访问名，只能按结构查——本文件唯一的例外） */
    painted: () => host.querySelectorAll('canvas').length,
    paintedIndexes: () => panels()
      .map((el, k) => (el.querySelector('canvas') != null ? k : -1))
      .filter((k) => k >= 0),
  };
}

describe('chart-preview 03 · 面板懒绘制与记账', () => {
  it('只画可见区间里的面板：一屏 4 格 → 头 4 个面板各出一张位图', () => {
    const s = session();
    s.sync();

    expect(s.paintedIndexes()).toEqual([0, 1, 2, 3]);
    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3]);
  });

  it('滚到第 6 格才建那几格；滚出去的不销毁（位图留着，账也留着）', () => {
    const s = session();
    s.sync();
    s.scrollTo(PANEL_W * 5);   // 可见区间 = [floor(1445/289), floor((1445 + 1155)/289)] = 5..8

    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(s.paintedIndexes()).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    // 中间那格（4）从没进过视口 → 没有位图
    expect(s.panel(4).querySelector('canvas')).toBeNull();
  });

  it('可见区间两端按 ADR-0016 §1.1 的公式取整：右缘正好落在面板边界的那一格也算上', () => {
    const s = session({ width: PANEL_W * 4 });
    s.sync();

    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3, 4]);
  });

  it('同一面板只画一次：滚走再滚回来不重画', () => {
    const s = session();
    s.sync();
    s.scrollTo(PANEL_W * 5);
    const before = s.calls.length;

    s.scrollTo(0);

    expect(s.calls.length).toBe(before);
    expect(s.calls.filter((c) => c.panel === 0)).toHaveLength(1);
  });

  it('换缩放档：面板变宽、每面板秒数减半、面板数增多，可见面板重出图', () => {
    const s = session();
    s.sync();
    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3]);

    s.rerender({ zoom: ZOOM * 2 });

    expect(expectedLayout(ZOOM * 2).panelW).toBe(577);   // 390 × 0.74 × 2 = 577.2 → 577
    expect(expectedLayout(ZOOM * 2).secondsPerPanel).toBeCloseTo(expectedLayout().secondsPerPanel / 2, 6);
    expect(expectedLayout(ZOOM * 2).panelCount).toBe(66);   // ceil 口径：32.56 → 65.12，不是正好翻倍
    // 新档 = 新画家 → 账作废：可见面板重出（面板变宽 → 这一屏 1155px 只剩 3 格）；
    // 视口外的面板 3 位图**整块作废**（issue 11 #2：换代不把老画家的图留在画布上）
    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3, 0, 1, 2]);
    expect(s.paintedIndexes()).toEqual([0, 1, 2]);
  });

  it('换谱面（新画家）：滚出视口的老位图连 canvas 一起作废，滚回去必须重画（issue 11 #2）', () => {
    const s = session();
    s.sync();
    s.scrollTo(PANEL_W * 5);   // 0..3 出过图、滚出视口（位图留着）；5..8 出图

    expect(s.paintedIndexes()).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    const before = s.calls.length;

    // 换谱面 = 新画家：此刻若不动作，0..3 的画布会留着上一版谱面的位图（横滚进场先闪一帧旧音符）
    s.rerender({ scene: { ...BASE_PROPS.scene, notes: [...NOTES, { type: 'Single', beat: 8, lane: 5 }] } });

    expect(s.calls.slice(before).map((c) => c.panel)).toEqual([5, 6, 7, 8]);   // 可见区间重出
    expect(s.paintedIndexes()).toEqual([5, 6, 7, 8]);                          // 视口外的连 canvas 撤掉

    const after = s.calls.length;
    s.scrollTo(0);   // 滚回去：没有旧位图可露，必须老老实实重画
    expect(s.calls.slice(after).map((c) => c.panel)).toEqual([0, 1, 2, 3]);
    expect(s.paintedIndexes()).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  it('容器变矮（窗口 resize）：面板高跟着变 → 每面板秒数减半、面板数增多，可见面板重出图', () => {
    const s = session();
    s.sync();
    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3]);

    s.setHeight(PANEL_H / 2);

    const shorter = makePanelLayout({
      notes: NOTES,
      chartDuration: CHART_DURATION,
      verticalRatio: VERTICAL_RATIO,
      panelH: PANEL_H / 2,
      es: esForZoom(ZOOM),
    });
    expect(shorter.secondsPerPanel).toBeCloseTo(expectedLayout().secondsPerPanel / 2, 6);
    expect(shorter.panelCount).toBe(66);   // ceil 口径：32.56 → 65.12，不是正好翻倍
    // 面板尺寸进几何 → 新画家 → 可见面板重出（位图缓冲也跟着换）
    expect(s.calls.slice(4).map((c) => c.panel)).toEqual([0, 1, 2, 3]);
  });
});

describe('chart-preview 03→08 · 清晰度：面板位图密度（ADR-0017 不变量「位图:物理 = 整数」）', () => {
  /** 一块面板的位图缓冲宽 —— 密度档位的直接读数（面板宽 289 @zoom 1） */
  function panelBuffer(imageQuality: 'smooth' | 'standard' | 'hd'): { w: number; h: number } {
    const s = session({
      real: true,
      props: { scene: { ...BASE_PROPS.scene, settingsDisplay: { ...SETTINGS_DISPLAY, imageQuality } } },
    });
    s.sync();
    const canvas = s.panel(0).querySelector('canvas')!;
    return { w: canvas.width, h: canvas.height };
  }

  it('设备像素比 1 的屏：density = dpr × 超采样档（流畅1/标准1/高清2）—— 08 四轮口径（Q8 接受标准档余量回退）', () => {
    // jsdom 的 devicePixelRatio 恒为 1
    expect(window.devicePixelRatio).toBe(1);

    expect(panelBuffer('standard')).toEqual({ w: PANEL_W, h: PANEL_H });            // 标准 = 1:1 物理（零重采样）
    expect(panelBuffer('hd')).toEqual({ w: PANEL_W * 2, h: PANEL_H * 2 });          // 高清 = 2× 盒式超采样
    expect(panelBuffer('smooth')).toEqual({ w: PANEL_W, h: PANEL_H });              // 流畅照旧 1:1（作者的选择）
  });

  it('density/dpr 恒为整数（dpr 3：标准 3 / 高清 6）—— 非整 dpr 屏不再落进非整数重采样', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    try {
      expect(panelBuffer('standard')).toEqual({ w: PANEL_W * 3, h: PANEL_H * 3 });
      expect(panelBuffer('smooth')).toEqual({ w: PANEL_W * 3, h: PANEL_H * 3 });
      expect(panelBuffer('hd')).toEqual({ w: PANEL_W * 6, h: PANEL_H * 6 });        // 2× 盒式，整数比
    } finally {
      if (original) Object.defineProperty(window, 'devicePixelRatio', original);
    }
  });
});

describe('chart-preview 03 · 滚轮：横滚与缩放（2026-09-30 验收）', () => {
  const wheel = (host: HTMLElement, init: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    act(() => { fireEvent(host, event); });
    return event;
  };

  it('光滚轮 = 横向滚动（纵向滚轮也映射成横滚），并拦掉默认滚动', () => {
    const s = session();
    s.sync();

    const down = wheel(s.host, { deltaY: 200 });
    expect(down.defaultPrevented).toBe(true);
    expect(s.host.scrollLeft).toBe(200);
    // 可见区间跟着滚：滚到 200 px → 可见 [floor(200/289), floor((200 + 1155)/289)] = 0..4
    expect(s.calls.map((c) => c.panel)).toEqual([0, 1, 2, 3, 4]);

    const up = wheel(s.host, { deltaY: -200 });
    expect(up.defaultPrevented).toBe(true);
    expect(s.host.scrollLeft).toBe(0);
  });

  it('Ctrl/⌘+滚轮 = 缩放这一屏（拦掉整页缩放），并把指针下的那一格钉住', () => {
    const onZoom = vi.fn();
    const s = session({ props: { onZoom } });
    s.sync();
    s.scrollTo(PANEL_W * 10);   // 先滚到中段，免得锚点落在 0 处被钳掉

    const event = wheel(s.host, { deltaY: -100, ctrlKey: true, clientX: 100 });

    expect(event.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalledTimes(1);
    const nextZoom = onZoom.mock.calls[0]![0] as number;
    expect(nextZoom).toBeGreaterThan(1);

    // 换代前不抢写（issue 11 #3）：这一刻 DOM 还是旧内容宽，写下去会被浏览器按旧宽钳、滚动条回跳
    expect(s.host.scrollLeft).toBe(PANEL_W * 10);

    // 布局换代（父层把新 zoom 传下来）→ 锚点在 layout effect 里一次性对齐：
    // 指针下那一格（带小数）落在同一屏位置，且写盘时新面板宽已经进 DOM
    s.rerender({ zoom: nextZoom });

    const offsetX = 100;
    const panelAt = (PANEL_W * 10 + offsetX) / PANEL_W;
    const expectedScrollLeft = panelAt * panelWidthForEs(esForZoom(nextZoom)) - offsetX;
    expect(s.host.scrollLeft).toBeCloseTo(expectedScrollLeft, 0);
  });

  it('连发滚轮（换代还没落地）：第二发从**新档**继续，不把上一档重复算（issue 11 #3）', () => {
    const onZoom = vi.fn();
    const s = session({ props: { onZoom } });
    s.sync();
    s.scrollTo(PANEL_W * 10);

    wheel(s.host, { deltaY: -100, ctrlKey: true, clientX: 100 });
    wheel(s.host, { deltaY: -100, ctrlKey: true, clientX: 100 });

    expect(onZoom).toHaveBeenCalledTimes(2);
    expect(onZoom.mock.calls[1]![0]).toBeGreaterThan(onZoom.mock.calls[0]![0] as number);
  });

  it('锚点只落一次：换代后再改布局（容器变矮）不动 scrollLeft（没有滞留的待办锚点）', () => {
    const onZoom = vi.fn();
    const s = session({ props: { onZoom } });
    s.sync();
    s.scrollTo(PANEL_W * 10);

    wheel(s.host, { deltaY: -100, ctrlKey: true, clientX: 100 });
    s.rerender({ zoom: onZoom.mock.calls[0]![0] as number });
    const settled = s.host.scrollLeft;
    expect(settled).toBeGreaterThan(0);

    s.setHeight(PANEL_H / 2);
    expect(s.host.scrollLeft).toBe(settled);
  });

  it('滑杆给的值也走同一把尺：连续可调、两端夹在区间内', () => {
    expect(normalizePreviewZoom(1.23)).toBeCloseTo(1.23, 6);
    expect(normalizePreviewZoom(99)).toBe(PREVIEW_ZOOM_RANGE.max);
    expect(normalizePreviewZoom(0)).toBe(PREVIEW_ZOOM_RANGE.min);
    expect(normalizePreviewZoom(Number.NaN)).toBe(DEFAULT_PREVIEW_ZOOM);
  });
});

describe('chart-preview 03 · 面板内指针 → 布局轴（与画布同一口径）', () => {
  it('面板顶 = 窗口上缘秒、面板底 = 窗口下缘秒（线性直读，不吸附）', () => {
    const layout = expectedLayout();
    const k = 2;
    const top = panelPointerAt(layout, k, 0);
    const bottom = panelPointerAt(layout, k, PANEL_H);
    const middle = panelPointerAt(layout, k, PANEL_H / 2);

    expect(top.seconds).toBeCloseTo((k + 1) * layout.secondsPerPanel, 6);
    expect(bottom.seconds).toBeCloseTo(k * layout.secondsPerPanel, 6);
    expect(middle.seconds).toBeCloseTo((top.seconds + bottom.seconds) / 2, 6);
    expect(top.pos - bottom.pos).toBeCloseTo(layout.windowVirtualY, 6);
  });

  it('hover：把面板局部指针交给同一渲染入口；离开 / 换面板时旧面板重出一帧干净的', () => {
    const s = session();
    s.sync();
    vi.spyOn(s.panel(1), 'getBoundingClientRect').mockReturnValue(PANEL_RECT);

    act(() => { fireEvent.mouseMove(s.panel(1), { clientX: 40, clientY: 120 }); });

    const hovered1 = s.calls.filter((c) => c.panel === 1 && c.hover != null);
    expect(hovered1).toHaveLength(1);
    expect(hovered1[0]!.hover).toEqual({ cx: 0, cy: 120 });

    vi.spyOn(s.panel(2), 'getBoundingClientRect').mockReturnValue(PANEL_RECT);
    act(() => { fireEvent.mouseMove(s.panel(2), { clientX: 40, clientY: 60 }); });

    expect(s.calls.filter((c) => c.panel === 1).pop()!.hover).toBeNull();
    expect(s.calls.filter((c) => c.panel === 2).pop()!.hover).toEqual({ cx: 0, cy: 60 });

    act(() => { fireEvent.mouseLeave(s.panel(2)); });
    expect(s.calls.filter((c) => c.panel === 2).pop()!.hover).toBeNull();
  });

  it('读数口径 = 画布那份：真渲染画出的分内时间 / 已过音符数与同一套函数算的一致', () => {
    // jsdom 无 canvas 实现：全局换成记录型假 ctx（图层缓存自建位图也走它），让 renderChart 真跑
    const { proxy, calls } = makeRecordingCtx();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => proxy) as typeof HTMLCanvasElement.prototype.getContext;
    try {
      const s = session({ real: true });
      s.sync();
      calls.length = 0;

      const k = 1;
      const cy = 120;
      vi.spyOn(s.panel(k), 'getBoundingClientRect').mockReturnValue(PANEL_RECT);
      act(() => { fireEvent.mouseMove(s.panel(k), { clientX: 40, clientY: cy }); });

      const texts = calls.filter(([name]: RecordedCall) => name === 'fillText').map(([, args]) => args[0]);
      const layout = expectedLayout();
      const virtualY = panelScrollY(layout, k) + cy / layout.es;
      const expectedTime = formatInMinuteTime(layout.geometry.virtualYToSeconds(virtualY, layout.es));
      const expectedCount = `♪ ${countNotesUpToBeat(NOTES, layout.geometry.virtualYToBeat(virtualY, layout.es))}`;

      expect(texts).toContain(expectedTime);
      expect(texts).toContain(expectedCount);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
});
