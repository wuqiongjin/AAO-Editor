import { describe, it, expect } from 'vitest';
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  updateSettings,
  type AppSettings,
} from '@/src/chart/config/AppSettings';
import { displayOptionsFromSettings } from '@/src/rendering/displayOptions';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

describe('issue 200 · settings.display 扩展（timePrecision & invertWheel）', () => {
  it('出厂默认：timePrecision 为 standard，invertWheel 为 false', () => {
    const defaults = defaultSettings().display;
    expect(defaults.timePrecision).toBe('standard');
    expect(defaults.invertWheel).toBe(false);
  });

  it('老设置文件缺省字段时回退到默认值', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      display: { noteSize: 1.2 },
    }));
    const loaded = loadSettings(st);
    expect(loaded.display.timePrecision).toBe('standard');
    expect(loaded.display.invertWheel).toBe(false);
    expect(loaded.display.noteSize).toBe(1.2);
  });

  it('非法值归一化回退：timePrecision 仅认 standard/centisecond/millisecond，invertWheel 仅认 boolean', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      display: {
        timePrecision: 'invalid_mode',
        invertWheel: 'true', // string 而非 boolean
      },
    }));
    const loaded = loadSettings(st);
    expect(loaded.display.timePrecision).toBe('standard');
    expect(loaded.display.invertWheel).toBe(false);

    // centisecond 合法识别
    const validCs = loadSettings(memStorage(JSON.stringify({
      schemaVersion: 1,
      display: { timePrecision: 'centisecond' },
    })));
    expect(validCs.display.timePrecision).toBe('centisecond');
  });

  it('有效配置往返持久化保真', () => {
    const st = memStorage();
    const next: AppSettings = {
      ...defaultSettings(),
      display: {
        ...defaultSettings().display,
        timePrecision: 'millisecond',
        invertWheel: true,
      },
    };
    saveSettings(next, st);
    const loaded = loadSettings(st);
    expect(loaded.display.timePrecision).toBe('millisecond');
    expect(loaded.display.invertWheel).toBe(true);
  });

  it('updateSettings 增量合并，不抹除 display 其它字段', () => {
    const base = defaultSettings();
    const updated = updateSettings(base, {
      display: { timePrecision: 'millisecond', invertWheel: true },
    });
    expect(updated.display.timePrecision).toBe('millisecond');
    expect(updated.display.invertWheel).toBe(true);
    expect(updated.display.noteSize).toBe(base.display.noteSize);
  });

  it('displayOptionsFromSettings 透传 timePrecision', () => {
    const display = {
      ...defaultSettings().display,
      timePrecision: 'millisecond' as const,
    };
    const options = displayOptionsFromSettings(display);
    expect(options.timePrecision).toBe('millisecond');
  });
});

describe('issue 204 · settings.display 扩展（pinchMode 滑条拖拽变形风格）', () => {
  it('出厂默认：pinchMode 为 smooth', () => {
    const defaults = defaultSettings().display;
    expect(defaults.pinchMode).toBe('smooth');
  });

  it('老设置文件缺省字段时回退到 smooth', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      display: { noteSize: 1.2 },
    }));
    const loaded = loadSettings(st);
    expect(loaded.display.pinchMode).toBe('smooth');
  });

  it('非法值归一化回退：pinchMode 仅认 smooth/triangle，其余回退 smooth', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      display: {
        pinchMode: 'invalid_mode',
      },
    }));
    const loaded = loadSettings(st);
    expect(loaded.display.pinchMode).toBe('smooth');

    const validTriangle = loadSettings(memStorage(JSON.stringify({
      schemaVersion: 1,
      display: { pinchMode: 'triangle' },
    })));
    expect(validTriangle.display.pinchMode).toBe('triangle');
  });

  it('有效配置往返持久化保真', () => {
    const st = memStorage();
    const next: AppSettings = {
      ...defaultSettings(),
      display: {
        ...defaultSettings().display,
        pinchMode: 'triangle',
      },
    };
    saveSettings(next, st);
    const loaded = loadSettings(st);
    expect(loaded.display.pinchMode).toBe('triangle');
  });

  it('updateSettings 增量合并，不抹除 display 其它字段', () => {
    const base = defaultSettings();
    const updated = updateSettings(base, {
      display: { pinchMode: 'triangle' },
    });
    expect(updated.display.pinchMode).toBe('triangle');
    expect(updated.display.noteSize).toBe(base.display.noteSize);
  });
});
