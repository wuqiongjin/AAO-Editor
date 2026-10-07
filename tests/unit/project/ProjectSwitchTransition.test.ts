// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartProjectPersistence } from '@/src/project/useChartProjectPersistence';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend } from '@/tests/support/providers';

const AT = 1_700_000_000_000;

function makeChart(id: string): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

function makeProject(id: string, name: string): ChartProject {
  return {
    id,
    name,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 60,
    lastOpened: AT,
    charts: [makeChart(`c-${id}`)],
    audioName: null,
    coverName: null,
  };
}

describe('Issue 26 · 切谱面进工作台画面残留防回潮测试', () => {
  it('useChartProjectPersistence: 初始及切工程时 waitUntilSettled 能够正确阻塞并等待 onRestore 结算', async () => {
    const p1 = makeProject('p1', '工程1');
    const p2 = makeProject('p2', '工程2');
    const store = new ChartProjectStore(makeMemoryProjectBackend([p1, p2]));

    let waiterFn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null = null;
    const registerRestoreWaiter = (fn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null) => {
      waiterFn = fn;
    };

    let restoredProject: ChartProject | null = null;
    const onRestore = vi.fn((project: ChartProject) => {
      restoredProject = project;
    });

    const { result, rerender } = renderHook(
      (props: { projectId: string | null; chartId: string | null }) =>
        useChartProjectPersistence({
          projectId: props.projectId,
          chartId: props.chartId,
          store,
          notes: [],
          durationSeconds: 60,
          audioName: null,
          audioBlob: null,
          onRestore,
          registerRestoreWaiter,
        }),
      {
        initialProps: { projectId: 'p1', chartId: 'c-p1' },
      },
    );

    expect(waiterFn).toBeTruthy();

    // 等待 p1 初始恢复完成
    await act(async () => {
      await waiterFn?.('p1', 'c-p1');
    });

    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'c-p1' }),
      expect.any(Object),
    );
    expect(result.current.isSettled).toBe(true);
    expect(restoredProject?.id).toBe('p1');

    // 如果目标已经匹配且已 settled，waitUntilSettled 立即 resolve
    let resolvedImmediately = false;
    await act(async () => {
      await waiterFn?.('p1', 'c-p1');
      resolvedImmediately = true;
    });
    expect(resolvedImmediately).toBe(true);

    // 切换到工程 p2
    rerender({ projectId: 'p2', chartId: 'c-p2' });

    // 正在切换过程中，isSettled 应置为 false
    expect(result.current.isSettled).toBe(false);

    // 调用 waiterFn 等待 p2 结算
    let p2Settled = false;
    const waitPromise = act(async () => {
      await waiterFn?.('p2', 'c-p2');
      p2Settled = true;
    });

    await waitPromise;
    expect(p2Settled).toBe(true);
    expect(result.current.isSettled).toBe(true);
    expect(restoredProject?.id).toBe('p2');
  });

  it('waitUntilSettled: 目标不匹配时不会过早 resolve', async () => {
    const p1 = makeProject('p1', '工程1');
    const store = new ChartProjectStore(makeMemoryProjectBackend([p1]));

    let waiterFn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null = null;
    const registerRestoreWaiter = (fn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null) => {
      waiterFn = fn;
    };

    renderHook(
      () =>
        useChartProjectPersistence({
          projectId: 'p1',
          chartId: 'c-p1',
          store,
          notes: [],
          durationSeconds: 60,
          audioName: null,
          audioBlob: null,
          onRestore: () => {},
          registerRestoreWaiter,
        }),
    );

    // 等待 p1 结算完成
    await act(async () => {
      await waiterFn?.('p1', 'c-p1');
    });

    // 尝试等待另一个未加载的目标 p999，当前 p1 不应触发其立即 resolve
    let targetMatched = false;
    const waitUnmatched = waiterFn?.('p999', 'c-p999').then(() => {
      targetMatched = true;
    });

    // 稍等一个小 tick，确认没有被误判立即 resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(targetMatched).toBe(false);
  });

  it('切换同工程的不同谱面时：正确触发 onRestore，支持上层复位播放进度', async () => {
    const p1 = makeProject('p1', '工程1');
    p1.charts.push(makeChart('c2-p1'));
    const store = new ChartProjectStore(makeMemoryProjectBackend([p1]));

    const onRestore = vi.fn();
    const { rerender } = renderHook(
      (props: { chartId: string }) =>
        useChartProjectPersistence({
          projectId: 'p1',
          chartId: props.chartId,
          store,
          notes: [],
          durationSeconds: 60,
          audioName: null,
          audioBlob: null,
          onRestore,
        }),
      {
        initialProps: { chartId: 'c-p1' },
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'c-p1' }),
      expect.any(Object),
    );
    onRestore.mockClear();

    // 切换到同工程的另一张谱面 c2-p1
    rerender({ chartId: 'c2-p1' });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'c2-p1' }),
      { restoreAudio: false },
    );
  });
});
