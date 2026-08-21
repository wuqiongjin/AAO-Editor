/**
 * 精灵图可视化定位工具（issue 41）纯逻辑：矩形归一化/钳制/墨迹缩进/网格步长/注册表条目生成/选区微调。
 * 与 React 解耦便于单测；UI 层（SpriteLocator.tsx）只管画布绘制与交互。
 * 输出格式与 issue 40 规范化后的 BaseSpriteIcons 注册表条目一致（像素矩形 {x,y,w,h} + 可选 inkLeft/inkRight）。
 */

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridSteps {
  /** 次网格步长（源像素） */
  minor: number;
  /** 主网格步长（源像素），次网格的整数倍 */
  major: number;
}

/** 选区缩放手柄（8 向） */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 拖拽两点 → 左上角起点 + 宽高（与拖拽方向无关） */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): PixelRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** 把矩形钳制进图片范围内，并保证最小 1×1（0 尺寸选区不产生条目） */
export function clampRect(rect: PixelRect, imgW: number, imgH: number): PixelRect {
  const x = clamp(rect.x, 0, Math.max(0, imgW - 1));
  const y = clamp(rect.y, 0, Math.max(0, imgH - 1));
  const w = clamp(rect.w, 1, Math.max(1, imgW - x));
  const h = clamp(rect.h, 1, Math.max(1, imgH - y));
  return { x, y, w, h };
}

/** 四舍五入到整数像素（选区吸附 1px） */
export function roundRect(rect: PixelRect): PixelRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.round(rect.h),
  };
}

/** inner 是否**包含**在 outer 内（含边界相切），且与 outer 不完全重合（至少一侧有真实缩进）。
 *  说明：方向滑键墨迹常占满框架高度（y/h 与框架一致）、只在水平方向缩进，故相切必须放行。 */
export function isInside(inner: PixelRect, outer: PixelRect): boolean {
  const insideAll =
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
  if (!insideAll) return false;
  const identical =
    inner.x === outer.x &&
    inner.y === outer.y &&
    inner.x + inner.w === outer.x + outer.w &&
    inner.y + inner.h === outer.y + outer.h;
  return !identical;
}

/**
 * 自适网格：从 1/2/5/10/… 序列选步长，使网格线视觉间距 ≥ minPx（显示像素）。
 * major 取比 minor 大、且视觉间距 ≥ minPx×5 的最小序列值；找不到时回退 minor×5。
 */
export function pickGridSteps(zoom: number, minPx = 24): GridSteps {
  const series = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  let minor = series[series.length - 1];
  for (const step of series) {
    if (step * zoom >= minPx) {
      minor = step;
      break;
    }
  }
  let major = minor * 5;
  for (const step of series) {
    if (step > minor && step * zoom >= minPx * 5) {
      major = step;
      break;
    }
  }
  return { minor, major };
}

/** 多个墨迹矩形在 frame 内的**并集**边界（同一框架多墨迹时取总边界）；无有效墨迹返回 null */
export function unionInside(frame: PixelRect, inks: PixelRect[]): PixelRect | null {
  let result: PixelRect | null = null;
  for (const ink of inks) {
    if (!isInside(ink, frame)) continue;
    if (!result) {
      result = { x: ink.x, y: ink.y, w: ink.w, h: ink.h };
    } else {
      const right = Math.max(result.x + result.w, ink.x + ink.w);
      const bottom = Math.max(result.y + result.h, ink.y + ink.h);
      result.x = Math.min(result.x, ink.x);
      result.y = Math.min(result.y, ink.y);
      result.w = right - result.x;
      result.h = bottom - result.y;
    }
  }
  return result;
}

/** 计算墨迹缩进：ink 边界相对 frame 左右边的源像素距离（inkLeft/inkRight）；ink 不在 frame 内返回 null */
export function computeInkInsets(frame: PixelRect, ink: PixelRect): { inkLeft: number; inkRight: number } | null {
  if (!isInside(ink, frame)) return null;
  return {
    inkLeft: ink.x - frame.x,
    inkRight: frame.x + frame.w - (ink.x + ink.w),
  };
}

// ---- 选区微调（issue 41 第 2 轮：键盘/手柄/数值） ----

/** 整体平移（键盘 nudge / 拖拽移动共用）：平移并钳制进图片范围 */
export function moveRect(rect: PixelRect, dx: number, dy: number, imgW: number, imgH: number): PixelRect {
  const x = clamp(rect.x + dx, 0, Math.max(0, imgW - rect.w));
  const y = clamp(rect.y + dy, 0, Math.max(0, imgH - rect.h));
  return { x, y, w: rect.w, h: rect.h };
}

/**
 * 手柄拖拽缩放：沿被拖边移动，其余边固定；结果钳制进图片范围且保持最小尺寸。
 * 例：拖 `se` 手柄 (dx, dy) → 宽增 dx、高增 dy；拖 `nw` → 左上角移动、右下角锚定。
 */
export function resizeRect(
  rect: PixelRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  imgW: number,
  imgH: number,
  minSize = 2,
): PixelRect {
  const { x, y, w, h } = rect;
  const right = x + w;
  const bottom = y + h;

  let nx = x;
  let ny = y;
  let nw = w;
  let nh = h;

  if (handle.includes('w')) {
    nx = clamp(x + dx, 0, right - minSize);
    nw = right - nx;
  } else if (handle.includes('e')) {
    nw = clamp(right + dx, nx + minSize, imgW) - nx;
  }
  if (handle.includes('n')) {
    ny = clamp(y + dy, 0, bottom - minSize);
    nh = bottom - ny;
  } else if (handle.includes('s')) {
    nh = clamp(bottom + dy, ny + minSize, imgH) - ny;
  }

  return { x: nx, y: ny, w: nw, h: nh };
}

/** 命中检测：返回距点最近且在命中半径内的手柄；半径按显示像素（调用方传入 radius/zoom） */
export function hitTestHandle(rect: PixelRect, px: number, py: number, radius = 8): ResizeHandle | null {
  const pts: Array<[ResizeHandle, number, number]> = [
    ['nw', rect.x, rect.y],
    ['n', rect.x + rect.w / 2, rect.y],
    ['ne', rect.x + rect.w, rect.y],
    ['e', rect.x + rect.w, rect.y + rect.h / 2],
    ['se', rect.x + rect.w, rect.y + rect.h],
    ['s', rect.x + rect.w / 2, rect.y + rect.h],
    ['sw', rect.x, rect.y + rect.h],
    ['w', rect.x, rect.y + rect.h / 2],
  ];
  const r2 = radius * radius;
  let best: ResizeHandle | null = null;
  let bestDist = r2;
  for (const [handle, hx, hy] of pts) {
    const d = (px - hx) ** 2 + (py - hy) ** 2;
    if (d <= bestDist) {
      best = handle;
      bestDist = d;
    }
  }
  return best;
}

/** 点是否在矩形内（含边界） */
export function pointInRect(rect: PixelRect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// ---- 注册表条目生成 ----

/** 生成 BaseSpriteIcons 注册表条目（issue 40 规范化格式，与注册表书写风格一致；ink 可选） */
export function formatRegistryEntry(
  name: string,
  src: string,
  rect: PixelRect,
  ink?: { inkLeft: number; inkRight: number } | null,
): string {
  const lines = [
    `${name}: {`,
    `    src: '${src}',`,
    `    x: ${rect.x}, y: ${rect.y}, w: ${rect.w}, h: ${rect.h},`,
  ];
  if (ink) lines.push(`    inkLeft: ${ink.inkLeft}, inkRight: ${ink.inkRight}`);
  lines.push('},');
  return lines.join('\n');
}
