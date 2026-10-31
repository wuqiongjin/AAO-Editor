// 片段库的 React 接缝（issue 185）：一次载入、每次变更整库落盘的唯一写入口。
//
// 为什么是 hook 而不是把状态塞进抽屉：收藏入口有两条（抽屉 footer 按钮 + `execSavePattern`
// 快捷键），抽屉可以没开。库状态必须活在两者之上（`WorkspacePage`），否则短路收藏会漏掉/覆盖。
//
// 写入口径：**内存先改、整库落盘**（v1 单文件全量的必然形态）；落盘失败回滚到上一次好状态并提示，
// 绝不留下"界面显示存了、磁盘没有"的分裂。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { showToast } from '../../ui/Toast';
import type { ChartNote, SelectionItem } from '../types';
import { capturePattern } from './capture';
import { removePatternFromLibrary, renamePatternInLibrary, sortPatternsNewestFirst } from './library';
import { createPattern } from './naming';
import { PatternStore } from './PatternStore';
import type { Pattern } from './types';

export interface PatternLibraryApi {
  /** 已按收藏时间倒序（最新在最上） */
  patterns: Pattern[];
  /** 首次载入完成前为 `loading`：此时既不是空库、也不要显示空态 */
  status: 'loading' | 'ready';
  /** 选区 → 新片段；无选区 / 落盘失败 → null（不提示「已收藏」） */
  addFromSelection: (notes: ChartNote[], selection: SelectionItem[]) => Promise<Pattern | null>;
  /** 改名；空名 / 没变 / 落盘失败 → false */
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
}

/** `store` 只在测试里注入；生产按环境自动选后端（`PatternStore` 默认构造） */
export function usePatternLibrary(store?: PatternStore): PatternLibraryApi {
  const storeRef = useRef<PatternStore | null>(null);
  if (storeRef.current === null) storeRef.current = store ?? new PatternStore();
  const resolved = storeRef.current;

  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  /** 当前库的唯一真相（同一帧内连发两个动作时，state 还是旧的） */
  const patternsRef = useRef<Pattern[]>([]);
  /** 首次载入：收藏要等它回来，否则会把整库覆盖成只有这一条 */
  const loadedRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = resolved.load()
      .then((list) => {
        if (cancelled) return;
        const sorted = sortPatternsNewestFirst(list);
        patternsRef.current = sorted;
        setPatterns(sorted);
      })
      // 读不出来按空库起（用户还没收藏过，或存储不可用）：不打断工作台，写盘时才报错
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setStatus('ready');
      });
    return () => { cancelled = true; };
  }, [resolved]);

  const commit = useCallback(async (next: Pattern[]): Promise<boolean> => {
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
    const pattern = createPattern(payload, patternsRef.current);
    // 收藏时间倒序是库口径：新的一条进列表头（落盘顺序与界面同序）
    const ok = await commit(sortPatternsNewestFirst([...patternsRef.current, pattern]));
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

  return useMemo(
    () => ({ patterns, status, addFromSelection, rename, remove }),
    [patterns, status, addFromSelection, rename, remove],
  );
}
