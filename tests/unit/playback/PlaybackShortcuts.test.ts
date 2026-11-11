// issue 230 · 倍速 / 音量快捷键的步进语义（纯函数接缝）。
// 这一层只管「按一次键该变成多少」；按键分发 / 回放落点由 DOM 与静态锁覆盖。
import { describe, expect, it } from 'vitest';
import {
  AUDIO_VOLUME_STEP,
  PLAYBACK_SHORTCUT_IDS,
  stepAudioVolume,
  stepPlaybackRatePreset,
} from '@/src/playback/playbackShortcuts';
import { SIM_PLAYBACK_RATE_PRESETS } from '@/src/playback/playbackRateState';

describe('issue 230 · 倍速预设档步进', () => {
  it('从 1× 逐档升到 2× 后端点停住', () => {
    let rate = 1;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      rate = stepPlaybackRatePreset(rate, 1);
      seen.push(rate);
    }
    expect(seen).toEqual([1.25, 1.5, 2, 2, 2]);
  });

  it('从 0.25× 降档端点停住；从 2× 降档回到 1.5×', () => {
    expect(stepPlaybackRatePreset(0.25, -1)).toBe(0.25);
    expect(stepPlaybackRatePreset(2, -1)).toBe(1.5);
  });

  it('手填值（不在预设档上）向两侧切入相邻档', () => {
    expect(stepPlaybackRatePreset(1.35, 1)).toBe(1.5);
    expect(stepPlaybackRatePreset(1.35, -1)).toBe(1.25);
    expect(stepPlaybackRatePreset(0.1, 1)).toBe(0.25); // 引擎下限 0.1× 只有手填到得了
    expect(stepPlaybackRatePreset(0.1, -1)).toBe(0.1);
  });

  it('快捷键封顶 2×：手填 3× 再升不越过 2×，降档落回 2×', () => {
    expect(stepPlaybackRatePreset(3, 1)).toBe(3); // >2× 只能靠手填，升档不动作
    expect(stepPlaybackRatePreset(3, -1)).toBe(2);
  });

  it('产出值始终落在预设表内（或原样保留表外手填值）', () => {
    for (const r of SIM_PLAYBACK_RATE_PRESETS) {
      for (const dir of [1, -1] as const) {
        const next = stepPlaybackRatePreset(r, dir);
        expect(next === r || (SIM_PLAYBACK_RATE_PRESETS as readonly number[]).includes(next)).toBe(true);
        expect(next).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('issue 230 · 音量步进', () => {
  it('步长 0.05（与播放条滑杆一致）', () => {
    expect(AUDIO_VOLUME_STEP).toBe(0.05);
    expect(stepAudioVolume(0.5, 1)).toBe(0.55);
    expect(stepAudioVolume(0.5, -1)).toBe(0.45);
  });

  it('0 / 1 端点停住', () => {
    expect(stepAudioVolume(0, -1)).toBe(0);
    expect(stepAudioVolume(1, 1)).toBe(1);
  });

  it('连续步进不攒浮点尾巴', () => {
    let v = 0;
    for (let i = 0; i < 6; i++) v = stepAudioVolume(v, 1);
    expect(v).toBe(0.3);
    for (let i = 0; i < 6; i++) v = stepAudioVolume(v, -1);
    expect(v).toBe(0);
  });

  it('越界输入就地钳回 [0,1]', () => {
    expect(stepAudioVolume(-0.4, 1)).toBe(0.05);
    expect(stepAudioVolume(1.4, -1)).toBe(0.95);
  });

  it('非 0.05 网格上的存量值也只加 0.05（不被吸附到网格）', () => {
    expect(stepAudioVolume(0.333, 1)).toBeCloseTo(0.383, 6);
    expect(stepAudioVolume(0.333, -1)).toBeCloseTo(0.283, 6);
  });
});

describe('issue 230 · 按住不连发名单', () => {
  it('只列四个播放控制功能（其它快捷键连发行为不变）', () => {
    expect([...PLAYBACK_SHORTCUT_IDS]).toEqual(['rateDown', 'rateUp', 'volumeDown', 'volumeUp']);
  });
});
