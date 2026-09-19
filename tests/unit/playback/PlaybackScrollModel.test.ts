// PlaybackScrollModel（候选 1 深模块）：秒↔scrollY↔滚动条映射 + 按秒重锚状态机 + 有效缩放钳制。
// 纯逻辑、node 环境可单测——脱离 DOM / RAF / ref 协议（架构深化评审候选 1）。
// 不变量来源：ADR-0004 §1/§3（判定线模型 + 滚动范围无空白）、ADR-0006 §2（判定线=画布底边）、
// issue 24（按秒重锚三段式）、issue 38（有效缩放钳制）。
import { describe, it, expect } from 'vitest';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import {
  secondsToBeat, beatToSeconds, type BpmEvent,
} from '@/src/audio/AudioTiming';

const bpm120: BpmEvent[] = [{ beat: 0, bpm: 120 }];
// 120bpm：每拍 0.5s、每拍 220px（BEAT_HEIGHT）。30s → chartEndVirtualY 13200。
// issue 104：几何一律按**谱面长度（秒）**构造（画布高度由秒直出，不再在调用点反查拍）。

const geom = (durationSeconds: number, surface = { w: 750, h: 900 }) =>
  new ChartGeometry(bpm120, { seconds: durationSeconds }, surface);

describe('PlaybackScrollModel · 倒流区（issue 104 修法 5：秒 ↔ scrollY 纯线性）', () => {
  // 120 → -120(beat 5) → 120(beat 6.5)：折返带 t ∈ [1.75, 2.5] 内同一 y 有三层
  const fold: BpmEvent[] = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -120 }, { beat: 6.5, bpm: 120 }];
  const g = new ChartGeometry(fold, { seconds: 2.5 }, { w: 750, h: 900 });
  const m = new PlaybackScrollModel(g, 1);

  it('画布高度 = 谱面长度(秒) × 像素密度（与 bpm / 倒流区无关）', () => {
    expect(g.virtualPxPerSecond).toBeCloseTo(2 * 220, 6); // 2·BEAT_HEIGHT·verticalRatio
    expect(g.chartEndVirtualY).toBeCloseTo(2.5 * 440, 6);
  });

  it('scrollY = chartEndVirtualY − 秒 × 像素密度；区内往返严格互逆（不经"秒 → 拍"）', () => {
    for (const s of [0, 0.5, 1.75, 2.125, 2.3, 2.5]) {
      expect(m.scrollYForSeconds(s)).toBeCloseTo(g.chartEndVirtualY - s * g.virtualPxPerSecond, 6);
      expect(m.secondsForScrollY(m.scrollYForSeconds(s))).toBeCloseTo(s, 6);
    }
  });
});

describe('PlaybackScrollModel · seconds ↔ scrollY（判定线=画布底边）', () => {
  it('scrollYForSeconds / secondsForScrollY 区间内互逆', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    for (const s of [0, 5, 15, 29.9]) {
      expect(m.secondsForScrollY(m.scrollYForSeconds(s))).toBeCloseTo(s, 6);
    }
  });

  it('beat0 → scrollY=底（maxCanvasScrollY）；谱面末端 → scrollY=0（顶）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    expect(m.scrollYForSeconds(0)).toBe(m.maxCanvasScrollY());
    expect(m.scrollYForSeconds(30)).toBe(0);
  });

  it('越界钳制到 [0, chartEndVirtualY]（负秒→判定线在 beat0=底；超大秒→末端=顶）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    expect(m.scrollYForSeconds(-5)).toBe(m.maxCanvasScrollY()); // 判定线停在最底（beat0）
    expect(m.scrollYForSeconds(1e9)).toBe(0);                  // 判定线停在最顶（末端）
  });

  it('与 ChartGeometry 既有坐标语义一致（吸收原画布 ref 数学）', () => {
    const g = geom(30);
    const m = new PlaybackScrollModel(g, 1);
    // 原画布 getScrollYForPlaybackSeconds：beatToVirtualY(beat) - surf.h/scale，再钳制
    for (const s of [0, 7, 15, 30]) {
      const beat = secondsToBeat(bpm120, s);
      const raw = g.beatToVirtualY(beat, 1) - g.surface.h / 1;
      const clamped = Math.max(0, Math.min(g.chartEndVirtualY, raw));
      expect(m.scrollYForSeconds(s)).toBeCloseTo(clamped, 6);
      // 原画布 getPlaybackSecondsForScrollY：virtualYToBeat(scrollY + surf.h/scale)
      const beatBack = g.virtualYToBeat(m.scrollYForSeconds(s) + g.surface.h, 1);
      expect(m.secondsForScrollY(m.scrollYForSeconds(s))).toBeCloseTo(beatToSeconds(bpm120, beatBack), 6);
    }
  });
});

describe('PlaybackScrollModel · 滚动范围', () => {
  it('scrollRange = {top:0, bottom:chartEndVirtualY}（谱面实际长度、无空白）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    const r = m.scrollRange();
    expect(r.top).toBe(0);
    expect(r.bottom).toBe(m.maxCanvasScrollY());
  });

  it('virtualHeight = chartEndVirtualY + surface.h / effectiveScale', () => {
    const g = geom(30);
    const m = new PlaybackScrollModel(g, 1);
    expect(m.virtualHeight()).toBeCloseTo(g.chartEndVirtualY + g.surface.h / g.effectiveScale(1), 6);
  });
});

describe('PlaybackScrollModel · 滚动条 ↔ 画布 scrollY 映射', () => {
  it('canvasScrollYToScrollTop / scrollTopToCanvasScrollY 互逆', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    const maxScroll = 1234;
    for (const y of [0, 100, 6600, m.maxCanvasScrollY()]) {
      expect(m.scrollTopToCanvasScrollY(m.canvasScrollYToScrollTop(y, maxScroll), maxScroll))
        .toBeCloseTo(y, 6);
    }
  });

  it('maxScroll<=0 时不越界（scrollTop 映射归 0）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    expect(m.scrollTopToCanvasScrollY(5, 0)).toBe(0);
    expect(m.canvasScrollYToScrollTop(100, 0)).toBe(0);
  });
});

describe('PlaybackScrollModel · 秒 → 滚动目标（issue 75：seek 与 RAF 同源）', () => {
  const m = () => new PlaybackScrollModel(geom(30), 1);

  it('scrollTargetForSeconds = scrollYForSeconds + canvasScrollYToScrollTop 同口径', () => {
    const model = m();
    const maxScroll = 1234;
    for (const s of [0, 5, 15, 29.9, 30]) {
      const t = model.scrollTargetForSeconds(s, maxScroll);
      expect(t.scrollY).toBeCloseTo(model.scrollYForSeconds(s), 6);
      expect(t.scrollTop).toBeCloseTo(model.canvasScrollYToScrollTop(model.scrollYForSeconds(s), maxScroll), 6);
    }
  });

  it('scrollTop 落在 [0, maxScroll]，且经 scrollTopToCanvasScrollY 反解回同一 scrollY', () => {
    const model = m();
    const maxScroll = 4321;
    for (const s of [0, 12.5, 30]) {
      const t = model.scrollTargetForSeconds(s, maxScroll);
      expect(t.scrollTop).toBeGreaterThanOrEqual(0);
      expect(t.scrollTop).toBeLessThanOrEqual(maxScroll);
      expect(model.scrollTopToCanvasScrollY(t.scrollTop, maxScroll)).toBeCloseTo(t.scrollY, 6);
    }
  });

  it('越界秒钳制到两端（0s → scrollTop=maxScroll；≥末端 → 0）', () => {
    const model = m();
    const maxScroll = 1000;
    expect(model.scrollTargetForSeconds(0, maxScroll).scrollTop).toBeCloseTo(maxScroll, 6);
    expect(model.scrollTargetForSeconds(30, maxScroll).scrollTop).toBeCloseTo(0, 6);
    expect(model.scrollTargetForSeconds(-5, maxScroll).scrollTop).toBeCloseTo(maxScroll, 6);
    expect(model.scrollTargetForSeconds(1e9, maxScroll).scrollTop).toBeCloseTo(0, 6);
  });

  it('maxScroll<=0（内容未就绪）时 scrollTop 归 0，不产生越界写入', () => {
    expect(m().scrollTargetForSeconds(15, 0).scrollTop).toBe(0);
  });
});

describe('PlaybackScrollModel · 有效缩放钳制（issue 38 / ADR-0006 Q4=A）', () => {
  it('委托 ChartGeometry.effectiveScale：宽面不钳、窄面钳到容纳 7 轨', () => {
    const gWide = geom(30, { w: 750, h: 900 });
    const gNarrow = geom(30, { w: 200, h: 500 });
    expect(new PlaybackScrollModel(gWide, 1).effectiveScale(1)).toBe(1);
    const mNarrow = new PlaybackScrollModel(gNarrow, 1);
    expect(mNarrow.effectiveScale(1)).toBeCloseTo(gNarrow.effectiveScale(1), 6);
  });
});

describe('PlaybackScrollModel · 按秒重锚状态机（issue 24）', () => {
  it('谱面末端拉长后按秒重锚：判定线处秒数保持不变（不漂移到结尾）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    m.markInitialized();
    m.noteScrollObserved(m.scrollYForSeconds(15)); // 浏览到 15s
    expect(m.getAnchorSeconds()).toBeCloseTo(15, 6);

    // 导入更长谱面代码：30s → 40s，置位待重锚
    m.noteChartEndChange('40');
    m.configure(geom(40), 1); // 同实例换几何，状态机状态保留
    const pending = m.takePendingReAnchor(2000);
    expect(pending).not.toBeNull();
    // 重锚后的 scrollY 在新几何下读回仍是 15s（而非漂移到 40s 结尾）
    expect(m.secondsForScrollY(pending!.scrollY)).toBeCloseTo(15, 6);
    // 锚点同步回读
    expect(m.getAnchorSeconds()).toBeCloseTo(15, 6);
  });

  it('SKIP：待重锚期间的滚动观察不得覆盖旧锚点', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    m.markInitialized();
    m.noteScrollObserved(m.scrollYForSeconds(15));
    m.noteChartEndChange('40');
    m.configure(geom(40), 1);
    m.noteScrollObserved(m.scrollYForSeconds(30)); // 若未 SKIP 会写成 30
    expect(m.getAnchorSeconds()).toBeCloseTo(15, 6); // 仍是 15
  });

  it('播放中不置位待重锚、不执行重锚（RAF 独占滚动）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    m.markInitialized();
    m.setPlaying(true);
    m.noteChartEndChange('40');
    m.configure(geom(40), 1);
    expect(m.takePendingReAnchor(2000)).toBeNull();
  });

  it('未初始化（首帧滚动前）不置位待重锚', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    m.noteChartEndChange('40');
    m.configure(geom(40), 1);
    expect(m.takePendingReAnchor(2000)).toBeNull();
  });

  it('maxScroll<=0：清 pending 但本次跳过（与现实现一致，下帧重试）', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    m.markInitialized();
    m.noteScrollObserved(m.scrollYForSeconds(15));
    m.noteChartEndChange('40');
    m.configure(geom(40), 1);
    expect(m.takePendingReAnchor(0)).toBeNull();
    expect(m.takePendingReAnchor(2000)).toBeNull(); // pending 已清
  });

  it('重锚目标经滚动条映射落在 [0, maxScroll]', () => {
    const m = new PlaybackScrollModel(geom(30), 1);
    m.markInitialized();
    m.noteScrollObserved(m.scrollYForSeconds(15));
    m.noteChartEndChange('40');
    m.configure(geom(40), 1);
    const maxScroll = 2000;
    const pending = m.takePendingReAnchor(maxScroll);
    expect(pending!.scrollTop).toBeGreaterThanOrEqual(0);
    expect(pending!.scrollTop).toBeLessThanOrEqual(maxScroll);
  });
});
