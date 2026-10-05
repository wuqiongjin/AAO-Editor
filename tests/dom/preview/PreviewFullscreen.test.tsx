// @vitest-environment jsdom
// chart-preview 12 · 全屏预览：右上角**只留一枚「退出全屏」图标钮**（2026-10-05 用户定案）。
//
// 要锁的四件事：
//   1. 非全屏：那一排（缩放 / 设置 / 全屏 / 导出）照旧在，没有浮层；
//   2. 全屏：浮层里只有一枚 icon-only 退出钮（无文字、无滑杆 / 设置 / 导出），那一排整排退场；
//   3. 缩放不丢：全屏下 Ctrl/⌘+滚轮仍真的改了缩放（不是只拦下手势）；
//   4. 退出照旧：点那枚钮 / 从别处退出（浏览器 Esc）都同步回非全屏。
//
// jsdom 没有 Fullscreen API：`document.fullscreenElement` 用 defineProperty 打桩，
// `requestFullscreen` / `exitFullscreen` 自己派发 `fullscreenchange`（页面只读这一个事件）。
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import type { PageScope } from '@/src/layouts/pageScope';
import PreviewPage from '@/src/pages/preview/PreviewPage';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider } from '@/src/app/providers/UIProvider';
import {
  ChartProjectStore,
  type ChartDifficulty,
  type ChartProject,
  type ProjectChart,
} from '@/src/project/ChartProject';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { makeRecordingCtx } from '@/tests/support/canvas';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

const NOW = 1_700_000_000_000;
const NOTES: ChartNote[] = [
  { type: 'BPM', beat: 0, bpm: 120 },
  { type: 'Single', beat: 1, lane: 0 },
  { type: 'Single', beat: 3, lane: 3 },
];
/** 全屏前的缩放读数（滑杆 value = zoom × 100） */
const ZOOM_100 = '100';

stubPageShellEnv();

// jsdom 的 canvas 没有 2d 实现：整文件给一个记录型假 ctx（本组用例只关心"浮层里有什么"）
const ORIGINAL_GET_CONTEXT = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  const { proxy } = makeRecordingCtx();
  HTMLCanvasElement.prototype.getContext = (() => proxy) as typeof HTMLCanvasElement.prototype.getContext;
});
afterAll(() => { HTMLCanvasElement.prototype.getContext = ORIGINAL_GET_CONTEXT; });

/** 打桩的全屏真相：全屏元素 + 进出两头发 `fullscreenchange` */
let fsElement: Element | null = null;

/** 换全屏元素并派发事件（页面只读这一个事件） */
function setFullscreenElement(el: Element | null): void {
  fsElement = el;
  document.dispatchEvent(new Event('fullscreenchange'));
}

beforeAll(() => {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsElement });
  Element.prototype.requestFullscreen = function requestFullscreen(this: Element) {
    setFullscreenElement(this);
    return Promise.resolve();
  } as typeof Element.prototype.requestFullscreen;
  document.exitFullscreen = () => {
    setFullscreenElement(null);
    return Promise.resolve();
  };
});

function makeChart(id: string, title: string, notes: ChartNote[], diff: ChartDifficulty): ProjectChart {
  return {
    id,
    notes,
    title,
    diff,
    level: null,
    completed: false,
    upload: null,
    lastModified: NOW,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

/** 一个工程一张谱面；`notes` 传空数组 = 画面走空态（用来锁"没音符也要有出口"） */
function seedProject(notes: ChartNote[] = NOTES): ChartProject {
  return {
    ...createUnnamedProject({ id: 'pA', chartId: 'c-a1', now: NOW }),
    name: 'Alpha',
    charts: [makeChart('c-a1', 'Alpha 1', notes, 3)],
  };
}

/** 谱面切换器触发钮（名字里带"这一屏在看的那张谱面"） */
const chartTrigger = () => screen.getByRole('button', { name: /^预览中的谱面：/ });
/** 缩放滑杆（工具栏那一排的；全屏下不该存在） */
const zoomSlider = () => screen.getByRole('slider', { name: '缩放' }) as HTMLInputElement;
/** 全屏浮层（票 12 的对象：它里面该有什么、不该有什么） */
const fsOverlay = () => document.querySelector('.preview-fs');
/** 画面本体（滚轮缩放的接收者；`StaticPreviewView` 的滚动宿主） */
const previewHost = () => screen.getByRole('group', { name: '静态预览面板折行（横向滚动）' });
/** 工具栏右端那一排的按钮文案（按 DOM 顺序；组内只有这几枚带文字的钮） */
const controlRowButtons = () => within(
  zoomSlider().closest('.preview-static') as HTMLElement,
).getAllByRole('button').map((b) => b.textContent);

/**
 * 挂预览页本体（不走 AppShell / 左栏）：作用域直接给 `{ projectId }`，
 * 页面据此解析作用对象工程与谱面 —— 本组只关心"全屏下浮层里有什么"。
 */
function mountPreview(notes: ChartNote[] = NOTES): void {
  const SCOPE: PageScope = { projectId: 'pA' };
  const nav: AppNavValue = {
    activePage: 'preview',
    setActivePage: () => {},
    pageScope: SCOPE,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  renderWithProviders(
    <ConfigProvider>
      <UIProvider>
        <AppNavProvider value={nav}>
          <PreviewPage />
        </AppNavProvider>
      </UIProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend([seedProject(notes)])) },
  );
}

/** 进全屏：点工具栏那枚「全屏」（真相链走打桩的 requestFullscreen + 事件） */
async function enterFullscreen(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: '全屏' }));
  const overlay = fsOverlay();
  expect(overlay).not.toBeNull();
  return overlay as HTMLElement;
}

/** 退出全屏：走页面那枚钮 / 或浏览器那侧（本文件两种都用到） */
function exitFullscreen(): void {
  fireEvent.click(within(fsOverlay() as HTMLElement).getByRole('button', { name: '退出全屏' }));
}

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  fsElement = null;
});

afterEach(() => { vi.restoreAllMocks(); });

describe('chart-preview 12 · 全屏预览的浮层', () => {
  it('非全屏：那一排照旧在，没有浮层', async () => {
    mountPreview();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));

    expect(fsOverlay()).toBeNull();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument();
    expect(zoomSlider()).toBeInTheDocument();
    // 进入钮在这一排**末位**（2026-10-05 定案）：退出钮浮在舞台右上角，进出同一个角
    expect(controlRowButtons()).toEqual(['设置', '导出', '全屏']);
    // 那排是页面 chrome：一律不带面（2026-10-05 定案 A——「导出」曾独带 outlined 面，与同排不一致）
    for (const name of ['设置', '导出', '全屏']) {
      expect(screen.getByRole('button', { name })).not.toHaveClass('icon-btn--outlined');
    }
  });

  it('全屏：浮层里只有一枚 icon-only 退出钮（无滑杆 / 设置 / 导出），那一排整排退场', async () => {
    mountPreview();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));
    const overlay = await enterFullscreen();

    const buttons = within(overlay).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('退出全屏');
    expect(buttons[0]!.textContent).toBe('');       // icon-only：不显示文字（省占位）
    // 反过来：它浮在画面之上，必须自己带面（`outlined`），与页面那排的透明态是两回事
    expect(buttons[0]).toHaveClass('icon-btn--outlined');
    expect(within(overlay).queryByRole('slider')).toBeNull();

    // 那一排此刻不在页面上：不是挪位置，是全屏下不出现（设置 / 导出先退出再做）
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出' })).toBeNull();
  });

  it('全屏下缩放不丢：Ctrl/⌘+滚轮仍落到缩放上（画面接住手势，档位真的变了）', async () => {
    mountPreview();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));
    await enterFullscreen();

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    act(() => { fireEvent(previewHost(), wheel); });
    expect(wheel.defaultPrevented).toBe(true);      // 拦下整页缩放（不缩页面，缩谱面）

    // 档位真的变了（滑杆在全屏下不出现，退出后读它）：缩放这一路接线没被"收敛"掉
    exitFullscreen();
    expect(fsOverlay()).toBeNull();
    expect(zoomSlider().value).not.toBe(ZOOM_100);
  });

  it('退出：点那枚钮退出全屏，浮层消失、那一排回到页面上', async () => {
    mountPreview();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));
    await enterFullscreen();
    const exit = vi.spyOn(document, 'exitFullscreen');

    exitFullscreen();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(fsOverlay()).toBeNull();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument();
  });

  it('没有音符的谱面进全屏：舞台是空态文案，但退出钮照样在（出口不只靠 Esc）', async () => {
    mountPreview([]);
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));
    expect(screen.getByText('这张谱面还没有音符，先画出来再回来看全景。')).toBeInTheDocument();

    const overlay = await enterFullscreen();

    const buttons = within(overlay).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('退出全屏');
  });

  it('从别处退出（浏览器 Esc）也同步：浮层跟着消失', async () => {
    mountPreview();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));
    await enterFullscreen();

    // Esc 由浏览器负责退出，页面只听 `fullscreenchange`
    act(() => { setFullscreenElement(null); });

    expect(fsOverlay()).toBeNull();
    expect(screen.getByRole('button', { name: '全屏' })).toBeInTheDocument();
  });
});
