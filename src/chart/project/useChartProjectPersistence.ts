// useChartProjectPersistence（候选 2 / 架构深化评审候选 2 / ADR-0005 §6）：
// 谱面工程持久化 = 挂载恢复 + 编辑防抖落盘（IndexedDB / Electron userData 门面）。
// 拆出 Editor.tsx 内 ~50 行的"挂载恢复 + 防抖 800ms 落盘"会话流。
//
// 行为保持：
//   - 挂载时读取 ChartProjectStore → 把 project 灌入 onRestore（Editor 处理 notes/duration/canPlay）
//   - notes / 谱面时长变化后 800ms 防抖落盘（避免每次编辑都打 IO）
//   - 落盘失败静默（幂等，编辑会自然触发重试）
//   - 显式 saveNow()（音频导入后立即落盘，issue 27 路径）
//   - 页面隐藏/卸载前 flush 一次 pending（issue 64：旧实现是 destroy，配合"deps effect 每次重建"
//     的时序把实例打死，编辑内容从此不落盘）
import { useCallback, useEffect, useRef } from 'react';
import { ChartProjectStore, DEFAULT_PROJECT_ID, type ChartProject } from './ChartProject';
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

export function useChartProjectPersistence(opts: UseChartProjectPersistenceOptions): UseChartProjectPersistenceReturn {
  const {
    notes, durationSeconds, audioName, audioBlob,
    appliedChartCodeText, chartCodePristine,
    debounceMs = 800, store: storeOpt, onRestore,
  } = opts;

  // store 单例：跨渲染保持，跨 effect 重建
  const storeRef = useRef<ChartProjectStore | null>(storeOpt ?? null);
  if (storeRef.current == null) storeRef.current = new ChartProjectStore();

  // merger 单例：防抖 timer 持久化。
  // issue 64：**只能在 effect 里按需取用**，绝不在 render 顶部捕获——React 的被动效应时序是
  // 「render → 上一轮 cleanup → 本轮 effect」，render 里捕获的实例会在同一轮 cleanup 中被销毁，
  // 之后的 schedule/saveNow 全打在 destroyed 实例上静默 no-op（= 编辑内容永不落盘，刷新即丢）。
  const mergerRef = useRef<ChartProjectPersistenceMerger | null>(null);
  const ensureMerger = useCallback((): ChartProjectPersistenceMerger => {
    const existing = mergerRef.current;
    if (existing && !existing.isDestroyed) return existing;
    const next = new ChartProjectPersistenceMerger({
      debounceMs,
      save: async (project) => {
        // 不再静默：落盘失败必须可见（旧实现吞掉异常，让"一直在存却存不进去"无法排查）
        await storeRef.current!.save(project).catch((err: unknown) => {
          console.warn('[chart-project] 谱面工程落盘失败（下次编辑会重试）:', err);
        });
      },
    });
    mergerRef.current = next;
    return next;
  }, [debounceMs]);

  // 最新 ref 快照（避免 useCallback 闭包过期）
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

  const buildProject = useCallback((): ChartProject => ({
    id: DEFAULT_PROJECT_ID,
    durationSeconds: durationRef.current,
    notes: notesRef.current,
    appliedChartCodeText: appliedTextRef.current ?? null,
    chartCodePristine: pristineRef.current === true,
    ...(audioNameRef.current ? { audioName: audioNameRef.current } : {}),
    ...(audioBlobRef.current ? { audioBlob: audioBlobRef.current } : {}),
  }), []);

  // onRestore 引用稳定（用 ref 解包，避免 effect 每次 onRestore 变化重跑）
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // 挂载时恢复（ADR-0005 §6）
  const restoredRef = useRef(false);
  /**
   * 恢复是否已结算（issue 64）：**在此之前一律不落盘**。
   * 挂载那一次 deps effect 会用【初始空 notes】排一次保存；若恢复读得比防抖窗口更慢
   * （Electron 文件后端要读 audio.bin、大谱面 JSON 也大），空谱面会先写进去、把已存工程覆盖掉——
   * 与"第一次编辑后不落盘"并列为"刷新就丢"的第二个成因。
   */
  const restoreSettledRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return; // StrictMode 双挂载：只发起一次读取，第二轮直接复用
    restoredRef.current = true;
    const store = storeRef.current;
    if (!store) { restoreSettledRef.current = true; return; }
    // **不能有 cleanup 取消**（issue 64 第三轮）：StrictMode 的「setup → cleanup → setup」
    // 会在第二轮 setup 因 restoredRef 早退、不再发起第二次 get()，而第一轮那个 promise
    // 落地时看到 cancelled=true → 恢复被整轮丢弃（dev 下表现为"刷新必丢"）。
    // 这是一次性挂载读取：promise 晚到也只是给已卸载组件灌状态，无害。
    store.get().then((project) => {
      if (project) void onRestoreRef.current(project);
    }).catch((err: unknown) => {
      // 不再静默：恢复失败必须可见，否则"存了却读不出来"无法排查
      console.warn('[chart-project] 谱面工程读取失败，按空谱面继续:', err);
    }).finally(() => {
      // 无条件置位：无论成功/失败/空数据，"是否可安全落盘"都必须有结论
      restoreSettledRef.current = true;
    });
  }, []);

  // 自动防抖保存：notes / 时长变化后 ~800ms 落盘。
  // issue 64：本 effect **不带 cleanup**——旧实现在这里 destroy  merger 并把 ref 置 null，
  // 于是每有一次 notes 变化，本轮 effect 拿到的都是"上一轮 cleanup 刚销毁"的实例，
  // schedule 直接 no-op：第一次编辑之后内容再也不落盘（刷新丢谱面）。
  // timer 的重置本来就由 schedule 内部 clearTimeout 负责，不需要 cleanup 参与。
  useEffect(() => {
    // 恢复未落地 → 这次是"初始空谱面"，回写会把已存工程覆盖掉（见 restoreSettledRef 注释）
    if (!restoreSettledRef.current) return;
    ensureMerger().schedule(buildProject());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, durationSeconds, audioName, audioBlob, appliedChartCodeText, chartCodePristine, debounceMs]);

  // 页面隐藏 / 卸载前结算（issue 64 方案 B）：刷新、关标签、切到后台都会触发，
  // 把"编辑完立刻刷新"那 800ms 的窗口收掉。
  // 防抖值不动（ADR-0005 §6 的 ~800ms）——缩短它只是按比例放大 IDB/文件写入次数，
  // 密集谱面下不划算；真正会丢数据的场景（刷新/关闭）由这里兜住。
  // **不用 unmount 兜**：① StrictMode 双挂载会在挂载瞬间就跑一次 cleanup，
  //   此时 notes 还是初始空谱面 → 恰好制造"刷新就丢"的另一种形态；
  //   ② 应用壳五页保活挂载（issue 28），"切页"根本不触发 Editor 卸载。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const flushNow = () => {
      if (!restoreSettledRef.current) return; // 同上：不得以空谱面覆盖
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
