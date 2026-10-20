import type { ChartProject } from '../project/ChartProject';
import { storedFromProject } from '../project/ChartProjectRecord';
import { logger } from './logger';
import { sanitizeForDiagnostics } from './sanitizeDiagnosticsPayload';
import { trail } from './trail';

export interface DiagnosticsExportPayload {
  pageId: string;
  projectId: string | null;
  settings: unknown;
  chart?: unknown;
}

export interface DiagnosticsExportBridge {
  export(payload: DiagnosticsExportPayload): Promise<{ cancelled: boolean }>;
}

export function getDiagnosticsExportBridge(): DiagnosticsExportBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { diagnostics?: DiagnosticsExportBridge } }).electronAPI
    ?.diagnostics;
}

/** 工程 JSON 等价物：保留谱面文档，去掉音频 / 封面字节。 */
export function chartDocumentForDiagnostics(project: ChartProject): unknown {
  const doc = { ...storedFromProject(project) } as Record<string, unknown>;
  delete doc.audioBlob;
  delete doc.coverBlob;
  return doc;
}

export async function exportDiagnostics(input: {
  pageId: string;
  projectId: string | null;
  settings: unknown;
  includeChart: boolean;
  getProject: (id: string) => Promise<ChartProject | null>;
}): Promise<{ cancelled: boolean } | { unavailable: true }> {
  const bridge = getDiagnosticsExportBridge();
  if (!bridge) return { unavailable: true };
  let chart: unknown;
  if (input.includeChart && input.projectId) {
    try {
      const project = await input.getProject(input.projectId);
      if (project) chart = chartDocumentForDiagnostics(project);
    } catch (err) {
      // 这条 warn 与轨迹同族：也要赶在主进程读 logs 之前落盘，一并 await
      await logger.warn('[diagnostics]', '读取当前谱面失败，诊断包将不含谱面', err);
    }
  }
  try {
    // flush 返回的 Promise 在所有 pending 轨迹落盘后才 resolve（见 trail.ts），
    // 之后才发起导出，主进程读 logs 目录时轨迹已完整。
    await trail.flush();
    return await bridge.export({
      pageId: input.pageId,
      projectId: input.projectId,
      settings: sanitizeForDiagnostics(input.settings),
      ...(chart !== undefined ? { chart: sanitizeForDiagnostics(chart) } : {}),
    });
  } catch (err) {
    logger.error('[diagnostics]', '导出诊断包失败', err);
    throw err;
  }
}
