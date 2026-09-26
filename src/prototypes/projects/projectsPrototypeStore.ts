// PROTOTYPE（chart-projects 04/05 UI 原型，用完即弃）：工程管理页 + 工作台谱面切换器。
// 只在 dev 且 URL 带 ?prototype=projects 时生效；数据全在内存，不碰 ChartProjectStore。
import { useSyncExternalStore } from 'react';

export function isProjectsPrototype(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('prototype') === 'projects';
}

export type Diff = 0 | 1 | 2 | 3 | 4;
export const DIFF_NAMES = ['Easy', 'Normal', 'Hard', 'Expert', 'Special'] as const;
export const DIFF_SHORT = ['EZ', 'NM', 'HD', 'EX', 'SP'] as const;
export const DIFF_COLORS = ['#3b82f6', '#22a35a', '#d4a106', '#e5484d', '#d9468f'] as const;

export type SongSource = { type: 'custom' } | { type: 'bandori'; id: number } | { type: 'llsif'; id: number };
export type ChartStatus = 'unfinished' | 'completed' | 'uploaded';

export interface ProtoChart {
  id: string;
  title: string | null;
  diff: Diff;
  level: number | null;
  completed: boolean;
  upload: { postId: number; at: number } | null;
  noteCount: number;
  lastModified: number;
}

export interface ProtoProject {
  id: string;
  name: string | null;
  artist: string | null;
  source: SongSource;
  audioName: string | null;
  durationSec: number;
  hue: number;
  lastOpened: number;
  charts: ProtoChart[];
}

export interface ProtoState {
  projects: ProtoProject[];
  currentProjectId: string;
  currentChartId: string;
}

const H = 3600_000;
const D = 24 * H;
const now = Date.now();
let seq = 100;
const nid = (p: string) => `${p}${++seq}`;

const chart = (diff: Diff, level: number | null, opts: Partial<ProtoChart> = {}): ProtoChart => ({
  id: nid('c'), title: null, diff, level, completed: false, upload: null,
  noteCount: 200 + diff * 180, lastModified: Date.now(), ...opts,
});

const seed: ProtoProject[] = [
  {
    id: 'p1', name: 'FIRE BIRD', artist: 'Roselia', source: { type: 'bandori', id: 243 }, audioName: 'fire_bird.mp3',
    durationSec: 236, hue: 8, lastOpened: now - 2 * H,
    charts: [
      chart(3, 27, { completed: true, upload: { postId: 254301, at: now - 3 * D }, lastModified: now - 3 * D }),
      chart(3, 26, { title: 'FIRE BIRD 练习版', completed: true, lastModified: now - 5 * H }),
      chart(4, 29, { lastModified: now - 2 * H }),
    ],
  },
  {
    id: 'p2', name: null, artist: null, source: { type: 'custom' }, audioName: null, durationSec: 30, hue: 210,
    lastOpened: now - 1 * D, charts: [chart(3, null, { noteCount: 0, lastModified: now - 1 * D })],
  },
  {
    id: 'p3', name: '夏夜のメロディ', artist: '自作', source: { type: 'custom' }, audioName: 'natsuyoru_v3.wav',
    durationSec: 182, hue: 265, lastOpened: now - 5 * D,
      charts: [
        chart(2, 21, { completed: true, lastModified: now - 6 * D }),
        chart(3, 26, { completed: true, lastModified: now - 5 * D }),
      ],
  },
  {
    id: 'p4', name: 'Snow halation', artist: "μ's", source: { type: 'llsif', id: 43 }, audioName: 'snow_halation.mp3',
    durationSec: 258, hue: 190, lastOpened: now - 12 * D,
    charts: [
      chart(2, 20, { completed: true, upload: { postId: 251877, at: now - 14 * D }, lastModified: now - 14 * D }),
      chart(3, 26, { completed: true, upload: { postId: 251878, at: now - 14 * D }, lastModified: now - 14 * D }),
    ],
  },
  {
    id: 'p5', name: 'Yes! BanG_Dream!', artist: "Poppin'Party", source: { type: 'bandori', id: 1 }, audioName: 'yes_bang_dream.mp3',
    durationSec: 212, hue: 330, lastOpened: now - 20 * D,
    charts: [
      chart(0, 8, { completed: true, upload: { postId: 249010, at: now - 25 * D }, lastModified: now - 25 * D }),
      chart(1, 13, { completed: true, upload: { postId: 249011, at: now - 25 * D }, lastModified: now - 25 * D }),
      chart(2, 18, { completed: true, upload: { postId: 249012, at: now - 25 * D }, lastModified: now - 25 * D }),
      chart(3, 24, { completed: true, lastModified: now - 21 * D }),
      chart(4, 27, { lastModified: now - 20 * D }),
    ],
  },
  {
    id: 'p6', name: 'Tokyo Night Drive', artist: 'DJ K', source: { type: 'custom' }, audioName: 'tnd_master.flac',
    durationSec: 301, hue: 40, lastOpened: now - 40 * D, charts: [chart(3, 25, { lastModified: now - 40 * D })],
  },
];

let state: ProtoState = { projects: seed, currentProjectId: 'p1', currentChartId: seed[0].charts[0].id };
const listeners = new Set<() => void>();
const set = (next: ProtoState) => { state = next; listeners.forEach(l => l()); };
const mapProject = (id: string, fn: (p: ProtoProject) => ProtoProject) =>
  state.projects.map(p => (p.id === id ? fn(p) : p));

export function useProtoState(): ProtoState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export const chartStatus = (c: ProtoChart): ChartStatus => (c.upload ? 'uploaded' : c.completed ? 'completed' : 'unfinished');
export const projectUnfinished = (p: ProtoProject) => p.charts.some(c => chartStatus(c) === 'unfinished');
export const projectDisplayName = (p: ProtoProject) => p.name ?? '未命名工程';
export const chartEffectiveTitle = (p: ProtoProject, c: ProtoChart) => c.title ?? projectDisplayName(p);
/** 复制谱面时的默认名称：源显示名 + 「（副本）」，重名则（副本 2）…；已带（副本）后缀的再复制会接着编号。 */
export function uniqueCopyTitle(base: string, taken: string[]): string {
  const stem = base.replace(/（副本(?: \d+)?）$/, '') || base;
  const used = new Set(taken);
  const first = `${stem}（副本）`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n++) {
    const t = `${stem}（副本 ${n}）`;
    if (!used.has(t)) return t;
  }
}
/** 切换器标签：谱面名称为空或等于工程名称时只显示难度 */
export const chartSwitchLabel = (p: ProtoProject, c: ProtoChart) =>
  c.title && c.title !== p.name ? `${DIFF_NAMES[c.diff]} · ${c.title}` : DIFF_NAMES[c.diff];
export const sortedProjects = (s: ProtoState) => [...s.projects].sort((a, b) => b.lastOpened - a.lastOpened);
export const currentProject = (s: ProtoState) => s.projects.find(p => p.id === s.currentProjectId)!;
export const currentChart = (s: ProtoState) => currentProject(s).charts.find(c => c.id === s.currentChartId) ?? currentProject(s).charts[0];

export function relTime(t: number): string {
  const d = Date.now() - t;
  if (d < H) return '刚刚';
  if (d < D) return `${Math.floor(d / H)} 小时前`;
  if (d < 30 * D) return `${Math.floor(d / D)} 天前`;
  return `${Math.floor(d / (30 * D))} 个月前`;
}

export const STATUS_LABEL: Record<ChartStatus, string> = { unfinished: '未完成', completed: '已完成', uploaded: '已上传' };
export const SOURCE_LABEL = (s: SongSource) =>
  s.type === 'custom' ? '自定义' : s.type === 'bandori' ? `BanG Dream #${s.id}` : `LLSIF #${s.id}`;

export const protoActions = {
  open(projectId: string, chartId?: string) {
    const p = state.projects.find(x => x.id === projectId)!;
    set({
      projects: mapProject(projectId, x => ({ ...x, lastOpened: Date.now() })),
      currentProjectId: projectId,
      currentChartId: chartId ?? p.charts[0].id,
    });
  },
  selectChart(chartId: string) { set({ ...state, currentChartId: chartId }); },
  create(input: { name: string; artist: string; diff: Diff; audioName: string | null; noteCount?: number }): string {
    const c = chart(input.diff, null, { noteCount: input.noteCount ?? 0 });
    const p: ProtoProject = {
      id: nid('p'), name: input.name.trim() || null, artist: input.artist.trim() || null, source: { type: 'custom' },
      audioName: input.audioName, durationSec: input.audioName ? 200 : 30, hue: Math.floor(Math.random() * 360),
      lastOpened: Date.now(), charts: [c],
    };
    set({ projects: [...state.projects, p], currentProjectId: p.id, currentChartId: c.id });
    return p.id;
  },
  duplicateProject(projectId: string): string {
    const src = state.projects.find(x => x.id === projectId)!;
    const p: ProtoProject = {
      ...src, id: nid('p'), name: `${projectDisplayName(src)}（副本）`, lastOpened: Date.now(),
      charts: src.charts.map(c => ({ ...c, id: nid('c'), completed: false, upload: null, lastModified: Date.now() })),
    };
    set({ ...state, projects: [...state.projects, p] });
    return p.id;
  },
  deleteProject(projectId: string) {
    const projects = state.projects.filter(p => p.id !== projectId);
    if (projects.length === 0) return;
    const cur = state.currentProjectId === projectId ? projects[0] : currentProject(state);
    set({ projects, currentProjectId: cur.id, currentChartId: state.currentProjectId === projectId ? cur.charts[0].id : state.currentChartId });
  },
  renameProject(projectId: string, name: string, artist: string) {
    set({ ...state, projects: mapProject(projectId, p => ({ ...p, name: name.trim() || null, artist: artist.trim() || null })) });
  },
  addChart(projectId: string, diff: Diff, extra: { title?: string | null; level?: number | null; noteCount?: number } = {}) {
    const c = chart(diff, extra.level ?? null, { noteCount: extra.noteCount ?? 0, title: extra.title ?? null });
    set({
      ...state,
      projects: mapProject(projectId, p => ({ ...p, charts: [...p.charts, c] })),
      currentChartId: projectId === state.currentProjectId ? c.id : state.currentChartId,
    });
  },
  updateChart(projectId: string, chartId: string, patch: { title?: string | null; diff?: Diff; level?: number | null }) {
    set({
      ...state,
      projects: mapProject(projectId, p => ({
        ...p,
        charts: p.charts.map(c => (c.id === chartId && !c.upload ? { ...c, ...patch, lastModified: Date.now() } : c)),
      })),
    });
  },
  duplicateChart(projectId: string, chartId: string) {
    let newId = '';
    const projects = mapProject(projectId, p => {
      const i = p.charts.findIndex(c => c.id === chartId);
      const src = p.charts[i];
      const copy = {
        ...src,
        id: (newId = nid('c')),
        title: uniqueCopyTitle(chartEffectiveTitle(p, src), p.charts.map(c => chartEffectiveTitle(p, c))),
        completed: false,
        upload: null,
        lastModified: Date.now(),
      };
      return { ...p, charts: [...p.charts.slice(0, i + 1), copy, ...p.charts.slice(i + 1)] };
    });
    set({ ...state, projects, currentChartId: projectId === state.currentProjectId ? newId : state.currentChartId });
  },
  deleteChart(projectId: string, chartId: string) {
    const p = state.projects.find(x => x.id === projectId)!;
    if (p.charts.length <= 1) { window.alert('一个工程至少保留一张谱面'); return; }
    const projects = mapProject(projectId, x => ({ ...x, charts: x.charts.filter(c => c.id !== chartId) }));
    const cur = projects.find(x => x.id === state.currentProjectId)!;
    set({ ...state, projects, currentChartId: cur.charts.some(c => c.id === state.currentChartId) ? state.currentChartId : cur.charts[0].id });
  },
  toggleCompleted(projectId: string, chartId: string) {
    set({ ...state, projects: mapProject(projectId, p => ({ ...p, charts: p.charts.map(c => (c.id === chartId && !c.upload ? { ...c, completed: !c.completed, lastModified: Date.now() } : c)) })) });
  },
};
