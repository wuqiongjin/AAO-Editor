// `settings.display` → 渲染显示参数（`RenderDisplayOptions`）的**唯一映射处**。
//
// 提取理由（chart-preview 03）：预览面板与工作台画布必须用同一套映射 —— 两处各写一份 8 字段的
// 对象字面量，加一个字段就会漏一处（预览的"显示档"正是叠在这一层之上的）。
// 只搬映射，不改语义：字段与工作台原先内联的那份逐项一致。
//
// issue 218 豁免说明（§Answer.3）：
// settings.display.judgeLineOffsetRatio 作用域【仅工作台画布】；静态预览面板、谱面图导出与
// 仿真场明确豁免（恒不偏移/贴底）。若工作台传入了经 surface.h 折算出的 judgeLineOffsetY，
// 则透传进 RenderDisplayOptions；未提供时恒为 undefined（保持贴底）。
import type { AppSettings } from '../settings/AppSettings';
import type { RenderDisplayOptions } from './types';

export function displayOptionsFromSettings(
  display: AppSettings['display'],
  overrides?: { judgeLineOffsetY?: number },
): RenderDisplayOptions {
  return {
    noteSize: display.noteSize,
    slideOpacity: display.slideOpacity,
    simultaneousClickLines: display.simultaneousClickLines,
    colorAssist: display.colorAssist,
    gridStyle: display.gridStyle,
    lineShapeTiers: display.lineShapeTiers,
    gridOpacity: display.gridOpacity,
    labelScale: display.labelScale,
    timePrecision: display.timePrecision,
    judgeLineOffsetY: overrides?.judgeLineOffsetY,
  };
}
