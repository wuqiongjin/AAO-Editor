// @vitest-environment jsdom
// issue 193 锁测：片段多选（批量删除 / 批量导出 / 选择模式进入与退出）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { EditingProvider } from '@/src/app/providers/EditingProvider';
import { PatternStore } from '@/src/chart/patterns/PatternStore';
import { parsePatternsFile } from '@/src/chart/patterns/share';
import { usePatternLibrary } from '@/src/chart/patterns/usePatternLibrary';
import PatternLibraryDrawer from '@/src/pages/workspace/PatternLibraryDrawer';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { makeMemoryPatternStore, makePattern } from '@/tests/support/patterns';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

stubPageShellEnv();

function Harness({
  store, readOnly = false, onPaste = vi.fn(), onExitPaste = vi.fn(), activePatternId = null,
}: {
  store: PatternStore;
  readOnly?: boolean;
  onPaste?: (pattern: ReturnType<typeof makePattern>) => void;
  onExitPaste?: () => void;
  activePatternId?: string | null;
}) {
  const library = usePatternLibrary(store);
  return (
    <PatternLibraryDrawer
      library={library}
      canSaveSelection={false}
      readOnly={readOnly}
      onSaveSelection={() => {}}
      onPastePattern={onPaste}
      onExitPaste={onExitPaste}
      activePatternId={activePatternId}
    />
  );
}

function setup(opts: {
  seed?: ReturnType<typeof makePattern>[];
  readOnly?: boolean;
  loadFails?: boolean;
  loadPending?: boolean;
  onPaste?: (pattern: ReturnType<typeof makePattern>) => void;
  onExitPaste?: () => void;
  activePatternId?: string | null;
} = {}) {
  seedZhSettings({ layout: { patternDrawer: { open: true, width: 300 } } });
  const memory = makeMemoryPatternStore(opts.seed ?? []);
  const store = opts.loadPending
    ? new PatternStore({ load: () => new Promise(() => {}), saveAll: memory.store.saveAll.bind(memory.store) })
    : opts.loadFails
      ? new PatternStore({ load: async () => { throw new Error('blocked'); }, saveAll: memory.store.saveAll.bind(memory.store) })
      : memory.store;
  render(
    <ConfigProvider>
      <EditingProvider>
        <Harness
          store={store}
          readOnly={opts.readOnly}
          onPaste={opts.onPaste}
          onExitPaste={opts.onExitPaste}
          activePatternId={opts.activePatternId}
        />
      </EditingProvider>
    </ConfigProvider>,
  );
  return memory;
}

const openHeadMenu = () => fireEvent.click(screen.getByRole('button', { name: '片段库操作' }));
const storedDrawer = () =>
  (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { layout: { patternDrawer?: { open: boolean; width: number } } })
    .layout.patternDrawer;

const seedLibrary = () => [
  makePattern({ id: 'p1', name: '片段 1', createdAt: 100 }),
  makePattern({ id: 'p2', name: '片段 2', createdAt: 200 }),
  makePattern({ id: 'p3', name: '片段 3', createdAt: 300 }),
];

describe('issue 193 · 进入与退出选择模式', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('⋯ 菜单进入选择模式：footer 换为选区工具条，菜单项变为「退出选择」', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    // 初始为普通 footer
    expect(screen.getByRole('button', { name: '收藏选区' })).toBeInTheDocument();

    openHeadMenu();
    const selectItem = screen.getByRole('menuitem', { name: '选择片段' });
    fireEvent.click(selectItem);

    // 进入选择模式后，footer 切换为选区工具条
    expect(screen.queryByRole('button', { name: '收藏选区' })).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /已选 0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全选当前结果' })).toBeInTheDocument();

    // 再次打开 ⋯ 菜单，项变为「退出选择」
    openHeadMenu();
    const exitItem = screen.getByRole('menuitem', { name: '退出选择' });
    expect(exitItem).toBeInTheDocument();

    // 点击「退出选择」回到普通模式
    fireEvent.click(exitItem);
    expect(screen.getByRole('button', { name: '收藏选区' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('底栏「取消」按钮退出选择模式', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));
    expect(screen.getByRole('toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '收藏选区' })).toBeInTheDocument();
  });

  it('Esc 键退出选择模式并清空已选项', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // 勾选第一张卡
    const cards = screen.getAllByRole('checkbox');
    fireEvent.click(cards[0]!);
    expect(screen.getByText('已选 1')).toBeInTheDocument();

    // 按 Escape 退出
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '收藏选区' })).toBeInTheDocument();

    // 重新进入选择模式，选择集合已清空
    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));
    expect(screen.getByText('已选 0')).toBeInTheDocument();
  });

  it('关闭抽屉退出选择模式并清空', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(screen.getByText('已选 1')).toBeInTheDocument();

    // 点关闭按钮收起抽屉
    fireEvent.click(screen.getByRole('button', { name: '收起片段库' }));
    expect(storedDrawer()?.open).toBe(false);

    // 重新进入选择模式，选择已被清空
    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));
    expect(screen.getByText('已选 0')).toBeInTheDocument();
  });
});

describe('issue 193 · 选择模式下的卡片行为', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('进入选择模式时通知退出片段粘贴态（回指针）', async () => {
    const onExitPaste = vi.fn();
    setup({ seed: seedLibrary(), onExitPaste, activePatternId: 'p1' });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    expect(onExitPaste).toHaveBeenCalledTimes(1);
  });

  it('选择模式下点击卡片勾选/取消，不触发 onPaste', async () => {
    const onPaste = vi.fn();
    setup({ seed: seedLibrary(), onPaste });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    const cards = screen.getAllByRole('checkbox');
    // 单击第一张卡片：勾选
    fireEvent.click(cards[0]!);
    expect(cards[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('已选 1')).toBeInTheDocument();
    expect(onPaste).not.toHaveBeenCalled();

    // 再次单击第一张卡片：取消勾选
    fireEvent.click(cards[0]!);
    expect(cards[0]).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('已选 0')).toBeInTheDocument();
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('双击名字改名在选择模式下禁用', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    fireEvent.doubleClick(screen.getByText('片段 1'));
    expect(screen.queryByRole('textbox', { name: '重命名片段' })).not.toBeInTheDocument();
  });

  it('卡片 ⋯ 菜单在选择模式下隐藏', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    // 普通模式下每张卡有 ⋯ 菜单
    expect(screen.getAllByRole('button', { name: '片段操作' })).toHaveLength(3);

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // 选择模式下隐藏
    expect(screen.queryAllByRole('button', { name: '片段操作' })).toHaveLength(0);
  });

  it('只读谱面下卡片仍可勾选', async () => {
    setup({ seed: seedLibrary(), readOnly: true });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    const cards = screen.getAllByRole('checkbox');
    expect(cards[0]).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(cards[0]!);
    expect(cards[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('已选 1')).toBeInTheDocument();
  });

  it('读失败时「选择片段」菜单项禁用', async () => {
    setup({ loadFails: true });
    await waitFor(() => expect(screen.getByText('片段库读不出来')).toBeInTheDocument());

    openHeadMenu();
    const item = screen.getByRole('menuitem', { name: '选择片段' });
    expect(item).toBeDisabled();
  });

  it('载入中「选择片段」菜单项禁用（loading ≠ 空库）', () => {
    setup({ loadPending: true });

    openHeadMenu();
    const item = screen.getByRole('menuitem', { name: '选择片段' });
    expect(item).toBeDisabled();
  });
});

describe('issue 193 · 搜索与全选', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('全选当前结果将当前可见项全部勾选', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
    expect(screen.getByText('已选 3')).toBeInTheDocument();
    for (const card of screen.getAllByRole('checkbox')) {
      expect(card).toHaveAttribute('aria-checked', 'true');
    }
  });

  it('搜索变化保留已选，并提示「其中 X 条不在当前结果」', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // 勾选「片段 1」和「片段 2」
    const cards = screen.getAllByRole('checkbox');
    fireEvent.click(cards[0]!); // 片段 3 (createdAt 300)
    fireEvent.click(cards[1]!); // 片段 2 (createdAt 200)
    expect(screen.getByText('已选 2')).toBeInTheDocument();

    // 搜索「片段 1」
    const search = screen.getByRole('textbox', { name: '搜索片段名字' });
    fireEvent.change(search, { target: { value: '片段 1' } });

    // 列表只剩片段 1，而已选项（片段 3、片段 2）不在当前结果
    expect(screen.getByText('已选 2')).toBeInTheDocument();
    expect(screen.getByText('其中 2 条不在当前结果')).toBeInTheDocument();

    // 清空搜索，隐藏提示消失
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(screen.queryByText('其中 2 条不在当前结果')).not.toBeInTheDocument();
  });
});

describe('issue 193 · 批量删除', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('批量删除：二次确认 → 只写一次整库 → 成功后清空选择并退出选择模式', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // 勾选前两张
    const cards = screen.getAllByRole('checkbox');
    fireEvent.click(cards[0]!);
    fireEvent.click(cards[1]!);

    const deleteBtn = screen.getByRole('button', { name: '删除所选' });
    expect(deleteBtn).toBeEnabled();
    fireEvent.click(deleteBtn);

    // 弹窗确认
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('删除选中的 2 条片段？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    // 只写一次整库
    await waitFor(() => expect(memory.saves).toBe(1));
    expect(memory.disk).toHaveLength(1);
    expect(memory.disk[0]!.id).toBe('p1');

    // 成功后已退出选择模式
    expect(screen.getByRole('button', { name: '收藏选区' })).toBeInTheDocument();
  });

  it('取消删除：不落盘，原样保留在选择模式', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);

    fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(memory.saves).toBe(0);
    expect(memory.disk).toHaveLength(3);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });
});

describe('issue 193 · 批量导出', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('批量导出走统一信封与 aao-patterns-selected-<count>-YYYYMMDD-HHmmss.json 命名', async () => {
    const saveAs = vi.fn().mockResolvedValue({ cancelled: false });
    (window as unknown as { electronAPI: { patternLibrary: { saveAs: typeof saveAs } } }).electronAPI = {
      patternLibrary: { saveAs },
    };

    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // 勾选前两张
    const cards = screen.getAllByRole('checkbox');
    fireEvent.click(cards[0]!);
    fireEvent.click(cards[1]!);

    fireEvent.click(screen.getByRole('button', { name: '导出所选' }));

    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    const call = saveAs.mock.calls[0]![0] as { json: string; suggestedName: string };
    expect(call.suggestedName).toMatch(/^aao-patterns-selected-2-\d{8}-\d{6}\.json$/);

    const parsed = parsePatternsFile(call.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.patterns).toHaveLength(2);
  });

  it('取消导出不改变库状态', async () => {
    const saveAs = vi.fn().mockResolvedValue({ cancelled: true });
    (window as unknown as { electronAPI: { patternLibrary: { saveAs: typeof saveAs } } }).electronAPI = {
      patternLibrary: { saveAs },
    };

    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    openHeadMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);

    fireEvent.click(screen.getByRole('button', { name: '导出所选' }));
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));

    expect(memory.saves).toBe(0);
  });
});
