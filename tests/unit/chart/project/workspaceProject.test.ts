// chart-projects 03：进工作台时的选工程规则（纯函数）+ 切工程时的编辑态补丁。
import { describe, expect, it } from 'vitest';
import { canUndo, currentHistory } from '@/src/chart/editing/History';
import {
  applyProjectSwitch,
  createUnnamedProject,
  decideWorkspaceProject,
} from '@/src/chart/project/workspaceProject';
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
    const src = readStripped('src/chart/Editor.tsx');
    expect(src).toMatch(/ChartCodeEditorProvider key=\{projectId/);
  });
});
