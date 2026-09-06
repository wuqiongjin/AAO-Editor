// 轨道颜色样式（issue 53 grill 定案 2026-09-06 第二轮修订）：
// - 层级区分靠**颜色**：等级越高越"亮眼"、越低越"暗"，但下限远离黑（最淡层 luma ≥ 90，
//   黑底上清晰可辨——用户明确"不要出现与黑色相关的颜色"）。
// - **形态阶梯改为可选开关（默认关）**：关闭时全部实线、仅靠颜色分层；开启后叠加
//   实线→长虚线→短虚线→点线→细点线的线形阶梯（LINE_SHAPE_LADDER，跨主题共享）。
// - 旧"经典/高对比/柔和"三预设删除，改为 4 个**颜色主题**（灰阶/琥珀/青蓝/多彩）。
// - BPM 标线颜色跟随主题主色（beat 层色，第二轮 Q5=B）。

export type GridStylePreset = 'mono' | 'amber' | 'cyan' | 'vivid';

export const GRID_STYLE_PRESETS: readonly GridStylePreset[] = ['mono', 'amber', 'cyan', 'vivid'];

export const DEFAULT_GRID_STYLE: GridStylePreset = 'vivid';

/** 网格层级（分母分层制）：整拍 > 1/2 > 1/4、3/4 > 1/8 类 > 1/16 类 */
export type GridTier = 'beat' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

/** 层级优先序（绘制与抽稀顺序：高层级先画、优先保留） */
export const GRID_TIER_ORDER: readonly GridTier[] = ['beat', 'half', 'quarter', 'eighth', 'sixteenth'];

/** 单层网格线样式：线宽（整拍加粗强调），颜色承载层级区分。
 *  alpha 缺省 1；整拍层 0.8（第三轮用户反馈：实线太显眼）——各主题整拍色已相应提亮，
 *  保证有效亮度（luma×alpha）仍居层级首位、不反转。 */
export interface GridTierStyle {
  color: string;
  width: number;
  alpha?: number;
}

export type GridStyleDef = Record<GridTier, GridTierStyle>;

/**
 * 线形分层阶梯（可选开关，跨主题共享）：实线 → 长虚线 → 短虚线 → 点线 → 细点线。
 * 仅在 settings.display.lineShapeTiers = true 时叠加（默认关）。
 */
export const LINE_SHAPE_LADDER: Record<GridTier, readonly [number, number] | null> = {
  beat: null,
  half: [10, 6],
  quarter: [4, 6],
  eighth: [1.5, 5],
  sixteenth: [1, 4],
};

/** 四颜色主题（亮度沿层级单调递减、luma 下限 ≥ 90；多彩 = 层级靠色相辨识 + 亮度排序） */
export const GRID_STYLES: Record<GridStylePreset, GridStyleDef> = {
  mono: {
    beat: { color: '#d9d9d9', width: 2, alpha: 0.8 },
    half: { color: '#9e9e9e', width: 1 },
    quarter: { color: '#838383', width: 1 },
    eighth: { color: '#6e6e6e', width: 1 },
    sixteenth: { color: '#5c5c5c', width: 1 },
  },
  amber: {
    beat: { color: '#ffdda6', width: 2, alpha: 0.8 },
    half: { color: '#e0a35a', width: 1 },
    quarter: { color: '#c2854e', width: 1 },
    eighth: { color: '#a56c44', width: 1 },
    sixteenth: { color: '#8a573c', width: 1 },
  },
  cyan: {
    beat: { color: '#a8e6f2', width: 2, alpha: 0.8 },
    half: { color: '#5cb8cc', width: 1 },
    quarter: { color: '#4798ae', width: 1 },
    eighth: { color: '#387a90', width: 1 },
    sixteenth: { color: '#326b7e', width: 1 },
  },
  vivid: {
    beat: { color: '#ffffff', width: 2, alpha: 0.8 },
    half: { color: '#6fd3e0', width: 1 },
    quarter: { color: '#6cc96c', width: 1 },
    eighth: { color: '#d99a4e', width: 1 },
    sixteenth: { color: '#d67f9f', width: 1 },
  },
};

/** 非法/缺省回退 vivid（与设置域 merge 的白名单归一化同语义，渲染侧兜底） */
export function normalizeGridStyle(v: unknown): GridStylePreset {
  return typeof v === 'string' && (GRID_STYLE_PRESETS as readonly string[]).includes(v)
    ? (v as GridStylePreset)
    : DEFAULT_GRID_STYLE;
}

/** 主题主色 = beat 层色（issue 53 第二轮 Q5=B：BPM 标线跟随主题） */
export function gridThemeBpmColor(preset: GridStylePreset): string {
  return GRID_STYLES[preset].beat.color;
}

/**
 * beat 内细分位置 → 层级（纯函数，供单测）：分数 = subIndex/beatDisplay 约分后按分母定层。
 * 分母 2 → half、4 → quarter、8 → eighth、≥16 → sixteenth（beatDisplay ∈ {2,4,8,16} 封顶 16）。
 */
export function gridTierOf(subIndex: number, beatDisplay: number): GridTier {
  let a = subIndex, b = beatDisplay;
  while (b !== 0) { const t = a % b; a = b; b = t; }
  const denom = beatDisplay / a;
  if (denom <= 2) return 'half';
  if (denom === 4) return 'quarter';
  if (denom === 8) return 'eighth';
  return 'sixteenth';
}

/**
 * 线形（issue 53 第二轮补修订）：
 * - 整拍**恒实线**；
 * - 线形分层**关闭**（默认）：非整拍统一**短虚线** [4,6]（与旧版子拍线形态连续）；
 * - 线形分层**开启**：按层级叠加阶梯 实线(仅整拍)→长虚线→短虚线→点线→细点线。
 * 返回虚线段（×es，实线为 null）。
 */
export function gridLineDash(tier: GridTier, lineShapeTiers: boolean | undefined, es: number): number[] | null {
  if (tier === 'beat') return null;
  if (!lineShapeTiers) return [4, 6].map((d) => d * es);
  const ladder = LINE_SHAPE_LADDER[tier];
  return ladder ? ladder.map((d) => d * es) : null;
}
