// @vitest-environment jsdom
// issue 187 锁测：片段库导出的两个入口（抽屉头 ⋯ = 整库 / 卡片 ⋯ = 单条）+ 取消保存不写库。
//
// 文件真正落盘在 Electron 主进程 / 浏览器下载里，jsdom 没有落盘可断言 ——
// 这里用 preload 桥替身锁「发出去的 JSON 与建议文件名」，真实文件选择 / 下载走手工验收。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { PatternStore } from '@/src/chart/patterns/PatternStore';
import { usePatternLibrary } from '@/src/chart/patterns/usePatternLibrary';
import PatternLibraryDrawer from '@/src/pages/workspace/PatternLibraryDrawer';
import ToastHost, { dismissToast } from '@/src/ui/Toast';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { makeMemoryPatternStore, makePattern } from '@/tests/support/patterns';
import { seedZhSettings } from '@/tests/support/storage';

stubPageShellEnv();

const seedLibrary = () => [
  makePattern({ id: 'p1', name: '片段 1', createdAt: 100 }),
  makePattern({
    id: 'p2',
    name: '折返花活',
    createdAt: 200,
    bpmContext: { startBpm: 120, events: [{ deltaBeat: 1, bpm: -120 }] },
  }),
];

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
  const memory = makeMemoryPatternStore(seedLibrary());
  render(
    <ConfigProvider>
      <Harness store={memory.store} />
    </ConfigProvider>,
  );
  return memory;
}

/** 抽屉头的整库入口（⋯ 一直可见；与卡片上的「片段操作」分开命名） */
const openLibraryMenu = () => fireEvent.click(screen.getByRole('button', { name: '片段库操作' }));
const openCardMenu = (index = 0) => fireEvent.click(screen.getAllByRole('button', { name: '片段操作' })[index]!);

let saveAs: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  act(() => dismissToast());
  saveAs = vi.fn(async () => ({ cancelled: false }));
  (window as unknown as { electronAPI: unknown }).electronAPI = { patternLibrary: { saveAs } };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  act(() => dismissToast());
});

describe('issue 187 · 抽屉头 ⋯ = 整库导入导出', () => {
  it('菜单两项：导出片段库 / 导入片段库', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openLibraryMenu();
    const menu = screen.getByRole('menu', { name: '片段库操作' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '导出片段库' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '导入片段库' })).toBeEnabled();
  });

  it('导出整库：文件名 aao-patterns-YYYYMMDD-HHmmss.json，内容是整库', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '导出片段库' }));

    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    const payload = saveAs.mock.calls[0]![0] as { json: string; suggestedName: string };
    expect(payload.suggestedName).toMatch(/^aao-patterns-\d{8}-\d{6}\.json$/);
    const doc = JSON.parse(payload.json) as { schemaVersion: number; patterns: { name: string }[] };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.patterns.map((pattern) => pattern.name)).toEqual(['折返花活', '片段 1']);
    // 导出只读库：不改内存、不写盘
    expect(memory.saves).toBe(0);
  });

  it('取消保存：什么都不发生（库不动、无提示）', async () => {
    saveAs.mockResolvedValue({ cancelled: true });
    const memory = setup();
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '导出片段库' }));

    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    expect(memory.saves).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('issue 187 · 卡片 ⋯ 的导出 = 该条', () => {
  it('只导出该条：建议文件名带片段名，信封里只有它', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openCardMenu(0);
    fireEvent.click(screen.getByRole('menuitem', { name: '导出片段' }));

    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    const payload = saveAs.mock.calls[0]![0] as { json: string; suggestedName: string };
    expect(payload.suggestedName).toBe('折返花活.aao-pattern.json');
    const doc = JSON.parse(payload.json) as { patterns: { id: string; name: string }[] };
    expect(doc.patterns).toHaveLength(1);
    expect(doc.patterns[0]).toMatchObject({ id: 'p2', name: '折返花活' });
    expect(memory.saves).toBe(0);
  });

  it('单条导出失败：提示通用「导出失败」，不写库', async () => {
    saveAs.mockRejectedValue(new Error('disk full'));
    const memory = setup();
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openCardMenu(0);
    fireEvent.click(screen.getByRole('menuitem', { name: '导出片段' }));

    await waitFor(() => expect(screen.getByText('导出失败')).toBeInTheDocument());
    expect(memory.saves).toBe(0);
  });
});
