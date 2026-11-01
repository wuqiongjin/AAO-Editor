// 片段库的 React 接缝（issue 185）：一次载入、每次变更整库落盘的唯一写入口。
//
// 为什么是 hook 而不是把状态塞进抽屉：收藏入口有两条（抽屉 footer 按钮 + `execSavePattern`
// 快捷键），抽屉可以没开。库状态必须活在两者之上（`WorkspacePage`），否则短路收藏会漏掉/覆盖。
//
// 写入口径：**内存先改、整库落盘**（v1 单文件全量的必然形态）；落盘失败回滚到上一次好状态并提示，
// 绝不留下"界面显示存了、磁盘没有"的分裂。
//
// 读失败（`status === 'error'`）**一律不许写**：整库落盘的前提是手里这份是对的，读失败时
// 手里是空库 —— 此时写一次就等于把用户已有的片段全抹掉。宁可这轮不能收藏。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { showToast } from '../../ui/Toast';
import type { ChartNote, SelectionItem } from '../types';
import { capturePattern } from './capture';
import {
  planPatternImport,
  previewPatternImport,
  type PatternImportPreview,
  type PatternImportStrategy,
} from './importConflict';
import {
  appendNewPattern,
  removePatternFromLibrary,
  renamePatternInLibrary,
  setPatternPinnedInLibrary,
  sortPatternsNewestFirst,
} from './library';
import { PatternStore } from './PatternStore';
import { parsePatternsFile } from './share';
import type { Pattern } from './types';

export type PatternLibraryStatus = 'loading' | 'ready' | 'error';

export type PatternImportFailureReason = 'not-ready' | 'bad-file' | 'write-failed';

/**
 * 解析完成、尚未落盘的导入计划（189）：弹层确认后才交给 `applyImport`。
 * `patterns` 已由 `parsePatternsFile` 重发 id；`preview` 是默认「跳过」口径的计数与冲突清单。
 */
export interface PatternImportPreparation {
  patterns: Pattern[];
  invalidCount: number;
  preview: PatternImportPreview;
}

export type PatternImportPreparationResult =
  | { ok: true; preparation: PatternImportPreparation }
  | { ok: false; reason: Exclude<PatternImportFailureReason, 'write-failed'>; message?: string };

/**
 * 导入结果：`imported` = 实际写入库的条目数（含覆盖 / 保留两者），
 * `skipped` = 坏条目数，`skippedExisting` = 因内容已存在而跳过的条目数。
 */
export type PatternImportResult =
  | { ok: true; imported: number; skipped: number; skippedExisting: number }
  | { ok: false; reason: PatternImportFailureReason; message?: string };

export interface PatternLibraryApi {
  /** 已按收藏时间倒序（最新在最上） */
  patterns: Pattern[];
  /**
   * `loading` = 首次载入还没回来（既不是空库，也不要显示空态）；
   * `error` = 读不出来（界面如实说"读不到"，且本轮禁止写入以免覆盖原库）。
   */
  status: PatternLibraryStatus;
  /** 选区 → 新片段；无选区 / 未载入成功 / 落盘失败 → null（不提示「已收藏」） */
  addFromSelection: (notes: ChartNote[], selection: SelectionItem[]) => Promise<Pattern | null>;
  /** 改名；空名 / 没变 / 未载入成功 / 落盘失败 → false */
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  /** 置顶 / 取消置顶（issue 191）；id 不存在 / 状态未变 / 未载入成功 / 落盘失败 → false */
  setPinned: (id: string, pinned: boolean) => Promise<boolean>;
  /**
   * 分享文件文本 → 解析 + 冲突预览（**不写盘**）。整包坏 / 版本不认识 / 读失败 → `ok: false`；
   * 坏条目只计数、不阻断。弹层确认策略后交给 `applyImport`。
   */
  prepareImport: (text: string) => Promise<PatternImportPreparationResult>;
  /**
   * 把已解析的导入计划按策略合并进库（**只合并、不替换**）：覆盖保留本地身份，
   * 跳过不写盘，保留两者追加新 id。落盘失败 → `ok: false`（commit 已回滚并 toast）。
   */
  applyImport: (
    preparation: PatternImportPreparation,
    strategy: PatternImportStrategy,
  ) => Promise<PatternImportResult>;
}

/** `store` 只在测试里注入；生产按环境自动选后端（`PatternStore` 默认构造） */
export function usePatternLibrary(store?: PatternStore): PatternLibraryApi {
  const storeRef = useRef<PatternStore | null>(null);
  if (storeRef.current === null) storeRef.current = store ?? new PatternStore();
  const resolved = storeRef.current;

  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [status, setStatus] = useState<PatternLibraryStatus>('loading');
  /** 当前库的唯一真相（同一帧内连发两个动作时，state 还是旧的） */
  const patternsRef = useRef<Pattern[]>([]);
  /** 同一份真相的"能不能写"侧面：走 ref 是因为 `addFromSelection` 会 await 载入，
   *  闭包里的 state 可能是 await 之前的旧值 */
  const writableRef = useRef(false);
  /** 首次载入：收藏要等它回来，否则会把整库覆盖成只有这一条 */
  const loadedRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = resolved.load()
      .then((list) => {
        if (cancelled) return;
        const sorted = sortPatternsNewestFirst(list);
        patternsRef.current = sorted;
        writableRef.current = true;
        setPatterns(sorted);
        setStatus('ready');
      })
      .catch(() => {
        // 读不出来 ≠ 空库：不写盘、界面如实报错（下一次完整重载才恢复写入能力）
        if (cancelled) return;
        writableRef.current = false;
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [resolved]);

  /** 可写才写：读失败时整库落盘会覆盖用户原库，故一律拒绝 */
  const commit = useCallback(async (next: Pattern[]): Promise<boolean> => {
    if (!writableRef.current) return false;
    const previous = patternsRef.current;
    patternsRef.current = next;
    setPatterns(next);
    try {
      await resolved.saveAll(next);
      return true;
    } catch {
      patternsRef.current = previous;
      setPatterns(previous);
      showToast(t('patternLibrary.saveFailed'), 'danger');
      return false;
    }
  }, [resolved]);

  const addFromSelection = useCallback(async (
    notes: ChartNote[],
    selection: SelectionItem[],
  ): Promise<Pattern | null> => {
    await loadedRef.current;
    const payload = capturePattern(notes, selection);
    if (!payload) return null;
    const { patterns: appended, pattern } = appendNewPattern(patternsRef.current, payload);
    const ok = await commit(sortPatternsNewestFirst(appended));
    return ok ? pattern : null;
  }, [commit]);

  const rename = useCallback(async (id: string, name: string): Promise<boolean> => {
    const next = renamePatternInLibrary(patternsRef.current, id, name);
    if (!next) return false;
    return commit(next);
  }, [commit]);

  const remove = useCallback(async (id: string): Promise<void> => {
    const next = removePatternFromLibrary(patternsRef.current, id);
    if (next) await commit(next);
  }, [commit]);

  const setPinned = useCallback(async (id: string, pinned: boolean): Promise<boolean> => {
    await loadedRef.current;
    if (!writableRef.current) return false;
    const next = setPatternPinnedInLibrary(patternsRef.current, id, pinned);
    if (!next) return false;
    return commit(sortPatternsNewestFirst(next));
  }, [commit]);

  /**
   * 导入第一步（189）：解析 + 按当前库的排序算冲突预览，**不写盘**。
   * 三条拒绝线：读失败（不许写）、整包解析失败（不动库）；好条目 / 坏条目都只计数。
   * 解析仍在 184 的 `share` 层（逐条校验 + 新 id），判重与动作在 `importConflict`。
   */
  const prepareImport = useCallback(async (text: string): Promise<PatternImportPreparationResult> => {
    await loadedRef.current;
    if (!writableRef.current) {
      return { ok: false, reason: 'not-ready', message: t('patternLibrary.import.notReady') };
    }
    const parsed = parsePatternsFile(text);
    if (!parsed.ok) {
      return { ok: false, reason: 'bad-file', message: parsed.message };
    }
    const preview = previewPatternImport(patternsRef.current, parsed.patterns, parsed.skipped.length);
    return {
      ok: true,
      preparation: {
        patterns: parsed.patterns,
        invalidCount: parsed.skipped.length,
        preview,
      },
    };
  }, []);

  /**
   * 导入第二步（189）：按弹层选定的策略合并 → 整库落盘。
   * - 全部被跳过（`imported === 0`）：不产生无意义的整库落盘；
   * - 覆盖：保留本地 `id / createdAt` 等身份字段，只换名字（`planPatternImport`）；
   * - 落盘失败：`commit` 已回滚并 toast，返回 `write-failed` 由界面避免重复报错。
   */
  const applyImport = useCallback(async (
    preparation: PatternImportPreparation,
    strategy: PatternImportStrategy,
  ): Promise<PatternImportResult> => {
    await loadedRef.current;
    if (!writableRef.current) {
      return { ok: false, reason: 'not-ready', message: t('patternLibrary.import.notReady') };
    }
    const plan = planPatternImport(patternsRef.current, preparation.patterns, strategy);
    if (plan.imported === 0) {
      return {
        ok: true,
        imported: 0,
        skipped: preparation.invalidCount,
        skippedExisting: plan.skippedExisting,
      };
    }
    const ok = await commit(sortPatternsNewestFirst(plan.patterns));
    if (!ok) return { ok: false, reason: 'write-failed' };
    return {
      ok: true,
      imported: plan.imported,
      skipped: preparation.invalidCount,
      skippedExisting: plan.skippedExisting,
    };
  }, [commit]);

  return useMemo(
    () => ({ patterns, status, addFromSelection, rename, remove, setPinned, prepareImport, applyImport }),
    [patterns, status, addFromSelection, rename, remove, setPinned, prepareImport, applyImport],
  );
}
