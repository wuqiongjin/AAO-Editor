// ChartProjectPersistenceMerger（候选 2 / ADR-0005 §6）：谱面持久化防抖纯逻辑。
// 拆出 useChartProjectPersistence 内 800ms 防抖 timer 行为，以便单测边界（多次快速编辑只落盘一次）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChartProjectPersistenceMerger } from '../../src/chart/project/ChartProjectPersistenceMerger';
import type { ChartProject } from '../../src/chart/project/ChartProject';
import type { ChartNote } from '../../src/chart/types';

const emptyNotes: ChartNote[] = [];
const projectOf = (notes: ChartNote[], durationSeconds = 30): ChartProject => ({
  id: 'default', durationSeconds, notes,
});

describe('ChartProjectPersistenceMerger · 防抖 + flush', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('单次 schedule 后 800ms 调用 save', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const m = new ChartProjectPersistenceMerger({ debounceMs: 800, save });
    m.schedule(projectOf(emptyNotes));
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(799);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    m.destroy();
  });

  it('多次快速 schedule 只最后一次落盘（典型编辑场景）', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const m = new ChartProjectPersistenceMerger({ debounceMs: 800, save });
    for (let i = 0; i < 5; i++) {
      m.schedule(projectOf([{ beat: i, type: 'BPM', bpm: 120 } as ChartNote]));
    }
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
    // 第二次落盘应包含最后一次 schedule 的项目
    expect(save.mock.calls[0][0].notes.length).toBe(1);
    m.destroy();
  });

  it('saveNow 立即落盘 + 取消 pending timer', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const m = new ChartProjectPersistenceMerger({ debounceMs: 800, save });
    m.schedule(projectOf(emptyNotes));
    void m.saveNow(projectOf([{ beat: 1, type: 'BPM', bpm: 120 } as ChartNote]));
    expect(save).toHaveBeenCalledTimes(1);
    // 800ms 后不应再落盘（timer 已取消）
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
    m.destroy();
  });

  it('flush 立即落盘最新值（同 saveNow 语义）', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const m = new ChartProjectPersistenceMerger({ debounceMs: 800, save });
    m.schedule(projectOf(emptyNotes));
    void m.flush(projectOf([{ beat: 1, type: 'BPM', bpm: 120 } as ChartNote]));
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
    m.destroy();
  });

  it('save 失败静默（不影响后续 schedule）', () => {
    const save = vi.fn().mockRejectedValue(new Error('disk full'));
    const m = new ChartProjectPersistenceMerger({ debounceMs: 100, save });
    m.schedule(projectOf(emptyNotes));
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);
    // 第二次 schedule 仍能正常落盘（catch 已吞）
    m.schedule(projectOf([{ beat: 2, type: 'BPM', bpm: 140 } as ChartNote]));
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(2);
    m.destroy();
  });

  it('destroy 清 timer + 停止 schedule', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const m = new ChartProjectPersistenceMerger({ debounceMs: 800, save });
    m.schedule(projectOf(emptyNotes));
    m.destroy();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  // issue 64：调用方（useChartProjectPersistence）靠 isDestroyed 判定"这个实例还能不能用"，
  // 绝不能再把 schedule 打在已销毁实例上（旧 hook 正是这么把落盘打死，刷新丢谱面）。
  it('isDestroyed：新建 false / destroy 后 true（调用方据此重建）', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const m = new ChartProjectPersistenceMerger({ debounceMs: 100, save });
    expect(m.isDestroyed).toBe(false);
    m.destroy();
    expect(m.isDestroyed).toBe(true);
    // 销毁后既 schedule 也 saveNow 都不再产生副作用
    m.schedule(projectOf(emptyNotes));
    void m.saveNow(projectOf(emptyNotes));
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
