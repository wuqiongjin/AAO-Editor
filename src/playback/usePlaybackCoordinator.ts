// usePlaybackCoordinator（候选 2 / 架构深化评审候选 2 / ADR-0004 §1/§2/§3/§4）：
// 播放会话流 = RAF 滚动跟随 + togglePlay/seek/jumpToMarker + 与 PlaybackScrollModel 协作。
// 拆出 Editor.tsx 内 ~100 行的播放编排代码。
//
// 行为保持：
//   - togglePlay：若已播则 stop；否则从 0 seek 后 engine.play() + 启动 RAF
//   - RAF 循环：每帧 engine.getSeconds() → 画布 setScrollY + 滚动条 scrollTop（按 PlaybackScrollModel 互映）
//   - seek：clamp 到 [0, duration]、engine.seek + setCurrentSeconds + 画布跟随
//   - jumpToMarker：mark→beat→sec 转换 + 启动播放
//   - deleteMarkerIfSelected：标记选中态与音符选择互斥，Delete 优先删标记
//   - isPlaying 时完全锁定滚动条（onScroll 已在 Editor 侧判 isPlayingRef）
//   - 卸载自动 stopPlayback（防止挂载在其他页时仍在跑 RAF）
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';
import type { PlaybackScrollModel } from './PlaybackScrollModel';
import { getBpmEvents, beatToSeconds } from '../audio/AudioTiming';
import { MAX_DURATION_SECONDS } from '../chart/config/AppSettings';
import type { ChartNote } from '../chart/types';
import type { FinalVirtualCanvasHandle } from '../chart/components/canvas/FinalVirtualCanvas';

export interface UsePlaybackCoordinatorOptions {
  /** 引擎单例（Editor 持有） */
  engine: AudioEngine | null;
  /** 滚动模型（候选 1 拆出的 PlaybackScrollModel 单例） */
  scrollModel: PlaybackScrollModel | null;
  /** 滚动条容器 ref（chartAreaRef） */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  /** 画布 imperative ref（virtualCanvasRef） */
  canvasRef: React.RefObject<FinalVirtualCanvasHandle | null>;
  /** 当前谱面时长（秒） */
  ctxDuration: number;
  /** 设置谱面时长 */
  setCtxDuration: (sec: number) => void;
  /** 当前播放头秒数（写回 PlaybackContext） */
  setCurrentSeconds: (sec: number) => void;
  /** 播放状态（写回 PlaybackContext） */
  setIsPlaying: (v: boolean) => void;
  /** 当前 notes（jumpToMarker 用 BPM 换算） */
  notes: ChartNote[];
}

export interface UsePlaybackCoordinatorReturn {
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (sec: number) => void;
  jumpToMarker: () => void;
  deleteMarkerIfSelected: () => boolean;
  /** 编辑时长（无音频时手动调整，issue 22 §4 / ADR-0005 §4） */
  changeDuration: (sec: number) => void;
  /** 手动停止（页面失活时） */
  stopPlayback: () => void;
}

export function usePlaybackCoordinator(opts: UsePlaybackCoordinatorOptions): UsePlaybackCoordinatorReturn {
  const {
    engine, scrollModel, scrollContainerRef, canvasRef,
    ctxDuration, setCtxDuration, setCurrentSeconds, setIsPlaying, notes,
  } = opts;

  const [isPlaying, setIsPlayingState] = useState(false);
  const playbackRafRef = useRef<number | undefined>(undefined);
  const isPlayingRef = useRef(false);
  // ctxDuration 走 ref：RAF 循环不依赖 React state 重新创建
  const durationRef = useRef(ctxDuration);
  durationRef.current = ctxDuration;
  // notes 走 ref：jumpToMarker 不需要闭包过期
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlayingState(false);
    scrollModel?.setPlaying(false);
    canvasRef.current?.setPlaybackActive?.(false);
    if (playbackRafRef.current !== undefined) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = undefined;
    }
    engine?.pause();
    setIsPlaying(false);
  }, [engine, scrollModel, setIsPlaying, canvasRef]);

  const startPlaybackLoop = useCallback(() => {
    if (playbackRafRef.current !== undefined) cancelAnimationFrame(playbackRafRef.current);
    isPlayingRef.current = true;
    setIsPlayingState(true);
    scrollModel?.setPlaying(true);
    canvasRef.current?.setPlaybackActive?.(true);
    const loop = () => {
      if (!isPlayingRef.current) return;
      const e = engine;
      const canvas = canvasRef.current;
      const model = scrollModel;
      if (!e || !canvas || !model) return;
      const current = e.getSeconds();
      setCurrentSeconds(current);
      if (current >= durationRef.current) {
        stopPlayback();
        return;
      }
      const container = scrollContainerRef.current as HTMLDivElement | null;
      const maxScroll = container ? container.scrollHeight - container.clientHeight : 0;
      const { scrollY, scrollTop } = model.scrollTargetForSeconds(current, maxScroll);
      canvas.setScrollY(scrollY);
      if (container && Math.abs(scrollTop - container.scrollTop) > 0.5) {
        container.scrollTop = scrollTop;
      }
      e.tick();
      playbackRafRef.current = requestAnimationFrame(loop);
    };
    playbackRafRef.current = requestAnimationFrame(loop);
  }, [engine, scrollModel, canvasRef, scrollContainerRef, setCurrentSeconds, stopPlayback]);

  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (engine.isPlaying) {
      stopPlayback();
      return;
    }
    if (engine.getSeconds() >= durationRef.current) {
      engine.seek(0);
    }
    void engine.play().then(() => {
      setIsPlaying(true);
      startPlaybackLoop();
    });
  }, [engine, startPlaybackLoop, stopPlayback, setIsPlaying]);

  const seek = useCallback((sec: number) => {
    if (!engine) return;
    const clamped = Math.max(0, Math.min(sec, durationRef.current));
    engine.seek(clamped);
    setCurrentSeconds(clamped);
    const canvas = canvasRef.current;
    const model = scrollModel;
    const container = scrollContainerRef.current as HTMLDivElement | null;
    if (canvas && model) {
      // issue 75：滚动条 DOM scrollTop 必须与画布**同源**写入（与 RAF 循环同一口径）。
      // 此前 seek 只推画布，滚动条停在旧位置；切页回来第一次滚动就用陈旧 scrollTop
      // 反算 scrollY，把画布拉回旧播放位置。
      const maxScroll = container ? container.scrollHeight - container.clientHeight : 0;
      const { scrollY, scrollTop } = model.scrollTargetForSeconds(clamped, maxScroll);
      canvas.setScrollY(scrollY);
      if (container && Math.abs(scrollTop - container.scrollTop) > 0.5) {
        container.scrollTop = scrollTop;
      }
    }
    if (!engine.isPlaying) {
      stopPlayback();
    }
  }, [engine, scrollModel, canvasRef, scrollContainerRef, setCurrentSeconds, stopPlayback]);

  const jumpToMarker = useCallback(() => {
    const e = engine;
    const canvas = canvasRef.current;
    if (!e || !canvas) return;
    const beat = canvas.getMarkerBeat?.();
    if (beat == null) return;
    const secs = beatToSeconds(getBpmEvents(notesRef.current), beat);
    e.seek(secs);
    if (!e.isPlaying) {
      void e.play().then(() => {
        setIsPlaying(true);
        startPlaybackLoop();
      });
    }
  }, [engine, canvasRef, startPlaybackLoop, setIsPlaying]);

  const deleteMarkerIfSelected = useCallback((): boolean => {
    const canvas = canvasRef.current;
    if (!canvas?.getMarkerSelected?.()) return false;
    canvas.clearMarker?.();
    return true;
  }, [canvasRef]);

  const changeDuration = useCallback((sec: number) => {
    if (!(sec > 0)) return;
    const clamped = Math.min(sec, MAX_DURATION_SECONDS); // issue 28 P6 上限 30 分钟
    setCtxDuration(clamped);
    durationRef.current = clamped;
  }, [setCtxDuration]);

  // 卸载自动停播放（防止页面失活但 hook 仍存活时 RAF 漏跑）
  useEffect(() => () => { stopPlayback(); }, [stopPlayback]);

  return {
    isPlaying,
    togglePlay,
    seek,
    jumpToMarker,
    deleteMarkerIfSelected,
    changeDuration,
    stopPlayback,
  };
}
