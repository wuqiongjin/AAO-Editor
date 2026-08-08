// 快捷键系统核心：扁平「具体功能」注册表、每功能单键、冲突检测、localStorage 持久化、按键解析
// 权威规则见 docs/adr/0002-快捷键系统与自定义配置.md
//
// 设计要点（Q6 定案）：
// - 不给「音符类型/操作类型」整类绑定，而是给「具体功能」绑定。如「切换-单键」与「执行-单键」是两个独立功能。
// - 每个具体功能恰好绑定 1 个键（"1 功能 1 键"），不再支持一功能多键。

export type FunctionId =
  | 'switchSingle' | 'execSingle'
  | 'switchFlick' | 'execFlick'
  | 'switchSkill' | 'execSkill'
  | 'switchLDirectional' | 'execLDirectional'
  | 'switchRDirectional' | 'execRDirectional'
  | 'switchBpm' | 'execBpm'
  | 'switchSlide' | 'execSlide'
  | 'switchCopy' | 'execCopy'
  | 'switchPaste' | 'execPaste'
  | 'switchCut' | 'execCut'
  | 'switchDelete' | 'execDelete'
  | 'switchMirror' | 'execMirror'
  | 'switchMouse'
  | 'undo' | 'redo' | 'play';

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
  { id: 'switchSingle',       label: '切换-单键',   category: '单键', binding: 'f' },
  { id: 'execSingle',         label: '执行-单键',   category: '单键', binding: 'ctrl+f' },
  { id: 'switchFlick',        label: '切换-滑键',   category: '滑键', binding: 'g' },
  { id: 'execFlick',          label: '执行-滑键',   category: '滑键', binding: 'ctrl+g' },
  { id: 'switchSkill',        label: '切换-技能',   category: '技能', binding: 'a' },
  { id: 'execSkill',          label: '执行-技能',   category: '技能', binding: 'ctrl+a' },
  { id: 'switchLDirectional', label: '切换-左滑',   category: '左滑', binding: 's' },
  { id: 'execLDirectional',   label: '执行-左滑',   category: '左滑', binding: 'ctrl+s' },
  { id: 'switchRDirectional', label: '切换-右滑',   category: '右滑', binding: 'd' },
  { id: 'execRDirectional',   label: '执行-右滑',   category: '右滑', binding: 'ctrl+d' },
  { id: 'switchBpm',          label: '切换-BPM',    category: 'BPM', binding: '`' },
  { id: 'execBpm',            label: '执行-BPM',    category: 'BPM', binding: 'ctrl+`' },
  { id: 'switchSlide',        label: '切换-滑条',   category: '滑条', binding: 'e' },
  { id: 'execSlide',          label: '执行-滑条',   category: '滑条', binding: 'ctrl+e' },
  { id: 'switchCopy',         label: '切换-复制',   category: '复制', binding: 'c' },
  { id: 'execCopy',           label: '执行-复制',   category: '复制', binding: 'ctrl+c' },
  { id: 'switchPaste',        label: '切换-粘贴',   category: '粘贴', binding: 'v' },
  { id: 'execPaste',          label: '执行-粘贴',   category: '粘贴', binding: 'ctrl+v' },
  { id: 'switchCut',          label: '切换-剪切',   category: '剪切', binding: 'x' },
  { id: 'execCut',            label: '执行-剪切',   category: '剪切', binding: 'ctrl+x' },
  { id: 'switchDelete',       label: '切换-删除',   category: '删除', binding: 't' },
  { id: 'execDelete',         label: '执行-删除',   category: '删除', binding: 'ctrl+t' },
  { id: 'switchMirror',       label: '切换-镜像',   category: '镜像', binding: 'q' },
  { id: 'execMirror',         label: '执行-镜像',   category: '镜像', binding: 'ctrl+q' },
  { id: 'switchMouse',        label: '切换-鼠标',   category: '鼠标', binding: 'r' },
  { id: 'undo',               label: '撤销',        category: '撤销', binding: 'ctrl+z' },
  { id: 'redo',               label: '重做',        category: '重做', binding: 'ctrl+y' },
  { id: 'play',               label: '播放/暂停',   category: '播放', binding: ' ' },
];

export const functionById = (id: FunctionId): FunctionDef =>
  FUNCTIONS.find(f => f.id === id)!;

/** 按类别分组的功能（用于 tooltip 合并 切换/执行 展示） */
export const functionsByCategory = (cat: string): FunctionDef[] =>
  FUNCTIONS.filter(f => f.category === cat);

/** 功能模式：切换态或执行态（switch* → 切换；其余含 undo/redo/play → 执行） */
export const functionMode = (id: FunctionId): 'switch' | 'exec' =>
  id.startsWith('switch') ? 'switch' : 'exec';

/** 键位展示格式（大写）：ctrl+f → Ctrl+F，空格 → Space，ctrl+shift+q → Ctrl+Shift+Q */
export const formatKey = (key: string): string => {
  if (key === ' ') return 'Space';
  return key.split('+').map(p => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt') return 'Alt';
    return p.toUpperCase();
  }).join('+');
};

/** 某类别下用于 tooltip 展示的 切换/执行 键位行（按当前配置） */
export const categoryShortcuts = (cfg: ShortcutConfig, cat: string): { mode: string; key: string }[] =>
  functionsByCategory(cat).map(f => ({
    mode: functionMode(f.id) === 'switch' ? '切换' : '执行',
    key: formatKey(cfg[f.id]),
  }));

/** 全部类别（保序去重） */
export const categories = (): string[] => [...new Set(FUNCTIONS.map(f => f.category))];

/** 配置 = 每个具体功能绑定一个键（小写规范形式） */
export type ShortcutConfig = Record<FunctionId, string>;

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

const STORAGE_KEY = 'bangdream.shortcuts.v1';

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
      if (typeof v === 'string') cfg[f.id] = v.toLowerCase();
    }
    return cfg;
  } catch {
    return defaults;
  }
}

export function saveConfig(cfg: ShortcutConfig, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/** 构建 绑定串 → 功能 的反向索引（供按键解析） */
export function buildBindingIndex(cfg: ShortcutConfig): Map<string, FunctionId> {
  const map = new Map<string, FunctionId>();
  for (const f of FUNCTIONS) map.set(cfg[f.id], f.id);
  return map;
}

/** 由按键事件解析出命中的具体功能 id */
export function resolveAction(e: KeyboardEvent, cfg: ShortcutConfig): FunctionId | null {
  return buildBindingIndex(cfg).get(normalizeKeyEvent(e)) ?? null;
}

/** 冲突检测：某键位是否已属于"其它"功能 */
export function bindingTakenByOther(cfg: ShortcutConfig, target: FunctionId, binding: string): FunctionId | null {
  for (const f of FUNCTIONS) {
    if (f.id === target) continue;
    if (cfg[f.id] === binding) return f.id;
  }
  return null;
}

/** 为某个功能设置键位：冲突时返回冲突功能 id，否则写入并返回 null */
export function setFunctionBinding(cfg: ShortcutConfig, id: FunctionId, binding: string): FunctionId | null {
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
