// 音符皮肤·综合预览 + 按条目选择（issue 29 grill Q8=B + 2026-08-25 切片 3）：
// 6 列 2 行网格（Q13=A）：第 1 行 6 个真实精灵预览画布，第 2 行 6 个对应包选择器。
// 列对齐——col 0 = 单键（预览 + 选择器上下对齐）……col 5 = 滑条。
// 高信息密度 + 整页 1-2 个 viewport 内可看全。
//
// 几何：
//   - 预览行：用真实渲染路径（CanvasSpriteIcon + buildActiveNoteIcons）按条目绘制，6 个画布；
//   - 选择行：包选择缩略格（与原 .skin-thumb 同构，但移除外层大画布占位）；
//   - 每个列上下有"标签"色块间隔。
import { useEffect, useMemo, useRef } from 'react';
import { Check } from 'lucide-react';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import {
  buildActiveNoteIcons,
  listNoteSkinPacks,
  type NoteSkinItemId,
  type NoteSkinSelection,
} from './noteSkin';
// 单格画布尺寸与 Slide 列布局几何在 `./noteSkinPreviewLayout`（纯模块；react-refresh 规则要求组件文件只导出组件）
import { PREVIEW_CELL_W, PREVIEW_CELL_H } from './noteSkinPreviewLayout';
import { drawPreviewSprite } from './noteSkinPreviewDraw';
import { getActiveUiLanguage, t, type MessageKey } from '../../i18n';

interface ColMeta {
  item: NoteSkinItemId;
  labelKey: MessageKey;
}

const COLS: ColMeta[] = [
  { item: 'tap', labelKey: 'skin.tap' },
  { item: 'flick', labelKey: 'skin.flick' },
  { item: 'skill', labelKey: 'skin.skill' },
  { item: 'dirL', labelKey: 'skin.dirL' },
  { item: 'dirR', labelKey: 'skin.dirR' },
  { item: 'slide', labelKey: 'skin.slide' },
];

/** 解析"当前组合"为面向用户的简短摘要。
 * 用户视角 = 1 套皮肤（可能带微调）：
 *   - 6 条目完全命中某个整包预设（皮肤名）→ 标题=该整包名，副标="整包应用"
 *   - 否则 → 标题="已自定义"（不统计偏离条目数，issue 149）
 * 不暴露"方向 vs 普通"这种底层包分类——按条目覆盖区按 eligibility 自动分流即可。
 * 同编号方向 vs 普通包用户视角下是 1 套皮肤，故命中只要 note id + 配对方向 id 共同一致。
 */
function summarizeSelection(selection: NoteSkinSelection): { title: string; subtitle: string } {
  const packs = listNoteSkinPacks();
  const notePacks = packs.filter((p) => p.kind === 'note');
  // 6 条目完全 = 某 note 整包 + 配对方向包 → 命中该整包预设
  const matched = notePacks.find((p) => {
    if (selection.tap !== p.id || selection.flick !== p.id || selection.skill !== p.id || selection.slide !== p.id) return false;
    if (p.pairedDir) return selection.dirL === p.pairedDir && selection.dirR === p.pairedDir;
    return true;
  }) ?? null;
  if (matched) {
    return { title: matched.label, subtitle: t('pack.presetActive') };
  }
  return { title: t('assets.preview.custom'), subtitle: '' };
}

export default function NoteSkinPreview({
  selection,
  onChange,
}: {
  selection: NoteSkinSelection;
  onChange: (item: NoteSkinItemId, packId: string) => void;
}) {
  const lang = getActiveUiLanguage();
  const summary = useMemo(() => summarizeSelection(selection), [selection, lang]);
  const canvasRefs = useRef<Record<NoteSkinItemId, HTMLCanvasElement | null>>({
    tap: null, flick: null, skill: null, dirL: null, dirR: null, slide: null,
  });

  useEffect(() => {
    const icons = buildActiveNoteIcons(selection);
    const sprite = new CanvasSpriteIcon();
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    const drawAll = () => {
      for (const col of COLS) {
        const canvas = canvasRefs.current[col.item];
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        canvas.width = Math.round(PREVIEW_CELL_W * DPR);
        canvas.height = Math.round(PREVIEW_CELL_H * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.fillStyle = '#101418';
        ctx.fillRect(0, 0, PREVIEW_CELL_W, PREVIEW_CELL_H);
        drawPreviewSprite(ctx, sprite, icons, col.item, PREVIEW_CELL_W, PREVIEW_CELL_H);
      }
    };

    let cancelled = false;
    CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
      .catch(() => undefined)
      .then(() => { if (!cancelled) drawAll(); });

    return () => { cancelled = true; };
  }, [selection]);

  return (
    <div className="skin-live-preview" aria-label={t('assets.preview.aria')}>
      <div className="skin-live-preview-head">
        <span className="skin-live-preview-eyebrow">{t('assets.preview.current')}</span>
        <strong className="skin-live-preview-title">{summary.title}</strong>
        {summary.subtitle ? (
          <span className="skin-live-preview-subtitle">{summary.subtitle}</span>
        ) : null}
        <span className="skin-live-preview-meta">{t('assets.preview.meta', { count: COLS.length })}</span>
      </div>
      <div className="skin-col-grid" role="grid">
        {COLS.map((col) => {
          const eligible = col.item === 'dirL' || col.item === 'dirR' ? 'directional' : 'note';
          const packs = listNoteSkinPacks().filter((p) => p.kind === eligible);
          const currentId = selection[col.item];
          const colLabel = t(col.labelKey);
          return (
            <div key={col.item} className="skin-col" role="row">
              <div className="skin-col-preview">
                <canvas
                  ref={(el) => { canvasRefs.current[col.item] = el; }}
                  width={PREVIEW_CELL_W}
                  height={PREVIEW_CELL_H}
                  className="skin-col-canvas"
                  aria-label={t('assets.preview.itemAria', { label: colLabel })}
                />
                <span className="skin-col-label">{colLabel}</span>
              </div>
              <div className="skin-col-picker" role="radiogroup" aria-label={t('assets.preview.skinAria', { label: colLabel })}>
                {packs.map((p) => {
                  const selected = p.id === currentId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`skin-pill${selected ? ' is-active' : ''}`}
                      title={p.label}
                      onClick={() => onChange(col.item, p.id)}
                    >
                      <span className="skin-pill-label">{p.label}</span>
                      {selected && (
                        <span className="skin-pill-mark" aria-label={t('assets.preview.currentChoice')}>
                          <Check size={10} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}