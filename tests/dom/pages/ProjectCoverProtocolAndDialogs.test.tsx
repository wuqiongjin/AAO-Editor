// @vitest-environment jsdom
// chart-projects 44：Electron 封面协议 URL、EditInfoDialog 预览、onError 降级、PublishDialog 按需 store.get。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Cover } from '@/src/pages/projects/components/ProjectBits';
import { EditInfoDialog } from '@/src/pages/projects/components/ProjectDialogs';
import { usePublishEntry } from '@/src/pages/projects/usePublishEntry';
import type { ChartProject, ProjectSummary } from '@/src/project/ChartProject';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

function makeSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'pProto1',
    name: 'Test Song',
    artist: 'Band',
    source: { type: 'custom' },
    durationSeconds: 100,
    lastOpened: AT,
    audioName: 'a.mp3',
    coverName: 'c.png',
    audioPresent: true,
    coverPresent: true,
    coverVersion: '1234-5678',
    charts: [
      {
        id: 'c1',
        title: null,
        diff: 3,
        level: 27,
        completed: false,
        upload: null,
        lastModified: AT,
        noteCount: 2,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  seedZhSettings();
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    projectStore: {},
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('chart-projects 44 · Electron 封面协议与弹窗不回退', () => {
  it('Electron 摘要无 coverBlob 时 Cover 使用 aao-asset://project-cover/，onError 回退渐变', () => {
    const summary = makeSummary();
    const { container } = render(<Cover project={summary} size={172} fluid />);
    const img = container.querySelector('img.pp-cover__img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'aao-asset://project-cover/?id=pProto1&v=1234-5678');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');

    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    const coverBox = container.querySelector('.pp-cover') as HTMLElement;
    expect(coverBox.style.backgroundImage).toContain('linear-gradient');
    expect(coverBox.textContent).toBe('T');
  });

  it('EditInfoDialog 消费 ProjectSummary 仍能通过协议 URL 预览既有封面', () => {
    const summary = makeSummary();
    render(
      <EditInfoDialog
        project={summary}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    const thumb = document.querySelector('img.cover-card__img') as HTMLImageElement | null;
    expect(thumb).not.toBeNull();
    expect(thumb).toHaveAttribute('src', 'aao-asset://project-cover/?id=pProto1&v=1234-5678');
    expect(screen.getByRole('button', { name: '更换' })).toBeInTheDocument();
  });

  it('usePublishEntry.open 接收 ProjectSummary 时按需 store.get 拿完整 notes 与 coverBlob', async () => {
    const coverBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const fullProject: ChartProject = {
      id: 'pProto1',
      name: 'Test Song',
      artist: 'Band',
      source: { type: 'custom' },
      durationSeconds: 100,
      lastOpened: AT,
      audioName: 'a.mp3',
      coverName: 'c.png',
      coverBlob,
      charts: [
        {
          id: 'c1',
          title: null,
          diff: 3,
          level: 27,
          completed: false,
          upload: null,
          lastModified: AT,
          appliedChartCodeText: null,
          chartCodePristine: false,
          notes: [
            { beat: 0, type: 'BPM', bpm: 120 },
            { beat: 2, type: 'Single', lane: 3 },
          ],
        },
      ],
    };
    const get = vi.fn(async () => fullProject);
    const { result } = renderHook(() => usePublishEntry({
      store: { get, save: async () => {} },
      flush: async () => {},
      notify: () => {},
      reload: async () => {},
    }));

    const summary = makeSummary();
    act(() => {
      result.current.open(summary, summary.charts[0]);
    });

    await waitFor(() => expect(result.current.target).not.toBeNull());
    expect(get).toHaveBeenCalledWith('pProto1');
    expect(result.current.target!.project.coverBlob).toBe(coverBlob);
    expect(result.current.target!.chartCode).toEqual([
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: 2, lane: 3 },
    ]);
  });
});
