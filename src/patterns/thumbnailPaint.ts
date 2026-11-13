// 片段缩略图的**画法**（issue 185；2026-10-31 验收两轮改向）。
//
// 三条都是"照既有画布代码"来的，不另造一套：
// - **滑条段**：用 `splitBandAtFolds` + `bandPolygonAt`（画布同一份带体几何：横截面 = 车道横向，
//   回折处先按行进方向切分再各画一段）。缩略图不贴带体纹理，用体色实心填充、半透明叠加
//   （两臂真正重叠处更亮，与画布的"叠亮"同观感）。
// - **方向键整组**：直接调 `renderDirGroup`（画布同一份组合几何：N 条覆盖轨本体 + 最外侧箭头）。
//   自己按轨摆散点会画成几个互不相连的小块（2026-10-31 验收指出）。
// - **flick 顶部箭头**：`CanvasSpriteIcon.renderDecorator` + `flickTopDecorator`，锚点尺寸口径与画布
//   第二层装饰器一致；方向键不补（画布也不补，箭头就是它的组合件）。
//
// 音符本体贴当前皮肤的真实精灵；选款复用 `singleIconConfig` / `slideNodeIconConfig`
// （含「flick 胜 skill」issue 147 的优先级）。精灵按固定小尺寸贴、不随纵向压缩变形。
// 纯绘制函数（不碰 DOM、不碰设置）：精灵与图标由组件注入，node 侧可喂记录型替身单测。
import type CanvasSpriteIcon from '../ui/CanvasSpriteIcon';
import type { SpriteIconConfig } from '../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons } from '../rendering/skin/noteSkin';
import {
  renderBandStrip, renderDirGroup, singleIconConfig, slideNodeIconConfig, type IconChoiceCtx,
} from '../rendering/render';
import { bandPolygonAt, splitBandAtFolds } from '../rendering/slideBandGeometry';
import { NOTE_HEIGHT_SCALE, NOTE_ICON_SIZE, SLIDE_HEIGHT_SCALE } from '../rendering/primitives/noteMetrics';
import { LANE_WIDTH } from '../chart/geometry/ChartGeometry';
import type { PatternThumbnailScene, ThumbnailMark, ThumbnailPoint, ThumbnailSize } from './thumbnail';

/** 只取用到的两个绘制入口：测试注入记录型替身，生产注入 `CanvasSpriteIcon` */
export type ThumbnailSpriteRenderer = Pick<CanvasSpriteIcon, 'render' | 'renderDecorator'>;

export interface PatternThumbnailSprites {
  icons: ActiveNoteIcons;
  sprite: ThumbnailSpriteRenderer;
}

/**
 * 缩略图固定深色（谱面画布本身就是固定深色，卡片不跟主题换底）。
 * `background` 与 `src/app/styles/tokens.css` 的 `--canvas-bg` 同值 —— canvas 画不了 var()，
 * 这里是本模块唯一一份字面色（改主题底色时两处一起改）。
 */
export const THUMBNAIL_COLORS = {
  background: '#0c0e11',
  lane: 'rgba(255, 255, 255, 0.045)',
  bpm: 'rgba(255, 255, 255, 0.16)',
  /** 带体体色：取 skin00 / longNoteLine2 的实测值（`render.ts` 的 `STRIP_STYLE_DEFAULT`） */
  span: '#4be371',
} as const;

/**
 * 标记尺寸（CSS px）：跟车道宽走（缩略图横向铺满，车道约 11-13px），夹在 9..13。
 * 密度极端的片段精灵会叠 —— 这是卡片尺寸的固有限制，任何画法都躲不开（2026-10-31 用户确认）。
 */
function markSizeOf(scene: PatternThumbnailScene): number {
  const laneW = scene.lanes[0]?.w ?? 10;
  return Math.max(9, Math.min(13, laneW * 0.9));
}

/** 把场景画进给定尺寸的 2d 上下文（CSS 像素坐标系，调用方负责 dpr 变换） */
export function drawPatternThumbnail(
  ctx: CanvasRenderingContext2D,
  scene: PatternThumbnailScene,
  size: ThumbnailSize,
  sprites: PatternThumbnailSprites,
): void {
  const laneW = scene.lanes[0]?.w ?? 10;
  /** 虚拟 px → 缩略图 px（带体 half 宽、方向键组内偏移都用它换算） */
  const pxPerVirtual = laneW / LANE_WIDTH;

  ctx.fillStyle = THUMBNAIL_COLORS.background;
  ctx.fillRect(0, 0, size.w, size.h);

  for (const lane of scene.lanes) {
    ctx.fillStyle = THUMBNAIL_COLORS.lane;
    ctx.fillRect(lane.x, 0, lane.w, size.h);
  }

  // BPM 事件参考线：虚线，画在音符之下
  if (scene.bpmLines.length > 0) {
    ctx.save();
    ctx.strokeStyle = THUMBNAIL_COLORS.bpm;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const y of scene.bpmLines) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBands(ctx, scene, laneW, sprites);

  const sizePx = markSizeOf(scene);
  // 画布优先级（issue 85 / 160）：段 → 滑条结点 → 键型
  for (const mark of scene.slideMarks) {
    drawMark(ctx, sprites, mark, sizePx, SLIDE_HEIGHT_SCALE, (choice) => slideNodeIconConfig(
      choice,
      { lane: mark.lane, flick: mark.flick, skill: mark.skill },
      mark.endpoint === 'first',
      mark.endpoint === 'last',
    ));
  }
  for (const mark of scene.keyMarks) {
    if (mark.dirSide) {
      // 整组一次画完（画布同一份组合几何）；方向键不补 flick 箭头（画布也不补）
      renderDirGroup(
        ctx,
        sprites.sprite,
        sprites.icons.dirGroup(mark.dirSide, mark.dirLength ?? 1),
        mark.x,
        mark.y,
        pxPerVirtual,
        pxPerVirtual,
      );
      continue;
    }
    drawMark(ctx, sprites, mark, sizePx, NOTE_HEIGHT_SCALE, (choice) => singleIconConfig(
      choice,
      { lane: mark.lane, beat: 0, flick: mark.flick, skill: mark.skill },
    ));
  }

  // 装饰器层（画布同样是最后一层）：单键 / 滑条**端点**的 flick 顶部箭头。
  // 方向键不补（画布也不补，箭头就是它的组合件）；滑条中间结点不补（issue 145 #3）。
  const dec = sprites.icons.flickTopDecorator;
  // 装饰器的尺寸与偏移都按"主精灵设计尺寸(36×21.6) × spriteScale"算 —— 缩略图里 spriteScale
  // = sizePx / 36，否则偏移仍按设计 px 走，箭头会被甩到离音符很远的地方（2026-10-31 验收指出）。
  const decorScale = sizePx / NOTE_ICON_SIZE;
  const drawFlickDecor = (mark: ThumbnailMark) => {
    if (!dec) return;
    sprites.sprite.renderDecorator(
      ctx,
      { canvasX: mark.x, canvasY: mark.y, drawW: NOTE_ICON_SIZE, drawH: NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE },
      dec,
      decorScale,
    );
  };
  if (dec) {
    for (const mark of scene.keyMarks) if (mark.flick && !mark.dirSide) drawFlickDecor(mark);
    for (const mark of scene.slideMarks) if (mark.flick && mark.endpoint) drawFlickDecor(mark);
  }
}

/**
 * 滑条段：优先走画布同一份**带体光栅化**（`renderBandStrip`：截面剖面 = 中心暗 / 亮缘 / 软边，
 * 回折切分后逐行合成 = 自叠更亮；普通带与 SP 带各取自己的材质）。光栅化拿不到（无 DOM、
 * 或画布尚不可用）时退实心多边形 —— 缩略图至少还是一根带子，不会空白。
 */
function drawBands(
  ctx: CanvasRenderingContext2D,
  scene: PatternThumbnailScene,
  laneW: number,
  sprites: PatternThumbnailSprites,
): void {
  const half = (laneW / 2) * 0.92;
  for (const span of scene.spans) {
    const band = span.sp ? sprites.icons.slideBandSp : sprites.icons.slideBand;
    if (renderBandStrip(ctx, span.points, half, band, 1)) continue;
    drawBandFallback(ctx, span.points, half);
  }
}

/** 光栅化不可用时的退路：按回折切分的实心多边形（几何与光栅化同源） */
function drawBandFallback(ctx: CanvasRenderingContext2D, points: ThumbnailPoint[], half: number): void {
  ctx.save();
  ctx.fillStyle = THUMBNAIL_COLORS.span;
  ctx.globalAlpha = 0.85;
  for (const run of splitBandAtFolds(points)) {
    if (run.length < 2) continue;
    const polygon = bandPolygonAt(run, half);
    ctx.beginPath();
    polygon.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  sprites: PatternThumbnailSprites,
  mark: ThumbnailMark,
  sizePx: number,
  heightScale: number,
  configOf: (choice: IconChoiceCtx) => SpriteIconConfig,
): void {
  // 缩略图没有细分档概念（beat 只为色觉辅助的虚拍判断，未开该开关时不参与选款）
  const choice: IconChoiceCtx = { noteIcons: sprites.icons, beatDisplay: 1 };
  sprites.sprite.render(ctx, {
    ...configOf(choice),
    canvasX: mark.x,
    canvasY: mark.y,
    canvasSize: sizePx,
    canvasWidth: sizePx,
    canvasHeight: sizePx * heightScale,
    scale: 1,
    renderLayer: 'all',
  });
}
