// 工程目录操作（chart-projects 04 / 05）：纯函数，页面与工作台共用。
// 新建 / 复制工程 / 新增谱面（Apply 闸门）/ 复制谱面 / 切换器标签文案。
import {
  convertChartCodeToNotes,
  hasBeat0Bpm,
  parseCodeText,
  type ValidationError,
} from '../chart/editing/ChartConverter';
import type { ChartNote } from '../chart/types';
import type { ChartDifficulty, ChartProject, ChartUploadRecord, ProjectChart, SongSource } from './ChartProject';
import { createUnnamedProject, emptyChartNotes } from './workspaceProject';
import { clampChartDuration } from '../audio/chartDuration';
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

/**
 * Apply 闸门（ADR-0014）的产物：notes + 保真标记。空文本 = 一张空谱面（空白新建那条路）。
 * 这是「谱面代码文本 → 能落进工程的谱面」的**唯一**入口：新增谱面、官方 / 社区导入都走它。
 */
export interface AppliedChartCode {
  notes: ChartNote[];
  appliedChartCodeText: string | null;
  chartCodePristine: boolean;
}

export type ApplyChartCodeResult =
  | ({ ok: true } & AppliedChartCode)
  | { ok: false; errors: ValidationError[] };

export function applyChartCodeText(codeText: string): ApplyChartCodeResult {
  const trimmed = codeText.trim();
  if (!trimmed) {
    return { ok: true, notes: emptyChartNotes(), appliedChartCodeText: null, chartCodePristine: false };
  }
  // 一次解析同时给出 code 与全部错误（不再「先 parse 校验、再 parse 取数组」）
  const parsed = parseCodeText(trimmed);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  if (!hasBeat0Bpm(parsed.code)) {
    return { ok: false, errors: [{ noteIndex: -1, reason: t('chartCode.needBpm0') }] };
  }
  return {
    ok: true,
    notes: convertChartCodeToNotes(parsed.code),
    appliedChartCodeText: trimmed,
    chartCodePristine: true,
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
  const applied = applyChartCodeText(input.codeText);
  if (!applied.ok) return { ok: false, errors: applied.errors };

  const chart: ProjectChart = {
    id: ids.chartId,
    notes: applied.notes,
    title: input.title?.trim() || null,
    diff: input.diff,
    level: input.level,
    completed: false,
    upload: null,
    lastModified: ids.now,
    appliedChartCodeText: applied.appliedChartCodeText,
    chartCodePristine: applied.chartCodePristine,
  };
  return { ok: true, project: { ...project, charts: [...project.charts, chart] }, chart };
}

/**
 * 「从官方谱面导入」建出来的工程（票 08）：工程名称 ← 曲库标题、歌手 ← 官方歌手（乐队名）、
 * `曲目来源` ← 官方曲 id、一张谱面 —— **默认空 Expert**，勾了「带官方谱面内容」才把官方难度、
 * 等级与官方谱面代码（同一条 Apply 闸门）一起带上。
 *
 * 音频与封面不在这里：它们是**二进制**，由 store 从素材缓存拷进工程（见 ChartProject 的
 * `ProjectBinarySources`）——工程记录里只留 `audioName` / `coverName` 两个名字。
 */
export interface OfficialProjectInput {
  id: string;
  chartId: string;
  now: number;
  /** 曲库标题（工程名称；空串按未命名处理） */
  name: string;
  /** 官方歌手（乐队名）；乐队索引里查不到时给 null */
  artist: string | null;
  /** 曲目来源（官方曲 id）——发布时 `song` 怎么填的指针 */
  source: SongSource;
  /** 官方曲长（秒）：音频落地后由实际时长校正，先按官方数据起 */
  durationSeconds: number;
  /** 音频名（写进工程记录的显示名；二进制本身走素材缓存，见 ChartProject 的 ProjectBinarySources） */
  audioName: string;
  /** 封面名；这首曲子没有封面时给 null */
  coverName: string | null;
  /** 这张谱面的难度：不勾「带官方谱面」时就是 Expert（3） */
  diff: ChartDifficulty;
  /** 等级：只有勾了「带官方谱面」才给（等级是作品属性，人还没作谱，不预填） */
  level: number | null;
  /** 官方谱面代码原文（勾了才给）；走 Apply 闸门，过不了就整笔不建 */
  chartCodeText?: string;
}

export type OfficialProjectResult =
  | { ok: true; project: ChartProject; chart: ProjectChart }
  | { ok: false; errors: ValidationError[] };

export function createOfficialProject(input: OfficialProjectInput): OfficialProjectResult {
  const applied = applyChartCodeText(input.chartCodeText ?? '');
  if (!applied.ok) return { ok: false, errors: applied.errors };

  const base = createUnnamedProject({ id: input.id, chartId: input.chartId, now: input.now });
  const chart: ProjectChart = {
    ...base.charts[0],
    notes: applied.notes,
    diff: input.diff,
    level: input.level,
    appliedChartCodeText: applied.appliedChartCodeText,
    chartCodePristine: applied.chartCodePristine,
  };
  return {
    ok: true,
    chart,
    project: {
      ...base,
      name: input.name.trim() || null,
      artist: input.artist?.trim() || null,
      source: input.source,
      durationSeconds: clampChartDuration(input.durationSeconds),
      audioName: input.audioName,
      coverName: input.coverName,
      charts: [chart],
    },
  };
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

/**
 * 发布成功后记上传记录（bestdori-integration 11；ADR-0015 §4「每张谱面至多一条」）。
 * **只写一次**：谱面已有记录（或谱面不在这个工程里）时返回 null = 调用方取消，
 * 与 `mutateProject` 的 `fn` 返回 null 同口径 —— 「重复调用被拒」的落点就在这一行，
 * 平台侧那帖已经发了，本机绝不再记第二条。
 */
export function recordChartUpload(
  project: ChartProject,
  chartId: string,
  record: ChartUploadRecord,
): ChartProject | null {
  const target = project.charts.find((c) => c.id === chartId);
  if (!target || target.upload) return null;
  return {
    ...project,
    charts: project.charts.map((c) => (c.id === chartId ? { ...c, upload: record, publishDraft: null } : c)),
  };
}

/** 更新谱面的发布描述草稿（票 42 Q3）：随谱面持久化，发布成功后清除 */
export function updateChartPublishDraft(
  project: ChartProject,
  chartId: string,
  draft: string | null,
): ChartProject {
  const normalized = draft?.trim() ? draft : null;
  return {
    ...project,
    charts: project.charts.map((c) => (
      c.id === chartId ? { ...c, publishDraft: normalized } : c
    )),
  };
}

export function updateChartInfo(
  project: ChartProject,
  chartId: string,
  patch: { title: string | null; diff: ChartDifficulty; level: number | null },
  now: number,
): ChartProject {
  const cleanTitle = patch.title?.trim() || null;
  return {
    ...project,
    charts: project.charts.map((c) => {
      if (c.id !== chartId || c.upload) return c;
      const unchanged = c.title === cleanTitle && c.diff === patch.diff && c.level === patch.level;
      return {
        ...c,
        title: cleanTitle,
        diff: patch.diff,
        level: patch.level,
        lastModified: unchanged ? c.lastModified : now,
      };
    }),
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
