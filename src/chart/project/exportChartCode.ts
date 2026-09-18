// issue 118：谱面代码另存为。每次选路径写出 JSON，不记目录。
// Electron → dialog.showSaveDialog；浏览器 → a[download]。
import { convertNotesToChartCode, chartCodeToJSON } from '../editing/ChartConverter';
import type { ChartNote } from '../types';

export const CHART_CODE_EXPORT_FILENAME = 'chart.json';

export interface ChartCodeExportBridge {
  saveAs(payload: { json: string; suggestedName: string }): Promise<{ cancelled: boolean }>;
}

export function chartCodeExportText(notes: ChartNote[]): string {
  return chartCodeToJSON(convertNotesToChartCode(notes));
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

/** 每次另存为当前画布谱面代码。取消对话框视为成功静默返回。 */
export async function exportChartCodeSaveAs(notes: ChartNote[]): Promise<void> {
  const json = chartCodeExportText(notes);
  const bridge = getExportBridge();
  if (bridge) {
    await bridge.saveAs({ json, suggestedName: CHART_CODE_EXPORT_FILENAME });
    return;
  }
  downloadJson(CHART_CODE_EXPORT_FILENAME, json);
}
