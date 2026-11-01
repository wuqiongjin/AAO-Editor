// @vitest-environment jsdom
// issue 185 锁测：片段库抽屉（卡片 / 缩略图 / 搜索 / 改名 / 删除 / 收藏按钮）+ 183 外壳回归。
import '@testing-library/jest-dom/vitest';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
function Harness({
  store, readOnly = false, onPaste = () => {}, activePatternId = null,
}: {
  store: PatternStore;
  readOnly?: boolean;
  onPaste?: (pattern: ReturnType<typeof makePattern>) => void;
  activePatternId?: string | null;
}) {
  const library = usePatternLibrary(store);
  const { canSave, save } = useSaveSelectionPattern(library);
  return (
    <PatternLibraryDrawer
      library={library}
      canSaveSelection={canSave}
      readOnly={readOnly}
      onSaveSelection={() => void save()}
      onPastePattern={onPaste}
      activePatternId={activePatternId}
    />
  );
}

function setup(opts: {
  seed?: ReturnType<typeof makePattern>[];
  readOnly?: boolean;
  withSelection?: boolean;
  loadFails?: boolean;
  onPaste?: (pattern: ReturnType<typeof makePattern>) => void;
  activePatternId?: string | null;
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
        <Harness store={store} readOnly={opts.readOnly} onPaste={opts.onPaste} activePatternId={opts.activePatternId} />
      </EditingProvider>
    </ConfigProvider>,
  );
  return memory;
}

const drawer = () => screen.getByRole('complementary', { name: '片段库' });
const saveButton = () => screen.getByRole('button', { name: '收藏选区' });
const cardNames = () => screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
/** 常驻 ⋯ 是卡片动作的唯一入口（2026-10-31 验收：不再靠 hover 才出现） */
const openCardMenu = (index = 0) => fireEvent.click(screen.getAllByRole('button', { name: '片段操作' })[index]!);
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
    // issue 190 统计夹具：单键 1 + 滑条非 hidden 结点 2 = 3 音符；拍数 0 → 8.5（hidden 结点仍在跨度内）
    notes: [
      { type: 'Single', beat: 0, lane: 0 },
      {
        type: 'Slide',
        connections: [
          { beat: 2, lane: 1 },
          { beat: 6.5, lane: 2, hidden: true },
          { beat: 8.5, lane: 3 },
        ],
      },
    ],
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
    expect(screen.getAllByRole('img', { name: /的缩略图/ })).toHaveLength(2);

    // 倒序：最新的「折返花活」在最上
    const names = cardNames();
    expect(names[0]).toContain('折返花活');
    expect(names[1]).toContain('片段 1');

    // 徽标 = 速度跨度（issue 186 二轮）：无变化只有起点；有变化给「起点 → 峰值」
    const cards = screen.getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('BPM 120 → -120');
    expect(cards[1]).toHaveTextContent('BPM 120');
    // 负值只给那个数字上危险色；「含倒流」徽标已删
    expect(screen.getByText('-120')).toHaveClass('is-negative');
    expect(screen.queryByText('含倒流')).not.toBeInTheDocument();
  });

  it('动作入口常驻可见（不用 hover）；导出项可用（动作落 187）', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 两张卡各有一枚 ⋯，且没有任何 hover 前置动作
    expect(screen.getAllByRole('button', { name: '片段操作' })).toHaveLength(2);

    openCardMenu(0);
    expect(screen.getByRole('menu', { name: '片段操作' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '导出片段' })).toBeEnabled();
  });

  it('菜单：Esc / 点遮罩都能关掉', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openCardMenu(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    openCardMenu(0);
    fireEvent.click(document.querySelector('.pld-menu__scrim')!);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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

    openCardMenu(0);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除片段' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('删除「折返花活」？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByText('折返花活')).not.toBeInTheDocument());
    expect(memory.disk.map((pattern) => pattern.id)).toEqual(['p1']);
  });

  it('取消则原样保留', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    openCardMenu(0);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除片段' }));
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

describe('issue 186 · 点卡片进片段粘贴态', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const card = (name: string) => screen.getByRole('button', { name: `把「${name}」贴到画布` });

  it('点卡片：回调带上该片段；不写库', async () => {
    const onPaste = vi.fn();
    const memory = setup({ seed: seedLibrary(), onPaste });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    fireEvent.click(card('折返花活'));

    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste.mock.calls[0]![0]).toMatchObject({ id: 'p2', name: '折返花活' });
    expect(memory.saves).toBe(0);
  });

  it('名字也是卡片热区：单击切卡；双击改名时第二击不再切一次', async () => {
    const onPaste = vi.fn();
    setup({ seed: seedLibrary(), onPaste });
    await waitFor(() => expect(screen.getByText('片段 1')).toBeInTheDocument());

    // 单击名字 = 点卡片（issue 186 二轮：以前这块点不动）
    fireEvent.click(screen.getByText('片段 1'));
    expect(onPaste).toHaveBeenCalledTimes(1);

    // 双击：第一击切卡，第二击（detail=2）被挡掉，dblclick 开改名
    const name = screen.getByText('片段 1');
    fireEvent.click(name, { detail: 1 });
    fireEvent.click(name, { detail: 2 });
    fireEvent.doubleClick(name);
    expect(onPaste).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: '重命名片段' })).toBeInTheDocument();
  });

  it('只读谱面：卡片置灰（aria-disabled）且点击不进态', async () => {
    const onPaste = vi.fn();
    setup({ seed: seedLibrary(), readOnly: true, onPaste });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    const hit = card('折返花活');
    expect(hit).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(hit);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('当前粘贴来源的卡片高亮（aria-pressed），其余为 false', async () => {
    setup({ seed: seedLibrary(), activePatternId: 'p2' });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    expect(card('折返花活')).toHaveAttribute('aria-pressed', 'true');
    expect(card('片段 1')).toHaveAttribute('aria-pressed', 'false');
    // 高亮落在卡片那一层（CSS 只认 .pld-card.is-active）
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('is-active');
    expect(screen.getAllByRole('listitem')[1]).not.toHaveClass('is-active');
  });

  it('只读谱面不会把卡片标成"当前来源"（哪怕 id 巧合）', async () => {
    setup({ seed: seedLibrary(), readOnly: true, activePatternId: 'p2' });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());
    expect(card('折返花活')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('listitem')[0]).not.toHaveClass('is-active');
  });
});

describe('issue 190 · 卡片统计行', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('徽标下方显示「N 音符 · N 拍」，hidden 结点不计音符数但计拍数', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 倒序：折返花活 = 单键 1 + 滑条可击打结点 2 = 3 音符；8.5 − 0 = 8.5 拍
    expect(screen.getByText('3 音符 · 8.5 拍')).toHaveClass('pld-card__stats');
    expect(screen.getByText('1 音符 · 0 拍')).toBeInTheDocument();
  });

  it('就地改名只替换名字行，统计行保持', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByText('折返花活'));
    expect(screen.getByRole('textbox', { name: '重命名片段' })).toBeInTheDocument();

    const topCard = screen.getAllByRole('listitem')[0]!;
    expect(topCard).toHaveTextContent('3 音符 · 8.5 拍');
    expect(topCard).toHaveTextContent('BPM 120 → -120');
  });

  it('统计行不抢 ⋯ 菜单：动作入口仍可点开', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());
    expect(screen.getByText('3 音符 · 8.5 拍')).toBeInTheDocument();

    openCardMenu(0);
    expect(screen.getByRole('menu', { name: '片段操作' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '导出片段' })).toBeEnabled();
  });

  it('空片段 / 只有 BPM 的脏数据：显示「0 音符 · 0 拍」，不抛错', async () => {
    setup({
      seed: [
        makePattern({ id: 'empty', name: '空片段', createdAt: 100, notes: [] }),
        makePattern({
          id: 'bpm-only',
          name: '只有 BPM',
          createdAt: 200,
          notes: [{ type: 'BPM', beat: 0, bpm: 120 }],
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText('只有 BPM')).toBeInTheDocument());

    const cards = screen.getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('0 音符 · 0 拍');
    expect(cards[1]).toHaveTextContent('0 音符 · 0 拍');
  });
});

describe('issue 191 · 片段置顶', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('⋯ 菜单置顶 / 取消：状态变更且名字旁显示/隐藏 pin 图标', async () => {
    const memory = setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 初始两张都未置顶：无 pin 图标
    expect(screen.queryByTitle('已置顶')).not.toBeInTheDocument();

    // 打开第一张卡的 ⋯ 菜单，点击「置顶片段」
    openCardMenu(0);
    const pinItem = screen.getByRole('menuitem', { name: '置顶片段' });
    fireEvent.click(pinItem);

    // 卡片名字旁出现 pin 图标
    await waitFor(() => expect(screen.getByTitle('已置顶')).toBeInTheDocument());
    expect(memory.disk.find((p) => p.name === '折返花活')?.pinnedAt).toBeTypeOf('number');

    // 再次打开该卡 ⋯ 菜单，项变成「取消置顶」
    openCardMenu(0);
    const unpinItem = screen.getByRole('menuitem', { name: '取消置顶' });
    fireEvent.click(unpinItem);

    // pin 图标消失，字段删除
    await waitFor(() => expect(screen.queryByTitle('已置顶')).not.toBeInTheDocument());
    expect(memory.disk.find((p) => p.name === '折返花活')?.pinnedAt).toBeUndefined();
  });

  it('置顶后排到最上；取消置顶回到原位', async () => {
    setup({ seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 初始：折返花活 (createdAt: 200) 在前，片段 1 (createdAt: 100) 在后
    expect(cardNames()[0]).toContain('折返花活');
    expect(cardNames()[1]).toContain('片段 1');

    // 置顶后面的「片段 1」
    openCardMenu(1);
    fireEvent.click(screen.getByRole('menuitem', { name: '置顶片段' }));

    // 「片段 1」排到最前
    await waitFor(() => expect(cardNames()[0]).toContain('片段 1'));
    expect(cardNames()[1]).toContain('折返花活');

    // 取消「片段 1」置顶：回到末尾
    openCardMenu(0);
    fireEvent.click(screen.getByRole('menuitem', { name: '取消置顶' }));
    await waitFor(() => expect(cardNames()[0]).toContain('折返花活'));
    expect(cardNames()[1]).toContain('片段 1');
  });

  it('搜索过滤后仍置顶优先', async () => {
    setup({
      seed: [
        makePattern({ id: 'p1', name: '花活 A', createdAt: 300 }),
        makePattern({ id: 'p2', name: '花活 B', createdAt: 100, pinnedAt: 500 }),
        makePattern({ id: 'p3', name: '花活 C', createdAt: 200 }),
      ],
    });
    await waitFor(() => expect(screen.getByText('花活 B')).toBeInTheDocument());

    const search = screen.getByRole('textbox', { name: '搜索片段名字' });
    fireEvent.change(search, { target: { value: '花活' } });

    // 搜索结果中，置顶的「花活 B」仍在最前
    const names = cardNames();
    expect(names[0]).toContain('花活 B');
    expect(names[1]).toContain('花活 A');
    expect(names[2]).toContain('花活 C');
  });

  it('只读态下置顶仍可用（不写谱面）', async () => {
    const memory = setup({ readOnly: true, seed: seedLibrary() });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 打开 ⋯ 菜单并置顶「片段 1」
    openCardMenu(1);
    const pinBtn = screen.getByRole('menuitem', { name: '置顶片段' });
    expect(pinBtn).toBeEnabled();
    fireEvent.click(pinBtn);

    // 成功置顶并排序更新
    await waitFor(() => expect(cardNames()[0]).toContain('片段 1'));
    expect(screen.getByTitle('已置顶')).toBeInTheDocument();
    expect(memory.saves).toBe(1);
  });
});

describe('issue 193 · footer 状态切换（选择模式切换与恢复）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('普通模式 footer「收藏选区」仍可用；选择模式 footer 切换为工具条；退出后恢复', async () => {
    setup({ seed: seedLibrary(), withSelection: true });
    await waitFor(() => expect(screen.getByText('折返花活')).toBeInTheDocument());

    // 普通模式：收藏选区可用
    expect(saveButton()).toBeEnabled();

    // 抽屉头 ⋯ 进入选择模式
    fireEvent.click(screen.getByRole('button', { name: '片段库操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // footer 切换为选择工具条，收藏按钮消失
    expect(screen.queryByRole('button', { name: '收藏选区' })).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar')).toBeInTheDocument();

    // 退出选择模式
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    // 恢复为普通模式 footer，收藏选区仍可用
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});

describe('issue 192 · 片段排序（视图偏好与 UI 切换）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const sortSeed = () => [
    makePattern({
      id: 'p1',
      name: '片段 10',
      createdAt: 100,
      notes: [
        { type: 'Single', beat: 0, lane: 0 },
        { type: 'Single', beat: 1, lane: 1 },
      ], // 2 音符，跨度 1
    }),
    makePattern({
      id: 'p2',
      name: '片段 2',
      createdAt: 300,
      notes: [
        { type: 'Single', beat: 0, lane: 0 },
      ], // 1 音符，跨度 0
    }),
    makePattern({
      id: 'p3',
      name: '片段 1',
      createdAt: 200,
      pinnedAt: 50,
      notes: [
        { type: 'Single', beat: 0, lane: 0 },
        { type: 'Single', beat: 4, lane: 1 },
        { type: 'Single', beat: 8, lane: 2 },
      ], // 3 音符，跨度 8
    }),
  ];

  it('排序按钮存在，点击展开浮层菜单，列出 8 项且当前项（最新收藏）打勾', async () => {
    setup({ seed: sortSeed() });
    await waitFor(() => expect(screen.getByText('片段 10')).toBeInTheDocument());

    const sortBtn = screen.getByRole('button', { name: '排序片段' });
    expect(sortBtn).toBeInTheDocument();
    fireEvent.click(sortBtn);

    const menu = screen.getByRole('menu', { name: '排序片段' });
    expect(menu).toBeInTheDocument();

    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      '最新收藏',
      '最早收藏',
      '名称 A→Z',
      '名称 Z→A',
      '音符 多→少',
      '音符 少→多',
      '拍数 多→少',
      '拍数 少→多',
    ]);

    // 默认最新收藏打勾
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('切换排序后顺序变化、当前项打勾更新，且不触发片段库写盘（只写设置）', async () => {
    const memory = setup({ seed: sortSeed() });
    await waitFor(() => expect(screen.getByText('片段 10')).toBeInTheDocument());

    // 初始顺序：置顶的 p3 在前；未置顶按 createdAt 倒序：p2 (300) > p1 (100)
    let names = cardNames();
    expect(names[0]).toContain('片段 1');
    expect(names[1]).toContain('片段 2');
    expect(names[2]).toContain('片段 10');

    // 点开排序菜单切「最早收藏」
    fireEvent.click(screen.getByRole('button', { name: '排序片段' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /最早收藏/ }));

    // 置顶依然在最前，未置顶变为 createdAt 升序：p1 (100) < p2 (300)
    names = cardNames();
    expect(names[0]).toContain('片段 1');
    expect(names[1]).toContain('片段 10');
    expect(names[2]).toContain('片段 2');

    // 静态锁：切换排序不触发片段库 saveAll
    expect(memory.saves).toBe(0);

    // 设置对象中已持久化
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.patternLibrary.sort).toEqual({ key: 'createdAt', direction: 'asc' });

    // 再次点开菜单，最早收藏打勾
    fireEvent.click(screen.getByRole('button', { name: '排序片段' }));
    expect(screen.getByRole('menuitemradio', { name: /最早收藏/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('按名称自然数字序排序，置顶组依然优先', async () => {
    setup({ seed: sortSeed() });
    await waitFor(() => expect(screen.getByText('片段 10')).toBeInTheDocument());

    // 切「名称 A→Z」
    fireEvent.click(screen.getByRole('button', { name: '排序片段' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /名称 A→Z/ }));

    // 置顶的「片段 1」仍排在最前；未置顶中「片段 2」排在「片段 10」前（自然数字序）
    const names = cardNames();
    expect(names[0]).toContain('片段 1');
    expect(names[1]).toContain('片段 2');
    expect(names[2]).toContain('片段 10');
  });

  it('按音符数排序', async () => {
    setup({ seed: sortSeed() });
    await waitFor(() => expect(screen.getByText('片段 10')).toBeInTheDocument());

    // 切「音符 少→多」
    fireEvent.click(screen.getByRole('button', { name: '排序片段' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /音符 少→多/ }));

    // p3 为置顶（3 音符）仍在最前；未置顶中 p2 (1 音符) < p1 (2 音符)
    const names = cardNames();
    expect(names[0]).toContain('片段 1');
    expect(names[1]).toContain('片段 2');
    expect(names[2]).toContain('片段 10');
  });

  it('搜索过滤与排序组合：搜索不改变排序偏好', async () => {
    setup({ seed: sortSeed() });
    await waitFor(() => expect(screen.getByText('片段 10')).toBeInTheDocument());

    // 切「最早收藏」
    fireEvent.click(screen.getByRole('button', { name: '排序片段' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /最早收藏/ }));

    // 搜索输入「片段 1」：匹配 p1 (片段 10) 和 p3 (片段 1)
    const search = screen.getByRole('textbox', { name: '搜索片段名字' });
    fireEvent.change(search, { target: { value: '片段 1' } });

    // p3 置顶在最前，之后是 p1
    const names = cardNames();
    expect(names).toHaveLength(2);
    expect(names[0]).toContain('片段 1');
    expect(names[1]).toContain('片段 10');
  });

  it('选择模式下排序按钮依然可用且不丢失选择状态', async () => {
    setup({ seed: sortSeed() });
    await waitFor(() => expect(screen.getByText('片段 10')).toBeInTheDocument());

    // 进入选择模式
    fireEvent.click(screen.getByRole('button', { name: '片段库操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '选择片段' }));

    // 勾选 p1 (片段 10)
    fireEvent.click(screen.getByRole('checkbox', { name: '片段 10' }));
    expect(screen.getByRole('checkbox', { name: '片段 10' })).toHaveAttribute('aria-checked', 'true');

    // 排序按钮仍可用，切「最早收藏」
    const sortBtn = screen.getByRole('button', { name: '排序片段' });
    expect(sortBtn).toBeEnabled();
    fireEvent.click(sortBtn);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /最早收藏/ }));

    // 重新排序后，勾选状态依然保持
    expect(screen.getByRole('checkbox', { name: '片段 10' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: '片段 2' })).toHaveAttribute('aria-checked', 'false');
  });
});

