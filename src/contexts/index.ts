// Context 统一出口（ADR-0003 §7）：Editing/UI/Config 三域
export { EditingProvider, useEditing } from './EditingContext';
export type { EditingContextValue, Position as EditingPosition } from './EditingContext';
export { UIProvider, useUI } from './UIContext';
export type { UIContextValue, MousePos } from './UIContext';
export { ConfigProvider, useConfig } from './ConfigContext';
export type { ConfigContextValue } from './ConfigContext';