// 快捷键系统核心：扁平「具体功能」注册表、每功能单键、冲突检测、localStorage 持久化、按键解析
// 权威规则见 docs/adr/0002-快捷键系统与自定义配置.md
//
// 设计要点（Q6 定案）：
// - 不给「音符类型/操作类型」整类绑定，而是给「具体功能」绑定。如「切换-单键」与「执行-单键」是两个独立功能。
// - 每个具体功能恰好绑定 1 个键（"1 功能 1 键"），不再支持一功能多键。

import { t } from '../../i18n';

export type FunctionId =
  | 'switchSingle' | 'execSingle'
  | 'switchFlick' | 'execFlick'
  | 'switchSkill' | 'execSkill'
  | 'switchLDirectional' | 'execLDirectional'
  | 'switchRDirectional' | 'execRDirectional'
  | 'switchBpm' | 'execBpm'
  | 'switchSlide' | 'execSlide'
  // issue 09 S2（ADR-0009 §3）：曲线工具。验收反馈 #9 起补执行键（Shift+W）：选区=组合+全部段应用 /
  // 光标在段=重应用 / 空白=挂锚点续段（按光标分发，对齐 execSlide 双语义先例）。
  // 默认键不用 Ctrl+W——浏览器保留键（关标签、preventDefault 拦不住）。
  | 'switchCurve' | 'execCurve'
  // ADR-0008 §2.1（六轮）：复制/剪切**不占工具轴**（不 arm）——连续复制无意义、连续剪切有误删风险，
  // 二者必须有选区，只保留 execCopy / execCut 作用于选区。故无 switchCopy / switchCut。
  | 'execCopy'
  | 'switchPaste' | 'execPaste'
  | 'execCut'
  | 'switchDelete' | 'execDelete'
  | 'switchMirror' | 'execMirror'
  // issue 59 §2：音符代码 = 持工具态（点谁看谁）；Ctrl+B = 打开光标处音符的代码（不切工具的快捷版）
  | 'switchNoteCode' | 'execNoteCode'
  | 'switchMouse'
  | 'toggleSidebar'
  | 'undo' | 'redo' | 'play' | 'jumpToMarker';

export interface FunctionDef {
  id: FunctionId;
  /** 具体功能名（可搜索，支持部分匹配） */
  label: string;
  /** 展示分组类别（tooltip 按类别合并 切换/执行） */
  category: string;
  /** 该功能绑定的单个键，小写规范形式，如 'f' / 'ctrl+f' / ' '（空格） */
  binding: string;
}

export const FUNCTIONS: FunctionDef[] = [
  { id: 'switchSingle',       label: 'shortcut.fn.switchSingle',       category: 'single', binding: 'f' },
  { id: 'execSingle',         label: 'shortcut.fn.execSingle',         category: 'single', binding: 'ctrl+f' },
  { id: 'switchFlick',        label: 'shortcut.fn.switchFlick',        category: 'flick', binding: 'g' },
  { id: 'execFlick',          label: 'shortcut.fn.execFlick',          category: 'flick', binding: 'ctrl+g' },
  { id: 'switchSkill',        label: 'shortcut.fn.switchSkill',        category: 'skill', binding: 'a' },
  { id: 'execSkill',          label: 'shortcut.fn.execSkill',          category: 'skill', binding: 'ctrl+a' },
  { id: 'switchLDirectional', label: 'shortcut.fn.switchLDirectional', category: 'ldirectional', binding: 's' },
  { id: 'execLDirectional',   label: 'shortcut.fn.execLDirectional',   category: 'ldirectional', binding: 'ctrl+s' },
  { id: 'switchRDirectional', label: 'shortcut.fn.switchRDirectional', category: 'rdirectional', binding: 'd' },
  { id: 'execRDirectional',   label: 'shortcut.fn.execRDirectional',   category: 'rdirectional', binding: 'ctrl+d' },
  { id: 'switchBpm',          label: 'shortcut.fn.switchBpm',          category: 'bpm', binding: '`' },
  { id: 'execBpm',            label: 'shortcut.fn.execBpm',            category: 'bpm', binding: 'ctrl+`' },
  { id: 'switchSlide',        label: 'shortcut.fn.switchSlide',        category: 'slide', binding: 'e' },
  { id: 'execSlide',          label: 'shortcut.fn.execSlide',          category: 'slide', binding: 'ctrl+e' },
  { id: 'switchCurve',        label: 'shortcut.fn.switchCurve',        category: 'curve', binding: 'w' },
  { id: 'execCurve',          label: 'shortcut.fn.execCurve',          category: 'curve', binding: 'shift+w' },
  { id: 'execCopy',           label: 'shortcut.fn.execCopy',           category: 'copy', binding: 'ctrl+c' },
  { id: 'switchPaste',        label: 'shortcut.fn.switchPaste',        category: 'paste', binding: 'v' },
  { id: 'execPaste',          label: 'shortcut.fn.execPaste',          category: 'paste', binding: 'ctrl+v' },
  { id: 'execCut',            label: 'shortcut.fn.execCut',            category: 'cut', binding: 'ctrl+x' },
  { id: 'switchDelete',       label: 'shortcut.fn.switchDelete',       category: 'delete', binding: 't' },
  { id: 'execDelete',         label: 'shortcut.fn.execDelete',         category: 'delete', binding: 'ctrl+t' },
  { id: 'switchMirror',       label: 'shortcut.fn.switchMirror',       category: 'mirror', binding: 'q' },
  { id: 'execMirror',         label: 'shortcut.fn.execMirror',         category: 'mirror', binding: 'ctrl+q' },
  { id: 'switchNoteCode',     label: 'shortcut.fn.switchNoteCode',     category: 'noteCode', binding: 'b' },
  { id: 'execNoteCode',       label: 'shortcut.fn.execNoteCode',       category: 'noteCode', binding: 'ctrl+b' },
  { id: 'switchMouse',        label: 'shortcut.fn.switchMouse',        category: 'mouse', binding: 'r' },
  { id: 'toggleSidebar',      label: 'shortcut.fn.toggleSidebar',      category: 'layout', binding: 'ctrl+shift+b' },
  { id: 'undo',               label: 'shortcut.fn.undo',               category: 'undo', binding: 'ctrl+z' },
  { id: 'redo',               label: 'shortcut.fn.redo',               category: 'redo', binding: 'ctrl+y' },
  { id: 'play',               label: 'shortcut.fn.play',               category: 'play', binding: ' ' },
  { id: 'jumpToMarker',       label: 'shortcut.fn.jumpToMarker',       category: 'play', binding: 'ctrl+ ' },
];

export const functionById = (id: FunctionId): FunctionDef =>
  FUNCTIONS.find(f => f.id === id)!;

/** 按类别分组的功能（用于 tooltip 合并 切换/执行 展示） */
export const functionsByCategory = (cat: string): FunctionDef[] =>
  FUNCTIONS.filter(f => f.category === cat);

/** 功能模式：切换态或执行态（switch* → 切换；其余含 undo/redo/play → 执行） */
export const functionMode = (id: FunctionId): 'switch' | 'exec' =>
  id.startsWith('switch') ? 'switch' : 'exec';

/** 键位展示格式（大写）：ctrl+f → Ctrl+F，空格 → Space，ctrl+shift+q → Ctrl+Shift+Q；null(屏蔽) → — */
export const formatKey = (key: string | null): string => {
  if (!key) return '—';
  if (key === ' ') return 'Space';
  return key.split('+').map(p => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt') return 'Alt';
    if (p === ' ') return 'Space'; // 组合键中的空格（如 ctrl+ 空格）也应显示为 Space
    return p.toUpperCase();
  }).join('+');
};

/** 某类别下用于 tooltip 展示的 切换/执行 键位行（按当前配置） */
export const categoryShortcuts = (cfg: ShortcutConfig, cat: string): { mode: string; key: string }[] =>
  functionsByCategory(cat)
    .map(f => {
      const b = cfg[f.id];
      if (!b) return null; // 已屏蔽（未绑定）的功能不出现在 tooltip
      return {
        mode: functionMode(f.id) === 'switch' ? t('shortcut.mode.switch') : t('shortcut.mode.exec'),
        key: formatKey(b),
      };
    })
    .filter((x): x is { mode: string; key: string } => x !== null);

/** 全部类别（保序去重） */
export const categories = (): string[] => [...new Set(FUNCTIONS.map(f => f.category))];

/**
 * 配置 = 每个具体功能绑定一个键（小写规范形式）；值为 null 表示**屏蔽该功能快捷键**（未绑定、不触发）。
 */
export type ShortcutConfig = Record<FunctionId, string | null>;

/** 按键事件 → 规范绑定串（小写）：修饰键依次为 ctrl(含 meta)/alt/shift，后接主键小写 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return mods.length ? mods.join('+') + '+' + key : key;
}

export function getDefaultConfig(): ShortcutConfig {
  const cfg = {} as ShortcutConfig;
  for (const f of FUNCTIONS) cfg[f.id] = f.binding;
  return cfg;
}

const STORAGE_KEY = 'aao.shortcuts.v1';

/**
 * 旧存档修复（issue 59）：功能表会随版本增删，旧存档里某个功能占着的键位可能与**新功能**的默认键撞车。
 * 撞车会让 `buildBindingIndex` 静默丢一个（后写的赢），表现为"按键跑到了别的功上"——
 * 例如 `Ctrl+B` 原是「侧栏折叠」默认键，issue 59 起归「执行-音符代码」，
 * 而旧存档里 `toggleSidebar` 仍是 `ctrl+b`（与"从未改过"无法区分），于是 Ctrl+B 仍然折叠侧栏。
 *
 * 规则：只修**默认值被后来者接管**的那一种——持久化值 == 被接管前的旧默认键时，回落到新默认。
 * 用户真正改过的键位（≠ 旧默认）一律保留。
 */
const SUPERSEDED_DEFAULTS: Partial<Record<FunctionId, { old: string; current: string }>> = {
  toggleSidebar: { old: 'ctrl+b', current: functionById('toggleSidebar').binding },
  // issue 09 验收反馈 #9：曲线切换键 C → W（执行键 Shift+W 为新增项，不涉及旧存档）
  switchCurve: { old: 'c', current: functionById('switchCurve').binding },
};

function repairStaleBindings(cfg: ShortcutConfig): ShortcutConfig {
  for (const [id, rule] of Object.entries(SUPERSEDED_DEFAULTS) as [FunctionId, { old: string; current: string }][]) {
    if (cfg[id] === rule.old) cfg[id] = rule.current;
  }
  return cfg;
}

/** 从 localStorage 加载配置；无或损坏则返回默认 */
export function loadConfig(storage: Pick<Storage, 'getItem'> = localStorage): ShortcutConfig {
  const defaults = getDefaultConfig();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ShortcutConfig>;
    const cfg = getDefaultConfig();
    for (const f of FUNCTIONS) {
      const v = parsed[f.id];
      if (v === null) cfg[f.id] = null; // 显式屏蔽
      else if (typeof v === 'string') cfg[f.id] = v.toLowerCase();
    }
    return repairStaleBindings(cfg);
  } catch {
    return defaults;
  }
}

export function saveConfig(cfg: ShortcutConfig, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/** 构建 绑定串 → 功能 的反向索引（供按键解析；屏蔽/未绑定的功能不索引） */
export function buildBindingIndex(cfg: ShortcutConfig): Map<string, FunctionId> {
  const map = new Map<string, FunctionId>();
  for (const f of FUNCTIONS) {
    const b = cfg[f.id];
    if (b) map.set(b, f.id);
  }
  return map;
}

/** 由按键事件解析出命中的具体功能 id */
export function resolveAction(e: KeyboardEvent, cfg: ShortcutConfig): FunctionId | null {
  return buildBindingIndex(cfg).get(normalizeKeyEvent(e)) ?? null;
}

// 全局"正在记录快捷键"标志：记录弹窗打开时置 true，Editor 全局 keydown 据此放行，避免误触发。
let capturing = false;
export const setCapturingShortcut = (v: boolean): void => { capturing = v; };
export const isCapturingShortcut = (): boolean => capturing;

/** 冲突检测：某键位是否已属于"其它"功能 */
export function bindingTakenByOther(cfg: ShortcutConfig, target: FunctionId, binding: string): FunctionId | null {
  for (const f of FUNCTIONS) {
    if (f.id === target) continue;
    if (cfg[f.id] === binding) return f.id;
  }
  return null;
}

/** 为某个功能设置键位：传入 null/空串表示**屏蔽**（清除绑定）；冲突时返回冲突功能 id，否则写入并返回 null */
export function setFunctionBinding(cfg: ShortcutConfig, id: FunctionId, binding: string | null): FunctionId | null {
  if (binding === null || binding === '') {
    cfg[id] = null;
    return null;
  }
  binding = binding.toLowerCase();
  const conflict = bindingTakenByOther(cfg, id, binding);
  if (conflict) return conflict;
  cfg[id] = binding;
  return null;
}

/** 导出配置为 JSON 字符串 */
export function exportConfig(cfg: ShortcutConfig): string {
  return JSON.stringify(cfg, null, 2);
}
