// NowProvider（issue 36）：relTime 的「N 分钟前」要随时间自己走。
//
// 根因（票 31 验收现场）：relTime(at, now = Date.now()) 渲染时求值一次，hub / 详情两页
// 没有定时器驱动重渲染 —— 切走再切回来才变。修法是单一共享 ticker：整个应用一个 timer，
// 全部消费方经 context 读同一个 now；别在调用点各自 setInterval（一处一个 timer 正是
// 本票要防的形态，锁测见 tests/dom/RelTimeTicker.test.tsx）。
//
// 间隔 30s：relTime 最小可见档是分钟（issue 31），30s 让跨档在一分钟内翻转，
// 又不至于让整页高频重渲染。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** 共享 ticker 的间隔：30s（issue 36）。 */
export const NOW_TICK_MS = 30_000;

const NowContext = createContext<number | null>(null);

export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // 单一 timer：value 一涨，context 下全部消费方一起重渲染
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

/** 读共享 ticker 的当前 now。relTime 调用点传它，别用 Date.now() 默认参。 */
export function useNow(): number {
  const now = useContext(NowContext);
  if (now === null) throw new Error('useNow must be used within NowProvider');
  return now;
}
