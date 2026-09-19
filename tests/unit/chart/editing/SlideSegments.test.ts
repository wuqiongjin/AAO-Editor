// issue 106 · 非单调点序的**显示投影**（ADR-0009 §2.2，实机口径）：稳定排序 + 掐首尾 hidden。
// issue 115 · 同拍组的**数组序原样保留**（实机 repair() 只做上述两步，不重建走序）。
// 数据一字不动（代码弹窗/导出/编辑仍按原数组序），投影只服务"画布上看到的顺序"。
import { describe, it, expect } from 'vitest';
import type { ConnectionNote } from '@/src/chart/types';
import { displayConnections, isDisplayIdentity, slideSpans, visibleEnds } from '@/src/chart/editing/SlideSegments';

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

// issue 115 · 同拍组**保持数组序**（作者点序 = 带体走序）：
// 作者点序 = 带体走序；稳定排序在同拍内不换位，同拍对退化为零高度横跳，横移发生在哪一端由数组序决定。
describe('issue 115 · 同拍组保持数组序（走序不可重建）', () => {
  it('抖动段（beat 8→10 每步 `6,4`）原样保留 → 走恒等快路径', () => {
    const conns: ConnectionNote[] = [
      c(8, 6), c(8, 4), c(8.125, 6), c(8.125, 4), c(8.25, 6), c(8.25, 4),
    ];
    expect(isDisplayIdentity(conns)).toBe(true);
    expect(displayConnections(conns).conns).toBe(conns);
  });

  it('阶梯段（beat 16→18 的 `3,5 / 5,3` 交替）原样保留 → 竖条交替，不被改成斜带', () => {
    const conns: ConnectionNote[] = [
      c(16, 3), c(16.25, 3), c(16.25, 5), c(16.5, 5), c(16.5, 3), c(16.75, 3), c(16.75, 5),
    ];
    const r = displayConnections(conns);
    expect(r.conns.map((p) => `${p.beat}/${p.lane}`)).toEqual([
      '16/3', '16.25/3', '16.25/5', '16.5/5', '16.5/3', '16.75/3', '16.75/5',
    ]);
    expect(r.src).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('3+ 结点的同拍组同样原样保留（`0,4,2` 不被规范成 `0,2,4`）', () => {
    const conns: ConnectionNote[] = [c(13, 0), c(13, 4), c(13, 2)];
    expect(displayConnections(conns).src).toEqual([0, 1, 2]);
  });

  it('非单调点序下，同拍组的数组序同样保留（排序稳定之后不再重排）', () => {
    const conns: ConnectionNote[] = [c(3, 6), c(2, 6), c(3, 4)];
    const r = displayConnections(conns);
    expect(r.conns.map((p) => `${p.beat}/${p.lane}`)).toEqual(['2/6', '3/6', '3/4']);
    expect(r.src).toEqual([1, 0, 2]);
  });
});
