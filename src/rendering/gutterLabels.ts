// 外侧装饰文字系统（issue 51 grill 定案 2026-09-06；同日第二轮修订）：
// 贴轨道外缘、恒定 CSS 像素间距与字号的画布标注文字体系。
// 双带制（第二轮 Q2=A）：BPM 数值贴轨道（内带），START/END 远离轨道（外带）——水平分带互不抢占。
// 与端点文字不再互相让位；同沟槽内撞 y 的 BPM 数值按 issue 159 纵向错开。
// 字号（第二轮 Q1=A）：基准 14px × settings.display.labelScale（50%..300%），缩放中恒定。
// 实时显示线两侧信息（issue 54）是"实时信息文字"另一类样式（11px 基准、等宽、中性白），
// 不走本模块字号，只复用沟槽锚定思想。
import type { Coords } from './coords';

/** 内带：BPM 数值右缘距轨道左外缘的恒定间距 */
export const BPM_LABEL_GAP_PX = 8;
/** 常显标线文字基准字号（× labelScale；缩放中恒定，如轨道外装饰）。
 *  第二轮补修订：默认形态即原 150% 观感 → 基准 14→21px（labelScale 100% = 21px） */
export const GUTTER_LABEL_FONT_PX = 21;
/** 文字与所标注线条的纵向间隙（above/below 时）。第三轮：0——与 BPM 数值骑线（居中、
 *  距离 0）的观感一致，START/END 文字盒贴线 */
export const GUTTER_LABEL_LINE_GAP_PX = 0;

/** 沟槽文字分带：bpm = 内带（BPM 数值）、bound = 外带（START/END） */
export type GutterBand = 'bpm' | 'bound';

/**
 * 外带间距（动态，随文字大小系数放大）：BPM 数值最多 3 位数字，外带必须让其出
 * 内带文字盒 + 间隔，保证双带在任何 labelScale 下都不重叠（第二轮 Q2=A）。
 */
export function boundLabelGapPx(labelScale: number): number {
  return BPM_LABEL_GAP_PX + Math.ceil(GUTTER_LABEL_FONT_PX * labelScale * 2.2) + 8;
} // labelScale=1 → 63px

/** 常显标线文字的纵向位置语义：垂直居中于线（BPM 数值）/ 线上方（START）/ 线下方（END） */
export type GutterLabelPlacement = 'centered' | 'above' | 'below';

export interface GutterLabelLayout {
  x: number;
  y: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  font: string;
  /** 字号（px）：宽度/可见性判定与命中盒共用 */
  fontPx: number;
}

const GUTTER_LABEL_FONT = (px: number) => `600 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/**
 * 沟槽文字宽度（等宽字体）：给 ctx 就精确测量，否则按 0.62em 估算。
 * **绘制与命中判定必须共用本函数**，否则沟槽宽度临界时会出现"已隐藏但仍可点中"的隐形热区。
 */
export function measureGutterLabelWidth(
  text: string,
  fontPx: number,
  ctx?: CanvasRenderingContext2D | null,
): number {
  const measured = ctx ? (ctx.font = GUTTER_LABEL_FONT(fontPx), ctx.measureText(text)?.width ?? 0) : 0;
  return measured > 0 ? measured : Math.max((text.length || 3) * fontPx * 0.62, fontPx);
}

/**
 * 常显标线文字的锚定布局（纯函数，供单测）：
 * 右对齐到「轨道左外缘 − 分带间距」，纵向按 placement 相对 lineCanvasY 定位，
 * 字号 = 带基准 × labelScale（恒定 CSS 像素，缩放中距离与大小不变）。
 */
export function layoutGutterLabel(
  c: Coords,
  scale: number,
  lineCanvasY: number,
  placement: GutterLabelPlacement,
  band: GutterBand = 'bpm',
  labelScale = 1,
): GutterLabelLayout {
  const { trackStartX } = c.trackGeometry(scale);
  const gap = band === 'bpm' ? BPM_LABEL_GAP_PX : boundLabelGapPx(labelScale);
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * labelScale);
  const base: GutterLabelLayout = {
    x: trackStartX - gap,
    y: lineCanvasY,
    textAlign: 'right',
    textBaseline: 'middle',
    font: GUTTER_LABEL_FONT(fontPx),
    fontPx,
  };
  if (placement === 'above') {
    // alphabetic 基线 = 大写墨迹底正好压线（'bottom' 基线含下伸空间，墨迹会悬空 ~5px）
    base.y = lineCanvasY - GUTTER_LABEL_LINE_GAP_PX;
    base.textBaseline = 'alphabetic';
  } else if (placement === 'below') {
    base.y = lineCanvasY + GUTTER_LABEL_LINE_GAP_PX;
    base.textBaseline = 'top';
  }
  return base;
}

/**
 * 按 layout 绘制一枚外侧装饰文字（薄封装；布局数学见 layoutGutterLabel）。
 * 沟槽宽度不足（文字盒左缘越出画布）时整体隐藏——优雅降级（第二轮 Q2 定案）。
 * 返回是否实际绘制。
 */
export function drawGutterLabel(ctx: CanvasRenderingContext2D, layout: GutterLabelLayout, text: string, color: string): boolean {
  ctx.save();
  ctx.font = layout.font;
  // 与命中判定共用同一套宽度/可见性判定（measureGutterLabelWidth）
  const textWidth = measureGutterLabelWidth(text, layout.fontPx ?? GUTTER_LABEL_FONT_PX, ctx);
  if (layout.x - textWidth < 0) {
    ctx.restore();
    return false;
  }
  ctx.fillStyle = color;
  ctx.textAlign = layout.textAlign;
  ctx.textBaseline = layout.textBaseline;
  ctx.fillText(text, layout.x, layout.y);
  ctx.restore();
  return true;
}

/**
 * 沟槽标线文字的**横向钳制**：文字盒越出画布左缘时整体右移，而不是像 `drawGutterLabel` 那样隐藏。
 * `drawGutterLabel` 的"放不下就隐藏"是给**编辑器**定的（那里沟槽够宽，溢出说明布局有问题）；
 * 预览面板的沟槽只有 ~30px（13 车道宽里轨道占 7），隐藏等于开关没效果，故"必看"的读数
 * （chart-preview 08 的 Time 标记）走钳制——与实时读数盒 `clampHoverInfoX` 同一取舍。
 */
export function clampGutterLabelX(layout: GutterLabelLayout, textWidth: number, minX = 2): GutterLabelLayout {
  const x = layout.x - textWidth < minX ? textWidth + minX : layout.x;
  return x === layout.x ? layout : { ...layout, x };
}

/** 与 bpmLabelBox 纵向半高相同（字号一半 + 4px 命中容差）。 */
export function bpmGutterHitHalf(fontPx: number): number {
  return fontPx / 2 + 4;
}

/** 沟槽 BPM 墨迹盒是否与画布纵向相交（半截算相交；不含命中 +4 容差）。 */
export function bpmGutterYIntersectsCanvas(y: number, fontPx: number, surfaceH: number): boolean {
  const half = fontPx / 2;
  return y + half > 0 && y - half < surfaceH;
}

/** 展开叠仍有真数字落在画布上（含半截）→ 滚动不折回摘要。 */
export function bpmExpandedNumeralsOnCanvas(ys: readonly number[], fontPx: number, surfaceH: number): boolean {
  return ys.some((y) => bpmGutterYIntersectsCanvas(y, fontPx, surfaceH));
}

/**
 * beat 0 数字中心在线上方半个字高：贴判定线时整盒在画布内，滚动时与线 1:1 钉住并裁切。
 * 不能按画布底边钳 y（字会停在底边、线自己走）。其它拍仍居中于线。
 */
export function bpmLabelAnchorY(beat: number, y: number, fontPx: number, _surfaceH: number): number {
  if (beat !== 0) return y;
  return y - fontPx / 2;
}

/** 同位组摘要：各 `值 [n]` 自带颜色，右对齐到内带锚点。 */
export function drawBpmSummary(
  ctx: CanvasRenderingContext2D,
  layout: GutterLabelLayout,
  tokens: readonly BpmSummaryToken[],
  colorOf: (bpm: number) => string,
): boolean {
  const full = bpmSummaryFullText(tokens);
  const fontPx = layout.fontPx ?? GUTTER_LABEL_FONT_PX;
  const total = measureGutterLabelWidth(full, fontPx, ctx);
  if (layout.x - total < 0) return false;
  ctx.save();
  ctx.font = layout.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = layout.textBaseline;
  let x = layout.x - total;
  tokens.forEach((tok, i) => {
    const piece = i === 0 ? tok.text : `, ${tok.text}`;
    ctx.fillStyle = colorOf(tok.bpm);
    ctx.fillText(piece, x, layout.y);
    x += measureGutterLabelWidth(piece, fontPx, ctx);
  });
  ctx.restore();
  return true;
}

/** 文字盒纵向钳制（纯函数）：把 layout.y 钳入画布，保证文字盒完整可见（"都在谱面范围内"） */
export function clampGutterLabelY(layout: GutterLabelLayout, surfaceH: number, fontPx: number): GutterLabelLayout {
  const half = fontPx / 2;
  if (layout.textBaseline === 'middle') layout.y = Math.min(Math.max(layout.y, half), surfaceH - half);
  else if (layout.textBaseline === 'top') layout.y = Math.min(Math.max(layout.y, 0), surfaceH - fontPx);
  else layout.y = Math.min(Math.max(layout.y, fontPx), surfaceH); // bottom / alphabetic：基线最低=画布底缘
  return layout;
}

/**
 * 沟槽 BPM 数值纵向错开（issue 159）：文字盒在画布 y 上相交的收成一组，
 * 组内按 beat 升序错开、间距 = 字号，组中心仍对准各成员线 y 的均值。
 * 绘制与命中共用；横线几何不走这里。
 */
export function layoutBpmLabelYs(
  items: ReadonlyArray<{ beat: number; lineCanvasY: number }>,
  fontPx: number,
): number[] {
  const n = items.length;
  const ys = items.map((it) => it.lineCanvasY);
  if (n <= 1) return ys;
  const half = fontPx / 2;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < n; i++) {
    const a1 = items[i]!.lineCanvasY - half;
    const a2 = items[i]!.lineCanvasY + half;
    for (let j = i + 1; j < n; j++) {
      const b1 = items[j]!.lineCanvasY - half;
      const b2 = items[j]!.lineCanvasY + half;
      if (a1 < b2 && a2 > b1) unite(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  for (const members of groups.values()) {
    members.sort((a, b) => items[a]!.beat - items[b]!.beat || a - b);
    const center = members.reduce((s, i) => s + items[i]!.lineCanvasY, 0) / members.length;
    const minBeat = Math.min(...members.map((i) => items[i]!.beat));
    // beat 0 组贴判定线：最低一枚中心落在线上（再经 bpmLabelAnchorY 上移半个字高后整盒在画布内），其余只往上排。
    const start = minBeat === 0
      ? center - (members.length - 1) * fontPx
      : center - ((members.length - 1) * fontPx) / 2;
    members.forEach((idx, k) => {
      ys[idx] = start + k * fontPx;
    });
  }
  return ys;
}

/** 同位组键：虚拟 Y 量化。滚动只改画布 y，键不变。 */
export function bpmCoincidentKey(virtualY: number): number {
  return Math.round(virtualY * 1e4) / 1e4;
}

export interface BpmSummaryToken {
  bpm: number;
  count: number;
  /** 形如 `184` 或 `184 [2]`（次数 ≥2 才带括号） */
  text: string;
}

/** 同位组摘要词：带符号值按组内最小 beat 升序；次数 ≥2 才写 `[n]`。分隔 = `, `。 */
export function bpmSummaryTokens(members: ReadonlyArray<{ beat: number; bpm: number }>): BpmSummaryToken[] {
  const byVal = new Map<number, { count: number; minBeat: number }>();
  for (const m of members) {
    const cur = byVal.get(m.bpm);
    if (!cur) byVal.set(m.bpm, { count: 1, minBeat: m.beat });
    else {
      cur.count += 1;
      if (m.beat < cur.minBeat) cur.minBeat = m.beat;
    }
  }
  return [...byVal.entries()]
    .sort((a, b) => a[1].minBeat - b[1].minBeat || a[0] - b[0])
    .map(([bpm, v]) => ({
      bpm,
      count: v.count,
      text: v.count <= 1 ? String(bpm) : `${bpm} [${v.count}]`,
    }));
}

export function bpmSummaryFullText(tokens: readonly BpmSummaryToken[]): string {
  return tokens.map((t) => t.text).join(', ');
}

export interface BpmGutterSummary {
  key: number;
  lineCanvasY: number;
  tokens: BpmSummaryToken[];
  fullText: string;
  memberIndexes: number[];
}

export interface BpmGutterNumeral {
  noteIndex: number;
  beat: number;
  bpm: number;
  y: number;
  /** 展开中的同位组键；未折组 / 单条为 null */
  groupKey: number | null;
}

export interface BpmGutterLayout {
  summaries: BpmGutterSummary[];
  numerals: BpmGutterNumeral[];
}

/**
 * 沟槽 BPM 显示模型（issue 159 定案 2 + issue 161）：线 y 相同且 ≥2 条 → 摘要（展开组除外）；
 * 其余走 159 盒相交错开；展开组钉线错开、不平移进画布（出界靠绘制裁切）。
 */
export function layoutBpmGutter(
  notes: ReadonlyArray<{ type: string; beat?: number; bpm?: number }>,
  lineCanvasYOf: (beat: number) => number,
  virtualYOf: (beat: number) => number,
  fontPx: number,
  expandedKey: number | null,
): BpmGutterLayout {
  const slots: { noteIndex: number; beat: number; bpm: number; lineCanvasY: number; key: number }[] = [];
  notes.forEach((n, noteIndex) => {
    if (n.type !== 'BPM' || n.beat === undefined) return;
    const bpm = n.bpm ?? 0;
    slots.push({
      noteIndex, beat: n.beat, bpm,
      lineCanvasY: lineCanvasYOf(n.beat),
      key: bpmCoincidentKey(virtualYOf(n.beat)),
    });
  });
  const byKey = new Map<number, typeof slots>();
  for (const s of slots) {
    const g = byKey.get(s.key);
    if (g) g.push(s);
    else byKey.set(s.key, [s]);
  }
  const summaries: BpmGutterSummary[] = [];
  const staggerItems: { beat: number; lineCanvasY: number; noteIndex: number; bpm: number }[] = [];
  const expandedSlots: typeof slots = [];
  for (const [key, members] of byKey) {
    if (members.length >= 2 && key !== expandedKey) {
      const tokens = bpmSummaryTokens(members);
      summaries.push({
        key,
        lineCanvasY: members[0]!.lineCanvasY,
        tokens,
        fullText: bpmSummaryFullText(tokens),
        memberIndexes: members.map((m) => m.noteIndex),
      });
    } else if (members.length >= 2 && key === expandedKey) {
      expandedSlots.push(...members);
    } else {
      for (const m of members) staggerItems.push(m);
    }
  }
  const numerals: BpmGutterNumeral[] = [];
  const staggerYs = layoutBpmLabelYs(staggerItems, fontPx);
  staggerItems.forEach((it, i) => {
    numerals.push({ noteIndex: it.noteIndex, beat: it.beat, bpm: it.bpm, y: staggerYs[i]!, groupKey: null });
  });
  if (expandedSlots.length > 0) {
    expandedSlots.sort((a, b) => a.beat - b.beat || a.noteIndex - b.noteIndex);
    const raw = layoutBpmLabelYs(expandedSlots, fontPx);
    const key = expandedSlots[0]!.key;
    expandedSlots.forEach((it, i) => {
      numerals.push({ noteIndex: it.noteIndex, beat: it.beat, bpm: it.bpm, y: raw[i]!, groupKey: key });
    });
  }
  return { summaries, numerals };
}

/**
 * BPM 数值文字盒（§5 手势仲裁修订 2026-09-08）：**只认数字自身的横向范围**，
 * 不再把整条水平线都判成命中（否则左沟槽双击/单击在数字所在高度上永远吃不掉起点标记手势）。
 * 与 §5 就地编辑输入框同款宽度估算（等宽字体 0.62em + 8px 内边距，最少 2 字宽），
 * 右缘 = 内带锚点（轨道左外缘 − BPM_LABEL_GAP_PX）+ 少量容差；纵向与绘制同款居中 + 容差，
 * 纵向钉在 lineCanvasY；传入 surfaceH 时命中盒与画布求交（半截可点，完全出画 y1≥y2）。
 * 纯函数（不依赖 canvas 测量），供命中判定与单测共用。
 */
export function bpmLabelBox(
  trackStartX: number,
  lineCanvasY: number,
  text: string,
  labelScale = 1,
  surfaceH?: number,
  /** 文字宽度：由 measureGutterLabelWidth 给出（可传画布 ctx 精确测量），与绘制端同一套判定 */
  textWidth?: number,
): { x1: number; x2: number; y1: number; y2: number } {
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * labelScale);
  const right = trackStartX - BPM_LABEL_GAP_PX;
  const width = (textWidth ?? measureGutterLabelWidth(text, fontPx)) + 8;
  const half = bpmGutterHitHalf(fontPx);
  let y1 = lineCanvasY - half;
  let y2 = lineCanvasY + half;
  if (surfaceH !== undefined) {
    y1 = Math.max(y1, 0);
    y2 = Math.min(y2, surfaceH);
  }
  return { x1: right - width, x2: right + 4, y1, y2 };
}
