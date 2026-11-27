// @vitest-environment jsdom
// chart-projects 45：拆除 <ChartCodeEditorProvider key={projectId}> 后的行为锁测：
// 1. 切工程时不卸载 <canvas> / FinalVirtualCanvas DOM；
// 2. 切工程时自动关闭 ChartCodeEditorModal；
// 3. 切工程时显式清空 ChartSwitcher（openMenu / chartInfo）与 FinalVirtualCanvas
//    瞬态编辑态（slideBuffer / curveDraft / bpmEdit / expandedBpmGroupKey / GestureSession / lastBpmRef / markerSeconds）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import WorkspacePage from '@/src/pages/workspace/WorkspacePage';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider } from '@/src/app/providers/UIProvider';
import { EditingProvider } from '@/src/app/providers/EditingProvider';
import { PlaybackProvider } from '@/src/app/providers/PlaybackProvider';
import { useCurrentProject } from '@/src/app/providers/CurrentProjectProvider';
import { AppNavProvider } from '@/src/layouts/AppNav';
import { AudioSession } from '@/src/audio/AudioSession';
import type { AudioEngine } from '@/src/audio/AudioEngine';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { FakeAudioEngine, makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

stubPageShellEnv();

const makeProject = (id: string, name: string): ChartProject => ({
  id,
  name,
  artist: null,
  source: { type: 'custom' },
  durationSeconds: 60,
  lastOpened: 1,
  audioName: null,
  coverName: null,
  charts: [
    {
      id: `c-${id}`,
      notes: [{ type: 'BPM', beat: 0, bpm: 120 }],
      title: null,
      diff: 3,
      level: null,
      completed: false,
      upload: null,
      lastModified: 1,
      appliedChartCodeText: null,
      chartCodePristine: false,
    },
  ],
});

function setup() {
  class WorkspaceEngine extends FakeAudioEngine {
    setPlaybackRate(rate: number) { void rate; }
  }
  const engine = new WorkspaceEngine();
  const session = new AudioSession({
    keySetId: 'skin00',
    seVolume: 1,
    engineFactory: () => engine as unknown as AudioEngine,
  });
  const store = new ChartProjectStore(makeMemoryProjectBackend([
    makeProject('p1', '工程一'),
    makeProject('p2', '工程二'),
  ]));
  let controls!: ReturnType<typeof useCurrentProject>;
  function Controls() { controls = useCurrentProject(); return null; }

  const view = renderWithProviders(
    <ConfigProvider><PlaybackProvider><UIProvider><EditingProvider>
      <AppNavProvider value={{ activePage: 'workspace', setActivePage: vi.fn(), pageScope: null, navCollapsed: true, setNavCollapsed: vi.fn() }}>
        <Controls />
        <WorkspacePage active />
      </AppNavProvider>
    </EditingProvider></UIProvider></PlaybackProvider></ConfigProvider>,
    { store, session },
  );

  return { ...view, open: (id: string) => controls.open(id) };
}

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  window.localStorage.setItem('aao.currentProject.v1', JSON.stringify({ projectId: 'p1', chartId: 'c-p1' }));
  // 给 ResizeObserver 兜底宽高的容器占位（让 FinalVirtualCanvas 挂载出 <canvas>）
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

async function waitForBpmInput(canvasBox: HTMLElement): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = canvasBox.querySelector('input');
    expect(el).not.toBeNull();
    return el!;
  });
}

describe('chart-projects 45 · 切工程保活工作台与瞬态重置', () => {
  it('切工程不卸载 <canvas>，同时自动关闭谱面代码弹窗与 ChartSwitcher 菜单/新增谱面弹窗', async () => {
    const view = setup();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(view.container.querySelector('.ws-chart-area canvas')).not.toBeNull());
    await waitFor(() => expect(view.container.querySelector('.chart-switcher__current')).not.toBeNull());

    const canvasBefore = view.container.querySelector('.ws-chart-area canvas');
    expect(canvasBefore).toBeInstanceOf(HTMLCanvasElement);

    // 打开谱面代码弹窗
    const codeBtn = screen.getByRole('button', { name: '谱面代码' });
    fireEvent.click(codeBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // 打开 ChartSwitcher 下拉菜单
    const switcherBtn = view.container.querySelector('.chart-switcher__current') as HTMLElement;
    fireEvent.click(switcherBtn);
    expect(document.querySelector('.chart-switcher__panel')).toBeInTheDocument();

    // 切到工程二
    await act(async () => { await view.open('p2'); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // <canvas> 节点未被销毁重建（同一个 DOM 实例）
    const canvasAfter = view.container.querySelector('.ws-chart-area canvas');
    expect(canvasAfter).toBe(canvasBefore);

    // 谱面代码弹窗与 ChartSwitcher 菜单已关闭
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.chart-switcher__panel')).not.toBeInTheDocument();

    // 打开 ChartInfoDialog（新增谱面）后再切回工程一：弹窗必须随工程切换关闭
    fireEvent.click(view.container.querySelector('.chart-switcher__current') as HTMLElement);
    fireEvent.click(screen.getByText('新增谱面'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { await view.open('p1'); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('切工程时清空 FinalVirtualCanvas 的 bpmEdit、lastBpmRef、slideBuffer、curveDraft、GestureSession 与标记点', async () => {
    const view = setup();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const canvas = await waitFor(() => {
      const el = view.container.querySelector('.ws-chart-area canvas');
      expect(el).not.toBeNull();
      return el!;
    });

    const canvasBox = canvas.parentElement!;

    // 悬停画布，触发 Ctrl+` 就地编辑 BPM，输入 180 并回车提交以推进 lastBpmRef
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 300 });
    fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ctrlKey: true });
    const input1 = await waitForBpmInput(canvasBox);
    fireEvent.change(input1, { target: { value: '180' } });
    fireEvent.keyDown(input1, { key: 'Enter', code: 'Enter' });
    expect(canvasBox.querySelector('input')).toBeNull();

    // 再次 Ctrl+` 打开 bpmEdit（此时默认值为 180），并在左侧沟槽双击放置标记点
    fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ctrlKey: true });
    const input2 = await waitForBpmInput(canvasBox);
    expect(input2.value).toBe('180');
    fireEvent.doubleClick(canvas, { clientX: 16, clientY: 300 });
    expect(screen.getByLabelText('标记点，双击删除')).toBeInTheDocument();

    // 切到滑条工具并放置待连锚点 slideBuffer + 发起进行中右键手势
    const slideBtn = screen.getByRole('button', { name: '滑条' });
    fireEvent.click(slideBtn);
    expect(slideBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.mouseDown(canvas, { clientX: 400, clientY: 300, button: 0 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300, button: 0 });
    fireEvent.mouseDown(canvas, { clientX: 400, clientY: 280, button: 2 });

    // 切到工程二：bpmEdit、标记点、进行中手势与 slideBuffer 全部清除，lastBpmRef 复位 120
    await act(async () => { await view.open('p2'); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(canvasBox.querySelector('input')).toBeNull();
    expect(screen.queryByLabelText('标记点，双击删除')).not.toBeInTheDocument();

    // 因为 slideBuffer 与进行中手势都已随工程切换清零，按一次 Esc 即直接退出滑条持工具态回到指针态
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('button', { name: '指针' })).toHaveAttribute('aria-pressed', 'true');

    // 切到曲线工具并挂起 curveDraft 后再切回工程一：按一次 Esc 即直接退出曲线工具（curveDraft 已清）
    const curveBtn = screen.getByRole('button', { name: '曲线' });
    fireEvent.click(curveBtn);
    expect(curveBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.mouseDown(canvas, { clientX: 400, clientY: 300, button: 0 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300, button: 0 });
    await act(async () => { await view.open('p1'); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('button', { name: '指针' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 300 });
    fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ctrlKey: true });
    const inputAfter = await waitForBpmInput(canvasBox);
    expect(inputAfter.value).toBe('120');
  });
});
