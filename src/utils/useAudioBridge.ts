// useAudioBridge（候选 2 / 架构深化评审候选 2 / issue 27 / 28 Q15/Q16）：
// 音频会话流 = 导入/清除/错误暴露 + 音频页桥接 + 时长同步。
// 拆出 Editor.tsx 内 ~50 行 importAudio/clearAudio + audioDataRef + audioError + 时长刷新 + 注册 AudioPageContext。
//
// 行为保持：
//   - 加载 File → engine.load → 成功：记 audioName/audioBlob、按音频时长刷新谱面时长、persist、canPlay=true
//   - 失败：canPlay=false + 错误消息（音频页内联横幅用，issue 28 Q15）
//   - 清除 → 回到无音频态，时长保留当前值
//   - 注册到 AudioPageContext：音频页通过 useAudioPage 读到相同 api 引用
//   - 时长变化回调：onDurationChange（无音频时手动调整）
//   - keyset/SE 音量挂载即应用：setKeySet + setVolume + setSeVolume（issue 39 #7 独立 SE 音量）
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from './AudioEngine';
import { keySoundSetById } from './KeySound';
import { useAudioPageRegister, type AudioPageApi } from '../contexts/AudioPageContext';

export interface UseAudioBridgeOptions {
  /** 注入引擎（必传，候选 2 拆出 hook 时由 Editor 持有引擎单例） */
  engine: AudioEngine | null;
  /** 当前谱面时长（秒） */
  ctxDuration: number;
  /** 谱面时长 setter（与 setCtxDuration 配套） */
  setCtxDuration: (sec: number) => void;
  /** 同步时长到编辑器（= setCtxDuration + durationRef.current=sec，候选 2 拆出） */
  onDurationChange: (sec: number) => void;
  /** 加载/清除后立即落盘（候选 2 拆出 useChartProjectPersistence.saveNow） */
  onPersistNow: () => void | Promise<void>;
  /** 引擎 setChart（按键音事件）：与播放/编辑路径联动 */
  onAfterChange?: (audioName: string | null) => void;
  /** 设置（来源 ConfigContext.audio.keySet / audio.seVolume） */
  keySetId: string;
  seVolume: number;
  /** 引擎 setVolume（与 ctxVolume 同步） */
  ctxVolume: number;
  /** 播放状态 setter（isPlaying / canPlay） */
  setCanPlay: (v: boolean) => void;
  setIsPlaying: (v: boolean) => void;
}

export interface UseAudioBridgeReturn {
  /** 当前音频文件名（无音频为 null） */
  audioName: string | null;
  /** 加载/解码失败错误（issue 28 Q15：音频页内联横幅） */
  audioError: string | null;
  importAudio: (file: File) => void;
  clearAudio: () => void;
  dismissError: () => void;
  /** 暴露给 AudioPageContext 的 api（hook 内部已注册；外部也可直接拿到引用传给其它消费者） */
  api: AudioPageApi;
}

export function useAudioBridge(opts: UseAudioBridgeOptions): UseAudioBridgeReturn {
  const {
    engine, ctxDuration, onDurationChange, onPersistNow, keySetId, seVolume, ctxVolume,
    setCanPlay, setIsPlaying,
  } = opts;

  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // 音频 Blob 引用（持久化用，与原 audioDataRef 语义一致）
  const audioDataRef = useRef<{ audioName?: string; audioBlob?: Blob }>({});

  const importAudio = useCallback((file: File) => {
    if (!engine) return;
    setAudioError(null);
    engine.load(file)
      .then(() => {
        audioDataRef.current = { audioName: file.name, audioBlob: file };
        setAudioName(file.name);
        // bug 34：换音频时无论 canPlay 是否已 true 都直接按新音频时长刷新谱面时长
        const ad = engine.duration;
        if (ad != null) onDurationChange(ad);
        void onPersistNow();
        setCanPlay(true);
        setIsPlaying(false);
      })
      .catch((err: unknown) => {
        setCanPlay(false);
        setIsPlaying(false);
        setAudioError(err instanceof Error && err.message ? err.message : '该文件无法解码为音频，请更换文件后重试。');
      });
  }, [engine, onDurationChange, onPersistNow, setCanPlay, setIsPlaying]);

  const clearAudio = useCallback(() => {
    engine?.clear();
    audioDataRef.current = {};
    setAudioName(null);
    setAudioError(null);
    setCanPlay(false);
    setIsPlaying(false);
    void onPersistNow();
  }, [engine, onPersistNow, setCanPlay, setIsPlaying]);

  const dismissError = useCallback(() => setAudioError(null), []);

  // 初始化：把激活素材/音量/SE 音量应用到引擎（issue 39 #7 SE 音量独立于主音量）
  useEffect(() => {
    engine?.setKeySet(keySoundSetById(keySetId));
  }, [engine, keySetId]);
  useEffect(() => {
    engine?.setVolume(ctxVolume);
  }, [engine, ctxVolume]);
  useEffect(() => {
    engine?.setSeVolume(seVolume);
  }, [engine, seVolume]);

  // 暴露给 AudioPageContext 的 api 对象（每次变化都重注册以反映 audioName/error/ctxDuration）
  const api: AudioPageApi = {
    audioName,
    duration: ctxDuration,
    error: audioError,
    importAudio,
    clearAudio,
    dismissError,
    onDurationChange,
  };
  const registerAudioApi = useAudioPageRegister();
  useEffect(() => {
    registerAudioApi(api);
    return () => registerAudioApi(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioName, audioError, ctxDuration]);

  return { audioName, audioError, importAudio, clearAudio, dismissError, api };
}
