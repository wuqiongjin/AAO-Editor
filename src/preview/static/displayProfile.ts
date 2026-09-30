// 预览显示档（ADR-0016 §2；chart-preview 03）：预览页**自带**的一组 `FrameView.display` 覆盖。
//
// 面板里画的就是编辑器那套渲染 —— 这里只是把"编辑器装饰"关掉/开回，**不新开第二份绘制**。
// 首期优先用现有 display 字段表达；确需新开关时才在 `RenderDisplayOptions` 加字段（本票加了三个：
// gridDetail / gutterLabels / boundLines，都带"缺省 = 编辑器现状"的语义）。
import type { RenderDisplayOptions } from '../../rendering';

/**
 * 网格细节档：整拍线 / 全量 / 不画横网格。
 * 类型**不在这里另立**：取值口径归渲染域的 `RenderDisplayOptions.gridDetail`（缺省 `'all'` = 编辑器现状）。
 */
export type PreviewGridDetail = NonNullable<RenderDisplayOptions['gridDetail']>;

/** 预览显示档：三个叠加项开关（工具栏逐项可开回） */
export interface PreviewDisplayProfile {
  gridDetail: PreviewGridDetail;
  /** 沟槽常显文字（BPM 数值/摘要、END 文字） */
  gutterLabels: boolean;
  /** 起止线（START/END 线与 END 文字） */
  boundLines: boolean;
}

/**
 * 默认**精简**档（票面口径）：只画整拍线、不画沟槽文字、不画起止线。
 * 理由是面板只有 ~130 CSS px 宽：沟槽常显文字在这么窄的沟槽里要么被隐藏、要么压住轨道读不下去，
 * 而整拍线是"这段多长"的唯一参考，留着。三项都可在预览页工具栏开回。
 */
export const DEFAULT_PREVIEW_PROFILE: PreviewDisplayProfile = {
  gridDetail: 'beats',
  gutterLabels: false,
  boundLines: false,
};

/**
 * 预览档的文字系数：常显文字在窄面板里按 ~70% 画（实时读数 ≈11.5px，仍可读；
 * 100% 的 21px/16.5px 在 130px 面板里放不下）。这不是"预览第二套字号"，只是这一档的取值。
 */
export const PREVIEW_LABEL_SCALE = 0.7;

/**
 * 把显示档叠到基础显示参数上（工作台的 `settings.display`）：
 * - 三个开关 + 文字系数来自预览档；
 * - 其余（`gridStyle` / `gridOpacity` / `noteSize` / `slideOpacity` / `colorAssist` /
 *   `simultaneousClickLines`）**沿用作者自己的设置** —— 预览该像作者自己的画布。
 */
export function resolvePreviewDisplay(
  base: RenderDisplayOptions,
  profile: PreviewDisplayProfile = DEFAULT_PREVIEW_PROFILE,
): RenderDisplayOptions {
  return {
    ...base,
    gridDetail: profile.gridDetail,
    gutterLabels: profile.gutterLabels,
    boundLines: profile.boundLines,
    labelScale: PREVIEW_LABEL_SCALE,
  };
}
