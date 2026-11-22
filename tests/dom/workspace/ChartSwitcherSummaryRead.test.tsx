// @vitest-environment jsdom
// chart-projects 44：ChartSwitcher 只读轻摘要 store.getSummary，不调用整工程 store.get（避免重复读 audio.bin）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import ChartSwitcher from '@/src/pages/workspace/ChartSwitcher';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

function makeProject(): ChartProject {
  return {
    id: 'pSwitch1',
    name: 'Switch Song',
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
          { beat: 2, type: 'Slide', connections: [{ beat: 2, lane: 1 }, { beat: 2.5, lane: 2, hidden: true }, { beat: 3, lane: 3 }] },
        ],
        title: 'Expert Chart',
        diff: 3,
        level: 27,
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
  seedZhSettings();
  window.localStorage.setItem('aao.currentProject.v1', JSON.stringify({ projectId: 'pSwitch1', chartId: 'c1' }));
});

describe('chart-projects 44 · ChartSwitcher 只读轻摘要', () => {
  it('挂载与渲染下拉不调用 store.get，只调用 store.getSummary 并展示准确 noteCount', async () => {
    const store = new ChartProjectStore(makeMemoryProjectBackend([makeProject()]));
    const getSpy = vi.spyOn(store, 'get');
    const summarySpy = vi.spyOn(store, 'getSummary');

    const nav: AppNavValue = {
      activePage: 'workspace',
      setActivePage: vi.fn(),
      pageScope: null,
      navCollapsed: true,
      setNavCollapsed: vi.fn(),
    };

    renderWithProviders(
      <AppNavProvider value={nav}><ChartSwitcher /></AppNavProvider>,
      { store },
    );

    await waitFor(() => expect(screen.getByText('Switch Song')).toBeInTheDocument());
    expect(summarySpy).toHaveBeenCalledWith('pSwitch1');
    expect(getSpy).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('.chart-switcher__current') as HTMLElement);
    expect(await screen.findByText(/3 音符|3 notes/)).toBeInTheDocument();
  });
});
