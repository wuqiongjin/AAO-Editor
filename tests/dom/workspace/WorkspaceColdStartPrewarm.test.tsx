// @vitest-environment jsdom
// chart-projects 44 定案 Q1=A：冷启动停在非工作台页时工作台延迟到目录就绪且无近期滚动/交互后再预热；
// 提前主动切入工作台或点进入工作台立刻取消延迟开始恢复；预热前调用 flushPersist 不把空状态写回覆盖磁盘。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
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

const AT = 1_700_000_000_000;

function makeProject(id = 'p1'): ChartProject {
  return {
    id,
    name: 'Cold Start Song',
    artist: 'Band',
    source: { type: 'custom' },
    durationSeconds: 90,
    lastOpened: AT,
    audioName: 'bgm.mp3',
    audioBlob: new Blob([new Uint8Array([1, 2, 3])]),
    coverName: null,
    charts: [
      {
        id: 'c1',
        notes: [
          { beat: 0, type: 'BPM', bpm: 120 },
          { beat: 1, type: 'Single', lane: 2 },
        ],
        title: null,
        diff: 3,
        level: 26,
        completed: false,
        upload: null,
        lastModified: AT,
        appliedChartCodeText: null,
        chartCodePristine: false,
      },
    ],
  };
}

function setup(deferList = false) {
  class WorkspaceEngine extends FakeAudioEngine {
    setPlaybackRate(rate: number) { void rate; }
  }
  const engine = new WorkspaceEngine();
  const loadSpy = vi.spyOn(engine, 'load').mockImplementation(async () => {
    engine.duration = 90;
  });
  const session = new AudioSession({
    keySetId: 'skin00',
    seVolume: 1,
    engineFactory: () => engine as unknown as AudioEngine,
  });
  const backend = makeMemoryProjectBackend([makeProject()], { deferList });
  const store = new ChartProjectStore(backend);
  const getSpy = vi.spyOn(store, 'get');
  const getSummarySpy = vi.spyOn(store, 'getSummary');
  const saveSpy = vi.spyOn(store, 'save');

  let controls!: ReturnType<typeof useCurrentProject>;
  function Probe() {
    controls = useCurrentProject();
    return null;
  }

  const ui = (active: boolean, activePage: 'projects' | 'workspace' | 'preview' = active ? 'workspace' : 'projects') => (
    <ConfigProvider><PlaybackProvider><UIProvider><EditingProvider>
      <AppNavProvider value={{
        activePage,
        setActivePage: vi.fn(),
        pageScope: null,
        navCollapsed: true,
        setNavCollapsed: vi.fn(),
      }}>
        <Probe />
        <WorkspacePage active={active} />
      </AppNavProvider>
    </EditingProvider></UIProvider></PlaybackProvider></ConfigProvider>
  );

  const view = renderWithProviders(ui(false), { store, session });
  return {
    ...view,
    ui,
    backend,
    store,
    loadSpy,
    getSpy,
    getSummarySpy,
    saveSpy,
    getControls: () => controls,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  window.localStorage.setItem('aao.currentProject.v1', JSON.stringify({ projectId: 'p1', chartId: 'c1' }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('chart-projects 44 · 冷启动后台工作台延迟预热与竞态守卫', () => {
  it('停在工程页时零争抢：等目录就绪与无近期滚动后再预热；滚动期间继续让位', async () => {
    vi.useFakeTimers();
    const s = setup(true);

    // 目录未就绪：即便过了很久也不抢跑预热
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(s.getSpy).not.toHaveBeenCalled();
    expect(s.getSummarySpy).not.toHaveBeenCalled();
    expect(s.loadSpy).not.toHaveBeenCalled();

    // 放行目录 list()
    await act(async () => {
      s.backend.releaseList();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 800ms 时用户触发滚动 → 重置空闲计时，继续不抢跑
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(s.getSpy).not.toHaveBeenCalled();
    expect(s.loadSpy).not.toHaveBeenCalled();

    // 空闲窗口满后静默预热恢复
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(s.getSpy).toHaveBeenCalledWith('p1');
    expect(s.getSummarySpy).toHaveBeenCalledWith('p1');
    expect(s.loadSpy).toHaveBeenCalledOnce();
  });

  it('预热前调用 flushPersist 安全短路：不把空笔记/无音频写回覆盖磁盘', async () => {
    const s = setup();
    await act(async () => {
      await s.getControls().flushPersist();
    });
    expect(s.saveSpy).not.toHaveBeenCalled();
    expect(s.backend.disk.get('p1')?.charts[0].notes).toHaveLength(2);
    expect(s.backend.disk.get('p1')?.audioName).toBe('bgm.mp3');
  });

  it('预热前主动切进工作台（active→true）立刻恢复，且先展示 ws-preparing 兜底', async () => {
    const s = setup(true);
    expect(s.getSpy).not.toHaveBeenCalled();

    s.rerender(s.ui(true));
    expect(screen.getByRole('status')).toHaveTextContent('正在准备谱面');

    await waitFor(() => expect(s.getSpy).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(s.loadSpy).toHaveBeenCalledOnce());
  });

  it('预热前触发 waitForRestore（点卡片播放进工作台）立刻取消延迟并结算', async () => {
    const s = setup();
    await act(async () => { await Promise.resolve(); });
    expect(s.getSpy).not.toHaveBeenCalled();

    const startedAt = Date.now();
    let pending!: Promise<void>;
    act(() => {
      pending = s.getControls().waitForRestore('p1', 'c1');
    });
    await act(async () => {
      await pending;
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(s.getSpy).toHaveBeenCalledWith('p1');
    expect(s.loadSpy).toHaveBeenCalledOnce();
  });

  it('切到预览页（activePage="preview"）后停留也不触发冷启动后台预热，退回工程页后再按静默窗口恢复（ticket 89）', async () => {
    vi.useFakeTimers();
    const s = setup(true);

    await act(async () => {
      s.backend.releaseList();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 在 2s 预热计时器落地前切到预览页（active=false, activePage='preview'）
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    s.rerender(s.ui(false, 'preview'));

    // 即使在预览页播放停留超过 10 秒，也绝不在后台挂载工作台 / 触发 load 与 setChart
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(s.getSpy).not.toHaveBeenCalled();
    expect(s.getSummarySpy).not.toHaveBeenCalled();
    expect(s.loadSpy).not.toHaveBeenCalled();

    // 退回工程页并保持静默后，预热正常接管
    s.rerender(s.ui(false, 'projects'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(s.getSpy).toHaveBeenCalledWith('p1');
    expect(s.loadSpy).toHaveBeenCalledOnce();
  });
});
