// @vitest-environment jsdom
// issue 185 锁测：片段库 hook 的写入口径（载入竞态 / 落盘失败回滚 / 空选区不写盘）。
// 界面行为在 PatternLibraryDrawer.test.tsx，这里只锁"库"这一层。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PatternStore, type PatternLibraryBackend } from '@/src/chart/patterns/PatternStore';
import { usePatternLibrary } from '@/src/chart/patterns/usePatternLibrary';
import type { Pattern } from '@/src/chart/patterns/types';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import { dismissToast } from '@/src/ui/Toast';
import { makeMemoryPatternStore, makePattern } from '@/tests/support/patterns';

const NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 100 },
  { beat: 2, type: 'Single', lane: 0 },
];
const SELECTION: SelectionItem[] = [{ kind: 'note', noteIndex: 1 }];

describe('issue 185 · usePatternLibrary', () => {
  it('载入完成前收藏：等载入回来再追加，不会把整库覆盖成只有这一条', async () => {
    dismissToast();
    let release: (patterns: Pattern[]) => void = () => {};
    const gate = new Promise<Pattern[]>((resolve) => { release = resolve; });
    let disk: Pattern[] = [];
    const backend: PatternLibraryBackend = {
      load: () => gate,
      saveAll: async (patterns) => { disk = [...patterns]; },
    };
    const { result } = renderHook(() => usePatternLibrary(new PatternStore(backend)));

    // 载入还挂着的这一帧就按收藏（快捷键路径完全可能这样）
    let pending!: Promise<Pattern | null>;
    act(() => { pending = result.current.addFromSelection(NOTES, SELECTION); });
    release([makePattern({ id: 'old', name: '旧片段', createdAt: 1 })]);

    await act(async () => { await pending; });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(disk.map((pattern) => pattern.name)).toEqual(['片段 1', '旧片段']);
  });

  it('读失败：不冒充空库，且拒绝一切写入（不会把原库整份抹掉）', async () => {
    dismissToast();
    let saves = 0;
    const store = new PatternStore({
      load: async () => { throw new Error('blocked'); },
      saveAll: async () => { saves += 1; },
    });
    const { result } = renderHook(() => usePatternLibrary(store));
    await waitFor(() => expect(result.current.status).toBe('error'));

    let saved: Pattern | null = makePattern();
    await act(async () => { saved = await result.current.addFromSelection(NOTES, SELECTION); });
    expect(saved).toBeNull();

    let renamed = true;
    await act(async () => { renamed = await result.current.rename('p1', '新名'); });
    expect(renamed).toBe(false);

    await act(async () => { await result.current.remove('p1'); });
    expect(saves).toBe(0);
    expect(result.current.patterns).toEqual([]);
  });

  it('空选区 → null，且不写盘', async () => {
    dismissToast();
    const memory = makeMemoryPatternStore();
    const { result } = renderHook(() => usePatternLibrary(memory.store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let saved: Pattern | null = makePattern();
    await act(async () => { saved = await result.current.addFromSelection(NOTES, []); });
    expect(saved).toBeNull();
    expect(memory.saves).toBe(0);
  });

  it('落盘失败：回滚到上一次好状态，收藏不算成功', async () => {
    dismissToast();
    const seed = [makePattern({ id: 'p1', name: '片段 1', createdAt: 1 })];
    const store = new PatternStore({
      load: async () => seed,
      saveAll: async () => { throw new Error('disk full'); },
    });
    const { result } = renderHook(() => usePatternLibrary(store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let saved: Pattern | null = makePattern();
    await act(async () => { saved = await result.current.addFromSelection(NOTES, SELECTION); });
    expect(saved).toBeNull();
    expect(result.current.patterns.map((pattern) => pattern.id)).toEqual(['p1']);
  });

  it('名字已存在也允许（名字是标签，不是键）', async () => {
    dismissToast();
    const memory = makeMemoryPatternStore([makePattern({ id: 'p1', name: '片段 1', createdAt: 1 })]);
    const { result } = renderHook(() => usePatternLibrary(memory.store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { await result.current.addFromSelection(NOTES, SELECTION); });
    // 新的一条 createdAt 更大 → 排在前面；重名不报错（名字是标签，不是键）
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['片段 2', '片段 1']);
  });

  it('改名的拒绝口径透传到库：空名 false、不写盘', async () => {
    dismissToast();
    const memory = makeMemoryPatternStore([makePattern({ id: 'p1', name: '片段 1' })]);
    const { result } = renderHook(() => usePatternLibrary(memory.store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let ok = true;
    await act(async () => { ok = await result.current.rename('p1', '   '); });
    expect(ok).toBe(false);
    expect(memory.saves).toBe(0);
    expect(memory.disk[0]!.name).toBe('片段 1');
  });
});
