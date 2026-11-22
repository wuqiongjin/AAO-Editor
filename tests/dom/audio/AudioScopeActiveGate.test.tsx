// @vitest-environment jsdom
// chart-projects 44：useAudioScope 隐藏态（active=false）不发起 store.list / store.get；激活后才读盘。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAudioScope } from '@/src/audio/useAudioScope';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { CurrentProjectProvider } from '@/src/app/providers/CurrentProjectProvider';
import { makeMemoryProjectBackend } from '@/tests/support/providers';

const AT = 1_700_000_000_000;

function makeProject(): ChartProject {
  return {
    id: 'p1',
    name: 'Song 1',
    artist: 'Band',
    source: { type: 'custom' },
    durationSeconds: 120,
    lastOpened: AT,
    audioName: 'bgm.mp3',
    coverName: null,
    charts: [
      {
        id: 'c1',
        notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
        title: null,
        diff: 3,
        level: 25,
        completed: false,
        upload: null,
        lastModified: AT,
        appliedChartCodeText: null,
        chartCodePristine: false,
      },
    ],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('aao.currentProject.v1', JSON.stringify({ projectId: 'p1', chartId: 'c1' }));
});

describe('chart-projects 44 · useAudioScope active 门控', () => {
  it('active=false 时不发 store.list 与 store.get；切到 active=true 后再加载', async () => {
    const store = new ChartProjectStore(makeMemoryProjectBackend([makeProject()]));
    const listSpy = vi.spyOn(store, 'list');
    const getSpy = vi.spyOn(store, 'get');
    // 清掉 CurrentProjectProvider 启动预载对 listSpy 计数的干扰，观察 hook 挂载自身
    const nav: AppNavValue = {
      activePage: 'projects',
      setActivePage: vi.fn(),
      pageScope: null,
      navCollapsed: true,
      setNavCollapsed: vi.fn(),
    };

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useAudioScope(active),
      {
        initialProps: { active: false },
        wrapper: ({ children }) => (
          <CurrentProjectProvider store={store}>
            <AppNavProvider value={nav}>{children}</AppNavProvider>
          </CurrentProjectProvider>
        ),
      },
    );

    // 等待 CurrentProjectProvider 自身的启动预载 settle，再验证 useAudioScope 未发额外 list 且零 get
    await act(async () => { await Promise.resolve(); });
    expect(listSpy).toHaveBeenCalledTimes(1); // 仅 CurrentProjectProvider 启动预载一次
    expect(getSpy).not.toHaveBeenCalled();
    expect(result.current.view).toBeNull();

    rerender({ active: true });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(getSpy).toHaveBeenCalledWith('p1');
    expect(result.current.view?.audioName).toBe('bgm.mp3');
  });
});
