// issue 42 锁测：整包预设缩略画哪些条目、2×3 / 2×2 格子几何。
// 缩略 = 该预设会写入的样貌（有 pairedDir 六类，无则四类）；单格比例锁综合预览 140:88。
import { describe, it, expect } from 'vitest';
import {
  computePresetThumbnailLayout,
  computeThumbnailSpriteTransform,
  presetThumbnailItems,
} from '@/src/rendering/skin/noteSkinPresetThumbnail';
import { PREVIEW_CELL_H, PREVIEW_CELL_W } from '@/src/rendering/skin/noteSkinPreviewLayout';
import { readStripped } from '@/tests/support/source';

describe('整包预设缩略：画哪些条目', () => {
  it('有配对方向键时画六类，顺序与综合预览列相同', () => {
    expect(presetThumbnailItems({ pairedDir: 'directionalflickskin00' })).toEqual([
      'tap', 'flick', 'skill', 'dirL', 'dirR', 'slide',
    ]);
  });

  it('无配对方向键时只画会写入的四类，不含 dirL/dirR', () => {
    expect(presetThumbnailItems({ pairedDir: null })).toEqual([
      'tap', 'flick', 'skill', 'slide',
    ]);
  });
});

describe('整包预设缩略：格子几何', () => {
  // 画布宽 210：三列时单格宽 70；140:88 → 高 44；两行画布高 88。
  const CANVAS_W = 210;

  it('六类为 2×3，单格 70×44，画布高 88', () => {
    const items = presetThumbnailItems({ pairedDir: 'directionalflickskin00' });
    const layout = computePresetThumbnailLayout(CANVAS_W, items);
    expect(layout.canvasH).toBe(88);
    expect(layout.cells).toHaveLength(6);
    expect(layout.cells.map((c) => c.item)).toEqual(items);
    expect(layout.cells.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }))).toEqual([
      { x: 0, y: 0, w: 70, h: 44 },
      { x: 70, y: 0, w: 70, h: 44 },
      { x: 140, y: 0, w: 70, h: 44 },
      { x: 0, y: 44, w: 70, h: 44 },
      { x: 70, y: 44, w: 70, h: 44 },
      { x: 140, y: 44, w: 70, h: 44 },
    ]);
  });

  it('四类为 2×2：单格与六格卡相同，水平居中，不拉满', () => {
    const six = computePresetThumbnailLayout(
      CANVAS_W,
      presetThumbnailItems({ pairedDir: 'directionalflickskin00' }),
    );
    const four = computePresetThumbnailLayout(
      CANVAS_W,
      presetThumbnailItems({ pairedDir: null }),
    );
    expect(four.canvasH).toBe(six.canvasH);
    expect(four.cells).toHaveLength(4);
    expect(four.cells.map((c) => c.item)).toEqual(['tap', 'flick', 'skill', 'slide']);
    const cell = six.cells[0]!;
    for (const c of four.cells) {
      expect(c.w).toBe(cell.w);
      expect(c.h).toBe(cell.h);
    }
    expect(four.cells.map((c) => ({ x: c.x, y: c.y }))).toEqual([
      { x: 35, y: 0 },
      { x: 105, y: 0 },
      { x: 35, y: 44 },
      { x: 105, y: 44 },
    ]);
  });

  it('单格宽高比等于综合预览单格 140:88', () => {
    const { cells } = computePresetThumbnailLayout(
      CANVAS_W,
      presetThumbnailItems({ pairedDir: 'directionalflickskin00' }),
    );
    const { w, h } = cells[0]!;
    expect(w / h).toBeCloseTo(PREVIEW_CELL_W / PREVIEW_CELL_H, 10);
  });
});

describe('整包预设缩略：格内精灵缩小居中', () => {
  const CANVAS_W = 210;

  it('按综合预览单格等比缩小，居中且小于格子', () => {
    const { cells } = computePresetThumbnailLayout(
      CANVAS_W,
      presetThumbnailItems({ pairedDir: 'directionalflickskin00' }),
    );
    const cell = cells[0]!;
    const t = computeThumbnailSpriteTransform(cell);
    expect(t.drawW).toBe(PREVIEW_CELL_W);
    expect(t.drawH).toBe(PREVIEW_CELL_H);
    expect(t.scale).toBeLessThan(cell.w / PREVIEW_CELL_W);
    expect(PREVIEW_CELL_W * t.scale).toBeLessThan(cell.w);
    expect(PREVIEW_CELL_H * t.scale).toBeLessThan(cell.h);
    expect(t.x).toBeCloseTo(cell.x + (cell.w - PREVIEW_CELL_W * t.scale) / 2, 10);
    expect(t.y).toBeCloseTo(cell.y + (cell.h - PREVIEW_CELL_H * t.scale) / 2, 10);
  });
});

describe('整包预设缩略：静态接线', () => {
  const assetsSrc = readStripped('src/pages/assets/AssetsPage.tsx');
  const previewSrc = readStripped('src/rendering/skin/NoteSkinPreview.tsx');
  const cssSrc = readStripped('src/layouts/AppShell.css');

  it('整包预设不再用 Sparkles 占位', () => {
    expect(assetsSrc).not.toMatch(/\bSparkles\b/);
    expect(assetsSrc).toContain('NoteSkinPresetThumbnail');
  });

  it('卡上显示 Skin 编号（pack.label）', () => {
    expect(assetsSrc).toContain('{pack.label}');
  });

  it('缩略槽固定宽、不拉满卡宽', () => {
    expect(cssSrc).toMatch(/\.skin-preset-thumb\s*\{[^}]*width:\s*156px/);
    expect(cssSrc).not.toMatch(/\.skin-preset-thumb\s*\{[^}]*width:\s*100%/);
  });

  it('缩略绘制按预览格坐标缩放，不把格子当预览格', () => {
    const thumbSrc = readStripped('src/rendering/skin/NoteSkinPresetThumbnail.tsx');
    expect(thumbSrc).toContain('computeThumbnailSpriteTransform');
    expect(thumbSrc).toContain('PREVIEW_CELL_W');
    expect(thumbSrc).not.toMatch(/drawPreviewSprite\([^)]*cell\.w,\s*cell\.h\)/);
  });

  it('综合预览六列结构仍在', () => {
    expect(previewSrc).toContain('skin-col-grid');
    expect(previewSrc).toContain("item: 'tap'");
    expect(previewSrc).toContain("item: 'flick'");
    expect(previewSrc).toContain("item: 'skill'");
    expect(previewSrc).toContain("item: 'dirL'");
    expect(previewSrc).toContain("item: 'dirR'");
    expect(previewSrc).toContain("item: 'slide'");
  });
});
