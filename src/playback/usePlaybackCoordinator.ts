// usePlaybackCoordinator（候选 2 / 架构深化评审候选 2 / ADR-0004 §1/§2/§3/§4）：
// 播放会话流 = RAF 滚动跟随 + togglePlay/seek/jumpToMarker + 与 PlaybackScrollModel 协作。
// 拆出 Editor.tsx 内 ~100 行的播放编排代码。
//
// 行为保持：
//   - togglePlay：若已播则 stop；否则从 0 seek 后 engine.play() + 启动 RAF
//   - RAF 循环：每帧 engine.getSeconds() → 画布 setScrollY + 滚动条 scrollTop（按 PlaybackScrollModel 互映）
//   - seek：clamp 到 [0, duration]、engine.seek + setCurrentSeconds + 画布跟随
//   - jumpToMarker：起点存**秒**（issue 152），直接 seek + 启动播放，不再做拍→秒换算
//   - isPlaying 时完全锁定滚动条（onScroll 已在 Editor 侧判 isPlayingRef）
//   - 卸载自动 stopPlayback（防止挂载在其他页时仍在跑 RAF）
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';
import type { PlaybackScrollModel } from './PlaybackScrollModel';
import { MAX_DURATION_SECONDS } from '../chart/config/AppSettings';
import type { FinalVirtualCanvasHandle } from '../chart/components/canvas/FinalVirtualCanvas';

/** 播放 HUD（时间码 / 进度条 / 画布叠加）写入 React 的周期。约 12.5Hz，票面 10–15Hz。 */
export const PLAYBACK_HUD_PERIOD_MS = 80;

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
  /** 改谱面时长（无音频；走 AudioSession，PlaybackContext 由桥同步） */
  setChartDuration: (sec: number) => void;
  /** 当前播放头秒数（写回 PlaybackContext） */
  setCurrentSeconds: (sec: number) => void;
  /** 播放状态（写回 PlaybackContext） */
  setIsPlaying: (v: boolean) => void;
}

export interface UsePlaybackCoordinatorReturn {
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (sec: number) => void;
  jumpToMarker: () => void;
  /** 编辑时长（无音频时手动调整，issue 22 §4 / ADR-0005 §4） */
  changeDuration: (sec: number) => void;
  /** 手动停止（页面失活时） */
  stopPlayback: () => void;
}

export function usePlaybackCoordinator(opts: UsePlaybackCoordinatorOptions): UsePlaybackCoordinatorReturn {
  const {
    engine, scrollModel, scrollContainerRef, canvasRef,
    ctxDuration, setChartDuration, setCurrentSeconds, setIsPlaying,
  } = opts;

  const [isPlaying, setIsPlayingState] = useState(false);
  const playbackRafRef = useRef<number | undefined>(undefined);
  const isPlayingRef = useRef(false);
  const lastHudAtRef = useRef(0);
  // ctxDuration 走 ref：RAF 循环不依赖 React state 重新创建
  const durationRef = useRef(ctxDuration);
  durationRef.current = ctxDuration;

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
    if (engine) setCurrentSeconds(engine.getSeconds());
    setIsPlaying(false);
  }, [engine, scrollModel, setIsPlaying, setCurrentSeconds, canvasRef]);

  const startPlaybackLoop = useCallback(() => {
    if (playbackRafRef.current !== undefined) cancelAnimationFrame(playbackRafRef.current);
    isPlayingRef.current = true;
    setIsPlayingState(true);
    scrollModel?.setPlaying(true);
    canvasRef.current?.setPlaybackActive?.(true);
    lastHudAtRef.current = 0;
    const loop = () => {
      if (!isPlayingRef.current) return;
      const e = engine;
      const canvas = canvasRef.current;
      const model = scrollModel;
      if (!e || !canvas || !model) return;
      const current = e.getSeconds();
      const now = performance.now();
      if (now - lastHudAtRef.current >= PLAYBACK_HUD_PERIOD_MS) {
        lastHudAtRef.current = now;
        setCurrentSeconds(current);
      }
      if (current >= durationRef.current) {
        setCurrentSeconds(current);
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

  /** 启动播放的唯一入口（issue 152：togglePlay 与 jumpToMarker 共用，不再各写一份 play().then）。 */
  const startPlayback = useCallback(() => {
    if (!engine || engine.isPlaying) return;
    void engine.play().then(() => {
      setIsPlaying(true);
      startPlaybackLoop();
    });
  }, [engine, startPlaybackLoop, setIsPlaying]);

  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (engine.isPlaying) {
      stopPlayback();
      return;
    }
    if (engine.getSeconds() >= durationRef.current) {
      engine.seek(0);
    }
    startPlayback();
  }, [engine, startPlayback, stopPlayback]);

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

  /**
   * 回跳播放起点（ADR-0004 §4 / issue 152）：起点是**秒**，直接交给 `seek` ——
   * 因此继承它的 duration 夹取与 issue 75 的「滚动条 scrollTop 与画布同源写入」，
   * 不再自己 seek + 另起一份播放启动（旧实现回跳后滚动条不跟画布）。
   */
  const jumpToMarker = useCallback(() => {
    const seconds = canvasRef.current?.getMarkerSeconds?.();
    if (seconds == null) return;
    seek(seconds);
    startPlayback();
  }, [canvasRef, seek, startPlayback]);

  const changeDuration = useCallback((sec: number) => {
    if (!(sec > 0)) return;
    const clamped = Math.min(sec, MAX_DURATION_SECONDS); // issue 28 P6 上限 30 分钟
    setChartDuration(clamped);
    durationRef.current = clamped;
  }, [setChartDuration]);

  // 卸载自动停播放（防止页面失活但 hook 仍存活时 RAF 漏跑）
  useEffect(() => () => { stopPlayback(); }, [stopPlayback]);

  return {
    isPlaying,
    togglePlay,
    seek,
    jumpToMarker,
    changeDuration,
    stopPlayback,
  };
}
