// CurrentProjectProvider（chart-projects 03 / ADR-0015 §3）：
// 会话内唯一当前工程 + 当前谱面。进工作台/音频页时 ensure；切工程走 open。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '../../project/ChartProject';
import { CurrentProjectSession } from '../../project/CurrentProjectSession';

export interface CurrentProjectContextValue {
  projectId: string | null;
  chartId: string | null;
  store: ChartProjectStore;
  catalogEpoch: number;
  ensure: () => Promise<{ project: ChartProject; chart: ProjectChart; created: boolean }>;
  open: (projectId: string, chartId?: string) => Promise<{ project: ChartProject; chart: ProjectChart }>;
  reset: () => void;
  notifyCatalogChanged: () => void;
  registerPersistFlush: (fn: (() => Promise<void>) | null) => void;
  flushPersist: () => Promise<void>;
  registerRestoreWaiter: (fn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null) => void;
  waitForRestore: (targetProjectId?: string, targetChartId?: string) => Promise<void>;
}

const CurrentProjectContext = createContext<CurrentProjectContextValue | null>(null);

let sharedStore: ChartProjectStore | null = null;
let sharedSession: CurrentProjectSession | null = null;

function storeFor(store?: ChartProjectStore): ChartProjectStore {
  if (store) return store;
  if (!sharedStore) sharedStore = new ChartProjectStore();
  return sharedStore;
}

function sessionFor(store: ChartProjectStore, injected?: ChartProjectStore): CurrentProjectSession {
  if (injected) return new CurrentProjectSession(store);
  if (!sharedSession) sharedSession = new CurrentProjectSession(store);
  return sharedSession;
}

export function CurrentProjectProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: ChartProjectStore;
}) {
  const storeRef = useRef<ChartProjectStore | null>(null);
  if (storeRef.current == null) storeRef.current = storeFor(store);
  const sessionRef = useRef<CurrentProjectSession | null>(null);
  if (sessionRef.current == null) {
    sessionRef.current = sessionFor(storeRef.current, store);
  }
  const persistFlushRef = useRef<() => Promise<void>>(async () => {});
  const restoreWaiterRef = useRef<(targetProjectId?: string, targetChartId?: string) => Promise<void>>(async () => {});
  const [projectId, setProjectId] = useState<string | null>(() => sessionRef.current!.projectId);
  const [chartId, setChartId] = useState<string | null>(() => sessionRef.current!.chartId);
  const [catalogEpoch, setCatalogEpoch] = useState(0);

  // 启动预载目录（issue 29）：本 Provider 在应用启动时即挂载，早于各页 lazy chunk 加载 ——
  // 先发起一次 list()，工程页挂载时要么已就绪、要么共享同一个进行中 Promise（去重在 ChartProjectStore）。
  // 不让"页面挂载"成为读盘的起点。读失败不抛给启动流程：页面自己的 reload 会照常暴露错误。
  useEffect(() => {
    void storeRef.current!.list().catch(() => {});
  }, []);

  const notifyCatalogChanged = useCallback(() => {
    setCatalogEpoch((n) => n + 1);
  }, []);

  const ensure = useCallback(async () => {
    const result = await sessionRef.current!.ensure();
    setProjectId(result.project.id);
    setChartId(result.chart.id);
    // issue 10：新建未命名工程也要通知目录。ProjectsPage 是保活挂载、只在 catalogEpoch
    // 变化时 reload；单纯 open 已有工程不通知（否则每次进工作台都白拉一次列表）。
    if (result.created) notifyCatalogChanged();
    return result;
  }, [notifyCatalogChanged]);

  const open = useCallback(async (nextProjectId: string, nextChartId?: string) => {
    const result = await sessionRef.current!.open(nextProjectId, nextChartId);
    setProjectId(result.project.id);
    setChartId(result.chart.id);
    return result;
  }, []);

  const reset = useCallback(() => {
    sessionRef.current!.reset();
    setProjectId(null);
    setChartId(null);
  }, []);

  const registerPersistFlush = useCallback((fn: (() => Promise<void>) | null) => {
    persistFlushRef.current = fn ?? (async () => {});
  }, []);

  const flushPersist = useCallback(() => persistFlushRef.current(), []);

  const registerRestoreWaiter = useCallback((fn: ((targetProjectId?: string, targetChartId?: string) => Promise<void>) | null) => {
    restoreWaiterRef.current = fn ?? (async () => {});
  }, []);

  const waitForRestore = useCallback(
    (targetProjectId?: string, targetChartId?: string) => restoreWaiterRef.current(targetProjectId, targetChartId),
    [],
  );

  const value = useMemo(
    () => ({
      projectId,
      chartId,
      store: storeRef.current!,
      catalogEpoch,
      ensure,
      open,
      reset,
      notifyCatalogChanged,
      registerPersistFlush,
      flushPersist,
      registerRestoreWaiter,
      waitForRestore,
    }),
    [
      projectId,
      chartId,
      catalogEpoch,
      ensure,
      open,
      reset,
      notifyCatalogChanged,
      registerPersistFlush,
      flushPersist,
      registerRestoreWaiter,
      waitForRestore,
    ],
  );
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export function useCurrentProject(): CurrentProjectContextValue {
  const ctx = useContext(CurrentProjectContext);
  if (!ctx) throw new Error('useCurrentProject must be used within CurrentProjectProvider');
  return ctx;
}
