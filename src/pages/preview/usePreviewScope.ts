// 预览页的作用域数据（ADR-0016 §4）：作用对象工程 + 它的谱面列表 + 这一屏在看哪张谱面。
//
// 机制是壳层的（作用域状态在 AppShell、工程级控件在 ui/ScopePicker），**数据加载留在页面这一层**
// （票 22 的复用边界：各页数据来源不同，组件不该替它们做决定）。
// 谱面级定位不在作用域条上——那是本页自己的事（§4），所以这里多一段"页面内临时选择"。
//
// 与 `src/audio/useAudioScope.ts` 同形（激活重读 + `loaded{forId}` + 选项列表）：两份的差异只在
// "读回来的是什么"（音频视图 vs 谱面列表 + 页面内定位）。第二处就抽抽象太早，留在两处、
// 由各自的测试看着；真出现第三处消费者时再提成共用的页层 hook。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppNav } from '../../layouts/AppNav';
import { useCurrentProject } from '../../app/providers/CurrentProjectProvider';
import { pickScopedChartId, resolveScopedProjectId } from '../../layouts/pageScope';
import type { ChartProject } from '../../project/ChartProject';
import { sortProjectsByLastOpened } from '../../project/projectCatalog';
import { isProjectAudioLocked } from '../../project/workspaceProject';
import type { ScopeOption } from '../../ui/ScopePicker';

export interface PreviewScopeState {
  /** 作用对象 = 作用域 ?? 当前工程；null = 两者都没有（页面走空态） */
  scopeId: string | null;
  /** 当前工程 id（null = 没有当前工程） */
  currentId: string | null;
  /**
   * 作用对象那条工程记录；null = 还没读回来（或记录已不存在）。
   * **只交出与 `scopeId` 匹配的那一份**——切换作用域时旧记录还留在 state 里，
   * 直接给出会让谱面切换器把 A 的谱面配到 B 的名字底下。
   */
  project: ChartProject | null;
  /** 作用域条的工程选项（按 lastOpened 排序，当前项由控件提到最前） */
  options: ScopeOption[];
  /** 正在读（用来区分"还没读到"与"读不到"） */
  loading: boolean;
  /** 这一屏在看哪张谱面（解析结果 ∩ 页面内临时选择）；null = 还不知道 */
  chartId: string | null;
  /** 页面内换谱面：不写作用域（作用域条只管工程）、不动当前工程 */
  pickChart: (chartId: string) => void;
}

export function usePreviewScope(active = true): PreviewScopeState {
  const { pageScope } = useAppNav();
  const { projectId: currentId, chartId: currentChartId, store, catalogEpoch } = useCurrentProject();
  const scopeId = resolveScopedProjectId(pageScope, currentId);

  // 读回来的那份连 forId 一起存：记录与"为谁读的"绑在一起，才敢往外发
  const [loaded, setLoaded] = useState<{ forId: string; project: ChartProject | null } | null>(null);
  const [options, setOptions] = useState<ScopeOption[]>([]);
  // 页面内的临时选择：入口（作用域 / 当前工程）决定"初次看哪张"，之后用户在这一页里换
  const [pickedChartId, setPickedChartId] = useState<string | null>(null);

  // 每次被激活（保活页从隐藏变可见）时重读一次。数据源是**工程记录**，而记录被工作台以
  // 800ms 防抖落盘——防抖那笔落地时不通知目录，所以只靠 catalogEpoch 的话，本页可能整次访问
  // 都停在"进来那一刻读到的那份"（照 useAudioScope）。激活是"用户真的在看它了"的时刻。
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
      // 两件一起读：作用对象那条记录（含谱面列表）+ 工程列表（作用域条用）。
      // 列表读失败不该连累正文——各自兜住，页面照常显示。
      const [listed, scoped] = await Promise.all([
        store.list().catch(() => []),
        store.get(scopeId).catch(() => null),
      ]);
      if (cancelled) return;
      setOptions(sortProjectsByLastOpened(listed).map((p) => ({
        id: p.id,
        name: p.name,
        artist: p.artist,
        audioName: p.audioName,
        locked: isProjectAudioLocked(p),
      })));
      setLoaded({ forId: scopeId, project: scoped });
    })();
    return () => { cancelled = true; };
  }, [scopeId, catalogEpoch, store, activation]);

  const fresh = loaded != null && loaded.forId === scopeId ? loaded : null;
  const project = fresh?.project ?? null;
  const chartIds = useMemo(() => project?.charts.map((c) => c.id) ?? [], [project]);

  // 入口换了就丢弃页面内的临时选择：入口决定"看什么"（票 22 定案 2）。工程被删二级被清时，
  // `scopeChartId` 变 undefined 同样走这里，于是自动落回"该工程的当前谱面 ?? 首张"。
  // `activation` 也在依赖里：左栏入口在"作用域本来就没变"（scope 为 null、工程也没换）时
  // 不会改动任何 scope state，页面自己看不出这是一次重新进入——但**激活**看得出来
  // （保活页从隐藏变可见），与本 hook 的数据重读同一个时刻。
  const scopeChartId = pageScope?.chartId;
  useEffect(() => { setPickedChartId(null); }, [scopeId, scopeChartId, activation]);

  // 二级解析（pageScope）：作用域二级 ?? 该工程的当前谱面 ?? 首张
  const defaultChartId = project != null && scopeId != null
    ? pickScopedChartId(pageScope, scopeId, currentId, currentChartId, chartIds)
    : null;
  // 临时选择只在它仍属于这个工程时算数：谱面被删 / 换了工程都自动退回解析结果
  const chartId = pickedChartId != null && chartIds.includes(pickedChartId) ? pickedChartId : defaultChartId;

  return {
    scopeId,
    currentId,
    project,
    options,
    loading: scopeId != null && fresh == null,
    chartId,
    pickChart: setPickedChartId,
  };
}
