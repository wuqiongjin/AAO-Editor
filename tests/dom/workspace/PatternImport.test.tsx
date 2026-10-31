// @vitest-environment jsdom
// issue 187 锁测：导入片段库的语义（只合并不替换 / 坏条目跳过并报数 / 整包拒绝不动库）。
//
// 真实文件选择框在 jsdom 里没有系统对话框，只有 `<input type="file">` 这个壳 ——
// 测试给隐藏 input 灌 File，其余走真实 FileReader → parsePatternsFile → 库层合并落盘。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { PatternStore } from '@/src/chart/patterns/PatternStore';
import { serializePatterns } from '@/src/chart/patterns/share';
import { usePatternLibrary } from '@/src/chart/patterns/usePatternLibrary';
import PatternLibraryDrawer from '@/src/pages/workspace/PatternLibraryDrawer';
import ToastHost, { dismissToast } from '@/src/ui/Toast';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { makeMemoryPatternStore, makePattern } from '@/tests/support/patterns';
import { seedZhSettings } from '@/tests/support/storage';

stubPageShellEnv();

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

function setup() {
  seedZhSettings({ layout: { patternDrawer: { open: true, width: 300 } } });
  const memory = makeMemoryPatternStore([makePattern({ id: 'p1', name: '片段 1', createdAt: 100 })]);
  render(
    <ConfigProvider>
      <Harness store={memory.store} />
    </ConfigProvider>,
  );
  return memory;
}

const openLibraryMenu = () => fireEvent.click(screen.getByRole('button', { name: '片段库操作' }));

/** 点「导入片段库」→ 拿到隐藏 input → 灌进用户选的文件（异步读取由各用例的 waitFor 等） */
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

beforeEach(() => {
  window.localStorage.clear();
  act(() => dismissToast());
});

afterEach(() => {
  act(() => dismissToast());
});

describe('issue 187 · 合法文件：只合并不替换', () => {
  it('导入 N 条：新 id、允许重名、按收藏时间排进现有库', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const imported = [
      makePattern({ id: 'imp1', name: '片段 1', createdAt: 500 }),
      makePattern({ id: 'imp2', name: '外来花活', createdAt: 600 }),
    ];
    importFile(serializePatterns(imported));

    await waitFor(() => expect(memory.disk).toHaveLength(3));
    // 只合并：原库那条还在，新条目 id 是重发的（源 id 一个都没进来）
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['外来花活', '片段 1', '片段 1']);
    const ids = memory.disk.map((pattern) => pattern.id);
    expect(ids).not.toContain('imp1');
    expect(ids).not.toContain('imp2');
    expect(memory.saves).toBe(1);

    await waitFor(() => expect(screen.getByText('导入 2 条')).toBeInTheDocument());
  });
});

describe('issue 187 · 含坏条目：好条目照常进来，报「N 条 / 跳过 M 条」', () => {
  it('部分导入：坏条目跳过并计数，不阻断整包', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const goodOne = makePattern({ id: 'g1', name: '好 1', createdAt: 300 });
    const badOne = { ...makePattern({ id: 'bad', name: '坏条目', createdAt: 900 }), notes: [] };
    const goodTwo = makePattern({ id: 'g2', name: '好 2', createdAt: 400 });
    importFile(envelope([goodOne, badOne, goodTwo]));

    await waitFor(() => expect(memory.disk).toHaveLength(3));
    expect(memory.disk.map((pattern) => pattern.name)).toEqual(['好 2', '好 1', '片段 1']);
    expect(memory.disk.some((pattern) => pattern.name === '坏条目')).toBe(false);

    await waitFor(() => expect(screen.getByText('导入 2 条，跳过 1 条')).toBeInTheDocument());
  });
});

describe('issue 187 · 整包拒绝：不动现有库', () => {
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

  it('空文件（信封里没有片段）→ 如实说，也不写盘', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    importFile(envelope([]));

    await waitFor(() => expect(screen.getByText('这个文件里没有片段')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.saves).toBe(0);
  });
});
