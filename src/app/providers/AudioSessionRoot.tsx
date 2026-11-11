// AudioSessionRoot（issue 47 收口，issue 48 整改迁位）：
// 音频会话深模块的 React 装配层。
// 1) 读 useConfig() 拿 settings.audio.keySet / seVolume / volume（票 60：主音量也来自 A）；
// 2) useMemo 创建单例 AudioSession；
// 3) 同步 settings → session（keySet/seVolume/volume 变化时，票 60 起主音量也进这条 effect）；
// 4) 注入 session.setSettingsPersist（让 session 内部 setter 调回 ConfigContext）；
// 5) 把 session 传给 AudioSessionProvider，共享给工作台 + 音频页。
//
// 接缝：单一 AudioSession 实例，工作台/音频页都朝它直接调用，桥接 context 消失。
import { useMemo, useEffect, type ReactNode } from 'react';
import { useConfig } from './ConfigProvider';
import { createAudioSession } from '../../audio/AudioSession';
import { DEFAULT_CHART_DURATION_SECONDS } from '../../audio/chartDuration';
import { AudioSessionProvider } from './AudioSessionProvider';

export function AudioSessionRoot({ children }: { children: ReactNode }) {
  const { settings, setKeySetId, setSeVolume } = useConfig();
  const session = useMemo(
    () =>
      createAudioSession({
        keySetId: settings.audio.keySet,
        seVolume: settings.audio.seVolume,
        volume: settings.audio.volume,
        chartDuration: DEFAULT_CHART_DURATION_SECONDS,
      }),
    // session 单例：只创建一次；后续 settings 变化走 useEffect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // 1) settings 从存储加载后或用户切换素材/SE/主音量时，同步到 session（含跨页改主音量）
  useEffect(() => {
    session.syncSettingsFromConfig(settings.audio.keySet, settings.audio.seVolume, settings.audio.volume);
  }, [session, settings.audio.keySet, settings.audio.seVolume, settings.audio.volume]);
  // 2) 把设置写回回调注入 session（session 内 setKeySetId/setSeVolume 自动调）
  useEffect(() => {
    session.setSettingsPersist({
      persistKeySet: setKeySetId,
      persistSeVolume: setSeVolume,
    });
  }, [session, setKeySetId, setSeVolume]);
  return <AudioSessionProvider session={session}>{children}</AudioSessionProvider>;
}
