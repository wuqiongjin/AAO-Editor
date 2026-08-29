// useAudioBridge（架构深化评审候选 3 收口后的薄壳）：
// 把旧 useAudioBridge（候选 2 拆出的 hook）改为对 AudioSession 深模块的薄响应层。
// 行为完全保留：调用方拿到 audioName / audioError / importAudio / clearAudio / dismissError；
// 内部实现改为：订阅 session 的 snapshot 变化，方法直接转发到 session。
//
// 收口点：
//   - 不再持有 audioName / audioError state（session 是单一真相源）
//   - 不再注册 AudioPageContext（session 本身就是接缝，音频页 useAudioSession 直读）
//   - 不再"按 ctxDuration 变化重注册 api"——session 是稳定单例
//   - 不再需要 onPersistNow 外部传（session.setPersistNow 一次性注入，导入/清除时自动调）
//
// Editor 侧只需改：把"engine 单独持有"改为"取 session.getEngine() 引用"；
// 把"setCtxDuration 当 setter"改为"session.setChartDuration() + 写回 PlaybackContext"——
// 让 session 与 PlaybackContext 在 Editor 处单向同步（chartDuration 由 session 决定，PlaybackContext
// 仍承载 currentSeconds/isPlaying/canPlay/volume 播放编排状态）。
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { AudioSession } from './AudioSession';

export interface UseAudioBridgeOptions {
  /** 音频会话深模块（必传；通常经 useAudioSession() 或 App.tsx 注入） */
  session: AudioSession;
  /** 谱面时长变化时回调（把 session 的 chartDuration 写回 PlaybackContext） */
  onChartDurationChange: (sec: number) => void;
  /** canPlay 变化时回调（session.hasAudio 同步到 PlaybackContext.canPlay） */
  onCanPlayChange: (v: boolean) => void;
  /** isPlaying 变化时回调（导入音频时强制重置 isPlaying） */
  onIsPlayingChange: (v: boolean) => void;
}

export interface UseAudioBridgeReturn {
  audioName: string | null;
  audioError: string | null;
  importAudio: (file: File) => void;
  clearAudio: () => void;
  dismissError: () => void;
}

export function useAudioBridge(opts: UseAudioBridgeOptions): UseAudioBridgeReturn {
  const { session, onChartDurationChange, onCanPlayChange, onIsPlayingChange } = opts;

  // 用 session.getSnapshot() 取初值，再用 useState + subscribe 保持响应
  const [snap, setSnap] = useState(() => session.getSnapshot());
  useEffect(() => session.subscribe(setSnap), [session]);

  // 副作用：把 snapshot 关键字段写回 PlaybackContext（单向：session → context）
  // 1) chartDuration 变化 → 写回（issue 34：有音频=音频时长）
  useEffect(() => {
    onChartDurationChange(snap.chartDuration);
  }, [snap.chartDuration, onChartDurationChange]);
  // 2) hasAudio 变化 → 写回 canPlay
  useEffect(() => {
    onCanPlayChange(snap.hasAudio);
  }, [snap.hasAudio, onCanPlayChange]);
  // 3) 导入/清除 → 强制 isPlaying=false（保持与原 useAudioBridge 行为一致）
  // 用 ref 跟踪上一次 hasAudio 状态，只在变化时触发；初值取自 snapshot.hasAudio（避免挂载即触发）
  const lastHasAudioRef = useRef<boolean>(snap.hasAudio);
  useEffect(() => {
    if (lastHasAudioRef.current !== snap.hasAudio) {
      lastHasAudioRef.current = snap.hasAudio;
      onIsPlayingChange(false);
    }
  }, [snap.hasAudio, onIsPlayingChange]);

  // 转发到 session（用 useCallback 保引用稳定，避免下游 effect 重复触发）
  const importAudio = useCallback((file: File) => session.importAudio(file), [session]);
  const clearAudio = useCallback(() => session.clearAudio(), [session]);
  const dismissError = useCallback(() => session.dismissError(), [session]);

  return useMemo(() => ({
    audioName: snap.audioName,
    audioError: snap.audioError,
    importAudio,
    clearAudio,
    dismissError,
  }), [snap.audioName, snap.audioError, importAudio, clearAudio, dismissError]);
}
