import { describe, expect, it } from 'vitest';
import {
  FUNCTIONS,
  buildBindingIndex,
  formatKey,
  functionById,
  getDefaultConfig,
  loadConfig,
  resolveAction,
  type FunctionId,
  type ShortcutConfig,
} from '@/src/settings/ShortcutConfig';
import { bucketForCategory } from '@/src/settings/shortcutIndexFilter';
import { CHART_EDIT_FUNCTIONS } from '@/src/project/chartReadonlyGate';
import { PLAYBACK_SHORTCUT_IDS, SEEK_SHORTCUT_IDS } from '@/src/playback/playbackShortcuts';

const IDS = ['seekBack', 'seekForward'] as const satisfies readonly FunctionId[];
const DEFAULT_KEYS: Record<(typeof IDS)[number], string> = {
  seekBack: 'arrowleft',
  seekForward: 'arrowright',
};

const boundCountOf = (cfg: ShortcutConfig): number => Object.values(cfg).filter(Boolean).length;
const keyEvent = (key: string): KeyboardEvent =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const oldSnapshot = (obj: Record<string, string | null>): Pick<Storage, 'getItem'> =>
  ({ getItem: () => JSON.stringify(obj) });

describe('issue 251 · 两个 seek 功能登记', () => {
  it('出厂 ← / →，类别 play、作用域 canvas，复用 playback 桶', () => {
    const cfg = getDefaultConfig();
    for (const id of IDS) {
      const def = functionById(id);
      expect(def.binding, id).toBe(DEFAULT_KEYS[id]);
      expect(cfg[id], id).toBe(DEFAULT_KEYS[id]);
      expect(def.category, id).toBe('play');
      expect(def.scope ?? 'canvas', id).toBe('canvas');
      expect(bucketForCategory(def.category), id).toBe('playback');
      expect(CHART_EDIT_FUNCTIONS.has(id as never), id).toBe(false);
    }
    expect(formatKey('arrowleft')).toBe('←');
    expect(formatKey('arrowright')).toBe('→');
  });

  it('默认配置零冲突', () => {
    const cfg = getDefaultConfig();
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('方向键各自命中对应功能', () => {
    const cfg = getDefaultConfig();
    expect(resolveAction(keyEvent('ArrowLeft'), cfg)).toBe('seekBack');
    expect(resolveAction(keyEvent('ArrowRight'), cfg)).toBe('seekForward');
  });

  it('SEEK_SHORTCUT_IDS 就是这两 id；PLAYBACK_SHORTCUT_IDS 不含它们', () => {
    expect([...SEEK_SHORTCUT_IDS]).toEqual(['seekBack', 'seekForward']);
    for (const id of IDS) {
      expect(PLAYBACK_SHORTCUT_IDS).not.toContain(id);
    }
    expect(FUNCTIONS.filter((f) => IDS.includes(f.id as (typeof IDS)[number]))).toHaveLength(2);
  });
});

describe('issue 251 · 载入：快照已有优先、新增退让', () => {
  it('老快照不含这两 id → 出厂方向键生效', () => {
    const cfg = loadConfig(oldSnapshot({ switchSingle: 'f' }));
    for (const id of IDS) expect(cfg[id], id).toBe(DEFAULT_KEYS[id]);
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('老快照里 switchSingle 占着 arrowleft → 老功能保键、seekBack 退让为 null', () => {
    const cfg = loadConfig(oldSnapshot({ switchSingle: 'arrowleft' }));
    expect(cfg.switchSingle).toBe('arrowleft');
    expect(cfg.seekBack).toBeNull();
    expect(resolveAction(keyEvent('ArrowLeft'), cfg)).toBe('switchSingle');
  });
});
