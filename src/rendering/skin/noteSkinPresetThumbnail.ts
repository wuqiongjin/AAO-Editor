// 整包预设缩略（issue 42）：该预设会写入的条目 + 2×3 / 2×2 格子几何。
// 单格比例锁综合预览 140:88；四格卡与六格卡同单格尺寸、水平居中，不拉满。
import type { NoteSkinItemId, NoteSkinSelection } from './noteSkin';
import { DEFAULT_NOTE_SKIN_SELECTION } from './noteSkin';
import { PREVIEW_CELL_H, PREVIEW_CELL_W } from './noteSkinPreviewLayout';

export const PRESET_THUMBNAIL_COLS = 3;
export const PRESET_THUMBNAIL_ROWS = 2;

const SIX: NoteSkinItemId[] = ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'];
const FOUR: NoteSkinItemId[] = ['tap', 'flick', 'skill', 'slide'];

export function presetThumbnailItems(pack: { pairedDir: string | null }): NoteSkinItemId[] {
  return pack.pairedDir == null ? [...FOUR] : [...SIX];
}

/** 缩略绘制用的六条目选择：无配对时 dir 填默认（不画，仅让图标集能构建） */
export function presetSelection(pack: { id: string; pairedDir: string | null }): NoteSkinSelection {
  const dir = pack.pairedDir ?? DEFAULT_NOTE_SKIN_SELECTION.dirL;
  return {
    tap: pack.id,
    flick: pack.id,
    skill: pack.id,
    slide: pack.id,
    dirL: dir,
    dirR: dir,
  };
}

export interface PresetThumbnailCell {
  item: NoteSkinItemId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PresetThumbnailLayout {
  canvasH: number;
  cells: PresetThumbnailCell[];
}

export function computePresetThumbnailLayout(
  canvasW: number,
  items: readonly NoteSkinItemId[],
): PresetThumbnailLayout {
  const cellW = canvasW / PRESET_THUMBNAIL_COLS;
  const cellH = cellW * (PREVIEW_CELL_H / PREVIEW_CELL_W);
  const cols = items.length === SIX.length ? PRESET_THUMBNAIL_COLS : 2;
  const offsetX = (canvasW - cols * cellW) / 2;
  return {
    canvasH: PRESET_THUMBNAIL_ROWS * cellH,
    cells: items.map((item, i) => ({
      item,
      x: offsetX + (i % cols) * cellW,
      y: Math.floor(i / cols) * cellH,
      w: cellW,
      h: cellH,
    })),
  };
}

/** CSS aspect-ratio：与六格卡同一画布高（四格也用这块画布、格子居中） */
export const PRESET_THUMBNAIL_ASPECT = `${PRESET_THUMBNAIL_COLS * PREVIEW_CELL_W} / ${PRESET_THUMBNAIL_ROWS * PREVIEW_CELL_H}`;

/** 缩略槽 CSS 宽：原 Sparkles 占位 84px 加宽以容 2×3，仍远小于卡宽 */
export const PRESET_THUMBNAIL_CSS_W = 156;

/** 格内精灵相对格子的占用（综合预览单格等比缩小后居中；<1 留出边距，避免撑破格子） */
export const PRESET_THUMBNAIL_SPRITE_FIT = 0.76;

export function computeThumbnailSpriteTransform(cell: Pick<PresetThumbnailCell, 'x' | 'y' | 'w' | 'h'>): {
  x: number;
  y: number;
  scale: number;
  drawW: number;
  drawH: number;
} {
  const scale =
    Math.min(cell.w / PREVIEW_CELL_W, cell.h / PREVIEW_CELL_H) * PRESET_THUMBNAIL_SPRITE_FIT;
  return {
    x: cell.x + (cell.w - PREVIEW_CELL_W * scale) / 2,
    y: cell.y + (cell.h - PREVIEW_CELL_H * scale) / 2,
    scale,
    drawW: PREVIEW_CELL_W,
    drawH: PREVIEW_CELL_H,
  };
}
