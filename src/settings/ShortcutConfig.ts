// 快捷键系统核心：扁平「具体功能」注册表、每功能单键、冲突检测、localStorage 持久化、按键解析
// 权威规则见 docs/adr/0002-快捷键系统与自定义配置.md
//
// 设计要点（Q6 定案）：
// - 不给「音符类型/操作类型」整类绑定，而是给「具体功能」绑定。如「切换-单键」与「执行-单键」是两个独立功能。
// - 每个具体功能恰好绑定 1 个键（"1 功能 1 键"），不再支持一功能多键。

import { t } from '../i18n';

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
  // issue 185 / ADR-0023 §4：收藏选区为片段。**读的是选区、不写谱面** —— 故不进
  // `CHART_EDIT_FUNCTIONS`，已上传（只读）谱面照常可用。
  | 'execSavePattern'
  | 'toggleSidebar'
  | 'undo' | 'redo' | 'play' | 'jumpToMarker'
  // issue 230：倍速 / 音量快捷键（作用于播放态、可逆、结果即时可见；对齐 Bestdori 键位）
  | 'rateDown' | 'rateUp' | 'volumeDown' | 'volumeUp'
  // issue 216：节拍吸附快捷键（增大细分 / 减小细分 / 常用档位循环），出厂未绑定（binding: null）
  | 'beatSnapNext' | 'beatSnapPrev' | 'beatSnapCycle'
  // 切页（issue 177，2026-10-28 用户定案）：应用级功能进同一注册表，
  // 改键 / 冲突检测 / 屏蔽 / 导入导出全部复用同一套。
  | 'pageProjects' | 'pageWorkspace' | 'pageAudio' | 'pagePreview'
  | 'pageAssets' | 'pageShortcuts' | 'pageSettings';

/**
 * 功能作用域：
 * - `canvas`（默认）：画布功能，由 useShortcutDispatch 在页面激活时分发；
 * - `app`：应用级功能（切页），由 AppShell 分发，与页面激活无关。
 * 两个作用域**共用一份绑定索引做冲突检测**（一键不多功能是全局的），只在分发时按作用域分流。
 */
export type FunctionScope = 'canvas' | 'app';

export interface FunctionDef {
  id: FunctionId;
  /** 具体功能名（可搜索，支持部分匹配） */
  label: string;
  /** 展示分组类别（tooltip 按类别合并 切换/执行） */
  category: string;
  /** 该功能绑定的单个键，小写规范形式，如 'f' / 'ctrl+f' / ' '（空格）；null 表示出厂未绑定 */
  binding: string | null;
  /** 缺省 = 'canvas' */
  scope?: FunctionScope;
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
  { id: 'execSavePattern',    label: 'shortcut.fn.execSavePattern',    category: 'pattern', binding: 'ctrl+shift+d' },
  { id: 'toggleSidebar',      label: 'shortcut.fn.toggleSidebar',      category: 'layout', binding: 'ctrl+shift+b' },
  { id: 'undo',               label: 'shortcut.fn.undo',               category: 'undo', binding: 'ctrl+z' },
  { id: 'redo',               label: 'shortcut.fn.redo',               category: 'redo', binding: 'ctrl+y' },
  { id: 'play',               label: 'shortcut.fn.play',               category: 'play', binding: ' ' },
  { id: 'jumpToMarker',       label: 'shortcut.fn.jumpToMarker',       category: 'play', binding: 'ctrl+ ' },
  // 倍速 / 音量（issue 230）：category 'play' 复用现成的 playback 索引桶；四键均为出厂默认裸键，
  // 与出厂默认表零冲突（由 getDefaultConfig() 零冲突单测锁死）。位置不再有「去重优先」含义。
  { id: 'rateDown',           label: 'shortcut.fn.rateDown',           category: 'play', binding: ',' },
  { id: 'rateUp',             label: 'shortcut.fn.rateUp',             category: 'play', binding: '.' },
  { id: 'volumeDown',         label: 'shortcut.fn.volumeDown',         category: 'play', binding: ';' },
  { id: 'volumeUp',           label: 'shortcut.fn.volumeUp',           category: 'play', binding: "'" },
  // 节拍吸附（issue 216，双轨制 Q1=A）：出厂默认 null（零冲突），偏好用户在设置页自行绑定
  { id: 'beatSnapNext',       label: 'shortcut.fn.beatSnapNext',       category: 'snap', binding: null },
  { id: 'beatSnapPrev',       label: 'shortcut.fn.beatSnapPrev',       category: 'snap', binding: null },
  { id: 'beatSnapCycle',      label: 'shortcut.fn.beatSnapCycle',      category: 'snap', binding: null },
  // 切页默认键 Alt+1..7（1 起、与侧栏位次一一对应）。**不要改回 ⇧⌘0..6**：
  // macOS 的 ⇧⌘3/4/5 是系统截图/录屏、⇧⌘6 是 Touch Bar 截图，事件先被系统吃掉，应用收不到。
  // 表尾只是历史排布：载入时去重不再看表序，改按「用户快照里出现过的功能优先」（issue 230）。
  { id: 'pageProjects',  label: 'pageSwitch.projects',  category: 'navigation', binding: 'alt+1', scope: 'app' },
  { id: 'pageWorkspace', label: 'pageSwitch.workspace', category: 'navigation', binding: 'alt+2', scope: 'app' },
  { id: 'pageAudio',     label: 'pageSwitch.audio',     category: 'navigation', binding: 'alt+3', scope: 'app' },
  { id: 'pagePreview',   label: 'pageSwitch.preview',   category: 'navigation', binding: 'alt+4', scope: 'app' },
  { id: 'pageAssets',    label: 'pageSwitch.assets',    category: 'navigation', binding: 'alt+5', scope: 'app' },
  { id: 'pageShortcuts', label: 'pageSwitch.shortcuts', category: 'navigation', binding: 'alt+6', scope: 'app' },
  { id: 'pageSettings',  label: 'pageSwitch.settings',  category: 'navigation', binding: 'alt+7', scope: 'app' },
];

export const functionById = (id: FunctionId): FunctionDef =>
  FUNCTIONS.find(f => f.id === id)!;

/** 按类别分组的功能（用于 tooltip 合并 切换/执行 展示） */
export const functionsByCategory = (cat: string): FunctionDef[] =>
  FUNCTIONS.filter(f => f.category === cat);

/**
 * 功能模式：切换态或执行态（switch* → 切换；其余含 undo/redo/play → 执行）。
 * 应用级（切页）不属于任何一档 —— 它既不是"拿一个工具"也不是"就地执行"，返回 null。
 */
export const functionMode = (id: FunctionId): 'switch' | 'exec' | null => {
  if (functionById(id).scope === 'app') return null;
  return id.startsWith('switch') ? 'switch' : 'exec';
};

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
      const mode = functionMode(f.id);
      if (!mode) return null; // 应用级功能没有「切换/执行」之分，不进 tooltip 合并行
      return {
        mode: mode === 'switch' ? t('shortcut.mode.switch') : t('shortcut.mode.exec'),
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

/**
 * 主键字符。macOS 上按住 ⌥ 时 `e.key` 是**合成字符**（⌥1 → '¡'、⌥2 → '™'…），
 * 直接用它做绑定串会永远匹配不到 `alt+1`。带 alt 的数字行改用布局无关的 `e.code`（Digit1 → '1'）。
 */
function mainKeyOf(e: KeyboardEvent): string {
  if (e.altKey && /^Digit[0-9]$/.test(e.code ?? '')) return e.code.slice(5);
  return e.key.toLowerCase();
}

/** 按键事件 → 规范绑定串（小写）：修饰键依次为 ctrl(含 meta)/alt/shift，后接主键小写 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const key = mainKeyOf(e);
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return mods.length ? mods.join('+') + '+' + key : key;
}

/** 焦点在可编辑控件里 → 放行原生输入（ADR-0002 §6）。应用级切页键同样受此约束。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
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
  toggleSidebar: { old: 'ctrl+b', current: functionById('toggleSidebar').binding! },
  // issue 09 验收反馈 #9：曲线切换键 C → W（执行键 Shift+W 为新增项，不涉及旧存档）
  switchCurve: { old: 'c', current: functionById('switchCurve').binding! },
};

function repairStaleBindings(cfg: ShortcutConfig): ShortcutConfig {
  for (const [id, rule] of Object.entries(SUPERSEDED_DEFAULTS) as [FunctionId, { old: string; current: string }][]) {
    if (cfg[id] === rule.old) cfg[id] = rule.current;
  }
  return cfg;
}

/**
 * 载入时去重（issue 230 修订）：一份配置里同一组合只能归一个功能——**跨作用域也一样**。
 *
 * 长期契约 = **用户设置永远优先**：新增内置默认键绝不抢占用户已占用的键。
 * - 判定口径 B：以用户快照 `parsed` 的 **key 集合**分流 —— 出现过的 id = 老功能，
 *   没出现过的 = 本次新增（其键必然来自出厂默认）。**不看用户改没改过**（值恰好等于出厂默认也算老功能），
 *   因此无需 diff 元数据、无需 bump `schemaVersion`。
 * - 键位撞车时老功能保住键、新增功能退让成 `null`（显示为「已屏蔽」，快捷键页点「启用」可当场改绑）；
 *   即便新增功能在 `FUNCTIONS` 表里排在前面也一样 —— **表序优先 ≠ 用户优先**。
 * - 两边都是老功能（脏存档 / 导入）时仍按表序保留第一个，保证一键不多功能。
 * - 两边都是新增（两个出厂默认互撞）由 `getDefaultConfig()` 的零冲突单测在开发期锁死，此处不兜底。
 */
function dedupeBindings(cfg: ShortcutConfig, existingIds: ReadonlySet<string>): ShortcutConfig {
  const seen = new Map<string, FunctionId>();
  for (const f of FUNCTIONS) {
    const b = cfg[f.id];
    if (!b) continue;
    const owner = seen.get(b);
    if (!owner) { seen.set(b, f.id); continue; }
    if (!existingIds.has(owner) && existingIds.has(f.id)) {
      // 先到的新增功能退让给后到的老功能（不能用表序把老功能顶掉）
      cfg[owner] = null;
      seen.set(b, f.id);
    } else {
      cfg[f.id] = null;
    }
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
    // 快照里出现过的 id = 老功能；缺席的 id 是本次新增，其键来自出厂默认、撞车时退让。
    const existingIds = new Set(Object.keys(parsed));
    const cfg = getDefaultConfig();
    for (const f of FUNCTIONS) {
      const v = parsed[f.id];
      if (v === null) cfg[f.id] = null; // 显式屏蔽
      else if (typeof v === 'string') cfg[f.id] = v.toLowerCase();
    }
    return dedupeBindings(repairStaleBindings(cfg), existingIds);
  } catch {
    return defaults;
  }
}

export function saveConfig(cfg: ShortcutConfig, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/**
 * 构建 绑定串 → 功能 的反向索引（供按键解析；屏蔽/未绑定的功能不索引）。
 * `scope` 只筛**分发给谁**，不影响冲突检测（那边永远遍历全表）。
 */
export function buildBindingIndex(cfg: ShortcutConfig, scope?: FunctionScope): Map<string, FunctionId> {
  const map = new Map<string, FunctionId>();
  for (const f of FUNCTIONS) {
    if (scope && (f.scope ?? 'canvas') !== scope) continue;
    const b = cfg[f.id];
    if (b) map.set(b, f.id);
  }
  return map;
}

/** 由按键事件解析出命中的具体功能 id；scope 不传 = 全表（含切页键） */
export function resolveAction(e: KeyboardEvent, cfg: ShortcutConfig, scope?: FunctionScope): FunctionId | null {
  return buildBindingIndex(cfg, scope).get(normalizeKeyEvent(e)) ?? null;
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

/**
 * 「屏蔽前的键位」（issue 178，用户 2026-10-28 定案 Q1=A）：FunctionId → 屏蔽瞬间的绑定串。
 * 屏蔽只把配置值置 `null` 会丢掉用户的自定义键位，故在屏蔽时另记一份，重新启用时写回。
 * **只服务启用**：不参与绑定索引、不占用键位（屏蔽期间该键仍可被别的功能拿走，Q3 定案）；
 * 持久化在 `settings.shortcutLast`（additive，不 bump schemaVersion）。
 */
export type ShortcutMasks = Partial<Record<FunctionId, string>>;

/** 屏蔽：把当前键位记进 masks 再置 null；原本已屏蔽（没有当前键位）时保留已有记录 */
export function maskFunctionBinding(cfg: ShortcutConfig, masks: ShortcutMasks, id: FunctionId): void {
  const current = cfg[id];
  if (current) masks[id] = current;
  cfg[id] = null;
}

/** 重新启用的目标键：优先屏蔽前键位；没有记录（旧存档 / 载入去重造成）回落出厂默认（未绑定则为 null） */
export function bindingToRestore(id: FunctionId, masks: ShortcutMasks): string | null {
  return masks[id] ?? getDefaultConfig()[id] ?? functionById(id).binding ?? null;
}

/** 只保留仍在屏蔽态的条目：启用 / 恢复默认后旧记录自动失效，避免下次屏蔽时被当成"上次键位" */
export function pruneShortcutMasks(masks: ShortcutMasks, cfg: ShortcutConfig): ShortcutMasks {
  const out: ShortcutMasks = {};
  for (const [id, binding] of Object.entries(masks) as [FunctionId, string][]) {
    if (binding && cfg[id] === null) out[id] = binding;
  }
  return out;
}

/** 导出配置为 JSON 字符串 */
export function exportConfig(cfg: ShortcutConfig): string {
  return JSON.stringify(cfg, null, 2);
}
