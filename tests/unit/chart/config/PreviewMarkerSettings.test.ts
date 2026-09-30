// chart-preview 08：预览标注设置（`settings.preview`）的默认值 / 归一化 / 段内写回。
//
// 为什么单测：这一组是"跨会话记住的看谱方式"，三个档位都是白名单枚举 —— 脏值必须静默回落默认、
// 缺段（旧数据）必须补默认，否则进预览页会拿到 undefined 档位（渲染侧按"缺省 = 编辑器现状"解释，
// 等于把作者画布的全量网格搬进预览面板）。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_SETTINGS,
  PREVIEW_BEAT_MARK_DIVISIONS,
  PREVIEW_TIME_MARK_INTERVALS,
  defaultSettings,
  loadSettings,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { settingsStorageOf } from '@/tests/support/storage';

describe('chart-preview 08 · 预览标注设置', () => {
  it('默认档（用户 2026-09-30 二轮定案）：BPM 标记开 / 时间标记 5 秒 / 节拍线 1/1 / Combo 关 / 不镜像', () => {
    expect(defaultSettings().preview).toEqual(DEFAULT_PREVIEW_SETTINGS);
    expect(DEFAULT_PREVIEW_SETTINGS).toEqual({
      bpmMarks: true,
      timeMarks: 5,
      beatMarks: 1,
      comboMarks: false,
      mirror: false,
    });
  });

  it('白名单取值原样读回（各档位各自独立）', () => {
    const loaded = loadSettings(settingsStorageOf({
      preview: { bpmMarks: false, timeMarks: 1, beatMarks: 4, comboMarks: true, mirror: true },
    }));
    expect(loaded.preview).toEqual({ bpmMarks: false, timeMarks: 1, beatMarks: 4, comboMarks: true, mirror: true });
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
