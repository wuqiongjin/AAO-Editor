// 静态预览的工具栏控件（chart-preview 03；08 起显示档搬进「显示」面板）：
// 连续缩放滑杆 + 显示面板（标注 / 画布共享 / 音符皮肤）+ 全屏 + 导出。
//
// 一个旋钮：缩放决定轨道宽（面板宽 = 13 车道宽）、音符大小、每面板秒数；面板高跟容器高（Bestdori 语义）。
// 缩放**连续可调**（滑杆；预览区内 Ctrl/⌘+滚轮同款，见 StaticPreviewView 的滚轮监听），不再只给几档。
// 叠加项（BPM / 时间 / 节拍线）与画布共享项都在 `PreviewDisplayPanel` 里（同一排控件：页面工具栏与全屏浮层各一份）。
// 控件形式照全站：滑杆复用 `.slider-control` / `.slider-value`（设置页同一套），其余走 `IconButton`。
import { ImageDown, Maximize2, Minimize2 } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { t } from '../../i18n';
import { PREVIEW_ZOOM_RANGE, type SheetPlan } from '../../preview';
import PreviewDisplayPanel from './PreviewDisplayPanel';
import './PreviewPage.css';

export interface PreviewStaticToolbarProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  exporting: boolean;
  onExport: () => void;
  /**
   * 导出档的排布结论（固定档算出来的 `宽 × 高`；`ok:false` 时带"为什么出不了"的原因）。
   * null = 这一屏还没有可导出的谱面。按钮**不因超限而变灰**：点了会说清原因（票面：给方案，不画爆）。
   */
  exportPlan: SheetPlan | null;
  /** 全屏预览（全屏下这排控件跟着搬进预览区，仍可缩放） */
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

export default function PreviewStaticToolbar({
  zoom,
  onZoom,
  exporting,
  onExport,
  exportPlan,
  fullscreen,
  onToggleFullscreen,
}: PreviewStaticToolbarProps) {
  const exportTitle = exportPlan == null
    ? t('preview.static.export')
    : exportPlan.ok
      ? t('preview.static.exportHint', { w: exportPlan.sheetW, h: exportPlan.sheetH })
      : t('preview.static.exportRefused', { reason: exportPlan.detail });

  return (
    <div className="preview-static">
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

      <IconButton
        width="auto"
        size="sm"
        icon={fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        label={fullscreen ? t('preview.static.fullscreenExit') : t('preview.static.fullscreen')}
        title={fullscreen ? t('preview.static.fullscreenExit') : t('preview.static.fullscreenHint')}
        active={fullscreen}
        onClick={onToggleFullscreen}
      />

      <IconButton
        width="auto"
        size="sm"
        outlined
        disabled={exporting || exportPlan == null}
        icon={<ImageDown size={15} />}
        label={exporting ? t('preview.static.exporting') : t('preview.static.export')}
        title={exportTitle}
        onClick={onExport}
      />
    </div>
  );
}
