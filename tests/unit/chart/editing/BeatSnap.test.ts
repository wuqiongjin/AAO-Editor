// issue 178 锁测：节拍吸附的档位 / 归一化 / 滚轮步进 / 自定义解析（177 Q5 / Q16）
import { describe, it, expect } from 'vitest';
import {
  BEAT_SNAP_PRESETS, DEFAULT_BEAT_SNAP, normalizeBeatSnap, parseCustomBeatSnap, stepBeatSnap,
} from '@/src/chart/editing/BeatSnap';

describe('issue 178 · 节拍吸附档位', () => {
  it('预设 = 一行升序 12 档（只认数字，不分二分系 / 三分系）', () => {
    expect([...BEAT_SNAP_PRESETS]).toEqual([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]);
  });

  it('出厂默认 1/4', () => {
    expect(DEFAULT_BEAT_SNAP).toBe(4);
  });
});

describe('issue 178 · normalizeBeatSnap', () => {
  it('1–192 的整数原样保留（含不在预设里的自定义值）', () => {
    for (const v of [1, 5, 7, 64, 100, 192]) expect(normalizeBeatSnap(v)).toBe(v);
  });

  it('越界 / 小数 / 非数字一律回落 4', () => {
    for (const junk of [0, -4, 193, 1.5, Number.NaN, Infinity, '8', null, undefined, {}]) {
      expect(normalizeBeatSnap(junk), String(junk)).toBe(4);
    }
  });
});

describe('issue 178 · stepBeatSnap（滚轮步进）', () => {
  it('在预设间逐档走', () => {
    expect(stepBeatSnap(4, 1)).toBe(6);
    expect(stepBeatSnap(4, -1)).toBe(3);
    expect(stepBeatSnap(48, 1)).toBe(64);
  });

  it('越过端点停住', () => {
    expect(stepBeatSnap(64, 1)).toBe(64);
    expect(stepBeatSnap(1, -1)).toBe(1);
  });

  it('当前是自定义值时走到相邻预设', () => {
    expect(stepBeatSnap(7, 1)).toBe(8);
    expect(stepBeatSnap(7, -1)).toBe(6);
    expect(stepBeatSnap(100, 1)).toBe(64);
    expect(stepBeatSnap(100, -1)).toBe(64);
  });
});

describe('issue 178 · parseCustomBeatSnap（自定义输入）', () => {
  it('1–192 整数 → 数值', () => {
    expect(parseCustomBeatSnap('1')).toBe(1);
    expect(parseCustomBeatSnap('7')).toBe(7);
    expect(parseCustomBeatSnap(' 192 ')).toBe(192);
  });

  it('空串 / 越界 / 小数 / 非数字 → null', () => {
    for (const bad of ['', '  ', '0', '193', '1.5', 'abc', '-3']) {
      expect(parseCustomBeatSnap(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
