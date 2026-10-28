// chart-projects 06：只读闸门单测。
// 注入上传记录后，编辑类操作返回拒绝、谱面源数据不变；选中与复制仍可用。
// bestdori-integration 11：补「经真实写入路径（recordChartUpload）落账后编辑被拒」——
// 闸门此前只能靠手工注入记录测，发布落地后要走一遍真的写入。
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
import { recordChartUpload } from '@/src/project/projectCatalog';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import type { ChartProject, ChartUploadRecord, ProjectChart } from '@/src/project/ChartProject';
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
      message: '已上传谱面本体不可修改',
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

/** 一份带两张谱面的工程（票 11 的真实写入路径用）；字段照 ProjectChart / ChartProject */
function makeProjectWithCharts(): ChartProject {
  const chart = (id: string, title: string): ProjectChart => ({
    id,
    notes: [...initialNotes],
    title,
    diff: 3,
    level: 24,
    completed: false,
    upload: null,
    lastModified: 1_700_000_000_000,
    appliedChartCodeText: null,
    chartCodePristine: true,
  });
  return {
    id: 'p1',
    name: 'Test Project',
    artist: 'RAS',
    source: { type: 'bandori', id: 413 },
    durationSeconds: 100,
    lastOpened: 1_700_000_000_000,
    charts: [chart('c1', 'Expert'), chart('c2', 'Special')],
    audioName: 'audio.mp3',
    coverName: 'cover.png',
  };
}

describe('票 11 · 真实写入路径：recordChartUpload 之后编辑操作被拒', () => {
  it('发布落账后：闸门对该谱面的编辑类操作一律拒绝，源数据不变', () => {
    const record: ChartUploadRecord = { postId: 254203, at: 1_700_000_000_000 };
    const written = recordChartUpload(makeProjectWithCharts(), 'c1', record);
    expect(written).not.toBeNull();
    const chart = written!.charts[0];

    // 写入即生效：状态派生与判定都认这份记录（不再靠测试手工注入）
    expect(chart.upload).toEqual(record);
    expect(isChartUploaded(chart)).toBe(true);
    expect(isChartReadonly(chart)).toBe(true);
    expect(checkChartEditAllowed(chart).allowed).toBe(false);

    const mutateAction = vi.fn((notes: readonly ChartNote[]) => ({ notes: [...notes] }));
    const result = executeWithReadonlyGate(chart, 'place', mutateAction);
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe('uploaded_readonly');
    expect(mutateAction).not.toHaveBeenCalled();
    expect(result.notes).toBe(chart.notes);
    // 另一张没发布的谱面不受影响（记录是谱面级的）
    expect(isChartUploaded(written!.charts[1])).toBe(false);
  });

  it('只写一次：已有记录的谱面再记返回 null，原记录不被覆盖', () => {
    const project = makeProjectWithCharts();
    const first = recordChartUpload(project, 'c1', { postId: 1, at: 1 });
    expect(first).not.toBeNull();

    const second = recordChartUpload(first!, 'c1', { postId: 2, at: 2 });
    expect(second).toBeNull();
    expect(first!.charts[0].upload).toEqual({ postId: 1, at: 1 });

    // 谱面不在这个工程里也同样拒绝（不凭空造记录）
    expect(recordChartUpload(project, 'nope', { postId: 3, at: 3 })).toBeNull();
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
