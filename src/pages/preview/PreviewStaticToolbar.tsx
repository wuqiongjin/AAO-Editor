// 静态预览的工具栏控件（chart-preview 03；二轮修订 2026-09-30）：
// 连续缩放滑杆 + 网格档 + 沟槽文字 + 全屏 + 导出宽图。
//
// 一个旋钮：缩放决定轨道宽（面板宽 = 13 车道宽）、音符大小、每面板秒数；面板高跟容器高（Bestdori 语义）。
// 缩放**连续可调**（滑杆；预览区内 Ctrl/⌘+滚轮同款，见 StaticPreviewView 的滚轮监听），不再只给几档。
// 控件形式照全站：滑杆复用 `.slider-control` / `.slider-value`（设置页同一套），其余走 `IconButton`。
import { Grid3x3, ImageDown, Maximize2, Minimize2, Type } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { t, type MessageKey } from '../../i18n';
import {
  PREVIEW_ZOOM_RANGE,
  type PreviewDisplayProfile,
  type PreviewGridDetail,
  type SheetPlan,
} from '../../preview';
import './PreviewPage.css';

/** 网格细节档的循环次序（图标钮点一下走下一档） */
const GRID_CYCLE: PreviewGridDetail[] = ['beats', 'all', 'none'];
const GRID_LABEL_KEY: Record<PreviewGridDetail, MessageKey> = {
  beats: 'preview.static.gridDetail.beats',
  all: 'preview.static.gridDetail.all',
  none: 'preview.static.gridDetail.none',
};

export interface PreviewStaticToolbarProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  profile: PreviewDisplayProfile;
  onProfile: (profile: PreviewDisplayProfile) => void;
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
  profile,
  onProfile,
  exporting,
  onExport,
  exportPlan,
  fullscreen,
  onToggleFullscreen,
}: PreviewStaticToolbarProps) {
  const gridIndex = GRID_CYCLE.indexOf(profile.gridDetail);
  const gridNext = GRID_CYCLE[(gridIndex + 1) % GRID_CYCLE.length]!;
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

      <IconButton
        width="auto"
        size="sm"
        icon={<Grid3x3 size={15} />}
        label={t(GRID_LABEL_KEY[profile.gridDetail])}
        title={t('preview.static.gridDetail.cycle', {
          current: t(GRID_LABEL_KEY[profile.gridDetail]),
          next: t(GRID_LABEL_KEY[gridNext]),
        })}
        active={profile.gridDetail !== 'beats'}
        onClick={() => onProfile({ ...profile, gridDetail: gridNext })}
      />
      <IconButton
        width="auto"
        size="sm"
        icon={<Type size={15} />}
        title={t('preview.static.gutterLabels')}
        active={profile.gutterLabels}
        onClick={() => onProfile({ ...profile, gutterLabels: !profile.gutterLabels })}
      />

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
