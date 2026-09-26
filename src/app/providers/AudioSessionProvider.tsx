// AudioSessionContext（架构深化评审候选 3 收口）：
// 把"音频域"的单一深模块（AudioSession）经 React 树共享给工作台 + 音频页。
//
// 与旧 AudioPageContext 的本质区别：
//   - 旧：useAudioBridge 把 7 个薄字段注册进 context，AudioPage 调用 importAudio/clearAudio 时
//         是"桥接"——每次状态变化都重新注册 api 对象，跨组件 ref 协议；
//   - 新：context 只持有一个稳定的 AudioSession 实例（单例），工作台与音频页都朝它直接调用，
//         AudioPage 看到的不是"音频页 API"，而是真正的音频会话模块——桥接消失。
//
// 接缝：useAudioSession() 返回的是深模块的 snapshot + 操作集合，单一接缝。
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioSession, type AudioSessionSnapshot } from '../../audio/AudioSession';

const AudioSessionContext = createContext<AudioSession | null>(null);

/** Provider：必须放在 ConfigProvider 之后（keySetId/seVolume 来自 settings.audio）。 */
export function AudioSessionProvider({
  session,
  children,
}: {
  session: AudioSession;
  children: ReactNode;
}) {
  return <AudioSessionContext.Provider value={session}>{children}</AudioSessionContext.Provider>;
}

/**
 * 消费音频会话：返回 [snapshot, session]。
 * snapshot = 当前状态（响应式：session 内状态变化会触发本组件 setState）；
 * session = 深模块实例本身，用于调用方法（importAudio/clearAudio/setKeySetId 等）。
 */
export function useAudioSession(): [AudioSessionSnapshot, AudioSession] {
  const session = useContext(AudioSessionContext);
  if (!session) throw new Error('useAudioSession must be used within AudioSessionProvider');
  // 用 ref 缓存上一个 snapshot，避免初次渲染时多触发一次 setState
  const [snapshot, setSnapshot] = useState<AudioSessionSnapshot>(() => session.getSnapshot());
  const lastSnapRef = useRef(snapshot);
  useEffect(() => {
    // 初次同步一次（防止 Provider 期间外部已 emit 过）
    const initial = session.getSnapshot();
    if (!shallowEqual(lastSnapRef.current, initial)) {
      lastSnapRef.current = initial;
      setSnapshot(initial);
    }
    const unsub = session.subscribe((next) => {
      if (shallowEqual(lastSnapRef.current, next)) return;
      lastSnapRef.current = next;
      setSnapshot(next);
    });
    return unsub;
  }, [session]);
  return [snapshot, session];
}

function shallowEqual(a: AudioSessionSnapshot, b: AudioSessionSnapshot): boolean {
  return (
    a.audioName === b.audioName &&
    a.audioError === b.audioError &&
    a.chartDuration === b.chartDuration &&
    a.audioDuration === b.audioDuration &&
    a.hasAudio === b.hasAudio &&
    a.keySetId === b.keySetId &&
    a.seVolume === b.seVolume &&
    a.audioLocked === b.audioLocked
  );
}
