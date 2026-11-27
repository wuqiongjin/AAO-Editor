import { describe, expect, it } from 'vitest';
import {
  buildBindingIndex,
  functionById,
  getDefaultConfig,
  loadConfig,
  resolveAction,
  type FunctionId,
  type ShortcutConfig,
} from '@/src/settings/ShortcutConfig';
import { bucketForCategory, restoreDefaultsInFilter } from '@/src/settings/shortcutIndexFilter';
import { defaultSettings } from '@/src/settings/AppSettings';
import { CHART_EDIT_FUNCTIONS } from '@/src/project/chartReadonlyGate';

const SET_IDS = [
  'beatSnapSet1', 'beatSnapSet2', 'beatSnapSet3', 'beatSnapSet4',
  'beatSnapSet6', 'beatSnapSet8', 'beatSnapSet12', 'beatSnapSet16',
] as const satisfies readonly FunctionId[];

const SET_DEFAULT_KEYS: Record<(typeof SET_IDS)[number], string> = {
  beatSnapSet1: '1',
  beatSnapSet2: '2',
  beatSnapSet3: '3',
  beatSnapSet4: '4',
  beatSnapSet6: '6',
  beatSnapSet8: '8',
  beatSnapSet12: '9',
  beatSnapSet16: '0',
};

const boundCountOf = (cfg: ShortcutConfig): number => Object.values(cfg).filter(Boolean).length;
const keyEvent = (key: string): KeyboardEvent =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const oldSnapshot = (obj: Record<string, string | null>): Pick<Storage, 'getItem'> =>
  ({ getItem: () => JSON.stringify(obj) });

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

describe('issue 239 · 设为 1/N 登记与出厂数字键', () => {
  it('八档登记：出厂 Bestdori 数字键、类别 snap、作用域 canvas、进 editTools、不进只读闸门', () => {
    const cfg = getDefaultConfig();
    for (const id of SET_IDS) {
      const def = functionById(id);
      expect(def.id, id).toBe(id);
      expect(def.binding, id).toBe(SET_DEFAULT_KEYS[id]);
      expect(cfg[id], id).toBe(SET_DEFAULT_KEYS[id]);
      expect(def.category, id).toBe('snap');
      expect(def.scope ?? 'canvas', id).toBe('canvas');
      expect(bucketForCategory(def.category), id).toBe('editTools');
      expect(CHART_EDIT_FUNCTIONS.has(id as never), id).toBe(false);
    }
    expect(cfg.beatSnapNext).toBeNull();
    expect(cfg.beatSnapPrev).toBeNull();
    expect(cfg.beatSnapCycle).toBeNull();
  });

  it('5 与 7 出厂不被任何功能占用', () => {
    const cfg = getDefaultConfig();
    expect(resolveAction(keyEvent('5'), cfg)).toBeNull();
    expect(resolveAction(keyEvent('7'), cfg)).toBeNull();
  });

  it('八个裸键各自命中对应「设为 1/N」', () => {
    const cfg = getDefaultConfig();
    for (const id of SET_IDS) {
      expect(resolveAction(keyEvent(SET_DEFAULT_KEYS[id]), cfg), id).toBe(id);
    }
  });

  it('默认配置零冲突', () => {
    const cfg = getDefaultConfig();
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('恢复默认把八档拉回数字键，且不碰 beatSnapCycleList', () => {
    const settings = defaultSettings();
    const custom = { ...settings.shortcuts };
    custom.beatSnapSet4 = 'f12';
    custom.beatSnapSet12 = null;
    settings.beatSnapCycleList = [3, 6, 12, 24];
    const restored = restoreDefaultsInFilter(custom, 'all');
    for (const id of SET_IDS) expect(restored[id], id).toBe(SET_DEFAULT_KEYS[id]);
    expect(settings.beatSnapCycleList).toEqual([3, 6, 12, 24]);
  });
});

describe('issue 239 · 载入：快照已有优先、新增退让', () => {
  it('老快照不含设为 1/N 的 id、未占数字键 → 出厂数字键生效', () => {
    const cfg = loadConfig(oldSnapshot({ switchSingle: 'f' }));
    for (const id of SET_IDS) expect(cfg[id], id).toBe(SET_DEFAULT_KEYS[id]);
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('老快照已把 4 绑给老功能 → 老功能保键、beatSnapSet4 退让为 null', () => {
    const cfg = loadConfig(oldSnapshot({ switchSingle: '4' }));
    expect(cfg.switchSingle).toBe('4');
    expect(cfg.beatSnapSet4).toBeNull();
    expect(resolveAction(keyEvent('4'), cfg)).toBe('switchSingle');
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });
});
