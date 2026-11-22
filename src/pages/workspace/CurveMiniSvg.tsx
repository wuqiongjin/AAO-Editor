// 曲线与形状模板的共享迷你 SVG 图标组件（收起胶囊、模板卡片、缓动预览台共用）。
import type { EasingFamily, EasingType } from '../../chart/editing/Easing';
import type { ShapeTemplate } from '../../chart/editing/ShapeTemplates';
import type { TemplateExtraValue } from '../../chart/types';
import { buildEasingSvgPath, buildTemplateSvgPath, type SvgCurveGeometry } from './curveSvg';

/** 形状模板与缓动函数共用同一套几何骨架，只差墨色（绿 / 蓝）——墨色由 CSS 变量按主题给，
 *  见 `CurveConfigPanel.css` 的 `.ccp-svg--shape / --easing`。 */
function CurveSvgFrame({
  geometry,
  width,
  height,
  variant,
  strokeWidth,
  dotRadius,
}: {
  geometry: SvgCurveGeometry;
  width: number;
  height: number;
  variant: 'shape' | 'easing';
  strokeWidth: string;
  dotRadius: string;
}) {
  const { strokePath, bandPolygons, startPt, endPt } = geometry;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`ccp-svg ccp-svg--${variant}`}
      aria-hidden="true"
    >
      <line
        className="ccp-svg__chord"
        x1={startPt[0]}
        y1={startPt[1]}
        x2={endPt[0]}
        y2={endPt[1]}
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      {bandPolygons.map((pts, i) => (
        <polygon key={i} className="ccp-svg__band" points={pts} />
      ))}
      <path
        className="ccp-svg__line"
        d={strokePath}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="ccp-svg__dot" cx={startPt[0]} cy={startPt[1]} r={dotRadius} />
      <circle className="ccp-svg__dot" cx={endPt[0]} cy={endPt[1]} r={dotRadius} />
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
  extra,
}: {
  template: ShapeTemplate;
  width?: number;
  height?: number;
  mirrored?: boolean;
  ampScale?: number;
  densityScale?: number;
  extra?: Record<string, TemplateExtraValue>;
}) {
  const geometry = buildTemplateSvgPath(template, width, height, {
    mirrored,
    ampScale,
    densityScale,
    extra,
    padX: 6,
    padY: 5,
  });
  return (
    <CurveSvgFrame
      geometry={geometry}
      width={width}
      height={height}
      variant="shape"
      strokeWidth={template.adjustableDensity ? '1.35' : '1.75'}
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
      variant="easing"
      strokeWidth="1.8"
      dotRadius="2.2"
    />
  );
}
