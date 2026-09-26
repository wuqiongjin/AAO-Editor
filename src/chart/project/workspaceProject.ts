// 当前工程规则（ADR-0015 §3 / chart-projects 03）：
// 进工作台时选最近打开的未完成工程；没有则新建未命名工程（一张 Expert / diff=3）。
// 切工程时编辑态整体换成新工程，剪贴板不清空。
import { EMPTY_CHART_DURATION_SECONDS, DEFAULT_BPM } from '../../audio/AudioTiming';
import { createHistory, type HistoryState } from '../editing/History';
import type { ChartNote, SelectionItem } from '../types';
import type { ChartProject, ChartUploadRecord, ProjectChart } from './ChartProject';

export type ChartStatus = 'unfinished' | 'completed' | 'uploaded';

export interface ChartStatusFields {
  completed: boolean;
  upload: ChartUploadRecord | null;
}

export interface ProjectPickFields {
  id: string;
  lastOpened: number;
  charts: ChartStatusFields[];
}

export type WorkspaceProjectDecision =
  | { action: 'create' }
  | { action: 'open'; projectId: string };

export function chartStatus(chart: ChartStatusFields): ChartStatus {
  if (chart.upload) return 'uploaded';
  if (chart.completed) return 'completed';
  return 'unfinished';
}

/** 工程未完成 = 至少一张谱面未完成 */
export function isProjectUnfinished(project: { charts: ChartStatusFields[] }): boolean {
  return project.charts.some((c) => chartStatus(c) === 'unfinished');
}

export function decideWorkspaceProject(
  projects: readonly ProjectPickFields[],
): WorkspaceProjectDecision {
  let picked: ProjectPickFields | null = null;
  for (const project of projects) {
    if (!isProjectUnfinished(project)) continue;
    if (picked == null || project.lastOpened > picked.lastOpened) picked = project;
  }
  return picked ? { action: 'open', projectId: picked.id } : { action: 'create' };
}

export function emptyChartNotes(): ChartNote[] {
  return [{ beat: 0, type: 'BPM', bpm: DEFAULT_BPM }];
}

/** 未命名工程：name 空、一张 Expert（Bestdori diff=3），立刻可落盘 */
export function createUnnamedProject(opts: { id: string; chartId: string; now: number }): ChartProject {
  const chart: ProjectChart = {
    id: opts.chartId,
    notes: emptyChartNotes(),
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: opts.now,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
  return {
    id: opts.id,
    name: null,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: EMPTY_CHART_DURATION_SECONDS,
    lastOpened: opts.now,
    charts: [chart],
    audioName: null,
    coverName: null,
  };
}

export function pickCurrentChart(project: ChartProject, chartId?: string | null): ProjectChart {
  if (chartId) {
    const found = project.charts.find((c) => c.id === chartId);
    if (found) return found;
  }
  const first = project.charts[0];
  if (!first) throw new Error(`谱面工程没有谱面: ${JSON.stringify(project.id)}`);
  return first;
}

export function applyProjectSwitch(input: {
  notes: ChartNote[];
  clipboard: ChartNote[];
  selectedItems?: SelectionItem[];
}): {
  history: HistoryState<ChartNote[]>;
  selectedItems: SelectionItem[];
  clipboard: ChartNote[];
} {
  const notesToUse = input.notes.length > 0 ? input.notes : emptyChartNotes();
  return {
    history: createHistory(notesToUse),
    selectedItems: [],
    clipboard: input.clipboard,
  };
}
