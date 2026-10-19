// useChartProjectPersistence（候选 2 / 架构深化评审候选 2 / ADR-0005 §6 / chart-projects 03）：
// 谱面工程持久化 = 当前工程恢复 + 编辑防抖落盘（IndexedDB / Electron 数据根门面）。
//
// 当前工程由 CurrentProjectSession 决定；本 hook 在 projectId 变化时先 flush 旧工程，
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChartProjectStore, type ChartProject, type ProjectChart } from './ChartProject';
import { ChartProjectPersistenceMerger } from './ChartProjectPersistenceMerger';
import { stampChartModified } from './chartModifiedStamp';
import { isProjectAudioLocked, pickCurrentChart } from './workspaceProject';
import { AUDIO_DURATION_MISMATCH_TOLERANCE } from '../audio/projectAudio';
import type { ChartNote } from '../chart/types';
import type { ChartCodeFidelity } from '../chart/editing/ChartConverter';
import { logger } from '../diagnostics/logger';

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
  /** 谱面代码保真（源文本 + pristine）：与 notes 同源，落盘时映射到记录的两个扁平字段 */
  chartCodeFidelity?: ChartCodeFidelity;
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
  /** 注册等待恢复就绪回调（供 CurrentProjectProvider 串联 enterWorkspace） */
  registerRestoreWaiter?: (fn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null) => void;
}

export interface UseChartProjectPersistenceReturn {
  /** 立即落盘（音频导入/清除、卸载前） */
  saveNow: () => Promise<void>;
  /** 当前工程是否已恢复结算完成 */
  readonly isSettled: boolean;
  /** 等待当前恢复结算完成（已结算立即 resolve） */
  waitUntilSettled: (targetProjectId?: string, targetChartId?: string) => Promise<void>;
}

export function useChartProjectPersistence(opts: UseChartProjectPersistenceOptions): UseChartProjectPersistenceReturn {
  const {
    projectId, chartId, catalogEpoch = 0,
    notes, durationSeconds, audioName, audioBlob,
    chartCodeFidelity,
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
          logger.warn('[chart-project]', '谱面工程落盘失败（下次编辑会重试）:', err);
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

  const fidelityRef = useRef(chartCodeFidelity);
  fidelityRef.current = chartCodeFidelity;

  const projectRef = useRef<ChartProject | null>(null);
  const boundProjectIdRef = useRef<string | null>(null);
  const boundChartIdRef = useRef<string | null>(null);
  const boundEpochRef = useRef(0);
  const restoreSettledRef = useRef(true);
  const justRestoredRef = useRef(false);
  const loadGenRef = useRef(0);
  const settleResolversRef = useRef<Array<() => boolean>>([]);

  const notifySettle = useCallback(() => {
    restoreSettledRef.current = true;
    justRestoredRef.current = true;
    const pending = settleResolversRef.current;
    const remaining: Array<() => boolean> = [];
    for (const check of pending) {
      if (!check()) remaining.push(check);
    }
    settleResolversRef.current = remaining;
  }, []);

  const waitUntilSettled = useCallback((targetProjectId?: string, targetChartId?: string) => {
    const matchesTarget = targetProjectId == null || (
      boundProjectIdRef.current === targetProjectId
      && (targetChartId == null || boundChartIdRef.current === targetChartId)
    );
    if (restoreSettledRef.current && matchesTarget) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer != null) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(done, 1500);

      const check = () => {
        const matches = targetProjectId == null || (
          boundProjectIdRef.current === targetProjectId
          && (targetChartId == null || boundChartIdRef.current === targetChartId)
        );
        if (matches) {
          done();
          return true;
        }
        return false;
      };
      settleResolversRef.current.push(check);
    });
  }, []);

  const registerRestoreWaiter = opts.registerRestoreWaiter;
  useEffect(() => {
    registerRestoreWaiter?.(waitUntilSettled);
    return () => registerRestoreWaiter?.(null);
  }, [registerRestoreWaiter, waitUntilSettled]);

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
    // 保真（编辑态的**一个**字段）经 stampChartModified 映射回记录的两个扁平字段 —— 记录形状不变
    const fidelity = fidelityRef.current;
    const audio = audioBlobRef.current ?? undefined;
    const targetId = boundChartIdRef.current;
    const hasTarget = targetId != null && prev.charts.some((c) => c.id === targetId);
    const audioLocked = isProjectAudioLocked(prev);
    const charts = prev.charts.length > 0
      ? prev.charts.map((c, i) => {
          const isCurrent = hasTarget ? c.id === targetId : i === 0;
          if (!isCurrent) return c;
          if (c.upload) return c; // 已上传谱面只读：不可被改写
          // issue 35：lastModified 条件戳——notes / 保真真变才重戳，时长 / 音频 / 切 tab flush 不戳
          return stampChartModified(c, { notes: notesRef.current, fidelity, now });
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
        notifySettle();
        return;
      }

      const store = storeRef.current;
      if (!store) {
        notifySettle();
        return;
      }

      let loaded: ChartProject | null = null;
      try {
        loaded = await store.get(wantedProject);
      } catch (err: unknown) {
        logger.warn('[chart-project]', '谱面工程读取失败，按空谱面继续:', err);
      }
      if (gen !== loadGenRef.current) return;
      if (!loaded) {
        boundProjectIdRef.current = wantedProject;
        boundChartIdRef.current = wantedChart;
        boundEpochRef.current = wantedEpoch;
        notifySettle();
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
      // 容差与音频接缝同一个口径（AUDIO_DURATION_MISMATCH_TOLERANCE，33 票的替换信号沿用）
      // ——离线探针与播放引擎对同一文件的秒数可能有极小差异，不设容差会退化
      // 成"每次目录刷新都重新对齐一次"，顺带把播放停掉。
      const durationMismatch = loaded.audioName == null
        && Math.abs(loaded.durationSeconds - durationRef.current) > AUDIO_DURATION_MISMATCH_TOLERANCE;
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
      notifySettle();
    })();
  }, [projectId, chartId, catalogEpoch, buildProject, ensureMerger, notifySettle]);

  useEffect(() => {
    if (!restoreSettledRef.current) return;
    if (projectId !== boundProjectIdRef.current) return;
    if (chartId !== boundChartIdRef.current && chartId != null) return;
    if (justRestoredRef.current) {
      justRestoredRef.current = false;
      return;
    }
    const next = buildProject();
    if (!next) return;
    ensureMerger().schedule(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, durationSeconds, audioName, audioBlob, chartCodeFidelity, debounceMs, projectId, chartId]);

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

  // 立即落盘（音频导入/清除、卸载前、工程页激活时的 flushPersist）。
  // 提成 useCallback：**句柄身份必须稳定**。它被 WorkspacePage 注册进
  // CurrentProjectProvider.registerPersistFlush，而注册 effect 以它为依赖；每次渲染换新
  // 闭包会让那个 effect 反复 cleanup（注册柄清成 no-op）→ setup。React 一个 commit 内
  // 先跑完整个 cleanup 阶段再跑 setup 阶段，且 setup 按树序（工程页在工作台之前）——
  // 于是"回工程页"那一提交里，工程页激活 effect 的 flushPersist() 打到刚被清空的注册柄上，
  // 在飞防抖笔落不了盘，reload 读到编辑前的旧记录（issue 38 复验：激活 effect 本身没错，
  // 错在 flush 柄被导航提交的 cleanup 清掉后又晚于激活 effect 才恢复）。
  const saveNow = useCallback((): Promise<void> => {
    if (!restoreSettledRef.current) return Promise.resolve();
    const next = buildProject();
    if (!next) return Promise.resolve();
    return ensureMerger().saveNow(next);
  }, [buildProject, ensureMerger]);

  // 返回对象一并求稳：调用方（WorkspacePage 的 persistNow）以它为 useCallback 依赖，
  // 每渲染一个新对象会把句柄 churn 原样传导到注册 effect 上。
  return useMemo(
    () => ({
      saveNow,
      get isSettled() {
        return restoreSettledRef.current;
      },
      waitUntilSettled,
    }),
    [saveNow, waitUntilSettled],
  );
}
