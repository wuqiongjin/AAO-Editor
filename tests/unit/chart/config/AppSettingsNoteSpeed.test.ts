// chart-preview 24：仿真场音符速度档（`settings.preview.noteSpeed`）的范围 / 步长 / 归一化。
//
// 为什么单开一份（而不是继续挂在「预览标注」那张表里）：这一档同时是
//   ① 读写同一把尺的**白名单**；② 接近模型 `T = max(0.1, (12 − n)/2)` 的**定义域**。
// 2026-10-08 用户拍板把它从「照 Bestdori 封在 1..11 / 步长 0.5」改成
// **1..12 / 步长 0.1**（对标现代 BanG Dream；Bestdori 参照实现与游戏冲突时优先游戏），
// 老数据 9.5 在新步长上仍然合法 ⇒ additive、不 bump schemaVersion —— 这条得有人守着。
import { describe, expect, it } from 'vitest';
import {
  SIM_NOTE_SPEED_RANGE,
  defaultSettings,
  loadSettings,
  normalizeNoteSpeed,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { settingsStorageOf } from '@/tests/support/storage';

describe('chart-preview 24 · 音符速度档范围（1..12 / 步长 0.1）', () => {
  it('白名单 = 1..12、步长 0.1、默认 9.5（默认值 2026-10-07 定案，本票不动）', () => {
    expect(SIM_NOTE_SPEED_RANGE).toEqual({ min: 1, max: 12, step: 0.1, fallback: 9.5 });
    expect(defaultSettings().preview.noteSpeed).toBe(9.5);
    expect(SIM_NOTE_SPEED_RANGE.max).toBe(12); // 游戏档位上限（旧值 11 是老版本游戏）
  });

  it('老数据 9.5 原样读回（步长 0.5 → 0.1 后它仍在步长上 ⇒ additive，不 bump schemaVersion）', () => {
    expect(normalizeNoteSpeed(9.5)).toBe(9.5);
    expect(loadSettings(settingsStorageOf({ preview: { noteSpeed: 9.5 } })).preview.noteSpeed).toBe(9.5);
    // 旧的半档值（9.5 / 10.5 / 11）同样都还在 0.1 步长上
    expect(normalizeNoteSpeed(10.5)).toBe(10.5);
    expect(normalizeNoteSpeed(11)).toBe(11);
  });

  it('越界夹回区间：12.4 → 12、0.9 → 1（旧上界 11 会把 12 夹掉）', () => {
    expect(normalizeNoteSpeed(12.4)).toBe(12);
    expect(normalizeNoteSpeed(99)).toBe(12);
    expect(normalizeNoteSpeed(0.9)).toBe(1);
    expect(normalizeNoteSpeed(-3)).toBe(1);
  });

  it('非有限 / 脏值 → 默认档 9.5', () => {
    expect(normalizeNoteSpeed(Number.NaN)).toBe(9.5);
    expect(normalizeNoteSpeed(Number.POSITIVE_INFINITY)).toBe(9.5);
    expect(normalizeNoteSpeed(Number.NEGATIVE_INFINITY)).toBe(9.5);
    expect(normalizeNoteSpeed('fast')).toBe(9.5);
    expect(normalizeNoteSpeed(undefined)).toBe(9.5);
    expect(normalizeNoteSpeed(null)).toBe(9.5);
    expect(loadSettings(settingsStorageOf({ preview: { noteSpeed: 'fast' } })).preview.noteSpeed).toBe(9.5);
  });

  it('步长吸附到 0.1：9.55 → 9.6（半档按十进制进位，不被二进制残差吸到下档）', () => {
    expect(normalizeNoteSpeed(9.55)).toBe(9.6);
    expect(normalizeNoteSpeed(9.45)).toBe(9.5);
    expect(normalizeNoteSpeed(11.95)).toBe(12);
    expect(normalizeNoteSpeed(0.95)).toBe(1);
    expect(normalizeNoteSpeed(1.02)).toBe(1);
    expect(normalizeNoteSpeed(7)).toBe(7);
    // 吸附后不再带浮点尾巴（要能直接落盘 + `toFixed(1)` 显示）
    expect(normalizeNoteSpeed(9.55).toFixed(1)).toBe('9.6');
  });

  it('写回：updateSettings 段内浅合并，音符速度改了不碰别的档位 / 别的段', () => {
    const prev = defaultSettings();
    const next = updateSettings(prev, { preview: { noteSpeed: 12 } });
    expect(next.preview.noteSpeed).toBe(12);
    expect(next.preview.mirror).toBe(false);
    expect(next.preview.timeMarks).toBe(prev.preview.timeMarks);
    expect(next.display).toEqual(prev.display);
  });
});
