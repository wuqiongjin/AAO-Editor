// ProviderTree（ADR-0003 §7 上下文分域，issue 48 整改）：
// 装配 5 个跨域根状态 Provider。
// 装配顺序：Config（最外层，主题/快捷键几乎被所有 Provider 依赖）
//        → AudioSessionRoot（音频会话深模块的 React 入口，需读 useConfig() 拿 keySet/seVolume）
//        → Playback（播放编排状态）
//        → UI（工作台 UI 状态）
//        → Editing（最内层，选区/历史最终被画布消费）
//
// 详见 /workspace/.scratch/basic-editor/issues/48-src-目录整改与按域重组.md
import type { ReactNode } from 'react';
import { ConfigProvider } from './providers/ConfigProvider';
import { UIProvider } from './providers/UIProvider';
import { EditingProvider } from './providers/EditingProvider';
import { PlaybackProvider } from './providers/PlaybackProvider';
import { AudioSessionRoot } from './providers/AudioSessionRoot';

export { useConfig } from './providers/ConfigProvider';
export type { ConfigContextValue } from './providers/ConfigProvider';
export { useUI } from './providers/UIProvider';
export type { UIContextValue } from './providers/UIProvider';
export { useEditing } from './providers/EditingProvider';
export type { EditingContextValue } from './providers/EditingProvider';
export { usePlayback } from './providers/PlaybackProvider';
export type { PlaybackContextValue } from './providers/PlaybackProvider';
export { useAudioSession } from './providers/AudioSessionProvider';

export function ProviderTree({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <AudioSessionRoot>
        <PlaybackProvider>
          <UIProvider>
            <EditingProvider>{children}</EditingProvider>
          </UIProvider>
        </PlaybackProvider>
      </AudioSessionRoot>
    </ConfigProvider>
  );
}
