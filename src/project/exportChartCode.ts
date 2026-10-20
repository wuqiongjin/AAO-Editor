// issue 118：谱面代码另存为。每次选路径写出 JSON，不记目录。
// Electron → dialog.showSaveDialog；浏览器 → a[download]。
// issue 102：① 落盘形态与弹窗显示一致（每条音符一行，方便下次导入/粘贴时不卡）；
//           ② 对象视图（音符代码工具 / 面包屑深层）只存**当前这一层**的代码。
// 05：整份的「发哪份文本」交给 ChartConverter.chartCodeExportText（保真 pristine → 源文本原文，
//     否则画布投影）；本模块只剩「另存为」这个动作与对象视图那一层。
import { chartCodeExportText, EMPTY_CHART_CODE_FIDELITY, type ChartCodeFidelity } from '../chart/editing/ChartConverter';
import { buildNoteCode, noteViewCodeToJSON, type NoteCodeTarget } from '../chart/editing/NoteCodeOps';
import type { ChartNote } from '../chart/types';
import { trail } from '../diagnostics/trail';

export const CHART_CODE_EXPORT_FILENAME = 'chart.json';
/** 对象视图另存为的推荐名（带音符下标，连续存多条不会互相覆盖） */
export function noteCodeExportFilename(target: NoteCodeTarget): string {
  return target.connIndex !== undefined
    ? `note-${target.noteIndex}-${target.connIndex}.json`
    : `note-${target.noteIndex}.json`;
}

export interface ChartCodeExportBridge {
  saveAs(payload: { json: string; suggestedName: string }): Promise<{ cancelled: boolean }>;
}

/**
 * 对象视图的导出文本：只含当前层的那一小段（整条音符 / 滑条子段 / 滑条结点）。
 * `null` = 目标已不存在（谱面被改动把它抹了）——调用方静默返回，弹窗随后也会自己关掉。
 */
export function noteCodeExportText(notes: readonly ChartNote[], target: NoteCodeTarget): string | null {
  const code = buildNoteCode(notes, target);
  return code ? noteViewCodeToJSON(code) : null;
}

function getExportBridge(): ChartCodeExportBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { chartCodeExport?: ChartCodeExportBridge } }).electronAPI;
  return api?.chartCodeExport ?? null;
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 另存为：
 * - 完整谱面视图（`target` 缺省）→ 整份谱面代码，文本由保真判定入口给（见 `chartCodeExportText`）；
 * - 对象视图（传 `target`）→ 只存这一层（随面包屑档位变化：整条 / 子段 / 结点）。
 * 一律**不导出弹窗里未应用的草稿**（issue 118 定案）。
 * 取消对话框视为成功静默返回。
 */
export async function exportChartCodeSaveAs(
  notes: ChartNote[],
  target?: NoteCodeTarget,
  fidelity: ChartCodeFidelity | null = EMPTY_CHART_CODE_FIDELITY,
): Promise<void> {
  const json = target ? noteCodeExportText(notes, target) : chartCodeExportText(notes, fidelity);
  if (json === null) return; // 目标已被画布改动抹掉
  const suggestedName = target ? noteCodeExportFilename(target) : CHART_CODE_EXPORT_FILENAME;
  const started = Date.now();
  trail.record({ module: 'chart', action: 'export-start', meta: { kind: 'code' } });
  try {
    const bridge = getExportBridge();
    if (bridge) {
      const saved = await bridge.saveAs({ json, suggestedName });
      trail.record({
        module: 'chart',
        action: 'export-end',
        result: saved.cancelled ? 'cancel' : 'ok',
        durationMs: Date.now() - started,
        meta: { kind: 'code' },
      });
      return;
    }
    downloadJson(suggestedName, json);
    trail.record({
      module: 'chart',
      action: 'export-end',
      result: 'ok',
      durationMs: Date.now() - started,
      meta: { kind: 'code' },
    });
  } catch (err) {
    trail.record({
      module: 'chart',
      action: 'export-end',
      result: 'fail',
      durationMs: Date.now() - started,
      meta: { kind: 'code' },
    });
    throw err;
  }
}
