// 工作台与预览页「显示面板」同质下拉选项的收敛常量（issue 206）
// 范围窄收敛：严格限制于显示面板内部（WorkspaceDisplayPanel & PreviewDisplayPanel），
// 不扩散至工程页 / 选曲页等业务面板。
import type { AppSettings } from '../chart/config/AppSettings';
import { GRID_STYLE_PRESETS, type GridStylePreset } from '../rendering/gridStyle';
import { t, type MessageKey } from '../i18n';

/** 画质档选项（映射至 settings.imageQuality.* 键） */
export const QUALITY_OPTIONS: ReadonlyArray<{
  value: AppSettings['display']['imageQuality'];
  labelKey: MessageKey;
}> = (['smooth', 'standard', 'hd'] as const).map((value) => ({
  value,
  labelKey: `settings.imageQuality.${value}` as MessageKey,
}));

/** 轨道颜色主题选项（从 GRID_STYLE_PRESETS 派生，映射至 settings.gridStyle.* 键） */
export const GRID_OPTIONS: ReadonlyArray<{
  value: GridStylePreset;
  labelKey: MessageKey;
}> = GRID_STYLE_PRESETS.map((value) => ({
  value,
  labelKey: `settings.gridStyle.${value}` as MessageKey,
}));

/** 构造随当前语言响应的画质档选项列表 */
export function buildQualityOptions(): ReadonlyArray<{
  value: AppSettings['display']['imageQuality'];
  label: string;
}> {
  return QUALITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
}

/** 构造随当前语言响应的轨道主题选项列表 */
export function buildGridOptions(): ReadonlyArray<{
  value: GridStylePreset;
  label: string;
}> {
  return GRID_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
}
