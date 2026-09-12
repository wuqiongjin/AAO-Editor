// 滑条「段」的逻辑分区（issue 77 二轮）：**hidden 结点对段透明**。
// [A, hidden, B] 是一整段 A→B（不是 A→hidden 与 hidden→B 两段）——
// 命中 / 框选 / 渲染描边 / 复制镜像 / 删除 全部按本模块的 span 口径，避免各处各写一份。
import type { SlideNote } from '../types';

export interface ConnSpan {
  /** 段起点（**可见**结点）的 real 下标 */
  start: number;
  /** 段终点（**可见**结点）的 real 下标 */
  end: number;
}

/**
 * 一条滑条的逻辑段：两端都是可见结点，中间可以跨过若干 hidden 结点。
 * 可见结点 < 2（理论上不会出现，首尾不得 hidden）→ 无段。
 */
export function slideSpans(conns: SlideNote['connections']): ConnSpan[] {
  const out: ConnSpan[] = [];
  let last: number | null = null;
  conns.forEach((c, i) => {
    if (c.hidden) return; // hidden 不作分界
    if (last !== null) out.push({ start: last, end: i });
    last = i;
  });
  return out;
}

/** 某个 real region 下标（i 与 i+1 之间的连接带）所属的**逻辑段**；无 → null */
export function spanOfRegion(conns: SlideNote['connections'], ci: number): ConnSpan | null {
  return slideSpans(conns).find(sp => ci >= sp.start && ci < sp.end) ?? null;
}

/** 某 real region 所属逻辑段的**序数**（slideSpans 数组下标 = 可见结点对序数）；无 → -1 */
export function ordinalOfRegion(conns: SlideNote['connections'], ci: number): number {
  return slideSpans(conns).findIndex(sp => ci >= sp.start && ci < sp.end);
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
 * 该 region（ci 与 ci+1 之间的连接带）所属段是否为 **SP 段**（ADR-0009 §5）：
 * 段内任一 hidden 结点 → 整段用 SP 无缝带材质。段的中间结点必为 hidden
 * （可见结点作分界），故 `end - start > 1` ⟺ 段内含 hidden。
 */
export function isSpRegion(conns: SlideNote['connections'], ci: number): boolean {
  const sp = spanOfRegion(conns, ci);
  return sp !== null && sp.end - sp.start > 1;
}
