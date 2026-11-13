// 预览页的作用域数据（ADR-0016 §4）：作用对象工程 + 它的谱面列表 + 这一屏在看哪张谱面。
//
// 机制是壳层的（作用域状态在 AppShell、工程级控件在 ui/ScopePicker），**数据加载留在页面这一层**
// （票 22 的复用边界：各页数据来源不同，组件不该替它们做决定）。
// 谱面级定位不在作用域条上——那是本页自己的事（§4），所以这里多一段"页面内临时选择"。
//
// 与 `src/audio/useAudioScope.ts` 同形（激活重读 + `loaded{forId}` + 选项列表）：两份的差异只在
// "读回来的是什么"（音频视图 vs 谱面列表 + 页面内定位）。第二处就抽抽象太早，留在两处、
// 由各自的测试看着；真出现第三处消费者时再提成共用的页层 hook。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * 票 70：记录内容换代的序号（单调递增）。只有「读回来的记录语义不同于上一份」才 +1，
   * 页面用它判断静态形态是否要重新出图；无编辑的切回不递增。
   * 骨架是否显示另看 `checking`（激活重读在飞），与本值无关。
   */
  dataVersion: number;
  /**
   * 票 70：一次激活的 flushPersist + store.get() 还在飞。异步读盘期间页面还不知道数据变没变，
   * 但保活页的旧画布已经要显示出来了 —— 调用方据此在**激活当帧**先盖住画面。
   * 激活检测走 useLayoutEffect，所以这个 true 会在浏览器 paint 前提交。
   */
  checking: boolean;
}

/**
 * 票 70 · 激活重读的等价比较。
 *
 * 每次激活都会 `flushPersist → store.get()`，而 IndexedDB / 文件后端反序列化出来的**永远是新对象**：
 * 直接 `setLoaded({ project: scoped })` 会让 `scene` 换引用 → 画家换代 → 可见面板同步整批重画，
 * 即使音符一个都没改（实测 1×/4×/10× 长谱冷态 85/144/228ms、长任务最高合计 128ms）。
 * 这里按语义比较，相等就不替换 `project` 身份 —— 不换代、不重画。
 * 「激活期间要不要给一层骨架」不看本值，由 `checking` 独立控制：读盘那段时间还不知道数据变没变，
 * 等 `dataVersion` 才显示骨架就已经把旧画布画出来了。
 *
 * 按**整份记录的深层值**比较，而不是逐字段白名单或 `notesEqual`：
 *   - `notesEqual`（编辑域的语义去重）只认规范化后的音符类型，真实谱里的 `Directional` 等
 *     原始类型会落到它的 `return false`，用它做「没变」判断会把每次激活都误判成换代；
 *   - 深层值比较对任何音符类型、任何保真字段都成立，也不吃属性顺序差异。
 * `audioBlob` / `coverBlob` 故意排除：它们每次反序列化都是新 Blob，而静态预览不消费它们。
 * 长谱上这是 O(n) 遍历，但比整批重新光栅便宜两个数量级。
 */
export function samePreviewProject(a: ChartProject | null, b: ChartProject | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const sa = snapshot(a);
  const sb = snapshot(b);
  // 快路径：两份都来自同一个后端读回，属性顺序一致，原生序列化比手写递归便宜一个量级
  // （长谱上每次激活都要跑，别让它自己变成新的长任务）。
  if (JSON.stringify(sa) === JSON.stringify(sb)) return true;
  // 顺序不同（内存构造 vs 反序列化）时用与键序无关的深比较兜底，别把「没变」误判成换代。
  return samePreviewValue(sa, sb);
}

/** 去掉二进制字段后的浅拷贝（只给等价比较用，不交出页面） */
function snapshot(p: ChartProject): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  delete out.audioBlob;
  delete out.coverBlob;
  return out;
}

function samePreviewValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => samePreviewValue(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of Object.keys(ao)) {
    if (!samePreviewValue(ao[k], bo[k])) return false;
  }
  // b 独有的键：值为 undefined 视作缺省，否则算不同
  for (const k of Object.keys(bo)) {
    if (!(k in ao) && bo[k] !== undefined) return false;
  }
  return true;
}

export function usePreviewScope(active = true): PreviewScopeState {
  const { pageScope } = useAppNav();
  const {
    projectId: currentId, chartId: currentChartId, store, catalogEpoch, flushPersist, getProjectEditEpoch,
  } = useCurrentProject();
  const scopeId = resolveScopedProjectId(pageScope, currentId);

  // 读回来的那份连 forId 一起存：记录与"为谁读的"绑在一起，才敢往外发
  type Loaded = { forId: string; project: ChartProject | null };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 读 effect 里要拿「上一份」做等价比较；渲染期同步，异步回调里读到的就是最新一次提交
  const loadedRef = useRef<Loaded | null>(loaded);
  loadedRef.current = loaded;
  /** 票 70：只有记录真的换了代才递增；作用域清空再回来也不会倒退 */
  const [dataVersion, setDataVersion] = useState(0);
  /** 票 70：激活重读在飞（paint 前置 true，读完成置 false） */
  const [checking, setChecking] = useState(false);
  const [options, setOptions] = useState<ScopeOption[]>([]);
  // 页面内的临时选择：入口（作用域 / 当前工程）决定"初次看哪张"，之后用户在这一页里换
  const [pickedChartId, setPickedChartId] = useState<string | null>(null);

  // 票 70 复验整改：区分「重新进入页面（重置临时谱面选卡）」与「本地数据可能陈旧（才置 checking + 读盘）」。
  // 只有 scopeId / catalogEpoch / 工作台对该工程的编辑代次（editEpoch）任一变化、或尚未同步过时才读盘；
  // 从设置 / 音频 / 工程或未编辑的工作台切回，零遮罩、零 IO、零重绘。
  type SyncStamp = { scopeId: string; catalogEpoch: number; editEpoch: number; store: unknown };
  const [activation, setActivation] = useState(0);
  const [syncEpoch, setSyncEpoch] = useState(0);
  const wasActiveRef = useRef(active);
  const activeRef = useRef(active);
  activeRef.current = active;
  const requestedRef = useRef<SyncStamp | null>(null);
  const syncedRef = useRef<SyncStamp | null>(null);
  const syncedEditByProjectRef = useRef<Map<string, number>>(new Map());
  const optionsEpochRef = useRef<number | null>(null);

  // layout 阶段而不是 effect：仅当检测到确实需要更新时，才在 paint 之前把「正在检查」提交到 DOM，
  // 防止先画出一帧保活页的旧画布再突然更新；无编辑切回则直接放行，零闪烁。
  useLayoutEffect(() => {
    const justActivated = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (justActivated) {
      setActivation((n) => n + 1);
    }
    if (!active) return;
    if (scopeId == null) {
      requestedRef.current = null;
      syncedRef.current = null;
      return;
    }
    const editEpoch = getProjectEditEpoch?.(scopeId) ?? 0;
    const baseline = justActivated ? syncedRef.current : requestedRef.current;
    const isStale =
      baseline == null ||
      baseline.scopeId !== scopeId ||
      baseline.catalogEpoch !== catalogEpoch ||
      baseline.editEpoch !== editEpoch ||
      baseline.store !== store;
    if (isStale) {
      requestedRef.current = { scopeId, catalogEpoch, editEpoch, store };
      setChecking(true);
      setSyncEpoch((n) => n + 1);
    }
  }, [active, scopeId, catalogEpoch, store, getProjectEditEpoch]);

  useEffect(() => {
    if (scopeId == null) {
      requestedRef.current = null;
      syncedRef.current = null;
      optionsEpochRef.current = null;
      loadedRef.current = null;
      setLoaded(null);
      setOptions([]);
      setChecking(false);
      return;
    }
    if (!activeRef.current || syncEpoch === 0) return;
    const targetEditEpoch = requestedRef.current?.scopeId === scopeId
      ? requestedRef.current.editEpoch
      : (getProjectEditEpoch?.(scopeId) ?? 0);
    const prevSyncedEdit = syncedEditByProjectRef.current.get(scopeId) ?? 0;
    const needsFlush = targetEditEpoch !== prevSyncedEdit;
    const needOptions = optionsEpochRef.current !== catalogEpoch || syncedRef.current?.store !== store;
    let cancelled = false;
    void (async () => {
      if (needsFlush) {
        await flushPersist();
        if (cancelled) return;
      }
      // 仅当目录代次变化或初次加载时刷新作用域列表；工作台编辑谱面时只按 scopeId 读单条工程。
      const [listed, scoped] = await Promise.all([
        needOptions ? store.list().catch(() => []) : Promise.resolve(null),
        store.get(scopeId).catch(() => null),
      ]);
      if (cancelled) return;
      if (listed !== null) {
        optionsEpochRef.current = catalogEpoch;
        setOptions(sortProjectsByLastOpened(listed).map((p) => ({
          id: p.id,
          name: p.name,
          artist: p.artist,
          audioName: p.audioName,
          locked: isProjectAudioLocked(p),
        })));
      }
      const syncedEditEpoch = getProjectEditEpoch?.(scopeId) ?? targetEditEpoch;
      syncedEditByProjectRef.current.set(scopeId, syncedEditEpoch);
      syncedRef.current = { scopeId, catalogEpoch, editEpoch: syncedEditEpoch, store };
      // 票 70：内容没变就**不替换** project 身份。保活页的静态画面因此不换代、不重画，
      // 常态切回零成本；真变了才递增 dataVersion，让页面先用骨架盖住旧画布再分批出图。
      const prev = loadedRef.current;
      if (prev && prev.forId === scopeId && samePreviewProject(prev.project, scoped)) {
        setChecking(false);
        return;
      }
      const next: Loaded = { forId: scopeId, project: scoped };
      loadedRef.current = next;
      setLoaded(next);
      setDataVersion((v) => v + 1);
      // 与 dataVersion 同批提交：checking 退场时骨架改由「待出图」继续撑着，中间不断档
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [scopeId, catalogEpoch, store, syncEpoch, flushPersist, getProjectEditEpoch]);
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
    dataVersion,
    checking,
  };
}
