// PlaybackContext（ADR-0003 §7 之外的「播放编排」状态）：
// AudioEngine 仍由 Editor 持有并通过 ref 暴露，但播放相关状态（isPlaying / canPlay / currentSeconds / duration / volume）
// 在 Toolbar、PlayBar 之间共享——避免 Editor 反复作为 prop relay。
// Editor 仍是播放编排者（RAF 循环、音频解码、键音切换），本 Context 仅承载状态与最薄的 setter。
import { createContext, useContext, useState, type ReactNode } from 'react';

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
  // 需要判空直接用 `markerBeat !== null`，不必多一份派生 state。
  markerBeat: number | null;
  setMarker: (beat: number | null) => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [duration, setDuration] = useState(30);
  const [volume, setVolume] = useState(0.8);
  const [markerBeat, setMarkerBeatState] = useState<number | null>(null);

  const setMarker = (beat: number | null) => {
    setMarkerBeatState(beat);
  };

  const value: PlaybackContextValue = {
    isPlaying, setIsPlaying,
    canPlay, setCanPlay,
    currentSeconds, setCurrentSeconds,
    duration, setDuration,
    volume, setVolume,
    markerBeat,
    setMarker,
  };
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error('usePlayback must be used within PlaybackProvider');
  return ctx;
}
