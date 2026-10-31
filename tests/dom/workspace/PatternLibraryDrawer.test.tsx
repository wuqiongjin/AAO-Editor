// @vitest-environment jsdom
// issue 185 锁测：片段库抽屉（卡片 / 缩略图 / 搜索 / 改名 / 删除 / 收藏按钮）+ 183 外壳回归。
import '@testing-library/jest-dom/vitest';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { EditingProvider, useEditing } from '@/src/app/providers/EditingProvider';
import { PatternStore } from '@/src/chart/patterns/PatternStore';
import { usePatternLibrary } from '@/src/chart/patterns/usePatternLibrary';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import PatternLibraryDrawer from '@/src/pages/workspace/PatternLibraryDrawer';
import { useSaveSelectionPattern } from '@/src/pages/workspace/useSaveSelectionPattern';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { makeMemoryPatternStore, makePattern } from '@/tests/support/patterns';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

stubPageShellEnv();

/** 一段带两个可收藏音符的谱面（BPM 不进选区，与真实口径一致） */
const CHART_NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { beat: 0, type: 'Single', lane: 0 },
  { beat: 1, type: 'Single', lane: 1 },
];
const CHART_SELECTION: SelectionItem[] = [
  { kind: 'note', noteIndex: 1 },
  { kind: 'note', noteIndex: 2 },
];

function SeedSelection() {
  const { resetNotes, setSelectedItems } = useEditing();
  useEffect(() => {
    resetNotes(CHART_NOTES);
    setSelectedItems(CHART_SELECTION);
  }, [resetNotes, setSelectedItems]);
  return null;
}

/** 抽屉 + 真实库 hook（内存后端）+ 真实收藏路径：断言的是"界面 → 库"的整条链 */
function Harness({ store, readOnly = false }: { store: PatternStore; readOnly?: boolean }) {
  const library = usePatternLibrary(store);
  const { canSave, save } = useSaveSelectionPattern(library);
  return (
    <PatternLibraryDrawer
      library={library}
      canSaveSelection={canSave}
      readOnly={readOnly}
      onSaveSelection={() => void save()}
    />
  );
}

function setup(opts: {
  seed?: ReturnType<typeof makePattern>[];
  readOnly?: boolean;
  withSelection?: boolean;
  loadFails?: boolean;
} = {}) {
  seedZhSettings({ layout: { patternDrawer: { open: true, width: 300 } } });
  const memory = makeMemoryPatternStore(opts.seed ?? []);
  // 读失败的后端：load 直接抛（IndexedDB 被占 / 文件读不出来）
  const store = opts.loadFails
    ? new PatternStore({ load: async () => { throw new Error('blocked'); }, saveAll: memory.store.saveAll.bind(memory.store) })
    : memory.store;
  render(
    <ConfigProvider>
      <EditingProvider>
        {opts.withSelection && <SeedSelection />}
        <Harness store={store} readOnly={opts.readOnly} />
      </EditingProvider>
    </ConfigProvider>,
  );
  return memory;
}

const drawer = () => screen.getByRole('complementary', { name: '片段库' });
const saveButton = () => screen.getByRole('button', { name: '收藏选区' });
const cardNames = () => screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
const readonlyTitle = '已上传的谱面不能粘贴片段；收藏选区不受影响';
const storedDrawer = () =>
  (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { layout: { patternDrawer?: { open: boolean; width: number } } })
    .layout.patternDrawer;

const seedLibrary = () => [
  makePattern({ id: 'p1', name: '片段 1', createdAt: 100 }),
  makePattern({
    id: 'p2',
    name: '折返花活',
    createdAt: 200,
    bpmContext: { startBpm: 120, events: [{ deltaBeat: 1, bpm: -120 }, { deltaBeat: 2, bpm: 120 }] },
  }),
];

describe('issue 183 · 抽屉外壳（回归）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('宽度取自设置', () => {
    setup();
    expect(drawer()).toHaveStyle({ width: '300px' });
  });

  it('关闭钮收起抽屉并落盘', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '收起片段库' }));
    expect(storedDrawer()?.open).toBe(false);
  });

  it('拖左缘改宽：拖动中只改本地宽度，松手才落盘', () => {
    setup();
    const resizer = screen.getByRole('separator', { name: '拖动调整片段库宽度' });

    fireEvent.mouseDown(resizer, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 980 });
    expect(drawer()).toHaveStyle({ width: '320px' });
    expect(storedDrawer()?.width).toBe(300);

    fireEvent.mouseUp(document, { clientX: 980 });
    expect(storedDrawer()?.width).toBe(320);
  });

  it('拖得过窄夹到下限 220', () => {
    setup();
    const resizer = screen.getByRole('separator', { name: '拖动调整片段库宽度' });
    fireEvent.mouseDown(resizer, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 1200 });
    expect(drawer()).toHaveStyle({ width: '220px' });
    fireEvent.mouseUp(document);
    expect(storedDrawer()?.width).toBe(220);
  });
});

describe('issue 185 · 空态与收藏入口', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('空库：显示「还没有收藏的片段」，无选区时收藏按钮置灰', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('还没有收藏的片段')).toBeInTheDocument());
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '搜索片段名字' })).toBeInTheDocument();
  });

  it('载入中不先闪「还没有收藏」（loading ≠ 空库）', () => {
    setup();
    expect(screen.queryByText('还没有收藏的片段')).not.toBeInTheDocument();
  });

  it('读失败：如实说读不出来，不冒充空库（且这轮不写入）', async () => {
    const memory = setup({ loadFails: true, withSelection: true });
    await waitFor(() => expect(screen.getByText('片段库读不出来')).toBeInTheDocument());
    expect(screen.queryByText('还没有收藏的片段')).not.toBeInTheDocument();

    fireEvent.click(saveButton());
    // 写盘次数是"没有覆盖原库"的硬指标
    await waitFor(() => expect(memory.saves).toBe(0));
  });

  it('有选区 → 收藏按钮可用，点一次即入库（新片段出现在列表里）', async () => {
    const memory = setup({ withSelection: true });
    await waitFor(() => expect(screen.getByText('还没有收藏的片段')).toBeInTheDocument());
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.disk[0]!.notes).toHaveLength(2);
    // 载荷不夹带 BPM：选区里本来就没有，收藏侧只取速度语境
    expect(memory.disk[0]!.bpmContext.startBpm).toBe(120);
  });

  it('无选区时按收藏按钮无事发生（不写盘）', async () => {
    const memory = setup();
    await waitFor(() => expect(screen.getByText('还没有收藏的片段')).toBeInTheDocument());
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(memory.disk).toHaveLength(0);
  });
});

describe('issue 185 · 卡片', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('三元素齐：缩略图 + 名字 + 徽标；收藏时间倒序', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 三元素：名字、徽标、缩略图（读屏名带片段名，故按 role 查得到）
    expect(screen.getByText('片段 1')).toBeInTheDocument();
    expect(screen.getByText('含 BPM 变化 · 2')).toBeInTheDocument();
    expect(screen.getByText('含倒流')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /的缩略图/ })).toHaveLength(2);

    // 倒序：最新的「折返花活」在最上
    const names = cardNames();
    expect(names[0]).toContain('折返花活');
    expect(names[1]).toContain('片段 1');
  });

  it('导出入口占位：菜单项在但禁用（动作落 187）', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());
    for (const button of screen.getAllByRole('button', { name: '导出片段' })) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', '片段导出即将推出');
    }
  });
});

describe('issue 185 · 搜索', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('按名字子串过滤，不区分大小写；清空复原', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    const search = screen.getByRole('textbox', { name: '搜索片段名字' });
    fireEvent.change(search, { target: { value: '片段' } });
    expect(screen.queryByText('折返花活')).not.toBeInTheDocument();
    expect(screen.getByText('片段 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(screen.getByText('折返花活')).toBeInTheDocument();
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('搜索无匹配是独立空态，不是「库里没有片段」', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: '搜索片段名字' }), { target: { value: '没有这个' } });
    expect(screen.getByText('没有匹配的片段')).toBeInTheDocument();
    expect(screen.queryByText('还没有收藏的片段')).not.toBeInTheDocument();
  });
});

describe('issue 185 · 就地改名', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const openRename = (name: string) => {
    fireEvent.doubleClick(screen.getByText(name));
    return screen.getByRole('textbox', { name: '重命名片段' }) as HTMLInputElement;
  };

  it('双击进入编辑；Enter 提交并存库', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const input = openRename('片段 1');
    expect(input).toHaveValue('片段 1');
    fireEvent.change(input, { target: { value: '  滑条花活  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('滑条花活')).toBeInTheDocument());
    expect(memory.disk.find((pattern) => pattern.id === 'p1')?.name).toBe('滑条花活');
  });

  it('Esc 取消：名字不变、不写盘', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const input = openRename('片段 1');
    fireEvent.change(input, { target: { value: '别保存我' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.getByText('片段 1')).toBeInTheDocument();
    expect(screen.queryByText('别保存我')).not.toBeInTheDocument();
    expect(memory.disk.find((pattern) => pattern.id === 'p1')?.name).toBe('片段 1');
    expect(memory.saves).toBe(0);
  });

  it('空名拒绝：名字原样保留', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    const input = openRename('片段 1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByRole('textbox', { name: '重命名片段' })).not.toBeInTheDocument());
    expect(screen.getByText('片段 1')).toBeInTheDocument();
    expect(memory.disk.find((pattern) => pattern.id === 'p1')?.name).toBe('片段 1');
  });
});

describe('issue 185 · 删除', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hover 删除 → sm 确认弹窗 → 立即删（落盘）', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: '删除片段' })[0]!);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('删除「折返花活」？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByText('折返花活')).not.toBeInTheDocument());
    expect(memory.disk.map((pattern) => pattern.id)).toEqual(['p1']);
  });

  it('取消则原样保留', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: '删除片段' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('折返花活')).toBeInTheDocument();
    expect(memory.disk).toHaveLength(2);
    expect(memory.saves).toBe(0);
  });
});

describe('issue 185 · 只读谱面', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('卡片置灰（带说明），但「收藏选区」仍可点、真能收片段', async () => {
    const memory = setup({ seed: seedLibrary(), readOnly: true, withSelection: true });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 置灰 = 卡片本身带只读说明（tooltip 是 164 §3 定下的说明位，贴入被拦见 186）；
    // 不是把整条收藏链路一起灰掉
    expect(screen.getAllByTitle(readonlyTitle)).toHaveLength(2);

    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(memory.disk).toHaveLength(3));
  });

  it('非只读时卡片不带只读说明', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());
    expect(screen.queryAllByTitle(readonlyTitle)).toHaveLength(0);
  });
});
