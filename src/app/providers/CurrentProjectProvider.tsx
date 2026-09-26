// CurrentProjectProvider（chart-projects 03 / ADR-0015 §3）：
// 会话内唯一当前工程 + 当前谱面。进工作台/音频页时 ensure；切工程走 open。
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '../../chart/project/ChartProject';
import { CurrentProjectSession } from '../../chart/project/CurrentProjectSession';

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
  const [projectId, setProjectId] = useState<string | null>(() => sessionRef.current!.projectId);
  const [chartId, setChartId] = useState<string | null>(() => sessionRef.current!.chartId);
  const [catalogEpoch, setCatalogEpoch] = useState(0);

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
    }),
    [projectId, chartId, catalogEpoch, ensure, open, reset, notifyCatalogChanged, registerPersistFlush, flushPersist],
  );
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export function useCurrentProject(): CurrentProjectContextValue {
  const ctx = useContext(CurrentProjectContext);
  if (!ctx) throw new Error('useCurrentProject must be used within CurrentProjectProvider');
  return ctx;
}
