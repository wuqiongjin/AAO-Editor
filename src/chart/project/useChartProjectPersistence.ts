// useChartProjectPersistence（候选 2 / 架构深化评审候选 2 / ADR-0005 §6）：
// 谱面工程持久化 = 挂载恢复 + 编辑防抖落盘（IndexedDB / Electron userData 门面）。
//
// chart-projects 02：UI 仍只操作一个工程。读写固定 id `workspace`（非 `default`），
// 以免覆盖旧「一份 notes」记录；当前工程规则由 03 接入。
import { useCallback, useEffect, useRef } from 'react';
import {
  ChartProjectStore,
  WORKSPACE_PROJECT_ID,
  newChartId,
  type ChartProject,
  type ProjectChart,
} from './ChartProject';
import { ChartProjectPersistenceMerger } from './ChartProjectPersistenceMerger';
import type { ChartNote } from '../types';

export interface UseChartProjectPersistenceOptions {
  /** 当前 notes（编辑中） */
  notes: ChartNote[];
  /** 当前谱面时长（秒） */
  durationSeconds: number;
  /** 当前音频文件元数据（无音频为 null） */
  audioName: string | null;
  audioBlob: Blob | null;
  appliedChartCodeText?: string | null;
  chartCodePristine?: boolean;
  /** 防抖落盘的延迟（默认 800ms，ADR-0005 §6） */
  debounceMs?: number;
  /** 注入存储后端（默认 new ChartProjectStore()）——测试可注入假实现 */
  store?: ChartProjectStore;
  /** 挂载恢复回调：把 notes / 时长 / 音频 / canPlay 灌入调用方（Editor） */
  onRestore: (project: ChartProject) => void | Promise<void>;
}

export interface UseChartProjectPersistenceReturn {
  /** 立即落盘（音频导入/清除、卸载前） */
  saveNow: () => Promise<void>;
}

function defaultChart(notes: ChartNote[], now: number, applied: string | null, pristine: boolean): ProjectChart {
  return {
    id: newChartId(),
    notes,
    title: null,
    diff: 3, // 03 新建未命名工程也是 Expert；此处只为单工程 shim 提供合法难度
    level: null,
    completed: false,
    upload: null,
    lastModified: now,
    appliedChartCodeText: applied,
    chartCodePristine: pristine,
  };
}

export function useChartProjectPersistence(opts: UseChartProjectPersistenceOptions): UseChartProjectPersistenceReturn {
  const {
    notes, durationSeconds, audioName, audioBlob,
    appliedChartCodeText, chartCodePristine,
    debounceMs = 800, store: storeOpt, onRestore,
  } = opts;

  const storeRef = useRef<ChartProjectStore | null>(storeOpt ?? null);
  if (storeRef.current == null) storeRef.current = new ChartProjectStore();

  const mergerRef = useRef<ChartProjectPersistenceMerger | null>(null);
  const ensureMerger = useCallback((): ChartProjectPersistenceMerger => {
    const existing = mergerRef.current;
    if (existing && !existing.isDestroyed) return existing;
    const next = new ChartProjectPersistenceMerger({
      debounceMs,
      save: async (project) => {
        await storeRef.current!.save(project).catch((err: unknown) => {
          console.warn('[chart-project] 谱面工程落盘失败（下次编辑会重试）:', err);
        });
      },
    });
    mergerRef.current = next;
    return next;
  }, [debounceMs]);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const durationRef = useRef(durationSeconds);
  durationRef.current = durationSeconds;
  const audioNameRef = useRef(audioName);
  audioNameRef.current = audioName;
  const audioBlobRef = useRef(audioBlob);
  audioBlobRef.current = audioBlob;

  const appliedTextRef = useRef(appliedChartCodeText);
  appliedTextRef.current = appliedChartCodeText;
  const pristineRef = useRef(chartCodePristine);
  pristineRef.current = chartCodePristine;

  const projectRef = useRef<ChartProject | null>(null);

  const buildProject = useCallback((): ChartProject => {
    const now = Date.now();
    const applied = appliedTextRef.current ?? null;
    const pristine = pristineRef.current === true;
    const audio = audioBlobRef.current ?? undefined;
    const prev = projectRef.current;
    if (prev == null) {
      const created: ChartProject = {
        id: WORKSPACE_PROJECT_ID,
        name: null,
        artist: null,
        source: { type: 'custom' },
        durationSeconds: durationRef.current,
        lastOpened: now,
        charts: [defaultChart(notesRef.current, now, applied, pristine)],
        audioName: audioNameRef.current,
        coverName: null,
        ...(audio ? { audioBlob: audio } : {}),
      };
      projectRef.current = created;
      return created;
    }
    const charts = prev.charts.length > 0
      ? prev.charts.map((c, i) => (
        i === 0
          ? { ...c, notes: notesRef.current, lastModified: now, appliedChartCodeText: applied, chartCodePristine: pristine }
          : c
      ))
      : [defaultChart(notesRef.current, now, applied, pristine)];
    const next: ChartProject = {
      ...prev,
      durationSeconds: durationRef.current,
      charts,
      audioName: audioNameRef.current,
      ...(audio ? { audioBlob: audio } : {}),
    };
    if (!audio) delete next.audioBlob;
    projectRef.current = next;
    return next;
  }, []);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const restoredRef = useRef(false);
  const restoreSettledRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const store = storeRef.current;
    if (!store) { restoreSettledRef.current = true; return; }
    store.get(WORKSPACE_PROJECT_ID).then((project) => {
      if (!project) return;
      projectRef.current = project;
      void onRestoreRef.current(project);
    }).catch((err: unknown) => {
      console.warn('[chart-project] 谱面工程读取失败，按空谱面继续:', err);
    }).finally(() => {
      restoreSettledRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!restoreSettledRef.current) return;
    ensureMerger().schedule(buildProject());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, durationSeconds, audioName, audioBlob, appliedChartCodeText, chartCodePristine, debounceMs]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const flushNow = () => {
      if (!restoreSettledRef.current) return;
      void ensureMerger().flush(buildProject()).catch(() => { /* 静默 */ });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    saveNow: () => ensureMerger().saveNow(buildProject()),
  };
}
