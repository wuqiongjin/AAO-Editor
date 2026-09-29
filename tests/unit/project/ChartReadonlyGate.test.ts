// chart-projects 06：只读闸门单测。
// 注入上传记录后，编辑类操作返回拒绝、谱面源数据不变；选中与复制仍可用。
import { describe, expect, it, vi } from 'vitest';
import {
  checkChartEditAllowed,
  executeWithReadonlyGate,
  isChartEditFunction,
  isChartReadonly,
  isChartUploaded,
  withReadonlyGate,
  type ChartEditOp,
  type ChartReadOp,
} from '@/src/project/chartReadonlyGate';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import type { ChartUploadRecord } from '@/src/project/ChartProject';
import { copySelection } from '@/src/chart/editing/SelectionEditing';

const initialNotes: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { beat: 4, lane: 2, type: 'Single' },
  { beat: 8, lane: 4, type: 'Single' },
];

function makeChart(overrides: { upload?: ChartUploadRecord | null; notes?: ChartNote[] } = {}) {
  return {
    notes: overrides.notes ?? [...initialNotes],
    upload: overrides.upload ?? null,
  };
}

describe('chartReadonlyGate · 只读闸门判定', () => {
  it('未上传谱面：isChartUploaded / isChartReadonly 为 false，checkChartEditAllowed 放行', () => {
    const chart = makeChart({ upload: null });
    expect(isChartUploaded(chart)).toBe(false);
    expect(isChartReadonly(chart)).toBe(false);
    expect(checkChartEditAllowed(chart)).toEqual({ allowed: true });
  });

  it('注入上传记录后：isChartUploaded / isChartReadonly 为 true，checkChartEditAllowed 返回拒绝', () => {
    const chart = makeChart({ upload: { postId: 12345, at: 1_700_000_000_000 } });
    expect(isChartUploaded(chart)).toBe(true);
    expect(isChartReadonly(chart)).toBe(true);
    expect(checkChartEditAllowed(chart)).toEqual({
      allowed: false,
      rejected: 'uploaded_readonly',
      message: '已上传的谱面不能修改，复制这张谱面来改？',
    });
  });
});

describe('chartReadonlyGate · 编辑类操作被拒且源数据不变', () => {
  const editOps: ChartEditOp[] = [
    'place',
    'drag',
    'delete',
    'paste',
    'applyCode',
    'cut',
    'mirror',
    'undo',
    'redo',
  ];

  it.each(editOps)('注入上传记录后：%s 操作返回拒绝、action 不被执行、谱面源数据不变', (op) => {
    const chart = makeChart({ upload: { postId: 999, at: 1_700_000_000_000 } });
    const originalNotes = chart.notes;
    const mutateAction = vi.fn((notes: readonly ChartNote[]) => ({
      notes: [...notes, { beat: 12, lane: 3, type: 'Single' } as ChartNote],
    }));

    const result = executeWithReadonlyGate(chart, op, mutateAction);

    expect(result.ok).toBe(false);
    expect(result.rejected).toBe('uploaded_readonly');
    expect(mutateAction).not.toHaveBeenCalled();
    // 谱面源数据引用与内容均不变
    expect(result.notes).toBe(originalNotes);
    expect(result.notes).toHaveLength(3);
  });

  it('未注入上传记录时：编辑类操作正常放行并修改 notes', () => {
    const chart = makeChart({ upload: null });
    const mutateAction = vi.fn((notes: readonly ChartNote[]) => ({
      notes: [...notes, { beat: 12, lane: 3, type: 'Single' } as ChartNote],
    }));

    const result = executeWithReadonlyGate(chart, 'place', mutateAction);

    expect(result.ok).toBe(true);
    expect(result.rejected).toBeUndefined();
    expect(mutateAction).toHaveBeenCalledOnce();
    expect(result.notes).toHaveLength(4);
  });
});

describe('chartReadonlyGate · 选中与复制仍可用', () => {
  const readOps: ChartReadOp[] = ['select', 'copy', 'play'];

  it.each(readOps)('注入上传记录后：%s 操作仍然放行', (op) => {
    const chart = makeChart({ upload: { postId: 888, at: 1_700_000_000_000 } });
    const originalNotes = chart.notes;
    const readAction = vi.fn((notes: readonly ChartNote[]) => ({
      notes: notes as ChartNote[],
      result: { executed: true },
    }));

    const result = executeWithReadonlyGate(chart, op, readAction);

    expect(result.ok).toBe(true);
    expect(result.rejected).toBeUndefined();
    expect(readAction).toHaveBeenCalledOnce();
    expect(result.notes).toBe(originalNotes);
    expect(result.result).toEqual({ executed: true });
  });

  it('注入上传记录后：仍能对音符建选区并复制到剪贴板', () => {
    const chart = makeChart({ upload: { postId: 777, at: 1_700_000_000_000 } });
    const selection: SelectionItem[] = [{ kind: 'note', noteIndex: 1 }];

    const selectResult = executeWithReadonlyGate(chart, 'select', (notes) => ({
      notes: notes as ChartNote[],
      result: selection,
    }));
    expect(selectResult.ok).toBe(true);
    expect(selectResult.result).toEqual(selection);

    const copyResult = executeWithReadonlyGate(chart, 'copy', (notes) => ({
      notes: notes as ChartNote[],
      result: copySelection(notes as ChartNote[], selection),
    }));
    expect(copyResult.ok).toBe(true);
    expect(copyResult.result).toEqual([{ beat: 4, lane: 2, type: 'Single' }]);
    expect(chart.notes).toHaveLength(3); // 源数据不变
  });
});

describe('chartReadonlyGate · isChartEditFunction 与 withReadonlyGate', () => {
  it('isChartEditFunction 准确区分编辑类与非编辑类功能 ID', () => {
    // 编辑类：放置/编辑/剪切板/撤销重做
    expect(isChartEditFunction('execSingle')).toBe(true);
    expect(isChartEditFunction('execFlick')).toBe(true);
    expect(isChartEditFunction('execSkill')).toBe(true);
    expect(isChartEditFunction('execLDirectional')).toBe(true);
    expect(isChartEditFunction('execRDirectional')).toBe(true);
    expect(isChartEditFunction('execBpm')).toBe(true);
    expect(isChartEditFunction('execSlide')).toBe(true);
    expect(isChartEditFunction('execCurve')).toBe(true);
    expect(isChartEditFunction('execPaste')).toBe(true);
    expect(isChartEditFunction('execDelete')).toBe(true);
    expect(isChartEditFunction('execCut')).toBe(true);
    expect(isChartEditFunction('execMirror')).toBe(true);
    expect(isChartEditFunction('undo')).toBe(true);
    expect(isChartEditFunction('redo')).toBe(true);

    // 非编辑类：切换工具态、复制、播放、侧栏折叠等
    expect(isChartEditFunction('switchSingle')).toBe(false);
    expect(isChartEditFunction('switchMouse')).toBe(false);
    expect(isChartEditFunction('execCopy')).toBe(false);
    expect(isChartEditFunction('play')).toBe(false);
    expect(isChartEditFunction('jumpToMarker')).toBe(false);
    expect(isChartEditFunction('toggleSidebar')).toBe(false);
  });

  it('withReadonlyGate: 只读时触发 onReject 且不执行 action', () => {
    const onReject = vi.fn();
    const action = vi.fn(() => 42);

    const result = withReadonlyGate({ isReadOnly: () => true, onReject }, action);

    expect(result).toBeUndefined();
    expect(onReject).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
  });

  it('withReadonlyGate: 非只读时放行并返回 action 结果', () => {
    const onReject = vi.fn();
    const action = vi.fn(() => 42);

    const result = withReadonlyGate({ isReadOnly: () => false, onReject }, action);

    expect(result).toBe(42);
    expect(onReject).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledOnce();
  });
});
