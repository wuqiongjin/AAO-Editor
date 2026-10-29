// chart-preview 08：预览标注设置（`settings.preview`）的默认值 / 归一化 / 段内写回。
//
// 为什么单测：这一组是"跨会话记住的看谱方式"，三个档位都是白名单枚举 —— 脏值必须静默回落默认、
// 缺段（旧数据）必须补默认，否则进预览页会拿到 undefined 档位（渲染侧按"缺省 = 编辑器现状"解释，
// 等于把作者画布的全量网格搬进预览面板）。
import { describe, expect, it } from 'vitest';
import {
  BG_BRIGHTNESS_RANGE,
  DEFAULT_PREVIEW_SETTINGS,
  PREVIEW_BEAT_MARK_DIVISIONS,
  PREVIEW_TIME_MARK_INTERVALS,
  SIM_NOTE_SPEED_RANGE,
  defaultSettings,
  loadSettings,
  normalizeBgBrightness,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { SIM_DEFAULT_PACK_IDS } from '@/src/preview/video/sim/simAssetPacks';
import { settingsStorageOf } from '@/tests/support/storage';

describe('chart-preview 08 · 预览标注设置', () => {
  it('默认档（用户 2026-09-30 三轮定案）：BPM / Combo 标记开、时间标记 5 秒、节拍线 1/1、不镜像', () => {
    expect(defaultSettings().preview).toEqual(DEFAULT_PREVIEW_SETTINGS);
    expect(DEFAULT_PREVIEW_SETTINGS).toEqual({
      bpmMarks: true,
      timeMarks: 5,
      beatMarks: 1,
      comboMarks: true,
      mirror: false,
      // 仿真场音符速度（chart-preview 05；用户 2026-10-07 定案 9.5）
      noteSpeed: 9.5,
      // 仿真场素材包（chart-preview 41 · ADR-0018 §1：各默认 skin00）
      bgPackId: SIM_DEFAULT_PACK_IDS.background,
      fieldPackId: SIM_DEFAULT_PACK_IDS.field,
      // 背景亮度（票 43）：默认 0.7（用户 2026-10-29 验收定档；1 = 原图）
      bgBrightness: 0.7,
    });
  });

  it('白名单取值原样读回（各档位各自独立）', () => {
    const loaded = loadSettings(settingsStorageOf({
      preview: { bpmMarks: false, timeMarks: 1, beatMarks: 4, comboMarks: true, mirror: true, noteSpeed: 7.5 },
    }));
    expect(loaded.preview).toEqual({
      bpmMarks: false, timeMarks: 1, beatMarks: 4, comboMarks: true, mirror: true, noteSpeed: 7.5,
      // 种子没给素材包 ⇒ 补默认（chart-preview 41，additive 不 bump schemaVersion）
      bgPackId: SIM_DEFAULT_PACK_IDS.background,
      fieldPackId: SIM_DEFAULT_PACK_IDS.field,
      // 种子没给亮度 ⇒ 补默认 0.7（票 43，additive 不 bump）
      bgBrightness: 0.7,
    });
  });

  it('背景亮度档（票 43）：0..1 吸附 0.05，越界 / 脏值归一', () => {
    expect(BG_BRIGHTNESS_RANGE).toEqual({ min: 0, max: 1, step: 0.05, fallback: 0.7 });
    const of = (bgBrightness: unknown) =>
      loadSettings(settingsStorageOf({ preview: { bgBrightness } })).preview.bgBrightness;
    expect(of(0.35)).toBeCloseTo(0.35, 6);
    // 0.5 是 0.05 的整数倍；落盘里常见的 0.333 会被吸到 0.35
    expect(of(0.333)).toBeCloseTo(0.35, 6);
    expect(of(-1)).toBe(0);
    expect(of(2)).toBe(1);
    expect(of('dim')).toBe(0.7);
    expect(of(Number.NaN)).toBe(0.7);
    expect(normalizeBgBrightness(undefined, 0.8)).toBe(0.8);
  });

  // 音符速度档（chart-preview 24：1..12 步长 0.1）的范围 / 步长 / 吸附锁测单开在
  // `AppSettingsNoteSpeed.test.ts`（它同时是接近模型的定义域），这里只管"读回白名单值"。
  it('音符速度档：白名单内原样读回，越界 / 脏值归一', () => {
    const of = (noteSpeed: unknown) => loadSettings(settingsStorageOf({ preview: { noteSpeed } })).preview.noteSpeed;
    expect(of(3)).toBe(3);
    expect(of(0)).toBe(SIM_NOTE_SPEED_RANGE.min);
    expect(of(99)).toBe(SIM_NOTE_SPEED_RANGE.max);
    expect(of('fast')).toBe(SIM_NOTE_SPEED_RANGE.fallback);
    expect(of(Number.NaN)).toBe(SIM_NOTE_SPEED_RANGE.fallback);
  });

  it('缺段 / 脏值（含旧枚举名）→ 逐字段回落默认，不整段丢弃', () => {
    // 旧数据根本没有 preview 段
    expect(loadSettings(settingsStorageOf({ display: { noteSize: 1 } })).preview).toEqual(DEFAULT_PREVIEW_SETTINGS);
    // 脏值：时间间隔 3 秒（白名单外）、节拍线旧枚举名 'beats'（03 那版的 gridDetail 写法）、两个布尔写成字符串
    const dirty = loadSettings(settingsStorageOf({
      preview: { bpmMarks: 'yes', timeMarks: 3, beatMarks: 'beats', comboMarks: 1, mirror: 'true' },
    }));
    expect(dirty.preview).toEqual(DEFAULT_PREVIEW_SETTINGS);
  });

  it('白名单本身与 UI 选项同源（加档位时只改一处）', () => {
    expect(PREVIEW_TIME_MARK_INTERVALS).toEqual(['off', 1, 2, 5, 10]);
    expect(PREVIEW_BEAT_MARK_DIVISIONS).toEqual(['off', 1, 2, 3, 4, 6]);
  });

  it('updateSettings 段内浅合并：只改一个档位不会清掉另外几个', () => {
    const prev = defaultSettings();
    const next = updateSettings(prev, { preview: { timeMarks: 10 } });
    expect(next.preview).toEqual({ ...DEFAULT_PREVIEW_SETTINGS, timeMarks: 10 });
    expect(updateSettings(prev, { preview: { bpmMarks: false } }).preview.timeMarks).toBe(5);
    expect(updateSettings(prev, { preview: { mirror: true } }).preview.beatMarks).toBe(1);
    // 别的段不受影响
    expect(next.display).toEqual(prev.display);
  });

  it('图像品质默认高清（用户定案：最高档），且画布侧仍按 min(设备像素比, 档位) 取', () => {
    expect(defaultSettings().display.imageQuality).toBe('hd');
  });
});
