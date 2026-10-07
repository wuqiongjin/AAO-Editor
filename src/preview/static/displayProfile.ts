// 预览显示档（ADR-0016 §2；chart-preview 03 起，08 扩成「预览标注」）：
// 预览面板**自带**的一组 `FrameView.display` 覆盖，来源 = `settings.preview`（跨会话记住的「看谱方式」，
// 08 用户定案：标注开关落设置、缩放与全屏仍属"这一屏怎么看看"）。
//
// 面板里画的就是编辑器那套渲染 —— 这里只是把"编辑器装饰"关掉/开回，**不新开第二份绘制**。
// 新增项一律优先用现有 display 字段表达；确需新开关时才在 `RenderDisplayOptions` 加字段
// （本域先后加了 gridDetail / gutterLabels / boundLines / timeMarks，都带"缺省 = 编辑器现状"的语义）。
import type { PreviewSettings } from '../../chart/config/AppSettings';
import { DEFAULT_PREVIEW_SETTINGS } from '../../chart/config/AppSettings';
import type { RenderDisplayOptions } from '../../rendering';

/**
 * 预览标注的默认档 —— **不在这里另立**：与 `settings.preview` 的默认值同源
 * （`AppSettings.DEFAULT_PREVIEW_SETTINGS`），宽图导出的固定档也用这一份（两处同档不各写一遍）。
 */
export const DEFAULT_PREVIEW_MARKERS: PreviewSettings = DEFAULT_PREVIEW_SETTINGS;

/**
 * 预览档的文字系数（issue 17 用户定案）：字号直接随视口 scale = layout.es（0.74 × zoom）
 * 联动缩放，基准系数继承工作台设置的 labelScale，不再人工硬编码 0.7 钉死。
 */
export const PREVIEW_LABEL_SCALE = 1;

/**
 * 把预览标注叠到基础显示参数上（工作台的 `settings.display`）：
 * - 五个标注档（Beat / BPM / Time / Combo 标记、镜向）+ 文字系数来自 `settings.preview`；
 * - 其余（`gridStyle` / `gridOpacity` / `noteSize` / `slideOpacity` / `colorAssist` /
 *   `simultaneousClickLines` 之外的一切）**沿用作者自己的设置** —— 预览该像作者自己的画布。
 */
export function resolvePreviewDisplay(
  base: RenderDisplayOptions,
  markers: PreviewSettings = DEFAULT_PREVIEW_MARKERS,
): RenderDisplayOptions {
  return {
    ...base,
    gridDetail: markers.beatMarks === 'off' ? 'off' : markers.beatMarks,
    gutterLabels: markers.bpmMarks,
    timeMarks: markers.timeMarks === 'off' ? 0 : markers.timeMarks,
    comboMarks: markers.comboMarks,
    mirror: markers.mirror,
    // 起止线在预览里恒不画（03 二轮定案：130px 面板里那只是两条 0.6px 虚线，读不出信息，
    // 工具栏那个开关已撤）；字段留着是为了「缺省 = 编辑器现状」的语义仍然成立。
    boundLines: false,
    labelScale: base.labelScale ?? 1,
  };
}
