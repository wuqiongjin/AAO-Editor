// @vitest-environment jsdom
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

const project = (id: string): ChartProject => ({
  id, name: id, artist: null, source: { type: 'custom' }, durationSeconds: 90, lastOpened: 1,
  audioName: `${id}.mp3`, audioBlob: new Blob([new Uint8Array([1])]), coverName: null,
  charts: ['c1', 'c2'].map(chartId => ({
    id: chartId, notes: [{ type: 'BPM', beat: 0, bpm: 120 }], title: null, diff: 3, level: null,
    completed: false, upload: null, lastModified: 1, appliedChartCodeText: null, chartCodePristine: false,
  })),
});

function setup(withAudio = true) {
  class WorkspaceEngine extends FakeAudioEngine {
    setPlaybackRate(rate: number) { void rate; /* 当前用例不播放，只验证恢复准备与保活 */ }
  }
  const engine = new WorkspaceEngine();
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const load = vi.spyOn(engine, 'load').mockImplementation(() => new Promise<void>((resolve, reject) => {
    pending.push({ resolve: () => { engine.duration = 90; resolve(); }, reject });
  }));
  const session = new AudioSession({ keySetId: 'skin00', seVolume: 1, engineFactory: () => engine as unknown as AudioEngine });
  const projects = [project('p1'), project('p2')];
  if (!withAudio) for (const item of projects) { item.audioName = null; delete item.audioBlob; }
  const store = new ChartProjectStore(makeMemoryProjectBackend(projects));
  let controls!: ReturnType<typeof useCurrentProject>;
  function Controls() { controls = useCurrentProject(); return null; }
  const ui = (active: boolean) => (
    <ConfigProvider><PlaybackProvider><UIProvider><EditingProvider>
      <AppNavProvider value={{ activePage: active ? 'workspace' : 'audio', setActivePage: vi.fn(), pageScope: null, navCollapsed: true, setNavCollapsed: vi.fn() }}>
        <Controls /><WorkspacePage active={active} />
      </AppNavProvider>
    </EditingProvider></UIProvider></PlaybackProvider></ConfigProvider>
  );
  const view = renderWithProviders(ui(true), { store, session });
  return { ...view, load, pending, session, ui, open: (id: string, chartId = 'c1') => controls.open(id, chartId) };
}

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  window.localStorage.setItem('aao.currentProject.v1', JSON.stringify({ projectId: 'p1', chartId: 'c1' }));
});

describe('issue 238 · 工作台首次准备', () => {
  it('真实解码完成才放行，超过导航兜底时间也不提前结束；切页与同工程切谱不重新加载', async () => {
    const view = setup();
    await waitFor(() => expect(view.load).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('正在准备谱面');
    expect(view.container.querySelector('.ws-shell')).toHaveAttribute('inert');
    const play = vi.spyOn(view.session.getEngine(), 'play');
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(play).not.toHaveBeenCalled();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => { view.pending[0].resolve(); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(view.container.querySelector('.ws-shell')).not.toHaveAttribute('inert');
    view.rerender(view.ui(false));
    view.rerender(view.ui(true));
    await act(async () => { await view.open('p1', 'c2'); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(view.load).toHaveBeenCalledOnce();
  });

  it('换工程等待新音频，失败也解除等待并保留错误', async () => {
    const view = setup();
    await waitFor(() => expect(view.load).toHaveBeenCalledOnce());
    await act(async () => { view.pending[0].resolve(); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => { await view.open('p2'); });
    await waitFor(() => expect(view.load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => { view.pending[1].reject(new Error('bad audio')); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(view.session.getSnapshot().audioError).toBe('bad audio');
  });

  it('无音频工程不启动解码即可结束准备', async () => {
    const view = setup(false);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(view.load).not.toHaveBeenCalled();
  });

  it('首次解码中切同工程谱面，谱面结算不能提前放行音频准备', async () => {
    const view = setup();
    await waitFor(() => expect(view.load).toHaveBeenCalledOnce());
    await act(async () => { await view.open('p1', 'c2'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(view.load).toHaveBeenCalledOnce();
    await act(async () => { view.pending[0].resolve(); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('A 就绪后切到未就绪 B 再回 A，必须等待 A 新一轮解码，旧 B 结果不能提前放行', async () => {
    const view = setup();
    await waitFor(() => expect(view.load).toHaveBeenCalledOnce());
    await act(async () => { view.pending[0].resolve(); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => { await view.open('p2'); });
    await waitFor(() => expect(view.load).toHaveBeenCalledTimes(2));
    await act(async () => { await view.open('p1'); });
    await waitFor(() => expect(view.load).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => { view.pending[1].resolve(); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => { view.pending[2].resolve(); });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
