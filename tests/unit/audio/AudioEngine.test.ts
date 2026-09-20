// issue 101 锁测：开播不得卡在键音预热上（滚动要能在同一手势里启动）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const engineSrc = readStripped('src/audio/AudioEngine.ts');
const coordSrc = readStripped('src/playback/usePlaybackCoordinator.ts');

function methodBody(src: string, startNeedle: string, nextNeedle: string): string {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(nextNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('AudioEngine.play · issue 101 开播不阻塞键音预热', () => {
  it('play() 不再 await keySetReady', () => {
    const playBody = methodBody(engineSrc, 'async play()', 'pause()');
    expect(playBody).not.toMatch(/await\s+this\.keySetReady/);
  });

  it('滚动循环启动前同步打标播放态（避免首帧无预算）', () => {
    expect(coordSrc).toMatch(/setPlaybackActive\?\.\(true\)/);
    expect(coordSrc).toMatch(/setPlaybackActive\?\.\(false\)/);
  });
});
