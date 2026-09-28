// 音频页的作用域数据（票 22 / ADR-0015 §6）：本页此刻在动谁、它的音频视图、切换器要的工程列表。
//
// 机制是壳层的（作用域状态在 AppShell、控件在 ui/ScopePicker），**数据加载留在页面这一层**——
// 各页的数据来源不同，组件不该替它们做决定（票 22 的复用边界）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppNav } from '../layouts/AppNav';
import { useCurrentProject } from '../app/providers/CurrentProjectProvider';
import { resolveScopedProjectId } from '../layouts/pageScope';
import { sortProjectsByLastOpened } from '../chart/project/projectCatalog';
import { isProjectAudioLocked } from '../chart/project/workspaceProject';
import type { ScopeOption } from '../ui/ScopePicker';
import { readProjectAudio, type ProjectAudioDeps, type ProjectAudioView } from './projectAudio';

export interface AudioScopeState {
  /** 本页此刻的作用对象 = 作用域 ?? 当前工程；null = 两者都没有（页面走空态） */
  scopeId: string | null;
  /** 当前工程 id（null = 没有当前工程） */
  currentId: string | null;
  /** 作用对象就是当前工程？ */
  isCurrent: boolean;
  /**
   * 作用对象的音频视图；null = 还没读回来（或记录已不存在）。
   * **只交出与 `scopeId` 匹配的那一份**——切换作用域时旧视图还留在 state 里，
   * 直接给出会让作用域条把 A 的名字配到 B 的 id 上。
   */
  view: ProjectAudioView | null;
  /** 切换器选项（按 lastOpened 排序，当前项由控件提到最前） */
  options: ScopeOption[];
  /** 正在读（用来区分"还没读到"与"读不到"） */
  loading: boolean;
  /** 写路径的依赖（store / 当前工程 / 落盘 / 目录通知），交给 projectAudio 的四个动作 */
  deps: ProjectAudioDeps;
}

export function useAudioScope(active = true): AudioScopeState {
  const { pageScope } = useAppNav();
  const {
    projectId: currentId, store, catalogEpoch, flushPersist, notifyCatalogChanged,
  } = useCurrentProject();
  const scopeId = resolveScopedProjectId(pageScope, currentId);

  // 读回来的那份连 forId 一起存：视图和选项与"为谁读的"绑在一起，才敢往外发。
  const [loaded, setLoaded] = useState<{ forId: string; view: ProjectAudioView | null } | null>(null);
  const [options, setOptions] = useState<ScopeOption[]>([]);
  // 每次被激活（保活页从隐藏变可见）时重读一次。数据源是**工程记录**，而记录被工作台以
  // 800ms 防抖落盘——防抖那笔落地时不通知目录，所以只靠 catalogEpoch 的话，本页可能整次访问
  // 都停在"进来那一刻读到的那份"。激活是"用户真的在看它了"的时刻，重读一次的代价是两次读。
  const [activation, setActivation] = useState(0);
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (!(active && !wasActiveRef.current)) {
      wasActiveRef.current = active;
      return;
    }
    wasActiveRef.current = true;
    setActivation((n) => n + 1);
  }, [active]);

  useEffect(() => {
    if (scopeId == null) {
      setLoaded(null);
      setOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // 两件一起读：作用对象那条记录（含音频视图）+ 工程列表（切换器用）。
      // 列表读失败不该连累视图——各自兜住，页面照常显示。
      const [listed, scoped] = await Promise.all([
        store.list().catch(() => []),
        readProjectAudio(store, scopeId).catch(() => null),
      ]);
      if (cancelled) return;
      setOptions(sortProjectsByLastOpened(listed).map((p) => ({
        id: p.id,
        name: p.name,
        artist: p.artist,
        audioName: p.audioName,
        locked: isProjectAudioLocked(p),
      })));
      setLoaded({ forId: scopeId, view: scoped });
    })();
    return () => { cancelled = true; };
  }, [scopeId, catalogEpoch, store, activation]);

  const fresh = loaded != null && loaded.forId === scopeId ? loaded : null;
  const view = fresh?.view ?? null;

  const deps = useMemo<ProjectAudioDeps>(() => ({
    store,
    currentProjectId: currentId,
    flushPersist,
    notifyCatalogChanged,
  }), [store, currentId, flushPersist, notifyCatalogChanged]);

  return {
    scopeId,
    currentId,
    isCurrent: scopeId != null && scopeId === currentId,
    view,
    options,
    loading: scopeId != null && fresh == null,
    deps,
  };
}
