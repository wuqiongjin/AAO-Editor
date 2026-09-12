// 素材页「音符皮肤」综合预览的**布局几何**（纯模块，node 可单测）。
// 从 NoteSkinPreview.tsx 抽出：react-refresh/only-export-components 不允许组件文件里导出函数
// （同 issue 86 把工具栏字形几何抽到 noteGlyph.ts 的先例）；issue 91 顺带把滑条 band 宽
// 从写死 22 改为锁真实画布口径 band:结点 = 30:36（与工具栏滑条字形共用 `SLIDE_BAND_TO_NODE_RATIO`）。
import { SLIDE_BAND_TO_NODE_RATIO } from '../../visual/noteMetrics';

/** 单格预览画布尺寸（CSS 同步；用 viewBox 概念，浏览器按 width 100% 缩放） */
export const PREVIEW_CELL_W = 140;
export const PREVIEW_CELL_H = 88;

/** 预览里滑条结点/端点精灵的放大倍数（设计宽 36 × 本值 = 绘制宽），布局与绘制共用同一份 */
export const SLIDE_PREVIEW_NODE_SCALE = 1.1;

/** Slide 列的预览布局（导出供测试）。竖向：上端点(起点) + 中间结点 + 下端点(终点) + 连接带。 */
export interface SlideColLayout {
  cx: number;
  cy: number;
  topY: number;
  midY: number;
  bottomY: number;
  bandW: number;
  bandH: number;
}
export function computeSlideColLayout(W: number, H: number): SlideColLayout {
  const cx = W * 0.5;
  const cy = H * 0.5;
  const half = Math.min(H * 0.36, 30);
  return {
    cx,
    cy,
    topY: cy - half,
    midY: cy,
    bottomY: cy + half,
    // issue 91：band 宽不再写死 22 —— 锁真实画布口径 band:结点 = 30:36（结点画 36×1.1）。
    // 旧值下中间结点超出带宽 1.8×；对齐后结点只按游戏内比例略微溢出带外。
    bandW: 36 * SLIDE_PREVIEW_NODE_SCALE * SLIDE_BAND_TO_NODE_RATIO,
    bandH: half * 2,
  };
}
