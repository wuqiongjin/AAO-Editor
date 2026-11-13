// @vitest-environment jsdom
// issue 189 锁测：导入冲突策略（弹层三选一 / 取消不写盘 / 分开报数 / 每次导入只写一次）。
//
// 前置（187）语义不变：解析逐条校验 + 重发 id；坏条目只计数、不阻断整包。
// 真实文件选择框在 jsdom 里没有系统对话框，只有 `<input type="file">` 这个壳 ——
// 测试给隐藏 input 灌 File，其余走真实 FileReader → prepareImport → 弹层 → applyImport。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { PatternStore } from '@/src/patterns/PatternStore';
import { serializePatterns } from '@/src/patterns/share';
import type { Pattern } from '@/src/patterns/types';
import { usePatternLibrary } from '@/src/patterns/usePatternLibrary';
import type { ChartNote } from '@/src/chart/types';
import PatternLibraryDrawer from '@/src/pages/workspace/PatternLibraryDrawer';
import ToastHost, { dismissToast } from '@/src/ui/Toast';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { makeMemoryPatternStore, makePattern } from '@/tests/support/patterns';
import { seedZhSettings } from '@/tests/support/storage';

stubPageShellEnv();

/** 与 setup 里的本地片段同内容（单键 lane 3） */
const NOTE_LOCAL: ChartNote[] = [{ type: 'Single', beat: 0, lane: 3 }];
const NOTE_OTHER: ChartNote[] = [{ type: 'Single', beat: 0, lane: 1 }];
const NOTE_THIRD: ChartNote[] = [{ type: 'Single', beat: 0, lane: 2 }];

function Harness({ store }: { store: PatternStore }) {
  const library = usePatternLibrary(store);
  return (
    <>
      <PatternLibraryDrawer
        library={library}
        canSaveSelection={false}
        onSaveSelection={() => {}}
        onPastePattern={() => {}}
      />
      <ToastHost />
    </>
  );
}

function setup(seed: Pattern[] = [
  makePattern({ id: 'p1', name: '片段 1', createdAt: 100, notes: NOTE_LOCAL }),
]) {
  seedZhSettings({ layout: { patternDrawer: { open: true, width: 300 } } });
  const memory = makeMemoryPatternStore(seed);
  render(
    <ConfigProvider>
      <Harness store={memory.store} />
    </ConfigProvider>,
  );
  return memory;
}

const openLibraryMenu = () => fireEvent.click(screen.getByRole('button', { name: '片段库操作' }));

/** 点「导入片段库」→ 拿到隐藏 input → 灌进用户选的文件（读取 / 解析由各用例的 waitFor 等） */
function importFile(text: string, filename = 'patterns.json'): void {
  openLibraryMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: '导入片段库' }));

  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  expect(input).toHaveAttribute('accept', '.json,application/json');
  fireEvent.change(input!, {
    target: { files: [new File([text], filename, { type: 'application/json' })] },
  });
}

const envelope = (patterns: unknown[]) => JSON.stringify({
  schemaVersion: 1,
  exportedAt: '2026-10-31T00:00:00.000Z',
  patterns,
});

/** 等弹层出现（解析完成前不能点，故先 findByRole）；无障碍名 = 标题 + hint，故用前缀匹配 */
const findDialog = () => screen.findByRole('dialog', { name: /^导入片段/ });

function chooseStrategy(name: RegExp): void {
  fireEvent.click(screen.getByRole('radio', { name }));
}

function confirmDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: '导入' }));
}

beforeEach(() => {
  window.localStorage.clear();
  act(() => dismissToast());
});

afterEach(() => {
  act(() => dismissToast());
});

describe('issue 189 · 无冲突：照常入列，确认前不写盘', () => {
  it('确认后才写：两次导入每次只写一次，新 id、按收藏时间排序', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const imported = [
      makePattern({ id: 'imp1', name: '片段 1', createdAt: 500, notes: NOTE_OTHER }),
      makePattern({ id: 'imp2', name: '外来花活', createdAt: 600, notes: NOTE_THIRD }),
    ];
    importFile(serializePatterns(imported));

    const dialog = await findDialog();
    expect(dialog).toBeInTheDocument();
    // 弹层出现前不写盘
    expect(memory.saves).toBe(0);
    expect(screen.getByText('总数 2')).toBeInTheDocument();
    expect(screen.getByText('新增 2')).toBeInTheDocument();
    // 无重复 → 不显示「重复条目处理」三选一；说明收在标题右侧的「?」里
    expect(screen.queryByText('重复条目处理')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认后才会把片段加入片段库/ })).toBeInTheDocument();

    confirmDialog();
    await waitFor(() => expect(memory.disk).toHaveLength(3));
    // 只合并：原库那条还在，新条目 id 是重发的（源 id 一个都没进来）
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['外来花活', '片段 1', '片段 1']);
    const ids = memory.disk.map((pattern) => pattern.id);
    expect(ids).not.toContain('imp1');
    expect(ids).not.toContain('imp2');
    expect(memory.saves).toBe(1);

    await waitFor(() => expect(screen.getByText('导入 2 条')).toBeInTheDocument());
  });

  it('空库导入文件内同内容多条：全部按新片段加入（只和本地库判重）', async () => {
    const memory = setup([]);
    await waitFor(() => expect(screen.getByText('还没有收藏的片段')).toBeInTheDocument());

    importFile(serializePatterns([
      makePattern({ id: 'imp1', name: '文件一', createdAt: 500, notes: NOTE_LOCAL }),
      makePattern({ id: 'imp2', name: '文件二', createdAt: 600, notes: NOTE_LOCAL }),
    ]));

    await findDialog();
    expect(screen.getByText('总数 2')).toBeInTheDocument();
    expect(screen.getByText('新增 2')).toBeInTheDocument();
    expect(screen.getByText('重复 0')).toBeInTheDocument();
    // 文件内部的同内容条目不是冲突：不出现「重复条目」清单，也不显示策略区
    expect(screen.queryByText('重复条目')).not.toBeInTheDocument();
    expect(screen.queryByText('重复条目处理')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    confirmDialog();
    await waitFor(() => expect(memory.disk).toHaveLength(2));
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['文件二', '文件一']);
    expect(memory.disk.map((pattern) => pattern.id)).not.toContain('imp1');
    expect(memory.disk.map((pattern) => pattern.id)).not.toContain('imp2');
    expect(memory.saves).toBe(1);
    await waitFor(() => expect(screen.getByText('导入 2 条')).toBeInTheDocument());
  });

  it('同名但内容不同：不判冲突，两条都保留（弹层给提示）', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(serializePatterns([
      makePattern({ id: 'imp', name: '片段 1', createdAt: 500, notes: NOTE_OTHER }),
    ]));

    await findDialog();
    expect(screen.getByText('另有 1 条同名但内容不同，会分别保留。')).toBeInTheDocument();
    confirmDialog();

    await waitFor(() => expect(memory.disk).toHaveLength(2));
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['片段 1', '片段 1']);
    expect(memory.saves).toBe(1);
    await waitFor(() => expect(screen.getByText('导入 1 条')).toBeInTheDocument());
  });
});

describe('issue 189 · 冲突：跳过（默认）', () => {
  it('默认跳过：本地不变、导入不写、不产生整库落盘，报「0 条 / 已存在」', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(serializePatterns([
      makePattern({ id: 'imp', name: '外来名', createdAt: 500, notes: NOTE_LOCAL }),
    ]));

    await findDialog();
    // 冲突清单：导入名 ↔ 本地名
    expect(screen.getByText('「外来名」↔「片段 1」')).toBeInTheDocument();
    expect(screen.getByText('重复 1')).toBeInTheDocument();

    confirmDialog();
    await waitFor(() => expect(screen.getByText('导入 0 条，跳过 1 条（1 条已存在）')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.disk[0]!.name).toBe('片段 1');
    expect(memory.saves).toBe(0);
  });

  it('取消 / Esc / 点遮罩关闭弹层 = 不写盘', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const conflictFile = serializePatterns([
      makePattern({ id: 'imp', name: '外来名', createdAt: 500, notes: NOTE_LOCAL }),
    ]);

    // 取消按钮
    importFile(conflictFile);
    await findDialog();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^导入片段/ })).not.toBeInTheDocument());
    expect(memory.saves).toBe(0);

    // Esc 由 Dialog 壳的 window capture 监听关闭
    importFile(conflictFile);
    await findDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: '导入' })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^导入片段/ })).not.toBeInTheDocument());
    expect(memory.saves).toBe(0);

    // 点遮罩（面板 mousedown 会 stopPropagation，不关）
    importFile(conflictFile);
    await findDialog();
    fireEvent.mouseDown(document.querySelector('.dialog__scrim') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^导入片段/ })).not.toBeInTheDocument());
    expect(memory.saves).toBe(0);

    expect(memory.disk).toHaveLength(1);
    expect(memory.disk[0]!.name).toBe('片段 1');
  });
});

describe('issue 189 · 冲突：覆盖 / 保留两者', () => {
  it('覆盖：保留本地 id / createdAt，只换名字；确认后只落盘一次', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(serializePatterns([
      makePattern({ id: 'imp', name: '外来名', createdAt: 500, notes: NOTE_LOCAL }),
    ]));

    await findDialog();
    chooseStrategy(/^覆盖/);
    confirmDialog();

    await waitFor(() => expect(memory.disk).toHaveLength(1));
    expect(memory.disk[0]!.id).toBe('p1');
    expect(memory.disk[0]!.createdAt).toBe(100);
    expect(memory.disk[0]!.name).toBe('外来名');
    expect(memory.saves).toBe(1);
    await waitFor(() => expect(screen.getByText('导入 1 条')).toBeInTheDocument());
  });

  it('保留两者：追加新 id，名字 / createdAt 沿用导入文件', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(serializePatterns([
      makePattern({ id: 'imp', name: '外来名', createdAt: 500, notes: NOTE_LOCAL }),
    ]));

    await findDialog();
    chooseStrategy(/^保留两者/);
    confirmDialog();

    await waitFor(() => expect(memory.disk).toHaveLength(2));
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['外来名', '片段 1']);
    expect(memory.disk[0]!.id).not.toBe('imp');
    expect(memory.disk[0]!.createdAt).toBe(500);
    expect(memory.saves).toBe(1);
    await waitFor(() => expect(screen.getByText('导入 1 条')).toBeInTheDocument());
  });
});

describe('issue 187 · 含坏条目：好条目照常进来，报「N 条 / 跳过 M 条」', () => {
  it('部分导入：坏条目跳过并计数，不阻断整包', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const goodOne = makePattern({ id: 'g1', name: '好 1', createdAt: 300, notes: NOTE_OTHER });
    const badOne = { ...makePattern({ id: 'bad', name: '坏条目', createdAt: 900 }), notes: [] };
    const goodTwo = makePattern({ id: 'g2', name: '好 2', createdAt: 400, notes: NOTE_THIRD });
    importFile(envelope([goodOne, badOne, goodTwo]));

    await findDialog();
    expect(screen.getByText('总数 3')).toBeInTheDocument();
    expect(screen.getByText('坏条目 1')).toBeInTheDocument();
    confirmDialog();

    await waitFor(() => expect(memory.disk).toHaveLength(3));
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['好 2', '好 1', '片段 1']);
    expect(memory.disk.some((pattern) => pattern.name === '坏条目')).toBe(false);
    expect(memory.saves).toBe(1);

    await waitFor(() => expect(screen.getByText('导入 2 条，跳过 1 条')).toBeInTheDocument());
  });
});

describe('issue 187 · 整包拒绝 / 空文件：不动现有库', () => {
  it('版本不认识 → 单独文案，一条都不写', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(JSON.stringify({
      schemaVersion: 99,
      exportedAt: '2026-10-31T00:00:00.000Z',
      patterns: [makePattern({ id: 'x', name: '不该进来' })],
    }));

    await waitFor(() => expect(screen.getByText('不支持的片段文件版本：99')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.disk[0]!.name).toBe('片段 1');
    expect(memory.saves).toBe(0);
  });

  it('不是片段文件 → 「无法解析」，一条都不写', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile('{ not json');

    await waitFor(() => expect(screen.getByText('片段文件无法解析')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.saves).toBe(0);
  });

  it('普通 JSON 对象但没有 schemaVersion → 「无法解析」，不把 undefined 当版本号', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(JSON.stringify({ exportedAt: 'x', patterns: [makePattern({ name: '不该进来' })] }));

    await waitFor(() => expect(screen.getByText('片段文件无法解析')).toBeInTheDocument());
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(memory.disk).toHaveLength(1);
    expect(memory.saves).toBe(0);
  });

  it('空文件（信封里没有片段）→ 如实说，也不写盘', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(envelope([]));

    await waitFor(() => expect(screen.getByText('这个文件里没有片段')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.saves).toBe(0);
  });
});
