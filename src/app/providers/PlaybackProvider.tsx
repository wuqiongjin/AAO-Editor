// PlaybackContext（ADR-0003 §7 之外的「播放编排」状态）：
// AudioEngine 仍由 Editor 持有并通过 ref 暴露，但播放相关状态（isPlaying / canPlay / currentSeconds / duration / volume）
// 在 Toolbar 与工作台各处之间共享——避免 Editor 反复作为 prop relay。
// Editor 仍是播放编排者（RAF 循环、音频解码、键音切换），本 Context 仅承载状态与最薄的 setter。
// chart-preview 22 起 PlayBar 本身不再直读本 Context：工作台在页面层取值后经 props 传入
// （预览页的播放条是同一个组件、接自己那份回放状态，两处共用外观与交互、不共用数据源）。
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_CHART_DURATION_SECONDS } from '../../audio/chartDuration';

export interface PlaybackContextValue {
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  canPlay: boolean;
  setCanPlay: (v: boolean) => void;
  currentSeconds: number;
  setCurrentSeconds: (v: number) => void;
  duration: number;
  setDuration: (v: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  // 注：`hasMarker` 派生字段已删（2026-09-10，issue 70 切片 9）—— 全仓无人消费，
  // 需要判空直接用 `markerSeconds !== null`，不必多一份派生 state。
  // issue 152：起点是**时间轴锚定**，单位就是秒（不是拍，也不再需要拍→秒换算）。
  markerSeconds: number | null;
  setMarker: (seconds: number | null) => void;
}

export type PlaybackStateContextValue = Omit<PlaybackContextValue, 'currentSeconds'>;

const PlaybackStateContext = createContext<PlaybackStateContextValue | null>(null);
const PlaybackSecondsContext = createContext<number>(0);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [duration, setDuration] = useState(DEFAULT_CHART_DURATION_SECONDS);
  const [volume, setVolume] = useState(0.8);
  const [markerSeconds, setMarkerSecondsState] = useState<number | null>(null);

  const setMarker = useCallback((seconds: number | null) => {
    setMarkerSecondsState(seconds);
  }, []);

  const stateValue = useMemo<PlaybackStateContextValue>(() => ({
    isPlaying, setIsPlaying,
    canPlay, setCanPlay,
    setCurrentSeconds,
    duration, setDuration,
    volume, setVolume,
    markerSeconds,
    setMarker,
  }), [isPlaying, canPlay, duration, volume, markerSeconds, setMarker]);

  return (
    <PlaybackStateContext.Provider value={stateValue}>
      <PlaybackSecondsContext.Provider value={currentSeconds}>
        {children}
      </PlaybackSecondsContext.Provider>
    </PlaybackStateContext.Provider>
  );
}

/**
 * issue 188：只订阅播放静态/控制状态（isPlaying / canPlay / duration / volume / markerSeconds），
 * 不订阅 80ms 节流刷新的 currentSeconds，避免画布主体等重组件在播放期周期性重渲染。
 */
export function usePlaybackState(): PlaybackStateContextValue {
  const ctx = useContext(PlaybackStateContext);
  if (!ctx) throw new Error('usePlaybackState must be used within PlaybackProvider');
  return ctx;
}

export function usePlayback(): PlaybackContextValue {
  const state = useContext(PlaybackStateContext);
  const currentSeconds = useContext(PlaybackSecondsContext);
  if (!state) throw new Error('usePlayback must be used within PlaybackProvider');
  return useMemo(() => ({ ...state, currentSeconds }), [state, currentSeconds]);
}

