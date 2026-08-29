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
import CanvasSpriteIcon from '../../components/CanvasSpriteIcon';
import {
  buildActiveNoteIcons,
  listNoteSkinPacks,
  DEFAULT_NOTE_SKIN_SELECTION,
  type NoteSkinItemId,
  type NoteSkinSelection,
} from '../../renderer/noteSkin';

interface ColMeta {
  item: NoteSkinItemId;
  label: string;
  hint: string;
}

const COLS: ColMeta[] = [
  { item: 'tap', label: '单键', hint: '普通单点' },
  { item: 'flick', label: '滑键', hint: '带 flick' },
  { item: 'skill', label: '技能键', hint: '带 skill' },
  { item: 'dirL', label: '左方向', hint: '向左方向' },
  { item: 'dirR', label: '右方向', hint: '向右方向' },
  { item: 'slide', label: '滑条', hint: '连接带+端点' },
];

const NOTE_SKIN_ITEM_IDS_FOR_LABEL = ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'] as const;

/** 单格预览画布尺寸（CSS 同步；用 viewBox 概念，浏览器按 width 100% 缩放） */
export const PREVIEW_CELL_W = 140;
export const PREVIEW_CELL_H = 88;

/** Slide 列的预览布局（导出供测试）。竖向：上端点(起点) + 中间结点 + 下端点(终点) + 连接带。 */
export interface SlideColLayout {
  cx: number;
  cy: number;
  topY: number;
  midY: number;
  bottomY: number;
  bandW: number;
  bandH: number;
}
export function computeSlideColLayout(W: number, H: number): SlideColLayout {
  const cx = W * 0.5;
  const cy = H * 0.5;
  const half = Math.min(H * 0.36, 30);
  return {
    cx,
    cy,
    topY: cy - half,
    midY: cy,
    bottomY: cy + half,
    bandW: 22,
    bandH: half * 2,
  };
}

/** 单格预览绘制（按 entry 类型） */
function drawPreviewSprite(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasSpriteIcon,
  icons: ReturnType<typeof buildActiveNoteIcons>,
  item: NoteSkinItemId,
  W: number,
  H: number,
) {
  const cx = W * 0.5;
  const cy = H * 0.5;
  if (item === 'tap' || item === 'skill') {
    const S = 1.6;
    sprite.render(ctx, {
      ...(item === 'tap' ? icons.tapFor(3) : icons.skillFor(3)),
      canvasX: cx, canvasY: cy, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
    });
    return;
  }
  if (item === 'flick') {
    const S = 1.6;
    sprite.render(ctx, {
      ...icons.flickFor(3),
      decorators: icons.flickTopDecorator ? [icons.flickTopDecorator] : [],
      canvasX: cx, canvasY: cy, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
    });
    return;
  }
  if (item === 'dirL' || item === 'dirR') {
    const type: 'L' | 'R' = item === 'dirL' ? 'L' : 'R';
    const S_DIR = 1.5;
    const group = icons.dirGroup(type, 1);
    sprite.render(ctx, {
      ...group.bodies[0].config,
      canvasX: cx, canvasY: cy, canvasSize: 45,
      canvasWidth: 45, canvasHeight: 45 * 0.33, scale: S_DIR, renderLayer: 'all',
    });
    const cv = group.chevron;
    if (cv) {
      sprite.render(ctx, {
        ...cv.config,
        canvasX: cx + (cv.offsetVirtualX + cv.extraDesignX) * S_DIR, canvasY: cy, canvasSize: 45,
        canvasWidth: cv.drawW, canvasHeight: cv.drawH, scale: S_DIR, renderLayer: 'all',
      });
    }
    return;
  }
  if (item === 'slide') {
    const layout = computeSlideColLayout(W, H);
    sprite.render(ctx, {
      ...icons.slideBand,
      canvasX: layout.cx, canvasY: (layout.topY + layout.bottomY) / 2, canvasSize: Math.max(layout.bandW, layout.bandH),
      canvasWidth: layout.bandW, canvasHeight: layout.bandH, scale: 1, renderLayer: 'main',
    });
    sprite.render(ctx, {
      ...icons.slideEndpointFor(3),
      canvasX: layout.cx, canvasY: layout.topY, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: 1.1, renderLayer: 'main',
    });
    sprite.render(ctx, {
      ...icons.slideAmongFor(3),
      canvasX: layout.cx, canvasY: layout.midY, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: 1.1, renderLayer: 'main',
    });
    sprite.render(ctx, {
      ...icons.slideEndpointFor(3),
      canvasX: layout.cx, canvasY: layout.bottomY, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: 1.1, renderLayer: 'main',
    });
  }
}

/** 解析"当前组合"为面向用户的简短摘要。
 * 用户视角 = 1 套皮肤（可能带微调）：
 *   - 6 条目完全命中某个整包预设（皮肤名）→ 标题=该整包名，副标="整包应用"
 *   - 否则 = "已自定义" → 标题="已自定义"，副标="N 项被调整"
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
    return { title: matched.label, subtitle: '整包应用' };
  }
  // 未命中：vs 默认偏离的条目数
  const defaults = DEFAULT_NOTE_SKIN_SELECTION;
  const overriddenCount = (NOTE_SKIN_ITEM_IDS_FOR_LABEL as readonly NoteSkinItemId[]).filter(
    (k) => selection[k] !== defaults[k],
  ).length;
  return { title: '已自定义', subtitle: `${overriddenCount} 项被调整` };
}

export default function NoteSkinPreview({
  selection,
  onChange,
}: {
  selection: NoteSkinSelection;
  onChange: (item: NoteSkinItemId, packId: string) => void;
}) {
  const summary = useMemo(() => summarizeSelection(selection), [selection]);
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
    <div className="skin-live-preview" aria-label="音符皮肤·6 列预览与选择">
      <div className="skin-live-preview-head">
        <span className="skin-live-preview-eyebrow">当前组合</span>
        <strong className="skin-live-preview-title">{summary.title}</strong>
        <span className={`skin-live-preview-subtitle${summary.title === '已自定义' ? ' is-modified' : ''}`}>{summary.subtitle}</span>
        <span className="skin-live-preview-meta">{COLS.length} 类音符 · 实时预览</span>
      </div>
      <div className="skin-col-grid" role="grid">
        {COLS.map((col) => {
          const eligible = col.item === 'dirL' || col.item === 'dirR' ? 'directional' : 'note';
          const packs = listNoteSkinPacks().filter((p) => p.kind === eligible);
          const currentId = selection[col.item];
          return (
            <div key={col.item} className="skin-col" role="row">
              <div className="skin-col-preview">
                <canvas
                  ref={(el) => { canvasRefs.current[col.item] = el; }}
                  width={PREVIEW_CELL_W}
                  height={PREVIEW_CELL_H}
                  className="skin-col-canvas"
                  aria-label={`${col.label}预览`}
                />
                <span className="skin-col-label">{col.label}</span>
              </div>
              <div className="skin-col-picker" role="radiogroup" aria-label={`${col.label}皮肤`}>
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
                        <span className="skin-pill-mark" aria-label="当前选择">
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