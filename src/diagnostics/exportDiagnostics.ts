import type { ChartProject } from '../project/ChartProject';
import { storedFromProject } from '../project/ChartProjectRecord';
import { logger } from './logger';
import { sanitizeSettingsForDiagnostics } from './sanitizeSettings';
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
      logger.warn('[diagnostics]', '读取当前谱面失败，诊断包将不含谱面', err);
    }
  }
  try {
    trail.flush();
    return await bridge.export({
      pageId: input.pageId,
      projectId: input.projectId,
      settings: sanitizeSettingsForDiagnostics(input.settings),
      ...(chart !== undefined ? { chart } : {}),
    });
  } catch (err) {
    logger.error('[diagnostics]', '导出诊断包失败', err);
    throw err;
  }
}
