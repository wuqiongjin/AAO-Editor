// @vitest-environment jsdom
// 准备到首次出帧的性能边界；GPU 编译、抗锯齿与真实帧间隔另走浏览器验收。
import { afterEach, expect, it, vi } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import { buildActiveNoteIcons, DEFAULT_NOTE_SKIN_SELECTION } from '@/src/rendering/skin/noteSkin';
import CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import { emptySimAssets, type SimSprites } from '@/src/preview/video/sim/simAssets';
import { buildSimChart, type SimFrameInput, type SimScene } from '@/src/preview/video/sim/simField';
import { fieldMetrics } from '@/src/preview/video/sim/simGeometry';
import { createSimPlayback, type SimPlayback } from '@/src/preview/video/sim/simPlayback';
import { makeRecordingCtx } from '@/tests/support/canvas';

let playback: SimPlayback | null = null;
afterEach(() => { playback?.dispose(); playback = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const reads = vi.fn(() => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }));
  const fillText = vi.fn();
  const mainDraws = makeRecordingCtx({
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    fillText,
  });
  const ctx = () => makeRecordingCtx({
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    getImageData: reads,
    getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    fillText,
  }).proxy;
  const createCanvas = vi.fn(() => ({ width: 0, height: 0, getContext: () => ctx() }));
  vi.stubGlobal('document', { createElement: createCanvas });
  const icons = buildActiveNoteIcons(DEFAULT_NOTE_SKIN_SELECTION);
  const notes: ChartNote[] = [
    { type: 'BPM', beat: 0, bpm: 60 },
    ...Array.from({ length: 10 }, (_, i): ChartNote => ({ type: 'Single', beat: i + 1, lane: 3 })),
  ];
  const scene: SimScene = {
    notes, beatDisplay: 4, noteSpeed: 9.5, noteSize: 1, slideOpacity: 0.8,
    simultaneousClickLines: false, colorAssist: false, mirror: false, showGameUi: false,
  };
  const sprites: SimSprites = {
    digits: { width: 720, height: 100 } as HTMLImageElement,
    combo: { width: 150, height: 41 } as HTMLImageElement,
    particles: { width: 2048, height: 2048 } as HTMLImageElement,
  };
  const input: SimFrameInput = {
    scene, chart: buildSimChart(scene, icons), metrics: fieldMetrics(960, 540),
    assets: { ...emptySimAssets(), sprites, judge: { width: 512, height: 256 } as HTMLImageElement },
    noteIcons: icons, spriteIcon: new CanvasSpriteIcon(),
  };
  const canvas = { width: 0, height: 0, getContext: () => mainDraws.proxy } as unknown as HTMLCanvasElement;
  playback = createSimPlayback({ canvas, audio: null, keySetId: 'skin00', seVolume: 0, duration: 20, density: 1 });
  return { input, createCanvas, reads, fillText, playback, mainDraws };
}

it('issue 80：COMBO 标签的阴影作为预生成贴图出帧，舞台不再实时模糊', () => {
  const { input, createCanvas, playback, mainDraws } = setup();
  for (const apCombo of [true, false]) {
    playback.setFrame({ ...input, scene: { ...input.scene, apCombo } });
    createCanvas.mockClear();
    mainDraws.calls.length = 0;
    playback.seek(1.8);
    expect(mainDraws.calls.filter(([operation]) => operation === 'shadowBlur')).toEqual([]);
    const images = mainDraws.calls.filter(([operation]) => operation === 'drawImage');
    // 标签前仍铺了一张阴影，不能靠删除视觉效果通过测试。
    const shadow = images.at(-2)?.[1][0];
    expect(shadow).toEqual(expect.objectContaining({ getContext: expect.any(Function) }));
    expect(shadow).not.toBe(images.at(-1)?.[1][0]);
    expect(createCanvas).not.toHaveBeenCalled();
  }
});

it('issue 80：接入一帧后，所有 combo 数字的首访不再创建瓦片或回读墨迹', () => {
  const { input, createCanvas, reads, playback } = setup();
  playback.setFrame(input);
  createCanvas.mockClear(); reads.mockClear();
  // 每次在命中特效寿命之后取帧，覆盖 1–9 与 10（含数字 0），不混入粒子图块的准备。
  for (let i = 1; i <= 10; i++) playback.seek(i + 0.8);
  expect({ canvases: createCanvas.mock.calls.length, readbacks: reads.mock.calls.length })
    .toEqual({ canvases: 0, readbacks: 0 });
});

it('issue 80：字形准备回读失败时仍能接入并播放，combo 退回既有纯字画法', () => {
  const { input, reads, fillText, playback } = setup();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  reads.mockImplementation(() => { throw new DOMException('readback unavailable', 'SecurityError'); });
  expect(() => playback.setFrame(input)).not.toThrow();
  playback.seek(1.8);
  expect(fillText).toHaveBeenCalledWith('1', expect.any(Number), expect.any(Number));
});

it('issue 80：换尺寸、换精灵和 AP 开关后仍先准备再出帧，相同输入复用缓存', () => {
  const { input, createCanvas, reads, playback } = setup();
  playback.setFrame({ ...input, scene: { ...input.scene, apCombo: false } });
  playback.seek(0);
  createCanvas.mockClear(); reads.mockClear();
  playback.setFrame(input);
  expect(createCanvas).not.toHaveBeenCalled();
  playback.setOptions({ density: 2 });
  createCanvas.mockClear(); reads.mockClear();
  for (let i = 1; i <= 10; i++) playback.seek(i + 0.8);
  expect({ canvases: createCanvas.mock.calls.length, readbacks: reads.mock.calls.length })
    .toEqual({ canvases: 0, readbacks: 0 });

  for (const next of [
    { ...input, metrics: fieldMetrics(1334, 750) },
    { ...input, assets: { ...input.assets, sprites: {
      ...input.assets.sprites!, digits: { width: 1000, height: 160 } as HTMLImageElement,
      combo: { width: 300, height: 82 } as HTMLImageElement,
    } } },
  ]) {
    playback.seek(0);
    createCanvas.mockClear(); reads.mockClear();
    playback.setFrame(next);
    expect(createCanvas.mock.calls.length).toBeGreaterThan(0);
    createCanvas.mockClear(); reads.mockClear();
    playback.setFrame(next);
    for (let i = 1; i <= 10; i++) playback.seek(i + 0.8);
    expect({ canvases: createCanvas.mock.calls.length, readbacks: reads.mock.calls.length })
      .toEqual({ canvases: 0, readbacks: 0 });
  }
});
