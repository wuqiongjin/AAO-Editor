// 工程目录操作（chart-projects 04 / 05）：纯函数，页面与工作台共用。
// 新建 / 复制工程 / 新增谱面（Apply 闸门）/ 复制谱面 / 切换器标签文案。
import {
  convertChartCodeToNotes,
  hasBeat0Bpm,
  parseCodeText,
  type ValidationError,
} from '../chart/editing/ChartConverter';
import type { ChartDifficulty, ChartProject, ProjectChart, SongSource } from './ChartProject';
import { createUnnamedProject, emptyChartNotes } from './workspaceProject';
import { t } from '../i18n';

export const DIFF_NAMES = ['Easy', 'Normal', 'Hard', 'Expert', 'Special'] as const;
export const DIFF_SHORT = ['EZ', 'NM', 'HD', 'EX', 'SP'] as const;
/**
 * 难度色 = 唯一标准：从游戏内开场画面截图逐像素实测提取（5 张不同难度截图取徽章实色）。
 * 别改这里之外的任何难度色（界面徽标、谱面预览、开场画面都读这一份）。
 */
export const DIFF_COLORS = ['#3464fc', '#64fd33', '#ffcc35', '#ff3e40', '#e22c94'] as const;

const DEFAULT_UNTITLED = '未命名工程';

export function projectDisplayName(name: string | null | undefined, untitled: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : untitled;
}

export function chartEffectiveTitle(
  projectName: string | null | undefined,
  chartTitle: string | null | undefined,
  untitled: string,
): string {
  const title = chartTitle?.trim();
  return title ? title : projectDisplayName(projectName, untitled);
}

/** 工作台切换器当前谱面那段：空名或等于工程名称时只显示难度。 */
export function chartSwitchLabel(
  projectName: string | null | undefined,
  chart: { title: string | null; diff: ChartDifficulty },
): string {
  const title = chart.title?.trim() ?? '';
  const name = projectName?.trim() ?? '';
  if (title && title !== name) return `${DIFF_NAMES[chart.diff]} · ${title}`;
  return DIFF_NAMES[chart.diff];
}

export function sortProjectsByLastOpened<T extends { lastOpened: number }>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}

/** 封面墙无图时的占位色相：由工程 id 稳定派生，不入库。 */
export function projectCoverHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function createBlankProject(opts: {
  id: string;
  chartId: string;
  now: number;
  name?: string;
  artist?: string;
  diff?: ChartDifficulty;
}): ChartProject {
  const project = createUnnamedProject({ id: opts.id, chartId: opts.chartId, now: opts.now });
  const diff = opts.diff ?? 3;
  return {
    ...project,
    name: opts.name?.trim() || null,
    artist: opts.artist?.trim() || null,
    charts: [{ ...project.charts[0], diff }],
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function duplicateProject(
  src: ChartProject,
  ids: { id: string; chartIds: string[]; now: number },
  untitled: string = DEFAULT_UNTITLED,
  /** 现有工程显示名：重名时递增「（副本 2）…」（与复制谱面同口径，issue 19 #6） */
  taken: readonly string[] = [],
): ChartProject {
  const charts = src.charts.map((chart, i) => ({
    ...chart,
    id: ids.chartIds[i] ?? chart.id,
    notes: cloneJson(chart.notes),
    completed: false,
    upload: null,
    lastModified: ids.now,
  }));
  return {
    ...src,
    id: ids.id,
    name: uniqueCopyTitle(projectDisplayName(src.name, untitled), taken),
    lastOpened: ids.now,
    charts,
  };
}

export type AddChartInput = {
  title: string | null;
  diff: ChartDifficulty;
  level: number | null;
  codeText: string;
};

export type AddChartResult =
  | { ok: true; project: ChartProject; chart: ProjectChart }
  | { ok: false; errors: ValidationError[] };

export function addChartToProject(
  project: ChartProject,
  input: AddChartInput,
  ids: { chartId: string; now: number },
): AddChartResult {
  const trimmed = input.codeText.trim();
  let notes = emptyChartNotes();
  let appliedChartCodeText: string | null = null;
  let chartCodePristine = false;

  if (trimmed) {
    // 一次解析同时给出 code 与全部错误（不再「先 parse 校验、再 parse 取数组」）
    const parsed = parseCodeText(trimmed);
    if (!parsed.ok) return { ok: false, errors: parsed.errors };
    if (!hasBeat0Bpm(parsed.code)) {
      return { ok: false, errors: [{ noteIndex: -1, reason: t('chartCode.needBpm0') }] };
    }
    notes = convertChartCodeToNotes(parsed.code);
    appliedChartCodeText = trimmed;
    chartCodePristine = true;
  }

  const chart: ProjectChart = {
    id: ids.chartId,
    notes,
    title: input.title?.trim() || null,
    diff: input.diff,
    level: input.level,
    completed: false,
    upload: null,
    lastModified: ids.now,
    appliedChartCodeText,
    chartCodePristine,
  };
  return { ok: true, project: { ...project, charts: [...project.charts, chart] }, chart };
}

/** 复制工程 / 复制谱面共用：原显示名 + 副本标记，重名则标记内递增「（副本 2）」「(Copy 2)」…。
 * 标记随界面语言（zh「（副本）」全角 / en " (Copy)" 半角，2026-09-28 拍板），复制时定格。
 * 不复解析名内旧标记：副本的副本直接叠加标记，不剥后缀重编号（issue 19 #6 推翻 2026-09-28）。 */
export function uniqueCopyTitle(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  const first = `${base}${t('projects.copySuffix')}`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n++) {
    const next = `${base}${t('projects.copySuffixN', { n })}`;
    if (!used.has(next)) return next;
  }
}

export function duplicateChartInProject(
  project: ChartProject,
  chartId: string,
  ids: { chartId: string; now: number },
  untitled: string,
): ChartProject | null {
  const index = project.charts.findIndex((c) => c.id === chartId);
  if (index < 0) return null;
  const src = project.charts[index];
  const taken = project.charts.map((c) => chartEffectiveTitle(project.name, c.title, untitled));
  const copy: ProjectChart = {
    ...src,
    id: ids.chartId,
    notes: cloneJson(src.notes),
    title: uniqueCopyTitle(chartEffectiveTitle(project.name, src.title, untitled), taken),
    completed: false,
    upload: null,
    lastModified: ids.now,
  };
  return {
    ...project,
    charts: [...project.charts.slice(0, index + 1), copy, ...project.charts.slice(index + 1)],
  };
}

export function deleteChartFromProject(
  project: ChartProject,
  chartId: string,
): { ok: true; project: ChartProject } | { ok: false; reason: 'last' | 'missing' } {
  if (project.charts.length <= 1) return { ok: false, reason: 'last' };
  if (!project.charts.some((c) => c.id === chartId)) return { ok: false, reason: 'missing' };
  return { ok: true, project: { ...project, charts: project.charts.filter((c) => c.id !== chartId) } };
}

export function toggleChartCompleted(project: ChartProject, chartId: string, now: number): ChartProject {
  return {
    ...project,
    charts: project.charts.map((c) => (
      c.id === chartId && !c.upload
        ? { ...c, completed: !c.completed, lastModified: now }
        : c
    )),
  };
}

export function updateChartInfo(
  project: ChartProject,
  chartId: string,
  patch: { title: string | null; diff: ChartDifficulty; level: number | null },
  now: number,
): ChartProject {
  return {
    ...project,
    charts: project.charts.map((c) => (
      c.id === chartId && !c.upload
        ? { ...c, title: patch.title?.trim() || null, diff: patch.diff, level: patch.level, lastModified: now }
        : c
    )),
  };
}

export function updateProjectInfo(
  project: ChartProject,
  patch: {
    name: string | null;
    artist: string | null;
    source: SongSource;
    coverName?: string | null;
    coverBlob?: Blob;
    clearCover?: boolean;
  },
): ChartProject {
  const next: ChartProject = {
    ...project,
    name: patch.name?.trim() || null,
    artist: patch.artist?.trim() || null,
    source: patch.source,
  };
  if (patch.clearCover) {
    next.coverName = null;
    delete next.coverBlob;
  } else if (patch.coverBlob) {
    next.coverName = patch.coverName ?? project.coverName;
    next.coverBlob = patch.coverBlob;
  }
  return next;
}
