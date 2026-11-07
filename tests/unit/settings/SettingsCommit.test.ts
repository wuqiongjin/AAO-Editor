// 14 票（架构评审候选 5）：设置对象的「变换 + 落盘」收进唯一写回入口。
//
// 为什么单测：一次变更的两半只有在可注入的 Storage 上才能同时观察 —— 改前 Provider
// 有 24 处 `persistSettings(updateSettings(...))` 同型重复 + 2 处变体，纯函数单测测不到调用方式。
// 这里只测 module 的公开入口；Provider 的接线由 DOM 净值网与静态唯一调用点锁看守。
import { describe, expect, it, vi } from 'vitest';
import { commitSettings, defaultSettings, replaceSettings } from '@/src/settings/AppSettings';
import { settingsMemStorage } from '@/tests/support/storage';

describe('14 · 设置对象唯一写回入口', () => {
  it('一次 patch 只落盘一次，落盘内容等于返回的新对象，且不改原对象', () => {
    const storage = settingsMemStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const prev = defaultSettings();

    const next = commitSettings(prev, { theme: 'dark' }, storage);

    expect(next.theme).toBe('dark');
    expect(prev.theme).not.toBe('dark');
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.raw() ?? 'null')).toEqual(next);
  });

  it('归一化仍生效：改 export.enabled 不抹掉 opening.items 的三项开关', () => {
    const storage = settingsMemStorage();
    const prev = defaultSettings();

    const next = commitSettings(prev, { export: { enabled: false } }, storage);

    expect(next.export.enabled).toBe(false);
    expect(next.export.opening.items).toEqual(prev.export.opening.items);
    expect(JSON.parse(storage.raw() ?? 'null').export.opening.items).toEqual(prev.export.opening.items);
  });

  it('连续两次 patch 各落盘一次，第二次基于第一次的结果', () => {
    const storage = settingsMemStorage();
    const setItem = vi.spyOn(storage, 'setItem');

    const first = commitSettings(defaultSettings(), { theme: 'dark' }, storage);
    const second = commitSettings(first, { autoCheck: false }, storage);

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(second.theme).toBe('dark');
    expect(second.autoCheck).toBe(false);
    expect(JSON.parse(storage.raw() ?? 'null')).toEqual(second);
  });

  it('整体替换（导入 / 恢复）只落盘一次，对象逐字不变', () => {
    const storage = settingsMemStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const imported = { ...defaultSettings(), theme: 'light' as const };

    const next = replaceSettings(imported, storage);

    expect(next).toBe(imported);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.raw() ?? 'null')).toEqual(imported);
  });
});
