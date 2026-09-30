// 静态预览 = 面板折行全景（ADR-0016 §1.1），长图导出是它的副产物（§7）。
//
// 骨架：本票（chart-preview 02）只定"喂什么进去"的接缝——排布 / 懒绘制 / 导出链路进 03，
// 下面的形状是**占位契约**（03 落地时按真实需要改，别当已定 API 用）。
// 面板里画的**就是**编辑器那套渲染（`src/rendering`），本域不新写第二种画笔。
import type { PreviewTarget } from '../types';

/** 面板排布参数（ADR-0016 §1.1 的 `panelW` / `panelH` / `es`；默认档由 03 定）。 */
export interface PreviewPanelLayout {
  /** 每面板宽（CSS px） */
  panelW: number;
  /** 每面板高（CSS px） */
  panelH: number;
  /** 生效缩放：面板覆盖的虚拟 px = `panelH / es` */
  es: number;
}

/** 一次静态预览请求：作用于谁 + 可选的面板参数（缺省用预览默认档，§2 的显示档同理）。 */
export interface StaticPreviewRequest {
  target: PreviewTarget;
  layout?: Partial<PreviewPanelLayout>;
}
