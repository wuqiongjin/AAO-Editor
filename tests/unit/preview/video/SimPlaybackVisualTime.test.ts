// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/src/audio/AudioEngine';
import { createSimPlayback, type SimPlayback } from '@/src/preview/video/sim/simPlayback';
import { drawSimFrameAt, prepareSimFieldBitmap, type SimFrameInput } from '@/src/preview/video/sim/simField';

vi.mock('@/src/preview/video/sim/simField', () => ({
  drawSimFrameAt: vi.fn(), prepareSimComboSprites: vi.fn(), prepareSimLifeGauge: vi.fn(), prepareSimFieldBitmap: vi.fn(),
}));

// 保留真实引擎、播放生命周期和帧循环；只替换浏览器音频设备与最终画笔。
class AudioDevice {
  static current: AudioDevice;
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};
  constructor() { AudioDevice.current = this; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createBufferSource() {
    return { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  decodeAudioData() { return Promise.resolve({ duration: 3600 } as AudioBuffer); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

let now = 0;
let callback: FrameRequestCallback | null = null;
let playback: SimPlayback;
const frame = {
  metrics: { w: 100, h: 100 }, assets: { sprites: null },
  scene: { notes: [], beatDisplay: 4 },
} as unknown as SimFrameInput;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const drawnSecond = () => vi.mocked(drawSimFrameAt).mock.calls.at(-1)![2];

beforeEach(() => {
  now = 0;
  callback = null;
  vi.stubGlobal('AudioContext', AudioDevice);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(AudioEngine.prototype, 'setKeySetId').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { callback = null; });
  vi.mocked(drawSimFrameAt).mockClear();
  vi.mocked(prepareSimFieldBitmap).mockReset();
});
afterEach(() => { playback?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function start(audio = true, initialSeconds = 0, duration = 3600) {
  playback = createSimPlayback({
    canvas: { getContext: () => ({ setTransform() {} }) } as unknown as HTMLCanvasElement,
    audio: audio ? { name: 'song.mp3', blob: new Blob([new Uint8Array([1])]) } : null,
    keySetId: '', seVolume: 0, duration, density: 1, initialSeconds,
  });
  playback.setFrame(frame);
  await settle(); // 等真实引擎接入异步音频
  playback.play();
  await settle();
}

function pump(ms: number, audioSeconds = Math.floor(ms / (32 / 3)) * (32 / 3000)) {
  now = ms;
  AudioDevice.current.currentTime = audioSeconds;
  const cb = callback!;
  callback = null;
  cb(ms);
  return drawnSecond();
}

describe('仿真场视觉取时 · 音频主时钟约束', () => {
  it('正常播放复用场地底图，亮度和密度变化替换底图，卸载释放最后一张', async () => {
    const images = Array.from({ length: 3 }, () => ({ close: vi.fn() }));
    for (const image of images) vi.mocked(prepareSimFieldBitmap).mockReturnValueOnce(image as unknown as ImageBitmap);
    await start();
    pump(20);
    playback.setOptions({ volume: 0.5 });
    playback.setFrame({ ...frame, scene: { ...frame.scene, mirror: true } });
    expect(vi.mocked(drawSimFrameAt).mock.lastCall?.[3]?.fieldBitmap).toBe(images[0]);
    expect(images[0]!.close).not.toHaveBeenCalled();
    playback.setFrame({ ...frame, scene: { ...frame.scene, bgBrightness: 0.4 } });
    expect(images[0]!.close).toHaveBeenCalledOnce();
    expect(vi.mocked(drawSimFrameAt).mock.lastCall?.[3]?.fieldBitmap).toBe(images[1]);
    playback.setOptions({ density: 1.25 });
    expect(images[1]!.close).toHaveBeenCalledOnce();
    expect(vi.mocked(drawSimFrameAt).mock.lastCall?.[3]?.fieldBitmap).toBe(images[2]);
    playback.dispose();
    expect(images[2]!.close).toHaveBeenCalledOnce();
  });

  it.each([60, 120, 144, 165].flatMap(hz => [0.1, 1, 4].map(rate => ({ hz, rate }))))(
    '$hz Hz / $rate×：音频分块更新时运动仍连续，视觉不脱离音频', async ({ hz, rate }) => {
      await start();
      playback.setOptions({ rate });
      let previous = drawnSecond();
      const errors: number[] = [];
      for (let i = 1; i <= hz * 2; i++) {
        const seconds = pump(i * 1000 / hz);
        errors.push(Math.abs((seconds - previous) * 1000 / rate - 1000 / hz));
        expect(seconds).toBeGreaterThanOrEqual(previous);
        expect(Math.abs(seconds - AudioDevice.current.currentTime * rate)).toBeLessThanOrEqual(0.020001 * rate);
        previous = seconds;
      }
      expect(Math.max(...errors)).toBeLessThan(1);
  });

  it('播放中改倍速不让已插值的画面跳回，之后按新倍速推进', async () => {
    await start();
    const before = pump(6, 0);
    playback.setOptions({ rate: 2 });
    expect(drawnSecond()).toBeCloseTo(before, 8);
    const after = pump(16, 0.01);
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeCloseTo(0.020, 3);
  });

  it('大幅降速时不倒退，等待音频追上后恢复新倍速限幅', async () => {
    await start();
    playback.setOptions({ rate: 4 });
    const before = pump(6, 0);
    playback.setOptions({ rate: 0.1 });
    expect(drawnSecond()).toBeCloseTo(before, 8);
    expect(pump(16, 0.01)).toBeGreaterThanOrEqual(before);
    const after = pump(316, 0.31);
    expect(after).toBeGreaterThan(before);
    expect(Math.abs(after - 0.031)).toBeLessThanOrEqual(0.002001);
  });

  it('seek 立即精确定位，暂停保持原位，重播不沿用旧插值锚点', async () => {
    await start();
    pump(6, 0);
    playback.seek(124);
    expect(drawnSecond()).toBe(124);
    expect(pump(22, 0.016)).toBeCloseTo(124.016, 3);
    playback.seek(2);
    expect(drawnSecond()).toBe(2);
    playback.pause();
    now = 5000;
    AudioDevice.current.currentTime = 5;
    playback.render();
    expect(drawnSecond()).toBe(2);
    playback.play();
    await settle();
    expect(pump(5016, 5.016)).toBeCloseTo(2.016, 3);
  });

  it('暂停与恢复不把领先于音频块的末画面拉回', async () => {
    await start();
    const before = pump(6, 0);
    playback.pause();
    expect(drawnSecond()).toBeCloseTo(before, 8);
    now = 1006;
    AudioDevice.current.currentTime = 1;
    playback.render();
    expect(drawnSecond()).toBeCloseTo(before, 8);
    playback.play();
    await settle();
    expect(drawnSecond()).toBeCloseTo(before, 8);
    expect(pump(1022, 1.016)).toBeGreaterThan(before);
  });

  it('合成时间线保持精确；迟到的音频从当前进度接入', async () => {
    let decode!: (buffer: AudioBuffer) => void;
    vi.spyOn(AudioDevice.prototype, 'decodeAudioData').mockReturnValue(new Promise(resolve => { decode = resolve; }));
    await start();
    expect(pump(1000, 0)).toBe(1);
    decode({ duration: 3600 } as AudioBuffer);
    await settle();
    expect(pump(1016, 0.016)).toBeCloseTo(1.016, 3);
    playback.setOptions({ rate: 2 });
    expect(drawnSecond()).toBeCloseTo(1.016, 3);
  });

  it('无音频起停、倍速与初始位置不受插值影响', async () => {
    await start(false, 12);
    expect(pump(1000, 0)).toBe(13);
    playback.setOptions({ rate: 0.5 });
    expect(pump(3000, 0)).toBe(14);
    playback.pause();
    now = 4000;
    playback.render();
    expect(drawnSecond()).toBe(14);
  });

  it('销毁后以另一音频和初始进度重建时，不保留前一个播放器的锚点', async () => {
    await start();
    pump(6, 0);
    playback.dispose();
    await start(true, 124);
    expect(drawnSecond()).toBe(124);
    expect(pump(22, 0.016)).toBeCloseTo(124.016, 3);
  });

  it('音频挂起时不靠墙钟继续跑，恢复时重新对齐音频', async () => {
    await start();
    pump(1000, 1);
    AudioDevice.current.state = 'suspended';
    expect(pump(2000, 1)).toBe(1);
    expect(pump(3000, 1)).toBe(1);
    AudioDevice.current.state = 'running';
    const resumed = pump(4000, 1.016);
    expect(resumed).toBe(1);
    const next = pump(4016, 1.032);
    expect(next).toBeGreaterThan(resumed);
    expect(Math.abs(next - 1.032)).toBeLessThanOrEqual(0.020001);
  });

  it('音频在视觉领先时挂起不倒退，恢复时不累计挂起时长', async () => {
    await start();
    const before = pump(6, 0);
    AudioDevice.current.state = 'suspended';
    expect(pump(12, 0)).toBeCloseTo(before, 8);
    expect(pump(1000, 0)).toBeCloseTo(before, 8);
    AudioDevice.current.state = 'running';
    expect(pump(2000, 0)).toBeCloseTo(before, 8);
    expect(pump(2016, 0.016)).toBeCloseTo(before + 0.016, 3);
  });

  it('长间隔与设备时钟速率偏差不积累漂移，音频不动时外推有界', async () => {
    await start();
    let previous = 0;
    for (let i = 1; i <= 36000; i++) {
      const ms = i * 1000 / 60;
      const audio = Math.floor(ms * 1.0002 / (32 / 3)) * (32 / 3000);
      const visual = pump(ms, audio);
      expect(visual).toBeGreaterThanOrEqual(previous);
      expect(Math.abs(visual - audio)).toBeLessThanOrEqual(0.020001);
      previous = visual;
    }
    const afterGap = pump(620000, 620.124);
    expect(Math.abs(afterGap - 620.124)).toBeLessThanOrEqual(0.020001);
    expect(pump(630000, 620.124)).toBeLessThanOrEqual(620.144001);
  });

  it('插值不越过谱面终点，音频到达终点后停止排帧', async () => {
    await start(true, 0, 2);
    pump(1990, 1.99);
    expect(pump(1999, 1.99)).toBeLessThanOrEqual(2);
    expect(pump(2010, 2.01)).toBe(2);
    expect(callback).toBeNull();
  });
});

describe('票 87 / 票 88 · 场地尺寸变化不挡播放且退全屏延迟回缩', () => {
  it('放大场地当帧不烘底图、不改 backing store；让出主线程后再换；退回小尺寸先复用旧缓冲、让出两帧后精准回缩 bw×bh', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ setTransform() {} }),
    };
    const images = Array.from({ length: 2 }, () => ({ close: vi.fn() }));
    vi.mocked(prepareSimFieldBitmap)
      .mockReturnValueOnce(images[0] as unknown as ImageBitmap)
      .mockReturnValueOnce(images[1] as unknown as ImageBitmap);

    playback = createSimPlayback({
      canvas: canvas as unknown as HTMLCanvasElement,
      audio: null,
      keySetId: '',
      seVolume: 0,
      duration: 3600,
      density: 1,
    });
    playback.setFrame(frame);
    expect(vi.mocked(prepareSimFieldBitmap)).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(100);

    playback.setFrame({ ...frame, metrics: { w: 200, h: 180 } });
    expect(vi.mocked(prepareSimFieldBitmap)).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(100);
    expect(images[0]!.close).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(vi.mocked(prepareSimFieldBitmap)).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });
    await vi.waitFor(() => {
      expect(canvas.width).toBe(200);
      expect(canvas.height).toBe(180);
    }, { timeout: 2000 });
    expect(images[0]!.close).not.toHaveBeenCalled();

    // 退全屏当帧：零同步拆缓冲，直接复用已缓存的小尺寸底图；随后延迟回缩到目标 100x100
    playback.setFrame(frame);
    expect(vi.mocked(prepareSimFieldBitmap)).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(180);
    await vi.waitFor(() => {
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(100);
    }, { timeout: 2000 });
    expect(images[0]!.close).not.toHaveBeenCalled();
    expect(images[1]!.close).not.toHaveBeenCalled();
    playback.dispose();
    expect(images[0]!.close).toHaveBeenCalledOnce();
    expect(images[1]!.close).toHaveBeenCalledOnce();
  });
});
