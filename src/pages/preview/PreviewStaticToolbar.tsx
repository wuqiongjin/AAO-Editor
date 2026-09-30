// 静态预览的工具栏控件（chart-preview 03）：缩放分段档 + 三个叠加项图标钮 + 导出宽图。
//
// 一个旋钮：缩放档同时决定轨道宽（面板宽 = 13 车道宽）、音符大小、每面板秒数 —— 缩放↑ 轨道变宽、
// 每面板时间缩短、面板数变多（横向滑条自然出现）。面板高跟容器高（Bestdori 语义）。
// 控件形式照 2026-09-30 二轮定案：缩放 = 分段档，叠加项 = 带 tooltip 的图标钮（全站 IconButton）。
import { Grid3x3, ImageDown, Ruler, Type } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { t, type MessageKey } from '../../i18n';
import {
  PREVIEW_ZOOM_STEPS,
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
}

export default function PreviewStaticToolbar({
  zoom,
  onZoom,
  profile,
  onProfile,
  exporting,
  onExport,
  exportPlan,
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
      <div className="preview-zoom" role="group" aria-label={t('preview.static.zoom')}>
        {PREVIEW_ZOOM_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            className={`preview-zoom__item${step === zoom ? ' is-active' : ''}`}
            aria-pressed={step === zoom}
            title={t('preview.static.zoomOption', { percent: Math.round(step * 100) })}
            onClick={() => onZoom(step)}
          >
            {Math.round(step * 100)}%
          </button>
        ))}
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
        icon={<Ruler size={15} />}
        title={t('preview.static.boundLines')}
        active={profile.boundLines}
        onClick={() => onProfile({ ...profile, boundLines: !profile.boundLines })}
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
