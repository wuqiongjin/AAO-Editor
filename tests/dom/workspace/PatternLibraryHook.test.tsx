// @vitest-environment jsdom
// issue 185 锁测：片段库 hook 的写入口径（载入竞态 / 落盘失败回滚 / 空选区不写盘）。
// 界面行为在 PatternLibraryDrawer.test.tsx，这里只锁"库"这一层。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PatternStore, type PatternLibraryBackend } from '@/src/chart/patterns/PatternStore';
import { serializePatterns } from '@/src/chart/patterns/share';
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

    let pinned = true;
    await act(async () => { pinned = await result.current.setPinned('p1', true); });
    expect(pinned).toBe(false);

    await act(async () => { await result.current.remove('p1'); });
    expect(saves).toBe(0);
    expect(result.current.patterns).toEqual([]);
  });

  it('读失败：导入同样拒绝（不会把原库整份抹掉）', async () => {
    dismissToast();
    let saves = 0;
    const store = new PatternStore({
      load: async () => { throw new Error('blocked'); },
      saveAll: async () => { saves += 1; },
    });
    const { result } = renderHook(() => usePatternLibrary(store));
    await waitFor(() => expect(result.current.status).toBe('error'));

    let outcome: Awaited<ReturnType<typeof result.current.prepareImport>> | null = null;
    await act(async () => {
      outcome = await result.current.prepareImport(serializePatterns([makePattern({ name: '外来片段' })]));
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'not-ready' });
    expect(saves).toBe(0);
    expect(result.current.patterns).toEqual([]);
  });

  it('导入拆两段：prepare 只解析不写盘，apply 才合并落盘', async () => {
    dismissToast();
    const memory = makeMemoryPatternStore([makePattern({ id: 'p1', name: '片段 1', createdAt: 1 })]);
    const { result } = renderHook(() => usePatternLibrary(memory.store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const text = serializePatterns([makePattern({
      id: 'imp',
      name: '外来片段',
      createdAt: 500,
      notes: [{ type: 'Single', beat: 0, lane: 1 }],
    })]);
    let prepared: Awaited<ReturnType<typeof result.current.prepareImport>> | null = null;
    await act(async () => { prepared = await result.current.prepareImport(text); });
    expect(prepared).toMatchObject({
      ok: true,
      preparation: { preview: { total: 1, newCount: 1, duplicateCount: 0 } },
    });
    expect(memory.saves).toBe(0);

    let applied: Awaited<ReturnType<typeof result.current.applyImport>> | null = null;
    await act(async () => {
      if (!prepared?.ok) return;
      applied = await result.current.applyImport(prepared.preparation, 'skip');
    });
    expect(applied).toMatchObject({ ok: true, imported: 1, skipped: 0, skippedExisting: 0 });
    expect(memory.saves).toBe(1);
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['外来片段', '片段 1']);
    expect(memory.disk.map((pattern) => pattern.id)).not.toContain('imp');
  });

  it('全部重复 + 默认跳过：apply 不产生整库落盘', async () => {
    dismissToast();
    const memory = makeMemoryPatternStore([makePattern({ id: 'p1', name: '片段 1' })]);
    const { result } = renderHook(() => usePatternLibrary(memory.store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const text = serializePatterns([makePattern({ id: 'imp', name: '外来名' })]);
    let prepared: Awaited<ReturnType<typeof result.current.prepareImport>> | null = null;
    await act(async () => { prepared = await result.current.prepareImport(text); });
    expect(prepared).toMatchObject({ ok: true, preparation: { preview: { duplicateCount: 1 } } });

    let applied: Awaited<ReturnType<typeof result.current.applyImport>> | null = null;
    await act(async () => {
      if (!prepared?.ok) return;
      applied = await result.current.applyImport(prepared.preparation, 'skip');
    });
    expect(applied).toMatchObject({ ok: true, imported: 0, skippedExisting: 1 });
    expect(memory.saves).toBe(0);
    expect(memory.disk[0]!.name).toBe('片段 1');
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

  describe('issue 191 · setPinned', () => {
    it('置顶成功整库落盘并重排（置顶优先），取消置顶回原位', async () => {
      dismissToast();
      const p1 = makePattern({ id: 'p1', name: '片段 1', createdAt: 100 });
      const p2 = makePattern({ id: 'p2', name: '片段 2', createdAt: 200 });
      const memory = makeMemoryPatternStore([p1, p2]);
      const { result } = renderHook(() => usePatternLibrary(memory.store));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      // 初始按 createdAt 倒序：p2 在前
      expect(result.current.patterns.map((p) => p.id)).toEqual(['p2', 'p1']);

      // 置顶 p1：落盘并排到最前
      let ok = false;
      await act(async () => { ok = await result.current.setPinned('p1', true); });
      expect(ok).toBe(true);
      expect(memory.saves).toBe(1);
      expect(result.current.patterns.map((p) => p.id)).toEqual(['p1', 'p2']);
      expect(typeof memory.disk.find((p) => p.id === 'p1')?.pinnedAt).toBe('number');

      // 取消置顶 p1：落盘并回到原有位置（p2 在前）
      await act(async () => { ok = await result.current.setPinned('p1', false); });
      expect(ok).toBe(true);
      expect(memory.saves).toBe(2);
      expect(result.current.patterns.map((p) => p.id)).toEqual(['p2', 'p1']);
      expect(memory.disk.find((p) => p.id === 'p1')?.pinnedAt).toBeUndefined();
    });

    it('不存在 id / 状态未改变返回 false 且不写盘', async () => {
      dismissToast();
      const p1 = makePattern({ id: 'p1', name: '片段 1', createdAt: 100 });
      const memory = makeMemoryPatternStore([p1]);
      const { result } = renderHook(() => usePatternLibrary(memory.store));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let ok = true;
      await act(async () => { ok = await result.current.setPinned('nope', true); });
      expect(ok).toBe(false);
      expect(memory.saves).toBe(0);

      // 已未置顶，再次取消置顶 → false
      await act(async () => { ok = await result.current.setPinned('p1', false); });
      expect(ok).toBe(false);
      expect(memory.saves).toBe(0);
    });

    it('落盘失败：回滚原状态（不留下界面置顶而磁盘没有的分裂）并返回 false', async () => {
      dismissToast();
      const seed = [
        makePattern({ id: 'p1', name: '片段 1', createdAt: 100 }),
        makePattern({ id: 'p2', name: '片段 2', createdAt: 200 }),
      ];
      const store = new PatternStore({
        load: async () => seed,
        saveAll: async () => { throw new Error('disk full'); },
      });
      const { result } = renderHook(() => usePatternLibrary(store));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let ok = true;
      await act(async () => { ok = await result.current.setPinned('p1', true); });
      expect(ok).toBe(false);

      // 界面与内存状态回滚：p1 仍未置顶，排序仍是 ['p2', 'p1']
      expect(result.current.patterns.map((p) => p.id)).toEqual(['p2', 'p1']);
      expect(result.current.patterns.find((p) => p.id === 'p1')?.pinnedAt).toBeUndefined();
    });
  });
});
