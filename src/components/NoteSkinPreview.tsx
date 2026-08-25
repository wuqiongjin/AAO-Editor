// 音符皮肤·综合预览画布（issue 29 grill Q8=B）：
// 用**真实渲染路径**（CanvasSpriteIcon + buildActiveNoteIcons）绘制六类样例——
// 单键 / 滑键（含顶部箭头）/ 技能键 / 左方向键 / 右方向键 / 滑条（连接带+端点+中间结点），
// 选择变化即时重绘，让用户看清"哪种音符对应的皮肤现在是什么样子"。
import { useEffect, useRef } from 'react';
import CanvasSpriteIcon from './CanvasSpriteIcon';
import { buildActiveNoteIcons, type NoteSkinSelection } from '../renderer/noteSkin';

const CELL_COUNT = 6;

export default function NoteSkinPreview({ selection }: { selection: NoteSkinSelection }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const icons = buildActiveNoteIcons(selection);
    const W = 660;
    const H = 128;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);

    let cancelled = false;
    const sprite = new CanvasSpriteIcon();

    const draw = () => {
      if (cancelled) return;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      // 深色底（谱面画布固定深色的主题边界）+ 轨道分隔示意线
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1;
      for (let i = 1; i < CELL_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo((W / CELL_COUNT) * i, 6);
        ctx.lineTo((W / CELL_COUNT) * i, H - 6);
        ctx.stroke();
      }

      const cellX = (i: number) => (W / CELL_COUNT) * (i + 0.5);
      const cy = H * 0.52;
      const S = 2; // 预览放大倍数（相对画布内音符设计尺寸 36×21.6）

      // 1 单键（lane 3 精灵）
      sprite.render(ctx, {
        ...icons.tapFor(3),
        canvasX: cellX(0), canvasY: cy, canvasSize: 36,
        canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
      });
      // 2 滑键（本体 + 顶部箭头挂件，与画布渲染同构）
      sprite.render(ctx, {
        ...icons.flickFor(3),
        decorators: icons.flickTopDecorator ? [icons.flickTopDecorator] : [],
        canvasX: cellX(1), canvasY: cy, canvasSize: 36,
        canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
      });
      // 3 技能键
      sprite.render(ctx, {
        ...icons.skillFor(3),
        canvasX: cellX(2), canvasY: cy, canvasSize: 36,
        canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
      });
      // 4/5 左右方向键：扁平本体 + 外侧箭头（与画布渲染同构，len=1）
      const S_DIR = S * 0.9;
      for (const [cell, type] of [[3, 'L'], [4, 'R']] as const) {
        const group = icons.dirGroup(type, 1);
        const cx = cellX(cell);
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
      }
      // 6 滑条：连接带（整图拉伸）+ 端点(单键皮肤) + 中间结点(note_slide_among)
      sprite.render(ctx, {
        ...icons.slideBand,
        canvasX: cellX(5), canvasY: cy, canvasSize: 84,
        canvasWidth: 18, canvasHeight: 92, scale: 1, renderLayer: 'main',
      });
      sprite.render(ctx, {
        ...icons.slideEndpointFor(3),
        canvasX: cellX(5), canvasY: cy - 36, canvasSize: 36,
        canvasWidth: 36, canvasHeight: 21.6, scale: 1.3, renderLayer: 'main',
      });
      sprite.render(ctx, {
        ...icons.slideAmongFor(3),
        canvasX: cellX(5), canvasY: cy, canvasSize: 36,
        canvasWidth: 36, canvasHeight: 21.6, scale: 1.3, renderLayer: 'main',
      });
      sprite.render(ctx, {
        ...icons.slideEndpointFor(3),
        canvasX: cellX(5), canvasY: cy + 36, canvasSize: 36,
        canvasWidth: 36, canvasHeight: 21.6, scale: 1.3, renderLayer: 'main',
      });
    };

    // 图片就绪后绘制；单图失败也画一次（缺图格留深底，drawSingle 每帧级重试语义一致）
    CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
      .catch(() => undefined)
      .then(draw);

    return () => {
      cancelled = true;
    };
  }, [selection]);

  return (
    <div className="skin-live-preview">
      <canvas ref={canvasRef} className="skin-live-preview-canvas" aria-label="音符皮肤综合预览" />
      <div className="skin-live-preview-labels" aria-hidden="true">
        {['单键', '滑键', '技能键', '左方向', '右方向', '滑条'].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}