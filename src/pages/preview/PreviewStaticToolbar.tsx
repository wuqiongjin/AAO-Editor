// 静态预览的工具栏控件（chart-preview 03；08 起显示档搬进「显示」面板）：
// 连续缩放滑杆 + 显示面板（标注 / 画布共享 / 音符皮肤）+ 导出 + 全屏（全屏末位，2026-10-05 定案）。
//
// 一个旋钮：缩放决定轨道宽（面板宽 = 13 车道宽）、音符大小、每面板秒数；面板高跟容器高（Bestdori 语义）。
// 缩放**连续可调**（滑杆；预览区内 Ctrl/⌘+滚轮同款，见 StaticPreviewView 的滚轮监听），不再只给几档。
// 叠加项（BPM / 时间 / 节拍线）与画布共享项都在 `PreviewDisplayPanel` 里。
// 控件形式照全站：滑杆复用 `.slider-control` / `.slider-value`（设置页同一套），其余走 `IconButton`。
//
// issue 12（2026-10-05 用户定案）：全屏下这一排**整排退场** —— 它太长、压画面；浮层只留
// `PreviewExitFullscreenButton` 一枚图标钮（缩放不丢：Ctrl/⌘+滚轮仍归 `StaticPreviewView`，
// 设置 / 导出先退出全屏再做）。
import { Maximize2, Minimize2 } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { t } from '../../i18n';
import { PREVIEW_ZOOM_RANGE, type SheetPlan } from '../../preview';
import PreviewDisplayPanel from './PreviewDisplayPanel';
import StaticExportControl from './StaticExportControl';
import './PreviewPage.css';

export interface PreviewStaticToolbarProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  exporting: boolean;
  onExport: () => void;
  /**
   * 导出档的排布结论（固定档算出来的 `宽 × 高`；`ok:false` 时带"为什么出不了"的原因）。
   * null = 这一屏还没有可导出的谱面。
   */
  exportPlan: SheetPlan | null;
  /** 进入全屏（全屏下这排控件整排退场，只留浮层那枚退出钮） */
  onEnterFullscreen: () => void;
}

export default function PreviewStaticToolbar({
  zoom,
  onZoom,
  exporting,
  onExport,
  exportPlan,
  onEnterFullscreen,
}: PreviewStaticToolbarProps) {
  return (
    <div className="preview-controls">
      <div className="preview-zoom">
        <span className="preview-zoom__label">{t('preview.static.zoom')}</span>
        <div className="slider-control preview-zoom__slider">
          <input
            type="range"
            min={Math.round(PREVIEW_ZOOM_RANGE.min * 100)}
            max={Math.round(PREVIEW_ZOOM_RANGE.max * 100)}
            step={Math.round(PREVIEW_ZOOM_RANGE.step * 100)}
            value={Math.round(zoom * 100)}
            aria-label={t('preview.static.zoom')}
            title={t('preview.static.zoomHint')}
            onChange={(e) => onZoom(Number(e.target.value) / 100)}
          />
          <span className="slider-value">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      <PreviewDisplayPanel />

      {/* 导出控件（chart-preview 37）：点击弹出「导出图片」弹层，内含「导出信息」头带配置 */}
      <StaticExportControl
        disabled={exportPlan == null}
        exporting={exporting}
        exportPlan={exportPlan}
        onExport={onExport}
      />

      {/* 全屏**末位**（2026-10-05 用户定案）：进入钮在这一排最右，退出钮浮在舞台右上角 ——
          进出这一趟手和眼都停在同一个角。 */}
      <PreviewEnterFullscreenButton onEnter={onEnterFullscreen} />
    </div>
  );
}

/**
 * 进入全屏钮（静态那一排的末位；chart-preview 20 起动态形态的工具栏也用这一枚 ——
 * 舞台是形态无关的同一块 `.preview-stage`，进全屏这件事自然也只有一份实现）。
 */
export function PreviewEnterFullscreenButton({ onEnter }: { onEnter: () => void }) {
  return (
    <IconButton
      width="auto"
      size="sm"
      icon={<Maximize2 size={15} />}
      label={t('preview.static.fullscreen')}
      title={t('preview.static.fullscreenHint')}
      onClick={onEnter}
    />
  );
}

/**
 * 全屏浮层那枚退出钮（issue 12）：icon-only，不显示文字（省占位）—— **别给它加 `label`**，一加就出文字。
 * 外形 = 圆角方形（`outlined` 自己带面），圆形胶囊被否（2026-10-05 用户：圆形不太合适）；
 * 阴影由 `.preview-fs .icon-btn` 补 —— 它浮在画面之上，画面底色与轨道花色都不固定。
 */
export function PreviewExitFullscreenButton({ onExit }: { onExit: () => void }) {
  return (
    <IconButton
      width="auto"
      size="sm"
      outlined
      icon={<Minimize2 size={15} />}
      title={t('preview.static.fullscreenExit')}
      aria-label={t('preview.static.fullscreenExit')}
      onClick={onExit}
    />
  );
}
