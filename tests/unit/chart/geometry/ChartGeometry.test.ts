import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  ChartGeometry,
  LANES,
  LANE_WIDTH,
  TRACK_CHROME_TOTAL,
  directionalLanes,
  quantizeBeat,
} from '@/src/chart/geometry/ChartGeometry';
import type { ChartNote } from '@/src/chart/types';
import { repoRoot } from '@/tests/support/source';

const bpm120 = [{ beat: 0, bpm: 120 }];
// issue 50：测试用默认 surface（旧 DEFAULT_SURFACE 值）；新构造函数 surface 必传
const TEST_SURFACE = { w: 750, h: 900 };
const TEST_SURFACE_W_NARROW = 200;
const surface = (over: Partial<{ w: number; h: number }> = {}) => ({ w: over.w ?? TEST_SURFACE.w, h: over.h ?? TEST_SURFACE.h });

// ---------------------------------------------------------------------------
// issue 70 候选 3 的**前提**：谱面光标（beat/lane）是「画布 px × 当前 viewport」的派生值。
// 同一像素在滚动/缩放后指向的是另一个拍 —— 所以这个换算的**结果不能被缓存**，
// 否则执行键（Ctrl+B/E/F..S）与 Ctrl+V 会落在一个已经不属于该位置的拍上（用户已复现）。
// 本组把这条前提钉住：若哪天 laneBeatFromCanvas 与 viewport 解耦，这条会红。
// ---------------------------------------------------------------------------
describe('laneBeatFromCanvas 对 viewport 的依赖（候选 3 前提）', () => {
  const g = new ChartGeometry(bpm120, { endBeat: 400 } , TEST_SURFACE);
  const viewport = (over: Partial<{ scrollY: number; scale: number }> = {}) => ({
    scrollX: 0, scrollY: over.scrollY ?? 0, scale: over.scale ?? 0.5,
    virtualWidth: 0, virtualHeight: 0,
  });
  // 轨道内某像素：第 2 轨中心、画布纵向中部
  const cx = (() => {
    const { trackBgX } = g.trackGeometry(0.5);
    return trackBgX + (LANE_WIDTH * 0.5) * 2.5;
  })();

  it('同一画布 px：滚动后指向另一个拍（故不能缓存换算结果）', () => {
    const a = g.laneBeatFromCanvas(cx, 450, viewport(), 4);
    const b = g.laneBeatFromCanvas(cx, 450, viewport({ scrollY: 400 }), 4);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.preciseBeat - b!.preciseBeat)).toBeGreaterThan(1);
  });

  it('同一画布 px：缩放后指向另一个拍', () => {
    const a = g.laneBeatFromCanvas(cx, 450, viewport(), 4);
    const c = g.laneBeatFromCanvas(cx, 450, viewport({ scale: 1 }), 4);
    expect(Math.abs(a!.preciseBeat - c!.preciseBeat)).toBeGreaterThan(1);
  });

  it('沟槽内（轨道外）→ null，光标不可用', () => {
    const { trackBgX } = g.trackGeometry(0.5);
    expect(g.laneBeatFromCanvas(trackBgX - 40, 450, viewport(), 4)).toBeNull();
  });
});

describe('trackGeometry', () => {
  it('轨道水平居中、左右对称', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 100 } , surface());
    const { totalTrackWidth, trackStartX, trackBgX, trackBgWidth } = g.trackGeometry(1);
    expect(totalTrackWidth).toBe(LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2);
    expect(trackStartX).toBe((TEST_SURFACE.w - totalTrackWidth) / 2);
    expect(trackBgX).toBe(trackStartX + TRACK_CHROME_TOTAL);
    expect(trackBgWidth).toBe(LANES * LANE_WIDTH);
  });
});

describe('坐标换算', () => {
  it('beatToVirtualY 自下而上：beat 0 落在判定线（画布底边）处', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    // chartEndVirtualY = 8拍 * 220px = 1760；总高 = 1760 + 渲染面高/scale（判定线=渲染面底边，ADR-0006 §2）
    expect(g.chartEndVirtualY).toBe(8 * 220);
    const total = g.totalVirtualHeight(1);
    expect(total).toBe(1760 + TEST_SURFACE.h);
    // beat0 → 顶部（总高 - 0）= 总高；经翻转后位于判定线
    expect(g.beatToVirtualY(0, 1)).toBe(total);
    expect(g.beatToVirtualY(8, 1)).toBe(TEST_SURFACE.h);
  });

  it('渲染面尺寸变化时总高随渲染面高自适应（ADR-0006 §1）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , { w: 400, h: 600 });
    expect(g.totalVirtualHeight(1)).toBe(1760 + 600);
    expect(g.beatToVirtualY(8, 1)).toBe(600); // 判定线 = 渲染面底边
  });

  it('virtualYToBeat 与 beatToVirtualY 互逆', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    for (const beat of [0, 1, 3.5, 8]) {
      expect(g.virtualYToBeat(g.beatToVirtualY(beat, 1), 1)).toBeCloseTo(beat, 6);
    }
  });

  it('virtualToCanvas / canvasToVirtual 互逆', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    const viewport = { scrollX: 0, scrollY: 100, scale: 1.5 };
    const v = { x: 15, y: 500 };
    const c = g.virtualToCanvas(v.x, v.y, viewport);
    const back = g.canvasToVirtual(c.x, c.y, viewport);
    expect(back.x).toBeCloseTo(v.x, 6);
    expect(back.y).toBeCloseTo(v.y, 6);
  });

  it('noteVirtualY 计入 subBeat 折算', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    const beatDisplay = 4;
    const y0 = g.noteVirtualY(0, 0, 1, beatDisplay);
    const y1 = g.noteVirtualY(0, 2, 1, beatDisplay); // 0.5 拍
    // 0.5 拍 = 110px，向上（y 更小）
    expect(Math.abs((y0 - y1) - 110)).toBeLessThan(1e-6);
  });
});

describe('laneBeatFromCanvas', () => {
  it('轨道内命中返回 lane 与吸附后的精确拍', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    // 滚到底（scrollY=chartEndVirtualY）使判定线处为 beat 0
    const viewport = { scrollX: 0, scrollY: g.chartEndVirtualY, scale: 1 };
    const { trackBgX } = g.trackGeometry(1);
    const cx = trackBgX + LANE_WIDTH * 2 + LANE_WIDTH / 2; // lane 2 中心
    const cy = TEST_SURFACE.h; // 判定线（画布底边）处 = beat 0
    const pos = g.laneBeatFromCanvas(cx, cy, viewport, 4);
    expect(pos).not.toBeNull();
    expect(pos!.lane).toBe(2);
    expect(pos!.preciseBeat).toBeCloseTo(0, 6);
  });

  it('轨道外返回 null', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
    expect(g.laneBeatFromCanvas(-5, 10, viewport, 4)).toBeNull();
  });
});

describe('effectiveScale 缩放钳制（ADR-0006 Q4=A）', () => {
  it('宽渲染面下不钳制：effectiveScale = 用户 scale', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , { w: 750, h: 900 });
    expect(g.effectiveScale(1)).toBe(1);
  });

  it('窄渲染面下钳制到恰好容纳 7 轨（不变形、不裁剪）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , { w: 200, h: 500 });
    const es = g.effectiveScale(1);
    const { trackBgWidth, trackStartX, totalTrackWidth } = g.trackGeometry(1);
    // 轨道完全容纳于渲染面宽内
    expect(trackStartX).toBeGreaterThanOrEqual(0);
    expect(trackStartX + totalTrackWidth).toBeLessThanOrEqual(g.surface.w);
    // 等比钳制：effectiveScale = fitWidth = 200 / (210 + 18)（外框 chrome 随缩放，分母含 chrome）
    expect(es).toBeCloseTo(TEST_SURFACE_W_NARROW / (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL), 6);
    expect(trackBgWidth).toBeCloseTo(LANES * LANE_WIDTH * es, 6);
  });

  // 候选 3-b 的**前提**：请求值（工具栏「+」的上限 3.0）可以超过 fitWidth，此时
  // effectiveScale 把它压到 fitWidth —— 「ui.scale（请求值）≠ 生效值」这个分歧就由此而来。
  // 末条幂等断言尤为关键：它保证画布把生效值回写进 ui.scale 后不会来回振荡。
  it('请求值超过 fitWidth 时被压低，且与生效值不相等（候选 3-b 分歧的前提）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , { w: 500, h: 900 }); // fitWidth ≈ 2.19 < 3
    const requested = 3; // 与 FinalVirtualCanvas 的 MAX_SCALE / 工具栏「+」上限一致
    const es = g.effectiveScale(requested);
    expect(es).toBeCloseTo(500 / (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL), 6);
    expect(es).toBeLessThan(requested);
  });

  it('幂等：把生效值再喂回 effectiveScale 不变（回写不振荡的保证）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , { w: 500, h: 900 });
    const es = g.effectiveScale(3);
    expect(g.effectiveScale(es)).toBeCloseTo(es, 12);
    // 连喂多次仍稳定
    expect(g.effectiveScale(g.effectiveScale(es))).toBeCloseTo(es, 12);
  });

  it('外框 chrome 随缩放缩放：预留与边条绘制一致（issue 51 修订，沟槽文字距离恒定的前提）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    for (const es of [0.5, 1, 2.5]) {
      const { trackStartX, trackBgX, totalTrackWidth } = g.trackGeometry(es);
      expect(trackBgX - trackStartX).toBeCloseTo(TRACK_CHROME_TOTAL * es, 6);
      expect(totalTrackWidth).toBeCloseTo((LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL) * es, 6);
      // 居中对称：左右沟槽等宽
      expect(trackStartX).toBeCloseTo((TEST_SURFACE.w - totalTrackWidth) / 2, 6);
    }
  });
});

// issue 144：工具栏数字「默认 100%」的判据靠 `fitScale` 区分两种钳制 ——
// ① 画布连 1× 都装不下（fitScale < 1，窄窗/高系统缩放）→ 数字保持用户请求值（100%），不回写生效值；
// ② 画布装得下（fitScale ≥ 1）但请求值更高 → 仍回写（保住 2026-09-10 修的「300% vs 263% 死行程」）。
describe('fitScale：区分「装不下 1×」与「请求值被上限钳住」（issue 144）', () => {
  it('fitScale = 恰好铺满渲染面宽的那个缩放', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 }, surface());
    expect(g.fitScale()).toBeCloseTo(TEST_SURFACE.w / (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL), 12);
    expect(g.fitScale()).toBeGreaterThan(1);
  });

  it('窄渲染面：fitScale < 1（用户的 88% 场景），effectiveScale 仍钳到 fitScale', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 }, { w: TEST_SURFACE_W_NARROW, h: 500 });
    expect(g.fitScale()).toBeCloseTo(TEST_SURFACE_W_NARROW / (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL), 12);
    expect(g.fitScale()).toBeLessThan(1);
    expect(g.effectiveScale(1)).toBeCloseTo(g.fitScale(), 12);
  });

  it('effectiveScale 的钳制口径不随本票改变（回归）', () => {
    const gWide = new ChartGeometry(bpm120, { endBeat: 8 }, { w: 500, h: 900 });
    expect(gWide.fitScale()).toBeGreaterThan(1);
    expect(gWide.effectiveScale(3)).toBeCloseTo(gWide.fitScale(), 12);
    expect(gWide.effectiveScale(1)).toBe(1);
  });
});

describe('visibleNotes 视口剔除', () => {
  const ch = (beat: number) => ({ type: 'Single' as const, lane: 0, beat, subBeat: 0 });

  const beatOf = (n: { note: ChartNote }) => (n.note as { beat: number }).beat;

    it('只返回视口内的音符', () => {
      const g = new ChartGeometry(bpm120, { endBeat: 100 } , surface());
      const notes = [ch(0), ch(50), ch(100)];
      // beat0→y=22840(顶)、beat50→y=11840、beat100→y=840(判定线)；scrollY=0 视口 y∈[0,1100]
      const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
      const visible = g.visibleNotes(notes, viewport, 4);
      expect(visible.map(beatOf)).toEqual([100]);
    });

    it('滚动后可见集变化', () => {
      const g = new ChartGeometry(bpm120, { endBeat: 100 } , surface());
      const notes = [ch(0), ch(50), ch(100)];
      // scrollY=11000 → 视口 y∈[10800,12100]，命中 beat50(y=11840)
      const viewport = { scrollX: 0, scrollY: 11000, scale: 1 };
      const visible = g.visibleNotes(notes, viewport, 4);
      expect(visible.map(beatOf)).toEqual([50]);
    });
});

// ---------------------------------------------------------------------------
// issue 90：滚轮缩放锚定改为**判定线（画布底边）**—— scrollY 缩放期间保持不变，
// 与工具栏 ±/百分比缩放（只 setScale）完全同口径。旧「以光标为锚」的 zoomAnchorScrollY 已删除：
// 锚点使 scrollY 随缩放变化 ∝（光标Y − 画布高），放大了「滚动条回写在缩放提交窗口内用陈旧值覆写」
// 的回弹竞态（越靠上部越明显、判定线处恒为 0）。
// 锚点数学随函数删除，纯单测无处可锁 → 本组做**结构断言**（照 EditorAudioSessionRefactor.test.ts
// 惯例防回归）；DOM 时序（滚动条回写竞态）单测覆盖不到 → Playwright/手工验收
// （照 scripts/measure-browser-zoom.mjs 口径，脚本不入库）。
// ---------------------------------------------------------------------------
describe('issue 90 · 滚轮缩放锚定判定线（结构断言）', () => {
  const root = repoRoot;

  it('zoomAnchorScrollY 全库零引用（光标锚机制整体删除）', () => {
    // 全库口径（票面要求）：递归扫 src/ 全部 ts/tsx（防任何角落悄悄复留调用）
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (name === 'node_modules') return [];
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : (/\.(ts|tsx)$/.test(name) ? [full] : []);
      });
    const offenders = walk(join(root, 'src'))
      .filter((f) => readFileSync(f, 'utf-8').includes('zoomAnchorScrollY'))
      .map((f) => f.replace(root + '/', ''));
    expect(offenders).toEqual([]);
  });

  it('视口变化重算走 GestureSession.onViewportChange（issue 113：不再扫 handleWheel 源）', () => {
    const sessionSrc = readFileSync(join(root, 'src/chart/editing/GestureSession.ts'), 'utf-8');
    expect(sessionSrc).toMatch(/onViewportChange\s*\(/);
    expect(sessionSrc).toContain('marqueeRect');
  });
});

// issue 62：方向滑键占用轨道 = 一份共享口径（命中/框选/拖拽/描边四处同一真相）
describe('directionalLanes / 方向键虚拟点集（issue 62）', () => {
  it('L 向左展开、R 向右展开、本体数 ceil(width)（ADR-0014）', () => {
    expect(directionalLanes(3, 'RDirectional', 3)).toEqual([3, 4, 5]);
    expect(directionalLanes(3, 'LDirectional', 3)).toEqual([3, 2, 1]);
    expect(directionalLanes(3, 'RDirectional', 1)).toEqual([3]);
    expect(directionalLanes(3, 'RDirectional', 4.25)).toEqual([3, 4, 5, 6, 7]);
    expect(directionalLanes(3, 'RDirectional', 9)).toHaveLength(9);
    expect(directionalLanes(3, 'RDirectional', 0)).toEqual([]);
    expect(directionalLanes(6, 'RDirectional', 2)).toEqual([6, 7]);      // 越界轨号照实返回，调用方自判
  });

  it('noteVirtualPoints 对方向键返回全部占用轨道（框选据此判定）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 100 } , surface());
    const pts = g.noteVirtualPoints({ type: 'LDirectional', beat: 10, lane: 4, subBeat: 0, length: 3 } as ChartNote, 1, 4);
    expect(pts).toHaveLength(3);
    expect(pts.map(p => p.x)).toEqual([4, 3, 2].map(lane => g.noteVirtualX(lane)));
    expect(new Set(pts.map(p => p.y)).size).toBe(1); // 整组同一拍位（同一水平线）
  });

  it('单键仍然只有根点（不误扩）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 100 } , surface());
    expect(g.noteVirtualPoints({ type: 'Single', beat: 10, lane: 4, subBeat: 0 } as ChartNote, 1, 4)).toHaveLength(1);
  });
});

describe('quantizeBeat（issue 61 的唯一量化口径）', () => {
  it('按 beatDisplay 吸附；0/负数退化为整拍', () => {
    expect(quantizeBeat(2.125, 8)).toBeCloseTo(2.125, 10);
    expect(quantizeBeat(2.125, 4)).toBeCloseTo(2.25, 10);
    expect(quantizeBeat(2.6, 1)).toBe(3);
    expect(quantizeBeat(2.6, 0)).toBe(3);
  });

  it('laneBeatFromCanvas 同时给出量化拍与未量化拍（未量化供拖拽抓取偏移）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 } , surface());
    const viewport = { scrollX: 0, scrollY: g.chartEndVirtualY, scale: 1 };
    const { trackBgX } = g.trackGeometry(1);
    const cx = trackBgX + LANE_WIDTH * 2 + LANE_WIDTH / 2;
    // 判定线上方一点点 = beat 略大于 0 且不在 1/4 网格上
    const cy = TEST_SURFACE.h - 20;
    const pos = g.laneBeatFromCanvas(cx, cy, viewport, 4);
    expect(pos).not.toBeNull();
    expect(pos!.rawBeat).toBeGreaterThan(pos!.preciseBeat - 1e-9);
    expect(Math.abs(pos!.preciseBeat * 4 - Math.round(pos!.preciseBeat * 4))).toBeLessThan(1e-9);
  });
});
