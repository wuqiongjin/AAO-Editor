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
import { appendNewPattern, removePatternFromLibrary, renamePatternInLibrary, sortPatternsNewestFirst } from './library';
import { PatternStore } from './PatternStore';
import { parsePatternsFile } from './share';
import type { Pattern } from './types';

export type PatternLibraryStatus = 'loading' | 'ready' | 'error';

export type PatternImportFailureReason = 'not-ready' | 'bad-file' | 'write-failed';

/** 导入结果：`ok` 时的两个计数就是反馈要说的「N 条 / 跳过 M 条」 */
export type PatternImportResult =
  | { ok: true; imported: number; skipped: number }
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
  /**
   * 分享文件文本 → 合并进库（**只合并、不替换**；id 已由 `parsePatternsFile` 重发）。
   * 整包坏 / 版本不认识 / 读失败 / 落盘失败 → `ok: false`；坏条目只计价、不阻断。
   */
  importFromText: (text: string) => Promise<PatternImportResult>;
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

  /**
   * 导入分享文件（issue 187）：解析在 184 的 `share` 层，这里只做「等载入 → 合并 → 整库落盘」。
   * 三条拒绝线：读失败（不许写）、整包解析失败（不动库）、落盘失败（commit 已回滚并 toast）。
   * 坏条目跳过不算失败 —— 好条目照常进来，计数交回界面报数。
   */
  const importFromText = useCallback(async (text: string): Promise<PatternImportResult> => {
    await loadedRef.current;
    if (!writableRef.current) {
      return { ok: false, reason: 'not-ready', message: t('patternLibrary.import.notReady') };
    }
    const parsed = parsePatternsFile(text);
    if (!parsed.ok) {
      return { ok: false, reason: 'bad-file', message: parsed.message };
    }
    const imported = parsed.patterns.length;
    if (imported === 0) {
      // 整包都坏 / 空库文件：没有可写的东西，不产生一次无意义的整库落盘
      return { ok: true, imported: 0, skipped: parsed.skipped.length };
    }
    const ok = await commit(sortPatternsNewestFirst([...patternsRef.current, ...parsed.patterns]));
    if (!ok) return { ok: false, reason: 'write-failed' };
    return { ok: true, imported, skipped: parsed.skipped.length };
  }, [commit]);

  return useMemo(
    () => ({ patterns, status, addFromSelection, rename, remove, importFromText }),
    [patterns, status, addFromSelection, rename, remove, importFromText],
  );
}
