// ChartProjectPersistenceMerger（候选 2 / ADR-0005 §6）：谱面持久化防抖纯逻辑。
// 拆出 useChartProjectPersistence 内 800ms 防抖 timer 行为，以便单测边界（多次快速编辑只落盘一次）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChartProjectPersistenceMerger } from '@/src/project/ChartProjectPersistenceMerger';
import { stampChartModified } from '@/src/project/chartModifiedStamp';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import type { ChartNote } from '@/src/chart/types';

const emptyNotes: ChartNote[] = [];
const projectOf = (notes: ChartNote[], durationSeconds = 30): ChartProject => ({
  id: 'pTest1',
  name: null,
  artist: null,
  source: { type: 'custom' },
  durationSeconds,
  lastOpened: 0,
  charts: [{
    id: 'c1',
    notes,
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: 0,
    appliedChartCodeText: null,
    chartCodePristine: false,
  }],
  audioName: null,
  coverName: null,
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
    expect(save.mock.calls[0][0].charts[0].notes.length).toBe(1);
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

// issue 35：ProjectChart.lastModified 戳机口径立档后的行为锁。
// buildProject() 每次落盘前都过 stampChartModified——本块锁的就是"哪次落盘配重戳时间"：
// 仅 notes / 保真字段相对已载入记录**真变**才戳 now；时长 / 音频 / 切 tab flush 不戳。
// （把模块里的条件判断改回无条件 now，本块立刻红。）
describe('stampChartModified · lastModified 条件戳（issue 35）', () => {
  const T0 = 1_700_000_000_000;
  const chartOf = (over: Partial<ProjectChart> = {}): ProjectChart => ({
    id: 'c1',
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: T0,
    appliedChartCodeText: null,
    chartCodePristine: false,
    ...over,
  });

  it('notes / 保真都没变（时长/音频/切 tab flush 走的同一条路）→ 沿用记录里的 lastModified', () => {
    const c = chartOf();
    // 同内容的新数组（React 重渲染产物），不是同一个引用
    const next = stampChartModified(c, { notes: [...c.notes], now: T0 + 9_999 });
    expect(next.lastModified).toBe(T0);
    // 记录内容照写（flush 仍落盘），只是不重戳
    expect(next.notes).toHaveLength(1);
    expect(next.appliedChartCodeText).toBeNull();
    expect(next.chartCodePristine).toBe(false);
  });

  it('notes 真变 → 重戳 now', () => {
    const c = chartOf();
    const next = stampChartModified(c, {
      notes: [{ beat: 1, type: 'Single', lane: 2 }],
      now: T0 + 1,
    });
    expect(next.lastModified).toBe(T0 + 1);
    expect(next.notes).toHaveLength(1);
  });

  it('保真文本变 / pristine 变 → 重戳；两者都没动 → 不戳', () => {
    const c = chartOf({ appliedChartCodeText: 'src', chartCodePristine: true });
    expect(stampChartModified(c, {
      notes: c.notes, fidelity: { text: 'src2', pristine: true }, now: T0 + 1,
    }).lastModified).toBe(T0 + 1);
    expect(stampChartModified(c, {
      notes: c.notes, fidelity: { text: 'src', pristine: false }, now: T0 + 1,
    }).lastModified).toBe(T0 + 1);
    expect(stampChartModified(c, {
      notes: c.notes, fidelity: { text: 'src', pristine: true }, now: T0 + 1,
    }).lastModified).toBe(T0);
  });

  it('fidelity 缺省 ⇒ 映射 null / false；把记录里的保真清掉也算变', () => {
    const c = chartOf({ appliedChartCodeText: 'src', chartCodePristine: true });
    const next = stampChartModified(c, { notes: c.notes, now: T0 + 5 });
    expect(next.appliedChartCodeText).toBeNull();
    expect(next.chartCodePristine).toBe(false);
    expect(next.lastModified).toBe(T0 + 5);
  });

  it('编辑后撤销、防抖内只落一次盘 → 不重戳（口径是"记录内容变了没"，不是"编辑发生过没"）', () => {
    const c = chartOf();
    // 编辑出去又撤销回来，800ms 防抖窗口里没发生过落盘：唯一一次 flush 面对的
    // 还是加载时那份记录。撤销产物重建了数组引用，但内容与记录相同 ⇒ 不重戳。
    const undone = [...c.notes];
    const next = stampChartModified(c, { notes: undone, now: T0 + 3_000 });
    expect(next.lastModified).toBe(T0);
  });

  it('落盘之后的撤销仍重戳（盘上已是改后的内容，撤回去是真实的内容变化）', () => {
    const c = chartOf();
    const edited = stampChartModified(c, {
      notes: [{ beat: 4, type: 'Single', lane: 3 }], now: T0 + 2_000,
    });
    expect(edited.lastModified).toBe(T0 + 2_000);
    const back = stampChartModified(edited, { notes: c.notes, now: T0 + 3_000 });
    expect(back.lastModified).toBe(T0 + 3_000);
    expect(back.notes).toEqual(c.notes);
  });

  it('渲染语义相同但记录内容不同（source / charge / spanParams）→ 算变，重戳', () => {
    // 锁"别拿 NotesEqual（历史去专用，刻意忽略 source / spanParams / charge）当戳机判据"：
    // 那些字段随谱面工程持久化，只改它们的落盘也是真实写入。
    const base = chartOf({ notes: [{ beat: 1, type: 'Single', lane: 2 }] });
    const withSource = stampChartModified(base, {
      notes: [{ beat: 1, type: 'Single', lane: 2, source: { type: 'Single', beat: 1, lane: 2 } }],
      now: T0 + 1,
    });
    expect(withSource.lastModified).toBe(T0 + 1);
    const charged = stampChartModified(base, {
      notes: [{ beat: 1, type: 'Single', lane: 2, charge: true }],
      now: T0 + 1,
    });
    expect(charged.lastModified).toBe(T0 + 1);
    const slideBase = chartOf({
      notes: [{ type: 'Slide', connections: [{ beat: 0, lane: 1 }, { beat: 4, lane: 3 }] }],
    });
    const slideSp = stampChartModified(slideBase, {
      notes: [{
        type: 'Slide',
        connections: [{ beat: 0, lane: 1 }, { beat: 4, lane: 3 }],
        spanParams: { visibleCount: 2, bySpan: { 0: { kind: 'easing', family: 'sine', type: 'in', precision: 32 } } },
      }],
      now: T0 + 1,
    });
    expect(slideSp.lastModified).toBe(T0 + 1);
  });

  it('键序不同 / 显式 undefined 不算变（JSON 往返容差）；显式 0 算变', () => {
    const c = chartOf({ notes: [{ beat: 0, type: 'Single', lane: 2 }] });
    // 键序不同的同内容快照
    const reordered: ChartNote[] = [{ type: 'Single', lane: 2, beat: 0 }];
    expect(stampChartModified(c, { notes: reordered, now: T0 + 9 }).lastModified).toBe(T0);
    // JSON.stringify 会丢 undefined 键：编辑器里的显式 undefined 与记录缺键同内容
    const explicitUndef: ChartNote[] = [{ beat: 0, type: 'Single', lane: 2, subBeat: undefined }];
    expect(stampChartModified(c, { notes: explicitUndef, now: T0 + 9 }).lastModified).toBe(T0);
    // 反向：记录缺键、编辑器显式 0 —— 0 是真实值，序列化后记录字节不同，算变
    const withZero: ChartNote[] = [{ beat: 0, type: 'Single', lane: 2, subBeat: 0 }];
    expect(stampChartModified(c, { notes: withZero, now: T0 + 9 }).lastModified).toBe(T0 + 9);
  });

  it('引用相同短路（未编辑的会话快照与记录同源，resetNotes 直接给记录 notes）', () => {
    const c = chartOf();
    expect(stampChartModified(c, { notes: c.notes, now: T0 + 9 }).lastModified).toBe(T0);
  });

  it('连续 flush 链：真变戳了之后，后续无变化 flush 一直沿用那个时间', () => {
    // 模拟 buildProject 的链式调用：projectRef 每次都被更新成上一次的产物
    const c = chartOf();
    const afterEdit = stampChartModified(c, {
      notes: [{ beat: 2, type: 'Single', lane: 0 }], now: T0 + 5_000,
    });
    expect(afterEdit.lastModified).toBe(T0 + 5_000);
    const flushDuration = stampChartModified(afterEdit, { notes: afterEdit.notes, now: T0 + 6_000 });
    expect(flushDuration.lastModified).toBe(T0 + 5_000);
    const flushTab = stampChartModified(flushDuration, { notes: flushDuration.notes, now: T0 + 7_000 });
    expect(flushTab.lastModified).toBe(T0 + 5_000);
  });
});
