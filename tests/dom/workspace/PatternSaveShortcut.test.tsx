// @vitest-environment jsdom
// issue 185 锁测：`execSavePattern`（Ctrl+Shift+D）—— 有选区才捕获并 toast；无选区无事发生；
// 抽屉开合态不被改动（收藏不打断正在编辑的人）。
import '@testing-library/jest-dom/vitest';
import { useCallback, useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, useConfig } from '@/src/app/providers/ConfigProvider';
import { EditingProvider, useEditing } from '@/src/app/providers/EditingProvider';
import { usePatternLibrary } from '@/src/chart/patterns/usePatternLibrary';
import type { PatternStore } from '@/src/chart/patterns/PatternStore';
import type { FunctionId } from '@/src/chart/config/ShortcutConfig';
import { useShortcutDispatch } from '@/src/chart/config/useShortcutDispatch';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import { useSaveSelectionPattern } from '@/src/pages/workspace/useSaveSelectionPattern';
import ToastHost, { dismissToast } from '@/src/ui/Toast';
import { makeMemoryPatternStore } from '@/tests/support/patterns';
import { seedZhSettings } from '@/tests/support/storage';

const CHART_NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { beat: 0, type: 'Slide', connections: [{ beat: 0, lane: 0 }, { beat: 2, lane: 6 }] },
];
const CHART_SELECTION: SelectionItem[] = [{ kind: 'note', noteIndex: 1 }];

function SeedSelection({ withSelection }: { withSelection: boolean }) {
  const { resetNotes, setSelectedItems } = useEditing();
  useEffect(() => {
    resetNotes(CHART_NOTES);
    setSelectedItems(withSelection ? CHART_SELECTION : []);
  }, [resetNotes, setSelectedItems, withSelection]);
  return null;
}

/**
 * 最小分发台：`WorkspacePage` 里 `case 'execSavePattern'` 那一行的等价物 + 同样的
 * `useShortcutDispatch`（键位解析、可编辑目标放行都由 hook 负责，不在这里重写）。
 * 页面真正接线由 `tests/static/PatternSaveWiring.test.ts` 锁。
 */
function ShortcutHarness({ store }: { store: PatternStore }) {
  const library = usePatternLibrary(store);
  const { save } = useSaveSelectionPattern(library);
  const { settings } = useConfig();
  const runFunction = useCallback((fn: FunctionId) => {
    if (fn === 'execSavePattern') void save();
  }, [save]);
  useShortcutDispatch({ shortcutConfig: settings.shortcuts, active: true, runFunction, onEscape: () => {} });

  return (
    <>
      <span>{`drawer:${settings.layout.patternDrawer.open ? 'open' : 'closed'}`}</span>
      <span>{`count:${library.patterns.length}`}</span>
    </>
  );
}

function setup(opts: { withSelection: boolean; drawerOpen?: boolean }) {
  seedZhSettings({ layout: { patternDrawer: { open: opts.drawerOpen ?? false, width: 300 } } });
  const memory = makeMemoryPatternStore();
  render(
    <ConfigProvider>
      <EditingProvider>
        <SeedSelection withSelection={opts.withSelection} />
        <ShortcutHarness store={memory.store} />
      </EditingProvider>
      <ToastHost />
    </ConfigProvider>,
  );
  return memory;
}

/** Ctrl+Shift+D（默认键位） */
const pressSaveShortcut = () => fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });

describe('issue 185 · 收藏快捷键', () => {
  beforeEach(() => {
    window.localStorage.clear();
    dismissToast();
  });

  it('有选区：调 capture 入库 + toast「已收藏到片段库」', async () => {
    const memory = setup({ withSelection: true });

    pressSaveShortcut();

    await waitFor(() => expect(screen.getByText('已收藏到片段库')).toBeInTheDocument());
    expect(memory.disk).toHaveLength(1);
    expect(memory.disk[0]!.notes).toHaveLength(1);
    // 载荷带速度语境（片段 = 音符 + 语境，不是裸音符）
    expect(memory.disk[0]!.bpmContext.startBpm).toBe(120);
    expect(screen.getByText('count:1')).toBeInTheDocument();
  });

  it('无选区：无事发生（不写盘、不提示）', async () => {
    const memory = setup({ withSelection: false });

    pressSaveShortcut();
    // 事件已经被分发（同步跑完），这里只需确认什么也没发生
    expect(memory.disk).toHaveLength(0);
    expect(memory.saves).toBe(0);
    expect(screen.queryByText('已收藏到片段库')).not.toBeInTheDocument();
  });

  it('抽屉关着时不自动打开（收藏不打断正在编辑的人）', async () => {
    setup({ withSelection: true, drawerOpen: false });
    pressSaveShortcut();
    await waitFor(() => expect(screen.getByText('已收藏到片段库')).toBeInTheDocument());
    expect(screen.getByText('drawer:closed')).toBeInTheDocument();
  });

  it('抽屉开着时也不改开合态', async () => {
    setup({ withSelection: true, drawerOpen: true });
    expect(screen.getByText('drawer:open')).toBeInTheDocument();
    pressSaveShortcut();
    await waitFor(() => expect(screen.getByText('已收藏到片段库')).toBeInTheDocument());
    expect(screen.getByText('drawer:open')).toBeInTheDocument();
  });

  it('焦点在输入框里时放行原生输入，不触发收藏', async () => {
    const memory = setup({ withSelection: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'd', ctrlKey: true, shiftKey: true });
    expect(memory.disk).toHaveLength(0);
    input.remove();
  });
});
