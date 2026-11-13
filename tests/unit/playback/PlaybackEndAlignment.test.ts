// @vitest-environment jsdom
// issue 214 锁测：播放完毕 END 线贴底与同源滚动吸附
// 1. 播放自然终止（current >= duration）时，推送终态坐标至画布与滚动条（scrollY=0, scrollTop=0）；
// 2. stopPlayback 同源双写：canvas.setScrollY 与 container.scrollTop 均被严格同步置为终态；
// 3. 画布坐标生效后才调用 setPlaybackActive(false)，保证 React 视口状态固化为精确的 0；
// 4. 超出 duration 的秒数被 clamp 到 duration，并通知 engine.seek(duration)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackCoordinator } from '@/src/playback/usePlaybackCoordinator';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import type { AudioEngine } from '@/src/audio/AudioEngine';
import type { FinalVirtualCanvasHandle } from '@/src/chart/components/canvas/FinalVirtualCanvas';
import { readStripped } from '@/tests/support/source';

describe('issue 214 · 播放完毕 END 线贴底与同源双写', () => {
  let geometry: ChartGeometry;
  let scrollModel: PlaybackScrollModel;
  let container: HTMLDivElement;
  let callOrder: string[];
  let canvas: FinalVirtualCanvasHandle;
  let mockEngine: Partial<AudioEngine> & {
    seconds: number;
    playing: boolean;
  };
  let setCurrentSeconds: ReturnType<typeof vi.fn<(sec: number) => void>>;
  let setIsPlaying: ReturnType<typeof vi.fn<(v: boolean) => void>>;
  let setChartDuration: ReturnType<typeof vi.fn<(sec: number) => void>>;

  let rafCb: FrameRequestCallback | null = null;
  let nextRafId = 1;
  let origRaf: typeof window.requestAnimationFrame;
  let origCaf: typeof window.cancelAnimationFrame;

  let scrollContainerRef: { current: HTMLDivElement };
  let canvasRef: { current: FinalVirtualCanvasHandle };

  beforeEach(() => {
    origRaf = window.requestAnimationFrame;
    origCaf = window.cancelAnimationFrame;
    rafCb = null;
    const mockRaf = vi.fn((cb: FrameRequestCallback) => {
      rafCb = cb;
      return nextRafId++;
    });
    const mockCaf = vi.fn(() => {
      rafCb = null;
    });
    window.requestAnimationFrame = mockRaf;
    globalThis.requestAnimationFrame = mockRaf;
    window.cancelAnimationFrame = mockCaf;
    globalThis.cancelAnimationFrame = mockCaf;

    geometry = new ChartGeometry([{ beat: 0, bpm: 120 }], { seconds: 30 }, { w: 750, h: 900 });
    scrollModel = new PlaybackScrollModel(geometry, 1);

    container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1500, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    container.scrollTop = 300;

    callOrder = [];
    canvas = {
      setScrollY: vi.fn((y: number) => {
        callOrder.push(`setScrollY:${y}`);
      }),
      setPlaybackActive: vi.fn((active: boolean) => {
        callOrder.push(`setPlaybackActive:${active}`);
      }),
      setFrameInterval: vi.fn(),
      getMarkerSeconds: vi.fn(),
      getEscapeFlags: vi.fn(() => ({
        pen: false,
        drag: false,
        box: false,
        rightHeld: false,
        anchor: false,
      })),
      cancelActiveGesture: vi.fn(() => false),
      cancelPendingSlide: vi.fn(() => false),
    };

    scrollContainerRef = { current: container };
    canvasRef = { current: canvas };

    mockEngine = {
      seconds: 30,
      playing: true,
      get isPlaying() {
        return this.playing;
      },
      getSeconds() {
        return this.seconds;
      },
      pause: vi.fn(function (this: typeof mockEngine) {
        this.playing = false;
      }),
      seek: vi.fn(function (this: typeof mockEngine, sec: number) {
        this.seconds = sec;
      }),
      play: vi.fn(async function (this: typeof mockEngine) {
        this.playing = true;
      }),
      tick: vi.fn(),
    };

    setCurrentSeconds = vi.fn((_sec: number) => {});
    setIsPlaying = vi.fn((_v: boolean) => {});
    setChartDuration = vi.fn((_sec: number) => {});
  });

  afterEach(() => {
    window.requestAnimationFrame = origRaf;
    globalThis.requestAnimationFrame = origRaf;
    window.cancelAnimationFrame = origCaf;
    globalThis.cancelAnimationFrame = origCaf;
    vi.restoreAllMocks();
  });

  it('stopPlayback 时同源推送终态坐标至画布与滚动条，且 setScrollY 在 setPlaybackActive(false) 之前', () => {
    mockEngine.seconds = 30; // 终态秒数
    container.scrollTop = 0.3; // 处于 (0, 0.5] 亚像素区间，验证终态仍被严格重置为 0
    const { result } = renderHook(() =>
      usePlaybackCoordinator({
        engine: mockEngine as unknown as AudioEngine,
        scrollModel,
        scrollContainerRef,
        canvasRef,
        ctxDuration: 30,
        setChartDuration,
        setCurrentSeconds,
        setIsPlaying,
      }),
    );

    act(() => {
      result.current.stopPlayback();
    });

    // 1. 画布 setScrollY 与 DOM container.scrollTop 均被置为 0
    expect(canvas.setScrollY).toHaveBeenCalledWith(0);
    expect(container.scrollTop).toBe(0);

    // 2. 坐标生效在 setPlaybackActive(false) 之前
    const scrollYIndex = callOrder.indexOf('setScrollY:0');
    const deactivateIndex = callOrder.indexOf('setPlaybackActive:false');
    expect(scrollYIndex).toBeGreaterThanOrEqual(0);
    expect(deactivateIndex).toBeGreaterThanOrEqual(0);
    expect(scrollYIndex).toBeLessThan(deactivateIndex);

    // 3. setCurrentSeconds 更新为精确的 30
    expect(setCurrentSeconds).toHaveBeenCalledWith(30);
  });

  it('播放中途停止时同源同步当前坐标至画布与滚动条', () => {
    mockEngine.seconds = 15; // 中途 15s
    const { result } = renderHook(() =>
      usePlaybackCoordinator({
        engine: mockEngine as unknown as AudioEngine,
        scrollModel,
        scrollContainerRef,
        canvasRef,
        ctxDuration: 30,
        setChartDuration,
        setCurrentSeconds,
        setIsPlaying,
      }),
    );

    act(() => {
      result.current.stopPlayback();
    });

    const maxScroll = 1500 - 500; // 1000
    const { scrollY, scrollTop } = scrollModel.scrollTargetForSeconds(15, maxScroll);

    expect(canvas.setScrollY).toHaveBeenCalledWith(scrollY);
    expect(container.scrollTop).toBeCloseTo(scrollTop, 5);

    const scrollYIndex = callOrder.indexOf(`setScrollY:${scrollY}`);
    const deactivateIndex = callOrder.indexOf('setPlaybackActive:false');
    expect(scrollYIndex).toBeGreaterThanOrEqual(0);
    expect(scrollYIndex).toBeLessThan(deactivateIndex);
    expect(setCurrentSeconds).toHaveBeenCalledWith(15);
  });

  it('播放自然终止（current >= duration）时触发 stopPlayback 并将画布与滚动条置为终态 0', async () => {
    mockEngine.playing = false;
    mockEngine.seconds = 29.98; // 接近终点
    const { result } = renderHook(() =>
      usePlaybackCoordinator({
        engine: mockEngine as unknown as AudioEngine,
        scrollModel,
        scrollContainerRef,
        canvasRef,
        ctxDuration: 30,
        setChartDuration,
        setCurrentSeconds,
        setIsPlaying,
      }),
    );

    await act(async () => {
      result.current.togglePlay();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rafCb).toBeTruthy();
    // 跑一帧 29.98s
    act(() => {
      const cb = rafCb!;
      rafCb = null;
      cb(16);
    });

    // 验证还在播放，且重置调用记录
    expect(rafCb).toBeTruthy();
    callOrder = [];
    (canvas.setScrollY as unknown as { mockClear: () => void }).mockClear();

    // 模拟推进下一帧越过 duration
    mockEngine.seconds = 30.02;

    act(() => {
      const cb = rafCb!;
      rafCb = null;
      cb(32);
    });

    // 验证到达终点后触发了停止并同步了 0 终态
    expect(canvas.setScrollY).toHaveBeenCalledWith(0);
    expect(container.scrollTop).toBe(0);

    const scrollYIndex = callOrder.indexOf('setScrollY:0');
    const deactivateIndex = callOrder.indexOf('setPlaybackActive:false');
    expect(scrollYIndex).toBeGreaterThanOrEqual(0);
    expect(deactivateIndex).toBeGreaterThanOrEqual(0);
    expect(scrollYIndex).toBeLessThan(deactivateIndex);

    // setCurrentSeconds 写入 duration
    expect(setCurrentSeconds).toHaveBeenCalledWith(30);

    // 自然终止后不再排下一帧
    expect(rafCb).toBeNull();
  });
});

describe('issue 214 · 静态源码架构看守', () => {
  const coordSrc = readStripped('src/playback/usePlaybackCoordinator.ts');

  it('stopPlayback 函数体中同时更新 canvas.setScrollY 与 container.scrollTop', () => {
    const stopBody = coordSrc.slice(
      coordSrc.indexOf('const stopPlayback = useCallback'),
      coordSrc.indexOf('const startPlaybackLoop'),
    );
    expect(stopBody).toMatch(/scrollTargetForSeconds/);
    expect(stopBody).toMatch(/canvas\?\.setScrollY\s*\(\s*scrollY\s*\)/);
    expect(stopBody).toMatch(/container\.scrollTop\s*=/);
  });

  it('stopPlayback 中 setPlaybackActive(false) 严格位于 scrollTargetForSeconds 之后', () => {
    const stopBody = coordSrc.slice(
      coordSrc.indexOf('const stopPlayback = useCallback'),
      coordSrc.indexOf('const startPlaybackLoop'),
    );
    const scrollTargetIdx = stopBody.indexOf('scrollTargetForSeconds');
    const deactivateIdx = stopBody.indexOf('setPlaybackActive');
    expect(scrollTargetIdx).toBeGreaterThan(-1);
    expect(deactivateIdx).toBeGreaterThan(scrollTargetIdx);
  });
});
