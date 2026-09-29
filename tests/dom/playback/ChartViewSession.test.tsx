// @vitest-environment jsdom
// architecture-refactor/09（架构评审候选 4）· 谱面视口会话的**行为锁**。
//
// 票面把三条滚动 DOM 不变量搬进 useChartViewSession：虚拟高度落地（写 .virtual-content + 首次置底 +
// 标记已初始化）、按秒重锚（canvas.setScrollY + 滚动条比例位 + 回声登记）、程序化写入回声吞掉。
// 这些断言的"真相"在 DOM 协议与 effect 次序里，静态文本锁盯不住 —— 本文件用最小驾驭壳挂真 hook。
//
// jsdom 没有布局引擎（tests/README 口径）：滚动尺寸由本文件**显式注入**（scrollHeight / clientHeight /
// scrollTop 存取器），断言的是协议（写了什么值、有没有 seek），不是视觉效果。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import type { ChartNote } from '@/src/chart/types';
import type { FinalVirtualCanvasHandle } from '@/src/chart/components/canvas/FinalVirtualCanvas';
import { useChartViewSession, type ChartViewSession } from '@/src/playback/useChartViewSession';

// useSurfaceSize 会 new ResizeObserver（jsdom 没有）；本文件只关心滚动协议，观察者空实现即可
// （surface 保持 null → 几何走 PLACEHOLDER_SURFACE，与画布未回调时的产品口径一致）。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

const NOTES: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 100;
const MAX_SCROLL = SCROLL_HEIGHT - CLIENT_HEIGHT;

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
  // 与工作台页同款接线：滚动宿主的 onScroll 直连会话的 onScrollbarScroll
  return (
    <div ref={containerRef} style={{ overflow: 'auto' }} onScroll={session.onScrollbarScroll}>
      <div className="virtual-content" />
    </div>
  );
}

/** 把滚动宿主的布局尺寸与 scrollTop 换成本文件可控的存取器（jsdom 无布局）。 */
function mockLayout(host: HTMLDivElement) {
  let scrollTop = 0;
  Object.defineProperty(host, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT });
  Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v; },
  });
  return {
    readScrollTop: () => scrollTop,
    writeScrollTop: (v: number) => { scrollTop = v; },
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
  return { box, setScrollY, onSecondsChange, host, layout, rerender: (d: number) => view.rerender(renderHarness(d)) };
}

describe('architecture-refactor 09 · 谱面视口会话（DOM 不变量行为锁）', () => {
  it('首次虚拟高度落地：写 .virtual-content 高度、置底（初始滚动 = beat0）', () => {
    const { box, host } = mount();

    act(() => { box.session!.onCanvasScrollChange(300, SCROLL_HEIGHT); });

    const content = host.querySelector('.virtual-content') as HTMLElement;
    expect(content.style.height).toBe(`${SCROLL_HEIGHT}px`);
    expect(host.scrollTop).toBe(MAX_SCROLL);
  });

  it('谱面末端变化：按锚点秒重锚（画布 setScrollY + 滚动条比例位 + 不跳尾）', () => {
    const { box, setScrollY, layout, rerender } = mount(30);
    act(() => { box.session!.onCanvasScrollChange(300, SCROLL_HEIGHT); });
    expect(setScrollY).not.toHaveBeenCalled(); // 首次落地只置底，不重锚

    const model = box.session!.scrollModel;
    const anchorSeconds = model.getAnchorSeconds();
    setScrollY.mockClear();

    // 时长 30 → 60：chartEndKey 变化 → 置位待重锚 → 会话按锚点秒消费
    act(() => { rerender(60); });

    const expectedScrollY = model.scrollYForSeconds(anchorSeconds);
    expect(expectedScrollY).toBeGreaterThan(0);
    expect(setScrollY).toHaveBeenCalledTimes(1);
    expect(setScrollY).toHaveBeenCalledWith(expectedScrollY);
    // 滚动条比例位与画布同源写入（issue 75 口径）
    expect(layout.readScrollTop()).toBeCloseTo(model.canvasScrollYToScrollTop(expectedScrollY, MAX_SCROLL), 6);
  });

  it('程序化写入的回声被吞掉（不反算 seek）；手滚照常让画布跟随并写回秒数', () => {
    const { box, setScrollY, onSecondsChange, host, layout, rerender } = mount(30);
    act(() => { box.session!.onCanvasScrollChange(300, SCROLL_HEIGHT); });

    // 重锚写回的比例位 = 刚登记的回声值
    act(() => { rerender(60); });
    const echoTop = layout.readScrollTop();
    expect(echoTop).toBeGreaterThan(0);
    onSecondsChange.mockClear();

    // ① 同一位置的 scroll 事件（浏览器取整回声）在 TTL 内 → 吞掉
    act(() => { fireEvent.scroll(host); });
    expect(onSecondsChange).not.toHaveBeenCalled();

    // ② 手滚到别处（超出 ±1px 容差）→ 反算画布 scrollY + 写回秒数
    setScrollY.mockClear();
    act(() => {
      layout.writeScrollTop(0);
      fireEvent.scroll(host);
    });
    expect(setScrollY).toHaveBeenCalledWith(0);
    expect(onSecondsChange).toHaveBeenCalledTimes(1);
  });
});
