// 曲线与形状模板的共享迷你 SVG 图标组件（收起胶囊、模板卡片、缓动预览台共用）。
import type { EasingFamily, EasingType } from '../../chart/editing/Easing';
import type { ShapeTemplate } from '../../chart/editing/ShapeTemplates';
import { buildEasingSvgPath, buildTemplateSvgPath, type SvgCurveGeometry } from './curveSvg';

function CurveSvgFrame({
  geometry,
  width,
  height,
  chordStroke,
  bandFill,
  stroke,
  strokeWidth,
  dotFill,
  dotStroke,
  dotRadius,
}: {
  geometry: SvgCurveGeometry;
  width: number;
  height: number;
  chordStroke: string;
  bandFill: string;
  stroke: string;
  strokeWidth: string;
  dotFill: string;
  dotStroke?: string;
  dotRadius: string;
}) {
  const { strokePath, bandPolygons, startPt, endPt } = geometry;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="ccp-svg" aria-hidden="true">
      <line
        x1={startPt[0]}
        y1={startPt[1]}
        x2={endPt[0]}
        y2={endPt[1]}
        stroke={chordStroke}
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      {bandPolygons.map((pts, i) => (
        <polygon key={i} points={pts} fill={bandFill} />
      ))}
      <path
        d={strokePath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={startPt[0]} cy={startPt[1]} r={dotRadius} fill={dotFill} stroke={dotStroke} strokeWidth={dotStroke ? '1' : undefined} />
      <circle cx={endPt[0]} cy={endPt[1]} r={dotRadius} fill={dotFill} stroke={dotStroke} strokeWidth={dotStroke ? '1' : undefined} />
    </svg>
  );
}

export function MiniTemplateSvg({
  template,
  width = 46,
  height = 48,
  mirrored = false,
  ampScale = 1,
  densityScale = 1,
}: {
  template: ShapeTemplate;
  width?: number;
  height?: number;
  mirrored?: boolean;
  ampScale?: number;
  densityScale?: number;
}) {
  const geometry = buildTemplateSvgPath(template, width, height, {
    mirrored,
    ampScale,
    densityScale,
    padX: 6,
    padY: 5,
  });
  return (
    <CurveSvgFrame
      geometry={geometry}
      width={width}
      height={height}
      chordStroke="rgba(255,255,255,0.18)"
      bandFill="rgba(74, 222, 128, 0.26)"
      stroke="#4ade80"
      strokeWidth={template.adjustableDensity ? '1.35' : '1.75'}
      dotFill="#86efac"
      dotStroke="#14532d"
      dotRadius="2.3"
    />
  );
}

export function MiniEasingSvg({
  family,
  type,
  width = 76,
  height = 96,
}: {
  family: EasingFamily;
  type: EasingType;
  width?: number;
  height?: number;
}) {
  const geometry = buildEasingSvgPath(family, type, width, height, 6, 5);
  return (
    <CurveSvgFrame
      geometry={geometry}
      width={width}
      height={height}
      chordStroke="rgba(255,255,255,0.16)"
      bandFill="rgba(56, 189, 248, 0.22)"
      stroke="#38bdf8"
      strokeWidth="1.8"
      dotFill="#bae6fd"
      dotRadius="2.2"
    />
  );
}
