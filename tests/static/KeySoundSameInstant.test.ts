// issue 231 落点锁：同刻键音事件的归并只有一处（AudioTiming.buildKeyEvents），
// 实时 / 仿真 / 导出三条链路共用同一份发声计划表；发声层不复制归并且不新建限幅口径。
//
// 手法照 VideoExportWiring.test.ts：读源码做字符串断言，锁的是 ADR / 定案的接线事实
// （DOM 测不到、端到端才测得动的那几条），行为本身由 AudioTiming.test.ts 的用例守。
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

const timing = readStripped('src/audio/AudioTiming.ts');
const engine = readStripped('src/audio/AudioEngine.ts');
const simPlayback = readStripped('src/preview/video/sim/simPlayback.ts');
const simField = readStripped('src/preview/video/sim/simField.ts');
const exportVideo = readStripped('src/preview/video/encode/exportVideo.ts');
const renderAudio = readStripped('src/preview/video/encode/renderAudioTrack.ts');
const keySamples = readStripped('src/audio/keySoundSamples.ts');
const srcFiles = sourceFiles(join(repoRoot, 'src'));

describe('issue 231 · 三条链路共用一份发声计划表', () => {
  it('buildKeyEvents 只在 AudioTiming 定义一次，实时与导出都调它', () => {
    expect(timing).toMatch(/export function buildKeyEvents\(/);
    expect(engine).toMatch(/this\.keyEvents = buildKeyEvents\(notes, beatDisplay, bpmEvents\)/);
    expect(exportVideo).toMatch(/buildKeyEvents\(req\.scene\.notes, req\.scene\.beatDisplay, getBpmEvents\(req\.scene\.notes\)\)/);
    expect(exportVideo).not.toMatch(/function buildKeyEvents/);
  });

  it('仿真场经 engine.setChart 复用实时事件表，画面侧也不另建表', () => {
    expect(simPlayback).toMatch(/engine\.setChart\(notes, beatDisplay\)/);
    expect(simPlayback).not.toMatch(/buildKeyEvents\(/);
    expect(simField).not.toMatch(/buildKeyEvents\(/);
  });

  it('离线渲染只消费传入的事件表，不自己建表 / 归并', () => {
    expect(renderAudio).toMatch(/for \(const evt of req\.keyEvents\)/);
    expect(renderAudio).not.toMatch(/buildKeyEvents\(|sampleEquivalenceKey|new Set|new Map/);
  });

  it('采样等价键只在建表层出现一份（归并只落在 buildKeyEvents）', () => {
    const hits = srcFiles.filter((rel) => readStripped(rel).includes('sampleEquivalenceKey'));
    expect(hits).toEqual(['src/audio/AudioTiming.ts']);
  });
});

describe('issue 231 · 音频侧不读 lane、不新增限幅', () => {
  it('KeySoundEvent 与建表层都不再携带 lane（Q15）', () => {
    expect(timing).not.toMatch(/\blane\b/);
  });

  it('实时 / 离线 / 共享发声层都不挂 DynamicsCompressor（Q11 砍掉限幅）', () => {
    for (const src of [engine, renderAudio, keySamples]) {
      expect(src).not.toMatch(/createDynamicsCompressor|DynamicsCompressor/);
    }
  });
});
