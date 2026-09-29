// useChartProjectPersistence（候选 2 / 架构深化评审候选 2 / ADR-0005 §6 / chart-projects 03）：
// 谱面工程持久化 = 当前工程恢复 + 编辑防抖落盘（IndexedDB / Electron 数据根门面）。
//
// 当前工程由 CurrentProjectSession 决定；本 hook 在 projectId 变化时先 flush 旧工程，
import { useCallback, useEffect, useRef } from 'react';
import { ChartProjectStore, type ChartProject, type ProjectChart } from './ChartProject';
import { ChartProjectPersistenceMerger } from './ChartProjectPersistenceMerger';
import { isProjectAudioLocked, pickCurrentChart } from './workspaceProject';
import type { ChartNote } from '../chart/types';

export interface UseChartProjectPersistenceOptions {
  /** 当前工程 id；null = 尚未 ensure，不读写 */
  projectId: string | null;
  /** 当前谱面 id；null 时取工程第一张 */
  chartId: string | null;
  /** 工程目录改了当前工程（新增谱面等）时递增；同 id 下只重载不 flush，避免把目录写入冲掉 */
  catalogEpoch?: number;
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
  /** 挂载/切工程恢复回调：把 notes / 时长 / 音频灌入调用方（Editor） */
  onRestore: (project: ChartProject, chart: ProjectChart, opts: { restoreAudio: boolean }) => void | Promise<void>;
  /**
   * 记录侧音频被别的写路径改掉（音频页按作用域直接写工程记录，票 15 定案 8）时的回调。
   *
   * 只重新对齐音频，不碰谱面编辑态：这条路径上没有"新谱面"，走 onRestore 会连 resetNotes
   * 一起做掉——那会清空撤销历史，用户只是换了个音频却丢了编辑历史。
   */
  onRecordAudioChanged?: (project: ChartProject) => void;
}

export interface UseChartProjectPersistenceReturn {
  /** 立即落盘（音频导入/清除、卸载前） */
  saveNow: () => Promise<void>;
}

export function useChartProjectPersistence(opts: UseChartProjectPersistenceOptions): UseChartProjectPersistenceReturn {
  const {
    projectId, chartId, catalogEpoch = 0,
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
  const boundProjectIdRef = useRef<string | null>(null);
  const boundChartIdRef = useRef<string | null>(null);
  const boundEpochRef = useRef(0);
  const restoreSettledRef = useRef(true);
  const loadGenRef = useRef(0);

  if (
    projectId !== boundProjectIdRef.current
    || chartId !== boundChartIdRef.current
    || catalogEpoch !== boundEpochRef.current
  ) {
    restoreSettledRef.current = false;
  }

  const buildProject = useCallback((): ChartProject | null => {
    const prev = projectRef.current;
    if (prev == null) return null;
    const now = Date.now();
    const applied = appliedTextRef.current ?? null;
    const pristine = pristineRef.current === true;
    const audio = audioBlobRef.current ?? undefined;
    const targetId = boundChartIdRef.current;
    const hasTarget = targetId != null && prev.charts.some((c) => c.id === targetId);
    const audioLocked = isProjectAudioLocked(prev);
    const charts = prev.charts.length > 0
      ? prev.charts.map((c, i) => {
        const isCurrent = hasTarget ? c.id === targetId : i === 0;
        if (!isCurrent) return c;
        if (c.upload) return c; // 已上传谱面只读：不可被改写
        return { ...c, notes: notesRef.current, lastModified: now, appliedChartCodeText: applied, chartCodePristine: pristine };
      })
      : prev.charts;
    const next: ChartProject = {
      ...prev,
      durationSeconds: audioLocked ? prev.durationSeconds : durationRef.current,
      charts,
      audioName: audioLocked ? prev.audioName : audioNameRef.current,
      ...(audioLocked
        ? (prev.audioBlob ? { audioBlob: prev.audioBlob } : {})
        : (audio ? { audioBlob: audio } : {})),
    };
    if (!audioLocked && !audio) delete next.audioBlob;
    projectRef.current = next;
    return next;
  }, []);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const onRecordAudioChangedRef = useRef(opts.onRecordAudioChanged);
  onRecordAudioChangedRef.current = opts.onRecordAudioChanged;

  useEffect(() => {
    const wantedProject = projectId;
    const wantedChart = chartId;
    const wantedEpoch = catalogEpoch;
    const prevProject = boundProjectIdRef.current;
    const prevChart = boundChartIdRef.current;
    const prevEpoch = boundEpochRef.current;
    const epochChanged = wantedEpoch !== prevEpoch;
    const sameBinding = wantedProject === prevProject && wantedChart === prevChart;
    if (sameBinding && !epochChanged) return;
    restoreSettledRef.current = false;
    const gen = ++loadGenRef.current;

    void (async () => {
      // 卸当前工程（删除后 reset）不再 flush，避免把刚删的记录写回去。调用方若要保留编辑应先 flushPersist。
      // 目录写入后的 epoch 递增只重载，也不 flush，避免用过期 charts[] 盖掉新增谱面。
      if (wantedProject != null && !epochChanged && prevProject != null) {
        const prev = buildProject();
        if (prev != null) {
          await ensureMerger().flush(prev).catch(() => { /* 静默 */ });
        }
      }
      if (gen !== loadGenRef.current) return;

      if (wantedProject == null) {
        projectRef.current = null;
        boundProjectIdRef.current = null;
        boundChartIdRef.current = null;
        boundEpochRef.current = wantedEpoch;
        restoreSettledRef.current = true;
        return;
      }

      const store = storeRef.current;
      if (!store) {
        restoreSettledRef.current = true;
        return;
      }

      let loaded: ChartProject | null = null;
      try {
        loaded = await store.get(wantedProject);
      } catch (err: unknown) {
        console.warn('[chart-project] 谱面工程读取失败，按空谱面继续:', err);
      }
      if (gen !== loadGenRef.current) return;
      if (!loaded) {
        boundProjectIdRef.current = wantedProject;
        boundChartIdRef.current = wantedChart;
        boundEpochRef.current = wantedEpoch;
        restoreSettledRef.current = true;
        return;
      }

      const chart = pickCurrentChart(loaded, wantedChart);
      const projectChanged = loaded.id !== prevProject;
      const chartChanged = chart.id !== prevChart;
      // 票 15 定案 8 的不变量：记录里的音频与手上这份（= 会话快照）不一致 → 必须重新对齐。
      // 少它的后果就是症状 a：epoch 单独递增时 projectChanged / chartChanged 都是假，既不 flush
      // 也不 onRestore，会话里就一直留着上一个工程的音频。
      const audioMismatch = loaded.audioName !== audioNameRef.current;
      // 时长：只在**无音频**时按记录对齐（有音频时长度由音频决定，跟着音频一起 hydrate 过来）。
      // 留 0.5s 容差——离线探针与播放引擎对同一文件的秒数可能有极小差异，不设容差会退化
      // 成"每次目录刷新都重新对齐一次"，顺带把播放停掉。
      const durationMismatch = loaded.audioName == null
        && Math.abs(loaded.durationSeconds - durationRef.current) > 0.5;
      const recordChanged = audioMismatch || durationMismatch;
      projectRef.current = loaded;
      boundProjectIdRef.current = loaded.id;
      boundChartIdRef.current = chart.id;
      boundEpochRef.current = wantedEpoch;
      const switching = projectChanged || chartChanged;
      const restoreAudio = (projectChanged && !epochChanged) || audioMismatch;
      if (switching) {
        await onRestoreRef.current(loaded, chart, { restoreAudio });
      }
      // 走 onRecordAudioChanged 的只有"onRestore 没替我们对齐音频"的那些情形；
      // 否则同一个文件会被解码两次（onRestore 一次、这里再一次）。
      if (recordChanged && !(switching && restoreAudio)) {
        onRecordAudioChangedRef.current?.(loaded);
      }
      if (gen !== loadGenRef.current) return;
      restoreSettledRef.current = true;
    })();
  }, [projectId, chartId, catalogEpoch, buildProject, ensureMerger]);

  useEffect(() => {
    if (!restoreSettledRef.current) return;
    if (projectId !== boundProjectIdRef.current) return;
    if (chartId !== boundChartIdRef.current && chartId != null) return;
    const next = buildProject();
    if (!next) return;
    ensureMerger().schedule(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, durationSeconds, audioName, audioBlob, appliedChartCodeText, chartCodePristine, debounceMs, projectId, chartId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const flushNow = () => {
      if (!restoreSettledRef.current) return;
      const next = buildProject();
      if (!next) return;
      void ensureMerger().flush(next).catch(() => { /* 静默 */ });
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
    saveNow: () => {
      if (!restoreSettledRef.current) return Promise.resolve();
      const next = buildProject();
      if (!next) return Promise.resolve();
      return ensureMerger().saveNow(next);
    },
  };
}
