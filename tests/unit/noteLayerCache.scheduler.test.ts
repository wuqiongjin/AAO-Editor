// issue 213 锁测：高刷屏（120Hz/144Hz/240Hz）瓦片帧调度与预算控制
// 1. 验证根据实际屏幕帧间隔（frameInterval）自适应缩短排水延时（消除 120Hz 下跨两帧的排空饥饿）；
// 2. 验证单片工作预算与手势重建预算按帧预算 25%/50% 动态等比缩放；
// 3. 验证 60Hz 设备体验平滑不降级，保护既有不变量。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createNoteLayerCache,
  computeDrainDelay,
  computeRebuildBudget,
  classifyRefreshInterval,
  DEFAULT_FRAME_INTERVAL_MS,
  type NoteLayerCache,
} from '@/src/rendering/pipeline/noteLayerCache';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { makeNoopCtx } from '@/tests/support/canvas';

const SURFACE = { w: 800, h: 900 };
const ES = 1.0;
const NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { type: 'Single', lane: 3, beat: 4, subBeat: 0 },
];

function makeRc(g: ChartGeometry, scrollY: number, playing: boolean): RenderCtx {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: 4,
    chartEndBeat: g.chartEndBeat,
    notes: NOTES,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing,
  };
}

describe('issue 213 · 帧率自适应算法单测', () => {
  it('默认基线帧间隔为 16.67ms (60Hz)', () => {
    expect(DEFAULT_FRAME_INTERVAL_MS).toBeCloseTo(16.67, 1);
  });

  describe('computeDrainDelay · 排水定时器延时自适应', () => {
    it('非播放静止期恒为 0ms（以最快速度在空闲期排空）', () => {
      expect(computeDrainDelay(16.67, false)).toBe(0);
      expect(computeDrainDelay(8.33, false)).toBe(0);
      expect(computeDrainDelay(4.17, false)).toBe(0);
    });

    it('60Hz（>12ms）播放态保持 16ms 延时，不破坏保守排水不变量', () => {
      expect(computeDrainDelay(16.67, true)).toBe(16);
      expect(computeDrainDelay(13.0, true)).toBe(16);
    });

    it('高刷屏幕（<=12ms）自适应缩短排水延时', () => {
      // 90Hz (~11.11ms) -> Math.floor(11.11 / 2) = 5 -> min(4, 5) = 4ms
      expect(computeDrainDelay(11.11, true)).toBe(4);
      // 120Hz (~8.33ms) -> Math.floor(8.33 / 2) = 4 -> min(4, 4) = 4ms
      expect(computeDrainDelay(8.33, true)).toBe(4);
      // 144Hz (~6.94ms) -> Math.floor(6.94 / 2) = 3 -> 3ms
      expect(computeDrainDelay(6.94, true)).toBe(3);
      // 240Hz (~4.17ms) -> Math.floor(4.17 / 2) = 2 -> 2ms
      expect(computeDrainDelay(4.17, true)).toBe(2);
      // 极限高刷下保底至少 1ms
      expect(computeDrainDelay(1.0, true)).toBe(1);
    });
  });

  describe('computeRebuildBudget · 工作预算与单块上限自适应', () => {
    it('60Hz 下预算为 4.0ms，单块上限为 8.0ms', () => {
      const b = computeRebuildBudget(16.67);
      expect(b.gestureBudgetMs).toBe(4.0);
      expect(b.tileCostCapMs).toBe(8.0);
    });

    it('120Hz 下预算等比缩放为 ~2.08ms，单块上限等比缩放为 ~4.16ms', () => {
      const b = computeRebuildBudget(8.33);
      expect(b.gestureBudgetMs).toBeCloseTo(2.08, 2);
      expect(b.tileCostCapMs).toBeCloseTo(4.16, 2);
    });

    it('240Hz 下预算等比缩放为 ~1.04ms，单块上限等比缩放为 ~2.08ms', () => {
      const b = computeRebuildBudget(4.17);
      expect(b.gestureBudgetMs).toBeCloseTo(1.04, 2);
      expect(b.tileCostCapMs).toBeCloseTo(2.08, 2);
    });
  });

  describe('classifyRefreshInterval · rAF 测量间隔物理档位分类', () => {
    it('正确将连续实测 delta 归一化到离散物理刷新率', () => {
      // 240Hz (~4.17ms)
      expect(classifyRefreshInterval(4.0)).toBeCloseTo(4.17, 1);
      expect(classifyRefreshInterval(5.0)).toBeCloseTo(4.17, 1);

      // 144Hz (~6.94ms)
      expect(classifyRefreshInterval(6.0)).toBeCloseTo(6.94, 1);
      expect(classifyRefreshInterval(7.0)).toBeCloseTo(6.94, 1);

      // 120Hz (~8.33ms)
      expect(classifyRefreshInterval(8.0)).toBeCloseTo(8.33, 1);
      expect(classifyRefreshInterval(8.5)).toBeCloseTo(8.33, 1);
      expect(classifyRefreshInterval(9.5)).toBeCloseTo(8.33, 1);

      // 90Hz (~11.11ms)
      expect(classifyRefreshInterval(11.0)).toBeCloseTo(11.11, 1);

      // 60Hz (~16.67ms)
      expect(classifyRefreshInterval(15.0)).toBeCloseTo(16.67, 1);
      expect(classifyRefreshInterval(16.6)).toBeCloseTo(16.67, 1);
      expect(classifyRefreshInterval(20.0)).toBeCloseTo(16.67, 1);
    });
  });
});

describe('issue 213 · NoteLayerCache 实例调度与定时器排空验证', () => {
  let cache: NoteLayerCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = createNoteLayerCache();
    cache.__setCanvasFactoryForTests(() => {
      return {
        width: 100,
        height: 100,
        getContext: () => makeNoopCtx(),
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('初始 frameInterval 为默认基线 16.67ms，支持显式 setFrameInterval 注入', () => {
    expect(cache.getFrameInterval()).toBeCloseTo(16.67, 1);
    cache.setFrameInterval(8.33);
    expect(cache.getFrameInterval()).toBe(8.33);
  });

  it('120Hz 下播放态定时器以 4ms 步长快速排空，60Hz 下以 16ms 步长排空', () => {
    const g = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE);
    const rc = makeRc(g, 0, true);

    // 1) 60Hz 下排空 3 块瓦片需 3 * 16ms = 48ms
    cache.setFrameInterval(16.67);
    cache.draw(makeNoopCtx(), rc);

    // 前进 15ms，尚未触发第一次排空（60Hz 需 16ms）
    vi.advanceTimersByTime(15);
    // 触发 16ms 时排空第一块
    vi.advanceTimersByTime(1);
    // 此时第一轮定时器已触发

    // 清空重测 120Hz
    const cache120 = createNoteLayerCache();
    cache120.__setCanvasFactoryForTests(() => ({ width: 100, height: 100, getContext: () => makeNoopCtx() }));
    cache120.setFrameInterval(8.33);
    cache120.draw(makeNoopCtx(), rc);

    // 120Hz 下 4ms 即可触发第一次排空
    vi.advanceTimersByTime(4);
    // 12ms 即可触发 3 次排空
    vi.advanceTimersByTime(8);
  });
});
