// 滑条「段」的逻辑分区（issue 77 二轮）：**hidden 结点对段透明**。
// [A, hidden, B] 是一整段 A→B（不是 A→hidden 与 hidden→B 两段）——
// 命中 / 框选 / 渲染描边 / 复制镜像 / 删除 全部按本模块的 span 口径，避免各处各写一份。
import type { SlideNote } from '../types';
import { isCanvasHiddenConn } from './NoteEditing';

export interface ConnSpan {
  /** 段起点（**可见**结点）的 real 下标 */
  start: number;
  /** 段终点（**可见**结点）的 real 下标 */
  end: number;
}

/**
 * 一条滑条的逻辑段：两端都是可见结点，中间可以跨过若干 hidden 结点。
 * 可见结点 < 2 → 无段（issue 106 起这种"退化滑条"允许从外部进来：
 * 可见 1 个按单键款画、可见 0 个画布上没有任何效果，见 `visibleEnds` / `displayConnections`）。
 */
export function slideSpans(conns: SlideNote['connections']): ConnSpan[] {
  const out: ConnSpan[] = [];
  let last: number | null = null;
  conns.forEach((c, i) => {
    if (isCanvasHiddenConn(c)) return;
    if (last !== null) out.push({ start: last, end: i });
    last = i;
  });
  return out;
}

/** 恒等判定（热路径用）：点序单调 + 首尾可见 → 显示序 = 原数组序（零分配）。 */
export function isDisplayIdentity(conns: SlideNote['connections']): boolean {
  for (let i = 1; i < conns.length; i++) {
    if (conns[i]!.beat < conns[i - 1]!.beat) return false;
  }
  const n = conns.length;
  if (n > 0 && (isCanvasHiddenConn(conns[0]!) || isCanvasHiddenConn(conns[n - 1]!))) return false;
  return true;
}

/**
 * **显示投影**（ADR-0009 §2.2 / issue 106 定案；同拍组走序见 issue 115）：把一条滑条的 connections
 * 投影成"画布上看到的顺序"。两步：
 *
 * 1. 按 beat **稳定排序**；
 * 2. **掐掉首尾 hidden**（排序后落到首 / 尾之外的结点等于被裁掉，图1 那种"看起来被忽略"就是这么来的）。
 *
 * 只此两步 = 实机 `repair()`（vendored `sonolus-bandori-engine` convert.ts L315-356）。
 * **同拍组（beat 全等的一串结点）一律保持数组序**：排序稳定，同拍内不换位；作者的点序就是带体的
 * 走序（同拍对退化为零高度横跳，横移落在哪一端由数组序决定），走序不可从代码重建。
 *
 * 外部进来的**非单调点序**靠这一层被"看见为实机所见"，而**数据一字不动**——
 * 代码弹窗、导出、段参数、拖带、删结点、`planDragMove` 一律仍按原数组序。
 *
 * 返回 `{ conns, src }`：`conns` = 投影后的点序列（元素是原对象引用），`src[i]` = 该点对应的
 * **原数组下标**。画布上的段列表走 `projectedSlideSpans`（投影 + 段 + 身份一次完成）；
 * 不要在命中/描边/实绘里各写一份 `slideSpans(view.conns)` + `src[start]`。
 */
export function displayConnections(conns: SlideNote['connections']): {
  conns: SlideNote['connections'];
  src: number[];
} {
  const n = conns.length;
  if (isDisplayIdentity(conns)) {
    return { conns, src: conns.map((_, i) => i) };
  }
  // 稳定排序：同 beat 保持原数组顺序（= 作者点序，走序不可重建）
  const src = conns.map((_, i) => i).sort((a, b) => (conns[a]!.beat - conns[b]!.beat) || (a - b));
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi && isCanvasHiddenConn(conns[src[lo]!]!)) lo++;
  while (hi >= lo && isCanvasHiddenConn(conns[src[hi]!]!)) hi--;
  const kept = lo > hi ? [] : src.slice(lo, hi + 1);
  return { conns: kept.map((i) => conns[i]!), src: kept };
}

/**
 * 首 / 尾**可见**结点的原下标（无可见结点 → first = last = -1）。
 *
 * 端点款图标的判据（`renderSlideBody` / 选中描边 / 幽灵三处共用）：首尾"不得 hidden"原本由校验兜住，
 * issue 106 起外部数据不再整份拒收 → 判据必须按"可见"而不是"数组下标 0 / 末位"；
 * **只剩 1 个可见结点**（退化滑条）时 first === last → 该结点按单键（端点）款画，与实机同形。
 */
export function visibleEnds(conns: SlideNote['connections']): { first: number; last: number } {
  let first = -1;
  let last = -1;
  for (let i = 0; i < conns.length; i++) {
    const conn = conns[i]!;
    if (isCanvasHiddenConn(conn)) continue;
    // 端点 = beat 最小 / 最大者（与 `displayConnections` 投影后的首尾同源；非单调点序下
    // 数组序的首尾未必是画布上的两端 → 带子的真端点会被画成中间款）
    if (first < 0 || conn.beat < conns[first]!.beat) first = i;
    if (last < 0 || conn.beat > conns[last]!.beat) last = i;
  }
  return { first, last };
}

export interface DisplaySlideRegion extends ConnSpan {
  /** 选区 / 命中身份 = 显示段起点的**原数组**下标（与 `view.src[sp.start]` 同口径） */
  connIndex: number;
}

export interface ProjectedSlideSpans {
  conns: SlideNote['connections'];
  src: number[];
  regions: DisplaySlideRegion[];
}

/**
 * 画布上的段列表：取点走显示投影，每段身份仍是原下标。
 * 命中 / 框选 / 选中描边共用，禁止各写一份 `displayConnections` + `slideSpans` + `src[start]`。
 */
export function projectedSlideSpans(conns: SlideNote['connections']): ProjectedSlideSpans {
  const view = displayConnections(conns);
  const regions: DisplaySlideRegion[] = slideSpans(view.conns).map((sp) => ({
    start: sp.start,
    end: sp.end,
    connIndex: view.src[sp.start]!,
  }));
  return { conns: view.conns, src: view.src, regions };
}

export interface RegionIdentity {
  /** 作者轴逻辑段（`slideSpans(原数组)`） */
  span: ConnSpan;
  /** 段参数 / 烘焙 / 捏形用的可见结点对序数 */
  ordinal: number;
}

/**
 * `slideRegion.connIndex` → 作者轴段身份（编辑侧；ADR-0009：数据层仍按数组序）。
 * 口径与旧 `spanOfRegion` / `ordinalOfRegion` 相同。
 */
export function regionIdentity(
  conns: SlideNote['connections'],
  connIndex: number,
): RegionIdentity | null {
  const spans = slideSpans(conns);
  const ordinal = spans.findIndex((sp) => connIndex >= sp.start && connIndex < sp.end);
  if (ordinal < 0) return null;
  return { span: spans[ordinal]!, ordinal };
}

/** 某个 real region 下标（i 与 i+1 之间的连接带）所属的**逻辑段**；无 → null */
export function spanOfRegion(conns: SlideNote['connections'], ci: number): ConnSpan | null {
  return regionIdentity(conns, ci)?.span ?? null;
}

/** 某 real region 所属逻辑段的**序数**（slideSpans 数组下标 = 可见结点对序数）；无 → -1 */
export function ordinalOfRegion(conns: SlideNote['connections'], ci: number): number {
  return regionIdentity(conns, ci)?.ordinal ?? -1;
}

/**
 * 该 region 覆盖的**全部** real 结点下标（含段内 hidden）；
 * 找不到所属段时回退成"两邻结点"（防御，兼容旧语义）。
 */
export function spanConnIndices(conns: SlideNote['connections'], ci: number): number[] {
  const sp = spanOfRegion(conns, ci);
  if (!sp) {
    const out: number[] = [];
    if (conns[ci]) out.push(ci);
    if (conns[ci + 1]) out.push(ci + 1);
    return out;
  }
  const out: number[] = [];
  for (let i = sp.start; i <= sp.end; i++) out.push(i);
  return out;
}

/**
 * 同条 Slide/Long 是否用 SP 无缝带（ADR-0009 §5 / issue 157）：任一结点 `hidden` → 整条传染。
 * 必须看**源 connections**，不要看掐过首尾 hidden 的显示投影。
 */
export function slideUsesSpBand(conns: SlideNote['connections']): boolean {
  return conns.some(c => c.hidden === true);
}

/**
 * 该 region（ci 与 ci+1 之间的连接带）是否用 SP 材质：region 合法且整条传染为 SP。
 */
export function isSpRegion(conns: SlideNote['connections'], ci: number): boolean {
  return spanOfRegion(conns, ci) !== null && slideUsesSpBand(conns);
}
