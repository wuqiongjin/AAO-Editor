// @vitest-environment jsdom
// 票 43 Q2：关窗后在飞的 updateProject 不得把发布弹窗 target 设回来。
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import { usePublishEntry } from '@/src/pages/projects/usePublishEntry';

const AT = 1_700_000_000_000;

function makeChart(): ProjectChart {
  return {
    id: 'c1',
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: 'Expert',
    diff: 3,
    level: 24,
    completed: false,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

function makeProject(): ChartProject {
  return {
    id: 'p1',
    name: 'song',
    artist: 'RAS',
    source: { type: 'custom' },
    durationSeconds: 100,
    lastOpened: AT,
    charts: [makeChart()],
    audioName: 'a.mp3',
    coverName: null,
  };
}

describe('票 43 · usePublishEntry 关窗不复活', () => {
  it('close 之后才完成的 mutate 不得 setTarget 回来', async () => {
    let project = makeProject();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = {
      get: async () => project,
      save: async (next: ChartProject) => {
        await gate;
        project = next;
      },
    };
    const { result } = renderHook(() => usePublishEntry({
      store,
      flush: async () => {},
      notify: () => {},
      reload: async () => {},
    }));

    act(() => result.current.open(project, project.charts[0]));
    expect(result.current.target).not.toBeNull();

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.updateProject((p) => ({ ...p, artist: 'x' }));
    });
    act(() => result.current.close());
    expect(result.current.target).toBeNull();

    release();
    await act(async () => { await finished; });
    expect(result.current.target).toBeNull();
  });
});
