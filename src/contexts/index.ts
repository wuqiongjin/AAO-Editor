// Context 统一出口（ADR-0003 §7）：Editing/UI/Config 三域
// PlaybackContext（播放编排状态）作为 editor-only 补充，不属 ADR-0003 三域之一
// AudioSessionContext（候选 3 收口）：音频域深模块的 React 入口；详见 ./AudioSessionContext.tsx

// 注：ChartPosition 已迁至 src/types/chart.ts（issue 48 跨域类型抽离），
// 跨域消费方请直接 import { type ChartPosition } from '../types/chart'（或更短 'src/types'）。

export { EditingProvider, useEditing } from './EditingContext';
export type { EditingContextValue } from './EditingContext';
export { UIProvider, useUI } from './UIContext';
export type { UIContextValue } from './UIContext';
export { ConfigProvider, useConfig } from './ConfigContext';
export type { ConfigContextValue } from './ConfigContext';
export { PlaybackProvider, usePlayback } from './PlaybackContext';
export type { PlaybackContextValue } from './PlaybackContext';
export { AudioSessionProvider, useAudioSession } from './AudioSessionContext';
