// issue 106 · 非单调点序的**显示投影**（ADR-0009 §2.2，实机口径）：稳定排序 + 掐首尾 hidden。
// 数据一字不动（代码弹窗/导出/编辑仍按原数组序），投影只服务"画布上看到的顺序"。
import { describe, it, expect } from 'vitest';
import type { ConnectionNote } from '../../src/chart/types';
import { displayConnections, slideSpans, visibleEnds } from '../../src/chart/editing/SlideSegments';

const c = (beat: number, lane: number, hidden = false): ConnectionNote =>
  hidden ? { beat, lane, hidden: true } : { beat, lane };

describe('issue 106 · 可见结点不足的处置（visibleEnds / 退化滑条）', () => {
  it('端点判据按"可见"：首尾 hidden 时指向第一/最后一个可见结点', () => {
    expect(visibleEnds([c(1, 0, true), c(2, 1), c(3, 2), c(4, 3, true)])).toEqual({ first: 1, last: 2 });
  });

  it('只剩 1 个可见结点 → first === last（该结点按单键 / 端点款画，与实机同形）', () => {
    expect(visibleEnds([c(1, 0, true), c(2, 1), c(3, 2, true)])).toEqual({ first: 1, last: 1 });
    expect(visibleEnds([c(1, 0)])).toEqual({ first: 0, last: 0 });
  });

  it('全 hidden / 空数组 → -1（画布上没有任何效果，数据仍原样保留）', () => {
    expect(visibleEnds([c(1, 0, true), c(2, 1, true)])).toEqual({ first: -1, last: -1 });
    expect(visibleEnds([])).toEqual({ first: -1, last: -1 });
  });
});

describe('issue 106 · 显示投影 displayConnections（稳定排序 + 掐首尾 hidden）', () => {
  it('合法滑条（点序单调 + 首尾可见）→ 恒等快路径：返回原数组引用、下标即原下标', () => {
    const conns: ConnectionNote[] = [c(1, 0), c(1.5, 2, true), c(2, 6)];
    const r = displayConnections(conns);
    expect(r.conns).toBe(conns);
    expect(r.src).toEqual([0, 1, 2]);
  });

  it('图1 案例：非法点全在起点之前 → 排序后落到首部被裁掉，只剩首尾两点（画布上是一条直线）', () => {
    const conns: ConnectionNote[] = [
      c(2.5, 0),
      c(2.4375, 0.5983, true), c(2.375, 0.887, true), c(2.3125, 1.1238, true), c(2.25, 1.3358, true),
      c(2.1875, 1.6249, true), c(2.125, 2.152, true), c(2.0625, 3.0818, true),
      c(3, 6),
    ];
    const r = displayConnections(conns);
    expect(r.src).toEqual([0, 8]);
    expect(r.conns.map((p) => p.beat)).toEqual([2.5, 3]);
    expect(slideSpans(r.conns)).toEqual([{ start: 0, end: 1 }]);
  });

  it('4 点判定实验：夹在中间的非法点保留 → 投影 = 稳定排序后的点序（带子只横向折、不回头）', () => {
    const conns: ConnectionNote[] = [c(1, 0), c(1.5, 2, true), c(1.25, 5, true), c(2, 6)];
    const r = displayConnections(conns);
    expect(r.src).toEqual([0, 2, 1, 3]);
    const beats = r.conns.map((p) => p.beat);
    expect(beats).toEqual([1, 1.25, 1.5, 2]);
    expect(beats.every((b, i) => i === 0 || b >= beats[i - 1]!)).toBe(true);
  });

  it('同 beat 稳定排序：保持原数组顺序（与实机 repair() 的 sort 同口径）', () => {
    expect(displayConnections([c(2, 0), c(1, 1), c(1, 2)]).src).toEqual([1, 2, 0]);
  });

  it('掐首尾 hidden：两端的不可见结点被裁掉（实机不画它们）', () => {
    expect(displayConnections([c(1, 0, true), c(2, 1), c(3, 2, true)]).src).toEqual([1]);
    expect(displayConnections([c(1, 0, true), c(2, 1, true)]).src).toEqual([]);
  });

  it('纯函数：不改入参（数组与元素都不动），投影元素是原对象引用', () => {
    const conns: ConnectionNote[] = [c(2, 0), c(1, 1), c(3, 2)];
    const snapshot = JSON.parse(JSON.stringify(conns));
    const r = displayConnections(conns);
    expect(JSON.parse(JSON.stringify(conns))).toEqual(snapshot);
    expect(r.conns[0]).toBe(conns[1]);
  });
});
