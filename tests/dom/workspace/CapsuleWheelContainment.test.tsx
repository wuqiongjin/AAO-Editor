// @vitest-environment jsdom
// 票 246 锁测：曲线选项胶囊面板内的滚轮**不出面板**，且在面板内部逐级接续（网格 → 面板）。
//
// jsdom 没有布局：`scrollHeight` / `clientHeight` 恒 0 ⇒ 什么容器都「滚不动」，这里测的是
// **决策**（该滚谁 / 该不该吞掉默认行为），所以滚动尺寸由本文件显式注入 —— 与
// tests/dom/playback/ChartViewSession.test.tsx 同一口径。真实几何（各窗宽下胶囊不越界、
// 末行可滚到可见、画布 `scrollTop` 不动）由 headless Edge 实测把关，数值记在票 246 Comments。
import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider, useUI, type ArmedTool } from '@/src/app/providers/UIProvider';
import CurveOptionsCapsule from '@/src/pages/workspace/CurveOptionsCapsule';
import { seedZhSettings } from '@/tests/support/storage';

function Arm({ tool }: { tool: ArmedTool | null }) {
  const { setArmedTool } = useUI();
  return <button type="button" onClick={() => setArmedTool(tool)}>{`arm:${tool ?? 'pointer'}`}</button>;
}

/** 胶囊所在的画布区（宿主）：只为接一颗冒泡的 wheel 监听器，看默认行为有没有被吞掉 */
const hostRef = createRef<HTMLDivElement>();

/** 打开胶囊并停在形状模板页（有网格 = 有内层滚动容器） */
function openTemplatePage() {
  seedZhSettings();
  render(
    <ConfigProvider>
      <UIProvider>
        <div className="ws-chart-area" ref={hostRef}>
          <Arm tool="curve" />
          <CurveOptionsCapsule />
        </div>
      </UIProvider>
    </ConfigProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'arm:curve' }));
  fireEvent.click(screen.getByRole('button', { name: '曲线配置' }));
  const form = screen.getByRole('group', { name: '曲线配置' });
  fireEvent.click(within(form).getByRole('tab', { name: '形状模板' }));
  return form;
}

interface Scrollport {
  top: number;
}

/** 把元素伪装成一个「内容高于视口」的纵向滚动容器（jsdom 里只能这么给尺寸） */
function fakeScrollport(
  el: Element,
  { scrollHeight, clientHeight, scrollTop = 0 }: { scrollHeight: number; clientHeight: number; scrollTop?: number },
): Scrollport {
  const state: Scrollport = { top: scrollTop };
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => state.top,
    set: (v: number) => { state.top = Math.min(Math.max(Math.round(v), 0), scrollHeight - clientHeight); },
  });
  (el as HTMLElement).style.overflowY = 'auto';
  return state;
}

/** 真实派发一次可取消的 wheel（React 的 onWheel 是被动的，监听器只能挂在原生事件上） */
function dispatchWheel(target: Element, deltaY: number, init: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('basic-editor 246 · 曲线选项胶囊滚轮封口与逐级接续', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('网格还能滚时：滚网格，默认行为被吞掉（画布宿主的监听器看到的就是「已取消」）', () => {
    const form = openTemplatePage();
    const seen: boolean[] = [];
    hostRef.current!.addEventListener('wheel', (e) => seen.push(e.defaultPrevented));
    const port = fakeScrollport(form.querySelector('.ccp__grid')!, { scrollHeight: 400, clientHeight: 200 });

    const event = dispatchWheel(within(form).getByRole('button', { name: '尖刺' }), 120);

    expect(port.top).toBe(120);
    expect(event.defaultPrevented).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('指针压在缩略图（<svg>，非 HTML 元素）上：照样滚网格', () => {
    const form = openTemplatePage();
    const port = fakeScrollport(form.querySelector('.ccp__grid')!, { scrollHeight: 400, clientHeight: 200 });
    const card = within(form).getByRole('button', { name: '尖刺' });
    const svg = card.querySelector('svg');
    expect(svg).not.toBeNull();

    const event = dispatchWheel(svg!, 120);

    expect(event.defaultPrevented).toBe(true);
    expect(port.top).toBe(120);
  });

  it('网格到底后：由面板接续滚动，网格不再动', () => {
    const form = openTemplatePage();
    const grid = form.querySelector('.ccp__grid')!;
    const body = form.closest('.ccap')!.querySelector('.coc__body')!;
    const gridPort = fakeScrollport(grid, { scrollHeight: 400, clientHeight: 200, scrollTop: 200 });
    const bodyPort = fakeScrollport(body, { scrollHeight: 500, clientHeight: 300, scrollTop: 0 });

    const event = dispatchWheel(grid, 120);

    expect(event.defaultPrevented).toBe(true);
    expect(gridPort.top).toBe(200);
    expect(bodyPort.top).toBe(120);
  });

  it('胶囊里已经没得滚：默认行为照样被吞掉（这是「画布跟着跑」的唯一入口）', () => {
    const form = openTemplatePage();
    const grid = form.querySelector('.ccp__grid')!;
    fakeScrollport(grid, { scrollHeight: 400, clientHeight: 200, scrollTop: 200 });

    expect(dispatchWheel(grid, 120).defaultPrevented).toBe(true);
  });

  it('顶栏（指针所在链上没有滚动容器）：同样吞掉，不让画布接走', () => {
    openTemplatePage();

    const event = dispatchWheel(screen.getByRole('button', { name: '曲线配置' }), -120);

    expect(event.defaultPrevented).toBe(true);
  });

  it('Shift+滚轮只给 deltaX（Windows）：按纵向接续滚动，不留给画布', () => {
    const form = openTemplatePage();
    const port = fakeScrollport(form.querySelector('.ccp__grid')!, { scrollHeight: 400, clientHeight: 200 });

    const event = dispatchWheel(within(form).getByRole('button', { name: '尖刺' }), 0, { deltaX: 120, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(port.top).toBe(120);
  });

  it('Ctrl+滚轮（缩放）不归胶囊管：不拦默认行为', () => {
    const form = openTemplatePage();
    fakeScrollport(form.querySelector('.ccp__grid')!, { scrollHeight: 400, clientHeight: 200 });

    const event = dispatchWheel(within(form).getByRole('button', { name: '尖刺' }), 120, { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
  });
});
