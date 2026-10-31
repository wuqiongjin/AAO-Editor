// ProviderTree（ADR-0003 §7 上下文分域，issue 48 整改）：
// 装配跨域根状态 Provider。
// 装配顺序：Config（最外层，主题/快捷键几乎被所有 Provider 依赖）
//        → CurrentProject（当前工程会话，进工作台/音频页时 ensure）
//        → AudioSessionRoot（音频会话深模块的 React 入口，需读 useConfig() 拿 keySet/seVolume）
//        → Playback（播放编排状态）
//        → UI（工作台 UI 状态）
//        → Editing（最内层，选区/历史最终被画布消费）
//        → Now（issue 36：relTime 的共享 ticker，无依赖，贴最内层即可）
//
// 详见 /workspace/.scratch/basic-editor/issues/48-src-目录整改与按域重组.md
import type { ReactNode } from 'react';
import { ConfigProvider } from './providers/ConfigProvider';
import { UIProvider } from './providers/UIProvider';
import { EditingProvider } from './providers/EditingProvider';
import { PlaybackProvider } from './providers/PlaybackProvider';
import { AudioSessionRoot } from './providers/AudioSessionRoot';
import { CurrentProjectProvider } from './providers/CurrentProjectProvider';
import { NowProvider } from './providers/NowProvider';

export { useConfig } from './providers/ConfigProvider';
export type { ConfigContextValue } from './providers/ConfigProvider';
export { useUI } from './providers/UIProvider';
export type { UIContextValue } from './providers/UIProvider';
export { useEditing } from './providers/EditingProvider';
export type { EditingContextValue } from './providers/EditingProvider';
export { usePlayback, usePlaybackState } from './providers/PlaybackProvider';
export type { PlaybackContextValue, PlaybackStateContextValue } from './providers/PlaybackProvider';
export { useAudioSession } from './providers/AudioSessionProvider';
export { useCurrentProject } from './providers/CurrentProjectProvider';
export type { CurrentProjectContextValue } from './providers/CurrentProjectProvider';
export { useNow, NOW_TICK_MS } from './providers/NowProvider';

export function ProviderTree({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <CurrentProjectProvider>
        <AudioSessionRoot>
          <PlaybackProvider>
            <UIProvider>
              <EditingProvider>
                <NowProvider>{children}</NowProvider>
              </EditingProvider>
            </UIProvider>
          </PlaybackProvider>
        </AudioSessionRoot>
      </CurrentProjectProvider>
    </ConfigProvider>
  );
}
