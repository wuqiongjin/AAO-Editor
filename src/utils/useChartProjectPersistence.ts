// useChartProjectPersistence（候选 2 / 架构深化评审候选 2 / ADR-0005 §6）：
// 谱面工程持久化 = 挂载恢复 + 编辑防抖落盘（IndexedDB / Electron userData 门面）。
// 拆出 Editor.tsx 内 ~50 行的"挂载恢复 + 防抖 800ms 落盘"会话流。
//
// 行为保持：
//   - 挂载时读取 ChartProjectStore → 把 project 灌入 onRestore（Editor 处理 notes/duration/canPlay）
//   - notes / 谱面时长变化后 800ms 防抖落盘（避免每次编辑都打 IO）
//   - 落盘失败静默（幂等，编辑会自然触发重试）
//   - 显式 saveNow()（音频导入后立即落盘，issue 27 路径）
//   - 卸载前清 timer（不强制 flush；卸载时浏览器通常会自动放弃）
import { useCallback, useEffect, useRef } from 'react';
import { ChartProjectStore, DEFAULT_PROJECT_ID, type ChartProject } from './ChartProject';
import { ChartProjectPersistenceMerger } from './ChartProjectPersistenceMerger';
import type { ChartNote } from '../notes/Charts';

export interface UseChartProjectPersistenceOptions {
  /** 当前 notes（编辑中） */
  notes: ChartNote[];
  /** 当前谱面时长（秒） */
  durationSeconds: number;
  /** 当前音频文件元数据（无音频为 null） */
  audioName: string | null;
  audioBlob: Blob | null;
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

export function useChartProjectPersistence(opts: UseChartProjectPersistenceOptions): UseChartProjectPersistenceReturn {
  const {
    notes, durationSeconds, audioName, audioBlob,
    debounceMs = 800, store: storeOpt, onRestore,
  } = opts;

  // store 单例：跨渲染保持，跨 effect 重建
  const storeRef = useRef<ChartProjectStore | null>(storeOpt ?? null);
  if (storeRef.current == null) storeRef.current = new ChartProjectStore();

  // merger 单例：防抖 timer 持久化
  const mergerRef = useRef<ChartProjectPersistenceMerger | null>(null);
  if (mergerRef.current == null) {
    mergerRef.current = new ChartProjectPersistenceMerger({
      debounceMs,
      save: async (project) => {
        await storeRef.current!.save(project).catch(() => { /* 静默 */ });
      },
    });
  }
  const merger = mergerRef.current;

  // 最新 ref 快照（避免 useCallback 闭包过期）
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const durationRef = useRef(durationSeconds);
  durationRef.current = durationSeconds;
  const audioNameRef = useRef(audioName);
  audioNameRef.current = audioName;
  const audioBlobRef = useRef(audioBlob);
  audioBlobRef.current = audioBlob;

  const buildProject = useCallback((): ChartProject => ({
    id: DEFAULT_PROJECT_ID,
    durationSeconds: durationRef.current,
    notes: notesRef.current,
    ...(audioNameRef.current ? { audioName: audioNameRef.current } : {}),
    ...(audioBlobRef.current ? { audioBlob: audioBlobRef.current } : {}),
  }), []);

  // onRestore 引用稳定（用 ref 解包，避免 effect 每次 onRestore 变化重跑）
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // 挂载时恢复（ADR-0005 §6）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const store = storeRef.current;
    if (!store) return;
    let cancelled = false;
    store.get().then((project) => {
      if (cancelled || !project) return;
      void onRestoreRef.current(project);
    });
    return () => { cancelled = true; };
  }, []);

  // 自动防抖保存：notes / 时长变化后 ~800ms 落盘
  useEffect(() => {
    merger.schedule(buildProject());
    return () => {
      // 卸载时清 timer；不强制 flush（hook 卸载通常在页面切走时，下次挂载会再 schedule）
      if (mergerRef.current) mergerRef.current.destroy();
      mergerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, durationSeconds, debounceMs]);

  return {
    saveNow: () => merger.saveNow(buildProject()),
  };
}
