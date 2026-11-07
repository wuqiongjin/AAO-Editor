import { describe, expect, it } from 'vitest';
import {
  FUNCTIONS,
  functionById,
  getDefaultConfig,
  type FunctionId,
} from '@/src/chart/config/ShortcutConfig';
import { bucketForCategory, restoreDefaultsInFilter } from '@/src/settings/shortcutIndexFilter';
import { defaultSettings } from '@/src/chart/config/AppSettings';
import { CHART_EDIT_FUNCTIONS } from '@/src/project/chartReadonlyGate';

describe('issue 216 · 快捷键系统注册与默认值锁测', () => {
  const ids: FunctionId[] = ['beatSnapNext', 'beatSnapPrev', 'beatSnapCycle'];

  it('beatSnapNext、beatSnapPrev、beatSnapCycle 正确登记在 FUNCTIONS 中', () => {
    for (const id of ids) {
      const def = functionById(id);
      expect(def).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.scope ?? 'canvas').toBe('canvas');
    }
  });

  it('三者默认键位均为 null（出厂未绑定，零按键冲突）', () => {
    const defaults = getDefaultConfig();
    for (const id of ids) {
      expect(functionById(id).binding).toBeNull();
      expect(defaults[id]).toBeNull();
    }
  });

  it('三者 category 均为 snap，并在 shortcutIndexFilter 中被归入 editTools 桶', () => {
    for (const id of ids) {
      const def = functionById(id);
      expect(def.category).toBe('snap');
      expect(bucketForCategory(def.category)).toBe('editTools');
    }
  });

  it('三者不在 CHART_EDIT_FUNCTIONS 中（只读谱面照常可用）', () => {
    for (const id of ids) {
      expect(CHART_EDIT_FUNCTIONS.has(id as never)).toBe(false);
    }
  });

  it('全量恢复默认快捷键时，键位重置为 null 且不影响 beatSnapCycleList', () => {
    const settings = defaultSettings();
    // 模拟用户绑定了按键，并配置了自定义循环列表
    const customShortcuts = { ...settings.shortcuts };
    customShortcuts.beatSnapNext = 'ctrl+shift+]';
    customShortcuts.beatSnapPrev = 'ctrl+shift+[';
    customShortcuts.beatSnapCycle = 'ctrl+shift+c';

    const customCycleList = [3, 6, 12, 24];
    settings.beatSnapCycleList = customCycleList;

    // 全量恢复快捷键默认
    const restoredShortcuts = restoreDefaultsInFilter(customShortcuts, 'all');

    // 快捷键重置为 null
    expect(restoredShortcuts.beatSnapNext).toBeNull();
    expect(restoredShortcuts.beatSnapPrev).toBeNull();
    expect(restoredShortcuts.beatSnapCycle).toBeNull();

    // 循环列表保持不变
    expect(settings.beatSnapCycleList).toEqual([3, 6, 12, 24]);
  });
});
