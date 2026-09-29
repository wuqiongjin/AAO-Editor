// 只读闸门（chart-projects 06 / ADR-0015 §4）：
// 已上传的谱面只读：可选中、复制、播放；
// 任何编辑入口（放置、拖动、删除、粘贴、谱面代码 Apply 等）都拒绝，
// 且谱面源数据不变；并提示「已上传的谱面不能修改，复制这张谱面来改？」附复制按钮。
import type { ChartUploadRecord } from './ChartProject';
import type { ChartNote } from '../chart/types';
import { chartStatus } from './workspaceProject';

export type ChartEditOp =
  | 'place'
  | 'drag'
  | 'delete'
  | 'paste'
  | 'applyCode'
  | 'cut'
  | 'mirror'
  | 'undo'
  | 'redo';

export type ChartReadOp =
  | 'select'
  | 'copy'
  | 'play';

export type ChartOp = ChartEditOp | ChartReadOp;

/** 触发谱面编辑的快捷键/菜单功能 ID 集合（用于集中拦截） */
export const CHART_EDIT_FUNCTIONS = new Set([
  'execSingle',
  'execFlick',
  'execSkill',
  'execLDirectional',
  'execRDirectional',
  'execBpm',
  'execSlide',
  'execCurve',
  'execPaste',
  'execDelete',
  'execCut',
  'execMirror',
  'undo',
  'redo',
] as const);

export type ChartEditFunctionId = typeof CHART_EDIT_FUNCTIONS extends Set<infer T> ? T : never;

/** 判断指定功能分发 ID 是否属于谱面修改类操作 */
export function isChartEditFunction(fn: string): boolean {
  return CHART_EDIT_FUNCTIONS.has(fn as any);
}

export interface ReadonlyGateHandler {
  isReadOnly: () => boolean;
  onReject?: () => void;
}

/** 包装只读拦截检查执行器：只读时触发 onReject 并返回 undefined，否则放行执行 */
export function withReadonlyGate<T>(
  gate: ReadonlyGateHandler | null | undefined,
  action: () => T,
): T | undefined {
  if (gate?.isReadOnly()) {
    gate.onReject?.();
    return undefined;
  }
  return action();
}

export function isChartUploaded(chart: { upload: ChartUploadRecord | null }): boolean {
  return chartStatus({ completed: false, upload: chart.upload }) === 'uploaded';
}

export const isChartReadonly = isChartUploaded;

export type ReadonlyCheckResult =
  | { allowed: true }
  | { allowed: false; rejected: 'uploaded_readonly'; message: string };

export function checkChartEditAllowed(chart: { upload: ChartUploadRecord | null }): ReadonlyCheckResult {
  if (isChartUploaded(chart)) {
    return {
      allowed: false,
      rejected: 'uploaded_readonly',
      message: '已上传的谱面不能修改，复制这张谱面来改？',
    };
  }
  return { allowed: true };
}

export function isEditOp(op: ChartOp): op is ChartEditOp {
  return op !== 'select' && op !== 'copy' && op !== 'play';
}

/**
 * 只读闸门纯函数：
 * - 尝试对谱面执行编辑类操作时，若有上传记录则拒绝，返回原 notes，不变动源数据；
 * - 读/非编辑操作（select / copy / play）不受阻拦。
 */
export function executeWithReadonlyGate<T = unknown>(
  chart: { upload: ChartUploadRecord | null; notes: readonly ChartNote[] },
  op: ChartOp,
  action: (notes: readonly ChartNote[]) => { notes: ChartNote[]; result?: T },
): {
  ok: boolean;
  rejected?: 'uploaded_readonly';
  notes: readonly ChartNote[];
  result?: T;
} {
  if (isChartUploaded(chart) && isEditOp(op)) {
    return {
      ok: false,
      rejected: 'uploaded_readonly',
      notes: chart.notes,
    };
  }
  const exec = action(chart.notes);
  return {
    ok: true,
    notes: exec.notes,
    result: exec.result,
  };
}
