// 票 15 定案 9：时长探针只做一件事——问出时长、拿完即丢。
// 这里锁两件容易退化的事：① 解不出 / 时长非法一律抛错（调用方据此放弃写入，不落半截记录）；
// ② 探针不碰共享 AudioEngine / AudioSession —— 它一旦借走工作台那份解码音频，就等于把
//    播放中的当前工程顶掉（这就是"另起一条路"的代价，不许回潮）。
import { describe, expect, it } from 'vitest';
import { probeAudioDuration, type AudioDecodeResult } from '@/src/audio/probeAudioDuration';
import { readStripped } from '@/tests/support/source';

const probeSrc = readStripped('src/audio/probeAudioDuration.ts');

function file(bytes = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], '曲目.mp3');
}

describe('票 15 · 时长探针', () => {
  it('解得出时就返回音频时长（不把解码结果留在任何地方）', async () => {
    let seenBytes = 0;
    const decode = async (bytes: ArrayBuffer): Promise<AudioDecodeResult> => {
      seenBytes = bytes.byteLength;
      return { duration: 42.5 };
    };

    await expect(probeAudioDuration(file([1, 2, 3]), decode)).resolves.toBe(42.5);
    expect(seenBytes).toBe(3);
  });

  it('时长非法（0 / 负数 / NaN / 缺字段）一律抛错，不给调用方"将就写进去"的机会', async () => {
    const cases: AudioDecodeResult[] = [
      { duration: 0 },
      { duration: -1 },
      { duration: Number.NaN },
      { duration: Number.POSITIVE_INFINITY },
      {} as AudioDecodeResult,
    ];
    for (const decoded of cases) {
      await expect(probeAudioDuration(file(), async () => decoded)).rejects.toThrow();
    }
  });

  it('解码器抛错时向上抛（不吞）', async () => {
    await expect(
      probeAudioDuration(file(), async () => { throw new Error('解不了'); }),
    ).rejects.toThrow('解不了');
  });

  it('探针不引用 AudioEngine / AudioSession（借共享引擎会顶掉工作台那份解码音频）', () => {
    expect(probeSrc).not.toMatch(/AudioEngine/);
    expect(probeSrc).not.toMatch(/AudioSession/);
    expect(probeSrc).not.toMatch(/new\s+AudioContext\b/);
    expect(probeSrc).toMatch(/OfflineAudioContext/);
  });
});
