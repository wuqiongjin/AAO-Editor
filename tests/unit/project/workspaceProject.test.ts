// chart-projects 03：进工作台时的选工程规则（纯函数）+ 切工程时的编辑态补丁。
import { describe, expect, it } from 'vitest';
import { canUndo, currentHistory } from '@/src/chart/editing/History';
import { copySelection } from '@/src/chart/editing/SelectionEditing';
import { pasteChartNotes } from '@/src/chart/editing/NoteReplacementRules';
import {
  applyProjectSwitch,
  chartStatus,
  createUnnamedProject,
  decideWorkspaceProject,
  isProjectAudioLocked,
  isProjectUnfinished,
} from '@/src/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';
import { readStripped } from '@/tests/support/source';

function chart(overrides: {
  completed?: boolean;
  upload?: { postId: number; at: number } | null;
} = {}) {
  return {
    completed: overrides.completed ?? false,
    upload: overrides.upload ?? null,
  };
}

function project(
  id: string,
  lastOpened: number,
  charts: Array<{ completed: boolean; upload: { postId: number; at: number } | null }>,
) {
  return { id, lastOpened, charts };
}

describe('decideWorkspaceProject · 进工作台选工程', () => {
  it('无工程 → 新建', () => {
    expect(decideWorkspaceProject([])).toEqual({ action: 'create' });
  });

  it('只有已完成工程 → 新建（已上传也算已完成）', () => {
    const projects = [
      project('done1', 100, [chart({ completed: true })]),
      project('up1', 200, [chart({ upload: { postId: 1, at: 1 } })]),
    ];
    expect(decideWorkspaceProject(projects)).toEqual({ action: 'create' });
  });

  it('多个未完成 → 取最近打开的', () => {
    const projects = [
      project('old', 10, [chart()]),
      project('recent', 50, [chart()]),
      project('done', 90, [chart({ completed: true })]),
    ];
    expect(decideWorkspaceProject(projects)).toEqual({ action: 'open', projectId: 'recent' });
  });

  it('刚新建的空工程下次仍被选中（不会再新建第二个）', () => {
    const unnamed = createUnnamedProject({ id: 'pEmpty1', chartId: 'cEx1', now: 1_700_000_000_000 });
    expect(unnamed.name).toBeNull();
    expect(unnamed.charts).toHaveLength(1);
    expect(unnamed.charts[0].diff).toBe(3);
    expect(unnamed.charts[0].completed).toBe(false);
    expect(unnamed.charts[0].upload).toBeNull();

    const listed = [
      project('done', 99, [chart({ completed: true })]),
      { id: unnamed.id, lastOpened: unnamed.lastOpened, charts: unnamed.charts },
    ];
    expect(decideWorkspaceProject(listed)).toEqual({ action: 'open', projectId: 'pEmpty1' });
  });
});

describe('chartStatus · 状态派生三态与优先级', () => {
  it('无上传记录且未标完成 → unfinished（未完成）', () => {
    expect(chartStatus({ completed: false, upload: null })).toBe('unfinished');
  });

  it('无上传记录但标了完成 → completed（已完成）', () => {
    expect(chartStatus({ completed: true, upload: null })).toBe('completed');
  });

  it('有上传记录且未标完成 → uploaded（已上传）', () => {
    expect(chartStatus({ completed: false, upload: { postId: 100, at: 1_700_000_000 } })).toBe('uploaded');
  });

  it('有上传记录且标了完成 → uploaded（已上传优先于已完成）', () => {
    expect(chartStatus({ completed: true, upload: { postId: 100, at: 1_700_000_000 } })).toBe('uploaded');
  });
});

describe('isProjectUnfinished / isProjectAudioLocked · 工程级聚合', () => {
  it('工程未完成 = 至少一张谱面未完成', () => {
    // 全未完成
    expect(isProjectUnfinished({ charts: [chart(), chart()] })).toBe(true);
    // 一张未完成，一张已完成
    expect(isProjectUnfinished({ charts: [chart(), chart({ completed: true })] })).toBe(true);
    // 一张未完成，一张已上传
    expect(isProjectUnfinished({ charts: [chart(), chart({ upload: { postId: 1, at: 1 } })] })).toBe(true);
    // 全已完成
    expect(isProjectUnfinished({ charts: [chart({ completed: true }), chart({ completed: true })] })).toBe(false);
    // 全已上传
    expect(isProjectUnfinished({ charts: [chart({ upload: { postId: 1, at: 1 } })] })).toBe(false);
    // 一张已完成，一张已上传（无未完成）
    expect(isProjectUnfinished({ charts: [chart({ completed: true }), chart({ upload: { postId: 1, at: 1 } })] })).toBe(false);
  });

  it('工程里只要有一张已上传谱面，共享音频与时长锁定', () => {
    // 无谱面或全是未上传
    expect(isProjectAudioLocked({ charts: [] })).toBe(false);
    expect(isProjectAudioLocked({ charts: [chart(), chart({ completed: true })] })).toBe(false);
    // 包含一张已上传谱面
    expect(isProjectAudioLocked({ charts: [chart(), chart({ upload: { postId: 1, at: 1 } })] })).toBe(true);
    // 全是已上传
    expect(isProjectAudioLocked({ charts: [chart({ upload: { postId: 1, at: 1 } })] })).toBe(true);
  });
});

describe('applyProjectSwitch · 切工程编辑态', () => {
  it('剪贴板内容与引用不变，撤销历史被清空', () => {
    const clipboard: ChartNote[] = [{ type: 'Single', beat: 4, lane: 2 }];
    const loaded: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 180 },
      { type: 'Single', beat: 8, lane: 3 },
    ];
    const next = applyProjectSwitch({
      notes: loaded,
      clipboard,
      selectedItems: [{ kind: 'note', noteIndex: 0 }],
    });
    expect(next.clipboard).toBe(clipboard);
    expect(next.clipboard).toEqual([{ type: 'Single', beat: 4, lane: 2 }]);
    expect(next.selectedItems).toEqual([]);
    expect(currentHistory(next.history)).toEqual(loaded);
    expect(canUndo(next.history)).toBe(false);
  });

  it('resetNotes 走 applyProjectSwitch 且不写剪贴板', () => {
    const src = readStripped('src/app/providers/EditingProvider.tsx');
    const body = src.slice(src.indexOf('const resetNotes'));
    expect(body).toMatch(/applyProjectSwitch/);
    expect(body.slice(0, body.indexOf('const undo'))).not.toMatch(/setClipboard/);
  });

  it('切工程时谱面代码弹窗随当前工程卸载', () => {
    const src = readStripped('src/pages/workspace/WorkspacePage.tsx');
    expect(src).toMatch(/ChartCodeEditorProvider key=\{projectId/);
  });

  it('切谱面与切工程走同一条 resetNotes：剪贴板不清、历史不串', () => {
    const src = readStripped('src/pages/workspace/WorkspacePage.tsx');
    const restore = src.slice(src.indexOf('handleProjectRestore'));
    expect(restore.slice(0, restore.indexOf('}, ['))).toMatch(/resetNotes\(chart\.notes/);
    expect(src).not.toMatch(/isProjectsPrototype/);
    expect(src).toMatch(/ChartSwitcher/);
  });
});

describe('跨谱面复制粘贴 · Expert → Hard', () => {
  it('Expert 选中复制后切到 Hard，剪贴板仍在且可贴入', () => {
    const expert: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: 4, lane: 2 },
    ];
    const hard: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 150 },
    ];
    const clipboard = copySelection(expert, [{ kind: 'note', noteIndex: 1 }]);
    expect(clipboard).toEqual([{ type: 'Single', beat: 4, lane: 2 }]);

    const switched = applyProjectSwitch({ notes: hard, clipboard });
    expect(switched.clipboard).toBe(clipboard);
    expect(canUndo(switched.history)).toBe(false);
    expect(currentHistory(switched.history)).toEqual(hard);

    const pasted = pasteChartNotes(currentHistory(switched.history), switched.clipboard, 8, 3);
    expect(pasted.rejected).toBeUndefined();
    expect(pasted.newNotes).toEqual([
      { type: 'BPM', beat: 0, bpm: 150 },
      { type: 'Single', beat: 8, lane: 3 },
    ]);
  });
});
