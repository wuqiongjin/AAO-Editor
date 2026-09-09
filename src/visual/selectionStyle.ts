// 画布选中 / hover 描边样式常量（issue 56 a + c）。
//
// 画布恒定深色、与主题（亮/暗）无关 → 独立常量模块，**不接 CSS 设计令牌**
// （读 token 需每帧 getComputedStyle，无收益）。选中 / hover / 滑条子部分共用一套配色，
// 仅亮度与 α 分档；框选矩形（进行中的临时反馈）保留独立色，不在这里。
// 取值均为目检初值，开发期可直接调本文件（grill Q10/Q11/Q16/Q49）。

/** 描边配色：亮面 / 暗底（真实选中外圈，替代 shadowBlur）/ 危险色（删除持工具态 hover） */
export const SELECTION_COLORS = {
  /** 亮面：选中、hover、滑条子部分共用（浅黄） */
  bright: '#FFE066',
  /** 暗底：仅真实选中，画在亮面外侧一圈 */
  dark: 'rgba(0, 0, 0, 0.45)',
  /** 危险红：删除工具持工具态下的 hover（同形态换色，Q49） */
  danger: '#FF5A5A',
} as const;

/**
 * 描边几何。单位 = **设计 px**，实际像素 = 本值 × spriteScale
 * （spriteScale = viewport.scale × noteSize）→ 描边随音符大小缩放、永远贴合外边缘（A5）。
 */
export const SELECTION_OUTLINE = {
  /** 亮面线宽（下限 1 屏幕 px：极小 noteSize 下仍可见） */
  lineWidth: 2,
  /** 暗底相对亮面的单侧外扩 */
  darkBand: 1.5,
  /** 圆角半径 */
  radius: 4,
  /** 描边相对 ink 矩形的外扩（选中/hover 基准） */
  outset: 2,
  /** hover / 危险描边的附加外扩：与真实选中叠加时形成外圈，两者可辨（Q11） */
  hoverOutset: 2,
  /** 真实选中 α（暗底自身带 0.45 不透明度） */
  selectedAlpha: 1,
  /** hover / 危险描边 α：比真实选中轻一档（Q11/Q49） */
  hoverAlpha: 0.7,
  /** BPM 线选中/hover 的线宽：细线描边不明显 → 整条改色 + 加粗（Q45） */
  bpmLineWidth: 4,
  /** 斜段（平行四边形）外扩的 miter 上限（× 外扩量）：近水平的细段不会拉出长尖刺 */
  miterLimit: 3,
} as const;

/**
 * 已有幽灵预览的态不画 hover（C4）：放置族 + 粘贴 + 镜像。
 * 其余态（指针 / 删除 / 镜像以外的动作族 / BPM / 滑条）都画。
 */
export const HOVER_GHOST_TOOLS: readonly string[] = [
  'single', 'flick', 'skill', 'ldirectional', 'rdirectional', 'paste', 'mirror',
];
