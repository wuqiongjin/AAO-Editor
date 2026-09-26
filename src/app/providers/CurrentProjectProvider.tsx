// CurrentProjectProvider（chart-projects 03 / ADR-0015 §3）：
// 会话内唯一当前工程 + 当前谱面。进工作台/音频页时 ensure；切工程走 open。
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '../../chart/project/ChartProject';
import { CurrentProjectSession } from '../../chart/project/CurrentProjectSession';

export interface CurrentProjectContextValue {
  projectId: string | null;
  chartId: string | null;
  ensure: () => Promise<{ project: ChartProject; chart: ProjectChart; created: boolean }>;
  open: (projectId: string, chartId?: string) => Promise<{ project: ChartProject; chart: ProjectChart }>;
}

const CurrentProjectContext = createContext<CurrentProjectContextValue | null>(null);

let sharedSession: CurrentProjectSession | null = null;

function sessionFor(store?: ChartProjectStore): CurrentProjectSession {
  if (store) return new CurrentProjectSession(store);
  if (!sharedSession) sharedSession = new CurrentProjectSession(new ChartProjectStore());
  return sharedSession;
}

export function CurrentProjectProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: ChartProjectStore;
}) {
  const sessionRef = useRef<CurrentProjectSession | null>(null);
  if (sessionRef.current == null) {
    sessionRef.current = sessionFor(store);
  }
  const [projectId, setProjectId] = useState<string | null>(() => sessionRef.current!.projectId);
  const [chartId, setChartId] = useState<string | null>(() => sessionRef.current!.chartId);

  const ensure = useCallback(async () => {
    const result = await sessionRef.current!.ensure();
    setProjectId(result.project.id);
    setChartId(result.chart.id);
    return result;
  }, []);

  const open = useCallback(async (nextProjectId: string, nextChartId?: string) => {
    const result = await sessionRef.current!.open(nextProjectId, nextChartId);
    setProjectId(result.project.id);
    setChartId(result.chart.id);
    return result;
  }, []);

  const value = useMemo(
    () => ({ projectId, chartId, ensure, open }),
    [projectId, chartId, ensure, open],
  );
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export function useCurrentProject(): CurrentProjectContextValue {
  const ctx = useContext(CurrentProjectContext);
  if (!ctx) throw new Error('useCurrentProject must be used within CurrentProjectProvider');
  return ctx;
}
