// issue 230 · 倍速 / 音量快捷键：注册表与「载入时新增默认键不抢用户既有键」。
// 接缝 = ShortcutConfig 的公共 API（getDefaultConfig / loadConfig / resolveAction），
// 不碰内部 dedupeBindings；撞键行为由「老存档快照」这条用户可见路径观察。
import { describe, expect, it } from 'vitest';
import {
  FUNCTIONS,
  buildBindingIndex,
  functionById,
  getDefaultConfig,
  loadConfig,
  resolveAction,
  type FunctionId,
  type ShortcutConfig,
} from '@/src/settings/ShortcutConfig';
import { bucketForCategory } from '@/src/settings/shortcutIndexFilter';
import { CHART_EDIT_FUNCTIONS } from '@/src/project/chartReadonlyGate';

const IDS = ['rateDown', 'rateUp', 'volumeDown', 'volumeUp'] as const satisfies readonly FunctionId[];
const DEFAULT_KEYS: Record<(typeof IDS)[number], string> = {
  rateDown: ',',
  rateUp: '.',
  volumeDown: ';',
  volumeUp: "'",
};

const boundCountOf = (cfg: ShortcutConfig): number => Object.values(cfg).filter(Boolean).length;
const keyEvent = (key: string): KeyboardEvent =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
/** 造一份「升级前的老存档」：只含给出的 id，四个新功能一律缺席 */
const oldSnapshot = (obj: Record<string, string | null>): Pick<Storage, 'getItem'> =>
  ({ getItem: () => JSON.stringify(obj) });

describe('issue 230 · 四个播放控制功能登记', () => {
  it('出厂默认键为 , . ; \'，类别 play、作用域 canvas，复用 play → playback 桶', () => {
    const cfg = getDefaultConfig();
    for (const id of IDS) {
      const def = functionById(id);
      expect(def.id, id).toBe(id);
      expect(def.binding, id).toBe(DEFAULT_KEYS[id]);
      expect(cfg[id], id).toBe(DEFAULT_KEYS[id]);
      expect(def.category, id).toBe('play');
      expect(def.scope ?? 'canvas', id).toBe('canvas');
      expect(bucketForCategory(def.category), id).toBe('playback');
    }
  });

  it('默认配置零冲突：两个同时新增的默认键互撞会在开发期失败', () => {
    const cfg = getDefaultConfig();
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('四个裸键各自命中对应功能', () => {
    const cfg = getDefaultConfig();
    for (const id of IDS) {
      expect(resolveAction(keyEvent(DEFAULT_KEYS[id]), cfg), id).toBe(id);
    }
  });

  it('四个功能不写谱面：不进 CHART_EDIT_FUNCTIONS（只读谱面也能调倍速 / 音量）', () => {
    for (const id of IDS) {
      expect(CHART_EDIT_FUNCTIONS.has(id as never), id).toBe(false);
    }
  });

  it('只在注册表追加四行，不改既有功能', () => {
    expect(FUNCTIONS.filter((f) => IDS.includes(f.id as (typeof IDS)[number]))).toHaveLength(4);
    const cfg = getDefaultConfig();
    expect(cfg.switchBpm).toBe('`');
    expect(cfg.play).toBe(' ');
  });
});

describe('issue 230 · 载入：快照已有优先、新增退让', () => {
  it('老快照不含这 4 个 id → 四键按出厂默认生效', () => {
    const cfg = loadConfig(oldSnapshot({ switchSingle: 'f' }));
    for (const id of IDS) expect(cfg[id], id).toBe(DEFAULT_KEYS[id]);
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  for (const [oldId, key, newId] of [
    ['switchSingle', ',', 'rateDown'],
    ['switchFlick', '.', 'rateUp'],
    ['switchSkill', ';', 'volumeDown'],
    ['switchLDirectional', "'", 'volumeUp'],
  ] as const) {
    it(`老快照里 ${oldId} 占着 ${key} → ${oldId} 保键、${newId} 退让为 null`, () => {
      const cfg = loadConfig(oldSnapshot({ [oldId]: key }));
      expect(cfg[oldId]).toBe(key);
      expect(cfg[newId]).toBeNull();
      expect(resolveAction(keyEvent(key), cfg)).toBe(oldId);
      expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
    });
  }

  it('判定只看「快照里出现过没」，不看值是否等于出厂默认、也不看 FUNCTIONS 表序', () => {
    // rateDown 在 FUNCTIONS 里排在 switchSingle 之后；按旧「表序优先」它会赢。
    // 新规则：rateDown 出现在快照里 = 老功能，switchSingle 缺席 = 本次新增 → 后者退让。
    const cfg = loadConfig(oldSnapshot({ rateDown: 'f' }));
    expect(cfg.rateDown).toBe('f');
    expect(cfg.switchSingle).toBeNull();
    expect(resolveAction(keyEvent('f'), cfg)).toBe('rateDown');
  });

  it('快照里出现过、值恰好等于出厂默认的 id 同样算老功能（不因「没改过」被清掉）', () => {
    const cfg = loadConfig(oldSnapshot({
      rateDown: ',', rateUp: '.', volumeDown: ';', volumeUp: "'",
    }));
    for (const id of IDS) expect(cfg[id], id).toBe(DEFAULT_KEYS[id]);
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('撞键时「值 = 自己的出厂默认」也不算新增：按 key 集合而非按改没改过分流', () => {
    // 两个 id 都在快照里 = 都是老功能。switchSingle 恰好是出厂默认 'f'，rateDown 改成了 'f'。
    // 按口径 A（值 = 出厂默认 ⇒ 视为新增）switchSingle 会退让；按本票口径 B 它照旧保键、表序兜底。
    const cfg = loadConfig(oldSnapshot({ switchSingle: 'f', rateDown: 'f' }));
    expect(cfg.switchSingle).toBe('f');
    expect(cfg.rateDown).toBeNull();
    expect(resolveAction(keyEvent('f'), cfg)).toBe('switchSingle');
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });

  it('用户主动屏蔽的功能不受新规则影响（含屏蔽新功能本身）', () => {
    const cfg = loadConfig(oldSnapshot({ switchSingle: null, rateDown: null, play: ' ' }));
    expect(cfg.switchSingle).toBeNull();
    expect(cfg.rateDown).toBeNull();
    expect(cfg.rateUp).toBe('.');
    expect(cfg.play).toBe(' ');
  });

  it('repairStaleBindings 两条特例不回退，且不与新增默认键打架', () => {
    const cfg = loadConfig(oldSnapshot({ toggleSidebar: 'ctrl+b', switchCurve: 'c' }));
    expect(cfg.toggleSidebar).toBe('ctrl+shift+b');
    expect(cfg.switchCurve).toBe('w');
    expect(cfg.execNoteCode).toBe('ctrl+b');
    for (const id of IDS) expect(cfg[id], id).toBe(DEFAULT_KEYS[id]);
    expect(buildBindingIndex(cfg).size).toBe(boundCountOf(cfg));
  });
});
