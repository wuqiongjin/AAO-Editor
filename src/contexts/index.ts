// Context 统一出口（ADR-0003 §7）：Editing/UI/Config 三域
// PlaybackContext（播放编排状态）作为 editor-only 补充，不属 ADR-0003 三域之一
// AudioSessionContext（候选 3 收口）：音频域深模块的 React 入口；详见 ./AudioSessionContext.tsx

// H5 收口：唯一位置类型，跨 Editing/UI/FinalVirtualCanvas/ChartGeometry 全栈复用
// 字段顺序统一为 { beat, lane }，调用点不再有 {lane, beat} / {beat, lane} / {preciseBeat, lane} 的多版本
export interface ChartPosition {
  beat: number;
  lane: number;
}

export { EditingProvider, useEditing } from './EditingContext';
export type { EditingContextValue } from './EditingContext';
export { UIProvider, useUI } from './UIContext';
export type { UIContextValue } from './UIContext';
export { ConfigProvider, useConfig } from './ConfigContext';
export type { ConfigContextValue } from './ConfigContext';
export { PlaybackProvider, usePlayback } from './PlaybackContext';
export type { PlaybackContextValue } from './PlaybackContext';
export { AudioSessionProvider, useAudioSession } from './AudioSessionContext';
