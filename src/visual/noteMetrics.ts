/**
 * 音符图标尺寸常量 —— **唯一定义处**（零 import 的叶子模块）。
 *
 * 为什么单独抽文件：渲染（`render.ts`）与命中（`hitTest.ts`）必须用**同一份**尺寸 ——
 * 命中盒比墨迹大就会"离音符很远也亮起 hover"（issue 82 的根因正是命中半径取图标半宽 18、
 * 而墨迹纵向半高只有 10.8）。两者不能互相 import（render → hitTest 单向），
 * 故把尺寸下沉到本叶子模块：两侧都从这里取，改一处即同步。
 *
 * `render.ts` 仍 re-export 这些常量（既有引用不变）。
 */

/** 音符图标设计宽度（设计 px；实际像素 = 本值 × viewport.scale × noteSize） */
export const NOTE_ICON_SIZE = 36;
export const SLIDE_ICON_SIZE = 36;
export const DIRECTIONAL_ICON_SIZE = 45;

/** 音符墨迹高度比例（墨迹高 = 宽度 × 本值）：音符是"扁"的，纵向判定必须按墨迹而非宽度算 */
export const NOTE_HEIGHT_SCALE = 0.6;
export const SLIDE_HEIGHT_SCALE = 0.6;
export const DIRECTIONAL_HEIGHT_SCALE = 0.33;
