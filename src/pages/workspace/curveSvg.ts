// 曲线 / 形状模板的竖向 SVG 几何路径构造器（零 React 依赖，胶囊摘要与面板网格共用）。
import { easing, type EasingFamily, type EasingType } from '../../chart/editing/Easing';
import {
  relativeChordOffset,
  resolveTemplateExtra,
  templateMappingMode,
  type ShapeTemplate,
} from '../../chart/editing/ShapeTemplates';
import type { TemplateExtraValue } from '../../chart/types';

export interface SvgCurveGeometry {
  strokePath: string;
  bandPolygons: string[];
  startPt: [number, number];
  endPt: [number, number];
}

type Pt2D = { x: number; y: number };

/** 将一段或多段中心线折线转成 SVG stroke 路径与对称半宽带体多边形 */
function runsToSvgGeometry(runs: Pt2D[][], halfBand: number, startPt: [number, number], endPt: [number, number]): SvgCurveGeometry {
  const strokePath = runs
    .map((r) => r.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
    .join(' ');
  const bandPolygons = runs.map((r) => {
    const left = r.map((p) => `${(p.x - halfBand).toFixed(1)},${p.y.toFixed(1)}`);
    const right = [...r].reverse().map((p) => `${(p.x + halfBand).toFixed(1)},${p.y.toFixed(1)}`);
    return [...left, ...right].join(' ');
  });
  return { strokePath, bandPolygons, startPt, endPt };
}

/**
 * 为形状模板生成竖向 SVG 轨迹（底部 t=0 → 顶部 t=1）。
 * 统一按 1 拍基准采样，使预览缩略图与画布实际放置的 1 拍滑条密度一致；
 * 同拍跃迁（Δt = 0）拆分为多条 `M ... L ...`，还原零高度横跳断带效果。
 */
export function buildTemplateSvgPath(
  tp: ShapeTemplate,
  width: number,
  height: number,
  opts?: {
    mirrored?: boolean;
    ampScale?: number;
    densityScale?: number;
    extra?: Record<string, TemplateExtraValue>;
    padX?: number;
    padY?: number;
  },
): SvgCurveGeometry {
  const mirrored = !!opts?.mirrored;
  const ampScale = opts?.ampScale ?? 1;
  const densityScale = opts?.densityScale ?? 1;
  const padX = opts?.padX ?? 6;
  const padY = opts?.padY ?? 5;
  const resolvedExtra = resolveTemplateExtra(tp, opts?.extra);
  const rawPts = tp.sample ? tp.sample(1, 32, densityScale, resolvedExtra) : tp.points;

  const y0 = height - padY;
  const y1 = padY;
  const isEndpointInterp = templateMappingMode(tp) === 'endpoint-interp';
  const inset = Math.min(padX + (width > 28 ? 3 : 0), width * 0.25);
  const cx = width / 2;
  const x0 = isEndpointInterp ? inset : cx;
  const x1 = isEndpointInterp ? width - inset : cx;
  const maxSwing = (cx - padX) * 0.88;
  const mapX = (off: number) => Math.max(2, Math.min(width - 2,
    isEndpointInterp
      ? x0 + (x1 - x0) * off
      : cx + relativeChordOffset(off, mirrored, tp, resolvedExtra) * ampScale * maxSwing,
  ));
  const startPt: [number, number] = [x0, y0];
  const endPt: [number, number] = [x1, y1];
  const all: (Pt2D & { t: number })[] = [
    { t: 0, x: x0, y: y0 },
    ...rawPts.map((p) => ({
      t: p.t,
      x: mapX(p.off),
      y: y0 - p.t * (y0 - y1),
    })),
    { t: 1, x: x1, y: y1 },
  ];

  // Δt === 0 时分段，不连接同拍水平跳转线段
  const runs: Pt2D[][] = [];
  let cur: Pt2D[] = [all[0]!];
  for (let i = 1; i < all.length; i++) {
    if (Math.abs(all[i]!.t - all[i - 1]!.t) < 1e-6) {
      if (cur.length >= 2) runs.push(cur);
      cur = [all[i]!];
    } else {
      cur.push(all[i]!);
    }
  }
  if (cur.length >= 2) runs.push(cur);

  const halfBand = tp.adjustableDensity
    ? Math.max(1.4, width * 0.05)
    : Math.max(2.0, width * 0.08);
  return runsToSvgGeometry(runs, halfBand, startPt, endPt);
}

/** 为缓动函数生成竖向 SVG 轨迹（左下 → 右上） */
export function buildEasingSvgPath(
  family: EasingFamily,
  type: EasingType,
  width: number,
  height: number,
  padX = 6,
  padY = 5,
): SvgCurveGeometry {
  const fn = easing(family, type);
  const x0 = padX + 3;
  const x1 = width - padX - 3;
  const y0 = height - padY;
  const y1 = padY;
  const steps = 32;
  const pts: Pt2D[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = Math.max(1.5, Math.min(width - 1.5, x0 + (x1 - x0) * fn(t)));
    pts.push({ x, y: y0 + (y1 - y0) * t });
  }
  return runsToSvgGeometry([pts], Math.max(2.2, width * 0.085), [x0, y0], [x1, y1]);
}
