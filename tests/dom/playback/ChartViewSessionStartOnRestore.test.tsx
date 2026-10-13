// @vitest-environment jsdom
// basic-editor 166 · 冷启动打开工作台，视口停在非开头（=90s）位置 —— **行为锁**。
//
// 症状链路：置底发生在工程恢复**之前**（默认 30s 几何），恢复到达后走「按秒重锚」（语义 = 保留
// 当前秒），而锚点已被"旧 scrollY + 新几何"刷成非零值 → 视图被钉在假秒数。点播放之所以归位，
// 是因为 RAF 每帧用引擎秒同时写画布与滚动条 —— 单线程时序，静态文本锁盯不住，故用最小驾驭壳。
//
// jsdom 没有布局引擎（tests/README 口径）：滚动尺寸由本文件**显式注入**（`scrollHeight` 跟随
// `.virtual-content` 的高度，与浏览器一致），断言的是协议（写了什么值、有没有 seek），不是视觉。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import type { ChartNote } from '@/src/chart/types';
import type { FinalVirtualCanvasHandle } from '@/src/chart/components/canvas/FinalVirtualCanvas';
import { useChartViewSession, type ChartViewSession } from '@/src/playback/useChartViewSession';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

const NOTES: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
const CLIENT_HEIGHT = 100;

interface Box {
  session: ChartViewSession | null;
}

function Harness(props: {
  box: Box;
  canvas: FinalVirtualCanvasHandle;
  chartDuration: number;
  onSecondsChange: (sec: number) => void;
}) {
  const { box, canvas, chartDuration, onSecondsChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<FinalVirtualCanvasHandle>(canvas);
  const session = useChartViewSession({
    containerRef,
    canvasRef,
    notes: NOTES,
    chartDuration,
    verticalRatio: 1,
    scale: 1,
    engine: null,
    onSecondsChange,
    onPlayingChange: () => {},
  });
  box.session = session;
  return (
    <div ref={containerRef} style={{ overflow: 'auto' }} onScroll={session.onScrollbarScroll}>
      <div className="virtual-content" />
    </div>
  );
}

/**
 * 把滚动宿主的布局尺寸换成本文件可控的存取器：`scrollHeight` = `.virtual-content` 的高度
 * （会话 effect 写入的那个，与浏览器一致），`clientHeight` 固定。
 */
function mockLayout(host: HTMLDivElement) {
  let scrollTop = 0;
  const content = host.querySelector('.virtual-content') as HTMLElement;
  Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
  Object.defineProperty(host, 'scrollHeight', {
    configurable: true,
    get: () => parseFloat(content.style.height) || 0,
  });
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v; },
  });
  return {
    readScrollTop: () => scrollTop,
    writeScrollTop: (v: number) => { scrollTop = v; },
    maxScroll: () => (parseFloat(content.style.height) || 0) - CLIENT_HEIGHT,
  };
}

function mount(chartDuration = 30) {
  const box: Box = { session: null };
  const setScrollY = vi.fn();
  const canvas: FinalVirtualCanvasHandle = { setScrollY };
  const onSecondsChange = vi.fn();
  const renderHarness = (duration: number) => (
    <Harness box={box} canvas={canvas} chartDuration={duration} onSecondsChange={onSecondsChange} />
  );
  const view = render(renderHarness(chartDuration));
  const host = view.container.firstElementChild as HTMLDivElement;
  const layout = mockLayout(host);
  return {
    box, setScrollY, onSecondsChange, host, layout,
    rerender: (d: number) => view.rerender(renderHarness(d)),
    /** 模拟画布上报（真实画布在几何/滚动变化后经 onScrollChange 上报 scrollY 与虚拟高度） */
    reportCanvas: (scrollY: number) => {
      const session = box.session!;
      act(() => { session.onCanvasScrollChange(scrollY, session.geometry.totalVirtualHeight(1)); });
    },
  };
}

describe('basic-editor 166 · 打开 / 恢复谱面 → 视口归零到 beat 0', () => {
  it('置底写入的 scroll 事件被回声吞掉（RC-2：不当手滚、不反算出非零秒）', () => {
    const { box, setScrollY, onSecondsChange, host, layout } = mount(30);
    // 首次虚拟高度落地 → 置底（初始滚动 = beat0）
    act(() => { box.session!.onCanvasScrollChange(box.session!.scrollModel.maxCanvasScrollY(), 13471); });
    expect(layout.readScrollTop()).toBe(layout.maxScroll());
    onSecondsChange.mockClear();
    setScrollY.mockClear();

    // 置底自己引发的 scroll 事件：位置 = 刚写入的置底值 → TTL 内吞掉（不得反算 seek / 写秒数）
    act(() => { fireEvent.scroll(host); });
    expect(onSecondsChange).not.toHaveBeenCalled();
    expect(setScrollY).not.toHaveBeenCalled();

    // 手滚照常跟随（回声只吞"程序化写入的那一发"，不锁死滚动）
    act(() => {
      layout.writeScrollTop(0);
      fireEvent.scroll(host);
    });
    expect(setScrollY).toHaveBeenCalled();
    expect(onSecondsChange).toHaveBeenCalled();
  });

  it('冷启动恢复（30s → 120s）：归零优先于按秒重锚，画布与滚动条都落在 beat 0', () => {
    const { box, setScrollY, onSecondsChange, layout, rerender, reportCanvas } = mount(30);
    const model = box.session!.scrollModel;
    const bottomOf30 = model.maxCanvasScrollY();
    reportCanvas(bottomOf30); // 恢复前：按默认 30s 置底
    expect(layout.readScrollTop()).toBe(layout.maxScroll());

    // 工程恢复：会话置位归零 → 新几何（120s）落地后由 effect 落权威值
    act(() => {
      box.session!.resetToStart();
      rerender(120);
    });
    // 新几何下 beat 0 = chartEndVirtualY(120s)
    const bottomOf120 = box.session!.scrollModel.maxCanvasScrollY();
    expect(bottomOf120).toBeGreaterThan(bottomOf30);
    expect(setScrollY).toHaveBeenCalledWith(bottomOf120);
    expect(box.session!.scrollModel.getAnchorSeconds()).toBe(0);

    // 画布上报新高度（真实画布在 setScrollY 后经 onScrollChange 上报）→ 滚动条比例位落到底
    reportCanvas(bottomOf120);
    expect(layout.readScrollTop()).toBeCloseTo(layout.maxScroll(), 6);
    // 秒数与视口同源归零（陈旧 scroll 事件写歪的秒数由此纠正）
    expect(onSecondsChange).toHaveBeenCalledWith(0);
    expect(box.session!.scrollModel.getAnchorSeconds()).toBe(0);
  });

  it('归零是一次性的：不会潜伏到后续无关的几何变化（issue 24「改谱长保留当前秒」不被打破）', () => {
    const { box, setScrollY, rerender, reportCanvas } = mount(30);
    const bottomOf30 = box.session!.scrollModel.maxCanvasScrollY();
    reportCanvas(bottomOf30);

    act(() => {
      box.session!.resetToStart();
      rerender(120);
    });
    reportCanvas(box.session!.scrollModel.maxCanvasScrollY());
    const model = box.session!.scrollModel;
    // 用户自己滚到 40s（此后锚点 = 40s）
    act(() => { box.session!.onCanvasScrollChange(model.scrollYForSeconds(40), box.session!.geometry.totalVirtualHeight(1)); });
    setScrollY.mockClear();

    // 又一次几何变化（例如编辑中改谱长）→ 走按秒重锚，**保留** 40s，而不是被上一轮的归零拉回开头
    act(() => { rerender(180); });
    expect(model.getAnchorSeconds()).toBeCloseTo(40, 6);
    expect(setScrollY).toHaveBeenCalledWith(model.scrollYForSeconds(40));
  });
});
