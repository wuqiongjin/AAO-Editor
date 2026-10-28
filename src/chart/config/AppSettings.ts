// 统一 versioned settings JSON（ADR-0003 §6 / ADR-0004 §7）：
// 合并「快捷键 + 主题 + 布局 + 音频键音」为一份带 schemaVersion 的设置对象。
// 单一 localStorage 键 bangdream.settings.v1，冲突/schema 损坏时回退默认再按字段合并。
//
// 迁移策略：
// - 旧 bangdream.shortcuts.v1 仍可读（一次性回填到新 settings.shortcuts），不再写入。
// - 旧版 schema（仅有 {schemaVersion, audio.keySet}）已包含 audio 段，load 时按字段合并。
import { FUNCTIONS, getDefaultConfig, loadConfig, type ShortcutConfig, type ShortcutMasks } from './ShortcutConfig';
import { normalizeProjectSortKey, type ProjectSortKey } from '../../project/projectSort';
import { normalizeSongSort, SONG_SORT_DEFAULT, type SongSort } from '../../community/bestdori/songs';
import { DEFAULT_ACTIVE_KEY_SOUND_SET_ID, isKnownKeySoundSetId } from '../../audio/KeySound';
import { NOTE_SKIN_DEFAULT_SELECTION } from '../../rendering/skin/gen/noteSkinRegistry.gen';
import { SIM_DEFAULT_PACK_IDS, normalizeSimAssetPackId } from '../../preview/video/sim/simAssetPacks';
import { GRID_STYLE_PRESETS, type GridStylePreset } from '../../rendering/gridStyle';
import { DEFAULT_CURVE_CONFIG, normalizeCurveConfig, type CurveConfig } from '../../chart/editing/CurveTool';
import { detectOsLanguageTag, resolveUiLanguage, type UiLanguage } from '../../i18n/resolveUiLanguage';

/** 背景皮肤默认不透明度（issue 29 修订 2026-08-27）：55% ≈ 首版"满图 + 固定 0.45 暗色遮罩"的最终亮度，观感连续 */
export const DEFAULT_BACKGROUND_OPACITY = 0.55;
/** 背景填充方式缺省：cover 铺满裁剪 */
export const DEFAULT_BACKGROUND_FIT = 'cover' as const;
/** 背景显示范围缺省：仅轨道外显示（用户 grill 定案 2026-08-27：不覆盖轨道本身，不影响作谱） */
export const DEFAULT_BACKGROUND_SCOPE = 'outsideTrack' as const;

export type BackgroundFit = typeof DEFAULT_BACKGROUND_FIT | 'contain';
export type BackgroundScope = typeof DEFAULT_BACKGROUND_SCOPE | 'fullCanvas';

/** chrome 无衬线预设（issue 124）：每档是回退链，不随界面语言自动切 */
export type UiFontStackId = 'geist' | 'yahei' | 'noto';

const UI_TYPE_SCALE_MIN = 0.7;
const UI_TYPE_SCALE_MAX = 1.5;
const UI_FONT_STACK_IDS: readonly UiFontStackId[] = ['geist', 'yahei', 'noto'];

export function normalizeUiTypeScale(raw: unknown, fallback = 1): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const snapped = Math.round(raw * 10) / 10;
  return Math.min(UI_TYPE_SCALE_MAX, Math.max(UI_TYPE_SCALE_MIN, snapped));
}

export function normalizeUiFontStack(raw: unknown, fallback: UiFontStackId = 'geist'): UiFontStackId {
  return (UI_FONT_STACK_IDS as readonly string[]).includes(raw as string) ? (raw as UiFontStackId) : fallback;
}

/**
 * 「屏蔽前的键位」归一化（issue 178）：只认注册表里存在的功能 id，值须为非空字符串并小写化；
 * 未知 id / 空串 / 非字符串一律丢弃——这份记录只服务"重新启用"，脏值宁可没有。
 */
export function normalizeShortcutMasks(raw: unknown): ShortcutMasks {
  const out: ShortcutMasks = {};
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const f of FUNCTIONS) {
    const v = src[f.id];
    if (typeof v === 'string' && v.trim() !== '') out[f.id] = v.trim().toLowerCase();
  }
  return out;
}

export interface AppSettings {
  schemaVersion: 1;
  theme: 'light' | 'dark' | 'system';
  /** 界面语言（issue 128）。additive，不 bump schemaVersion；不进谱面工程 */
  uiLanguage: UiLanguage;
  /** chrome 字号相对出厂 `--text-*` 的比例（issue 124）：0.7..1.5 步长 0.1，默认 1。additive，不 bump schemaVersion */
  uiTypeScale: number;
  /** chrome 无衬线字体档（issue 124）。additive，不 bump schemaVersion */
  uiFontStack: UiFontStackId;
  /** 启动时自动检查更新（ADR-0021）。additive，不 bump schemaVersion；默认开 */
  autoCheck: boolean;
  layout: {
    leftPanel: { width: number; collapsed: boolean };
    rightPanel: { width: number; collapsed: boolean };
    /**
     * 工程详情页左栏（工程列表）宽度，issue 23 #2。additive，不 bump schemaVersion。
     * 与 leftPanel/rightPanel（工作台面板）是**两套独立的分栏**：工作台那套绑 UIProvider +
     * 内联 CSS 变量、夹取随视口；这一套是 CSS Grid、夹取为绝对区间（见 PROJECT_LIST_WIDTH）。
     */
    projectList: { width: number };
  };
  shortcuts: ShortcutConfig;
  /**
   * 屏蔽前的键位（issue 178，用户 2026-10-28 定案 Q1=A）：`FunctionId → 屏蔽瞬间的绑定串`。
   * `shortcuts` 里置 `null` 的表达力不够——自定义键位会被就地覆盖，重新启用只能回落出厂默认；
   * 这份附属记录让"屏蔽 = 暂停"成立。additive，不 bump schemaVersion；缺段 = 没有历史（旧存档）。
   * **不参与**绑定索引与冲突检测（屏蔽期间该键仍算空闲，Q3 定案）。
   */
  shortcutLast: ShortcutMasks;
  audio: {
    keySet: string;
    /** 节奏图示 SE 音量（键音独立音量，0..1，0=静音），issue 39 #7 */
    seVolume: number;
    /**
     * 播放器主音量（BGM + 键音的统一前置增益，0..1；chart-preview 20）。
     * 仿照 Bestdori 的播放器音量（其 `player/volume` 与 SE 音量相乘）；预览播放器是它的编辑入口，
     * 票 07 的视频导出按它取"与播放一致"的音量。**不动工作台那档页面内主音量**（它不落设置）。
     */
    volume: number;
  };
  /** 画布显示 / 播放参数（issue 39 功能设置组）。数值均以比例存储：100% = 1。 */
  display: {
    /** 节奏图示大小（音符占轨道比例），0.1..2.0，issue 39 #1 */
    noteSize: number;
    /** 长压线不透明度，0.1..1.0，issue 39 #2 */
    slideOpacity: number;
    /** 同时点击线开关（同节拍音符连接线），issue 39 #3 */
    simultaneousClickLines: boolean;
    /** 色觉辅助开关（tap 实/虚拍款式），issue 39 #4：非半拍整数倍位置的单键渲染为虚拍款（判定见 rendering/render.ts isHalfBeatAligned） */
    colorAssist: boolean;
    /** 纵向比例（每小节纵向高度），0.5..2.0，与画布整体缩放正交，issue 39 #5 */
    verticalRatio: number;
    /** 图像品质（三档），issue 39 #6 */
    imageQuality: 'smooth' | 'standard' | 'hd';
    /** 轨道颜色主题（issue 53 第二轮）：网格线层级配色；类型与白名单单一来源 rendering/gridStyle.ts */
    gridStyle: GridStylePreset;
    /** 线形分层开关（issue 53 第二轮 Q3=A）：默认关（全实线，仅颜色分层） */
    lineShapeTiers: boolean;
    /** 轨道线透明度（issue 53 第三轮补）：网格线（节拍线+子节拍线）整体不透明度系数，0.1..1 */
    gridOpacity: number;
    /** 谱面文字大小系数（issue 51 第二轮 Q1=A）：0.5..3，默认 1（基准 14px/11px 已上调） */
    labelScale: number;
  };
  /** 素材域（issue 29 音符皮肤）：六条目 → 皮肤包 id。包合法性由 renderer/noteSkin.ts 归一化（缺省/非法回退默认包） */
  visual: {
    noteSkin: Partial<NoteSkinSelectionRaw>;
    /** 谱面背景皮肤（issue 29 Q4 最小模型，2026-08-27 定案；同日用户实机反馈修订加 opacity）。图片本体不在设置对象
     *  （浏览器 IndexedDB / Electron 数据根文件），此处仅存引用状态；enabled=true 但图不存在时按无背景渲染（静默降级），
     *  additive 不 bump schemaVersion。opacity 0..1：图片不透明度，越低画布原始黑底占比越多，默认 DEFAULT_BACKGROUND_OPACITY */
    backgroundSkin?: {
      enabled: boolean;
      opacity?: number;
      fit?: BackgroundFit;
      scope?: BackgroundScope;
    };
  };
  /**
   * 曲线工具配置（issue 114 定案：全局一份、跨会话沿用上次值，**不随谱面工程走**——
   * 它是"我的习惯"而非谱面属性）。additive 字段，不 bump schemaVersion；
   * 缺段/脏值经 `normalizeCurveConfig` 归一化回落。
   */
  curve: CurveConfig;
  /**
   * 工程管理页配置（启动台排序 issue 19 #4；同步导入谱面代码 issue 28
   * ；官方选曲面板排序 票 31）。
   * additive 字段，不 bump schemaVersion。
   */
  projects: {
    sort: ProjectSortKey;
    /** 同步导入谱面代码（票 28 定案 2026-10-12：跨官方/社区共用，默认 true） */
    importWithChart: boolean;
    /** 官方选曲面板的列表排序（票 31 验收回修 2026-10-13：要跨会话记住，默认发布时间降序） */
    songSort: SongSort;
  };
  /**
   * 预览标注（chart-preview 08 定案 2026-09-30）：预览页的「看谱方式」，跨会话记住。
   * 与 `display`（画布通性设置）刻意分开：这几项只有预览面板画，编辑器画布没有对应装饰，
   * 所以不走 `display`，也不进 ADR-0016 §2 的「预览显示档」（那是叠加在 display 之上的一层）。
   * additive 字段，不 bump schemaVersion。
   */
  preview: PreviewSettings;
  /**
   * 导出图文版的「头带」开关 + 「信息区」字段开关（chart-preview 14 定案 2026-10-06，
   * 2026-10-06 验收后追加 `enabled`）：跨会话记住。
   * 与 `preview`（看谱习惯）同样刻意分开：那是"自己怎么看"，这是"导出物里写什么"。
   * additive 字段，不 bump schemaVersion。
   */
  export: ExportFieldSettings;
  /**
   * 社区素材缓存的**回收策略**（票 18，用户 2026-10-10 拍板：可配「闲置天数 + 总量上限」，默认 30 天 / 1GB）。
   * 只管**回收**；鲜度（json / text 24h 后台刷新）与「手动清除」不在这里。
   * additive 字段，不 bump schemaVersion。
   */
  cachePolicy: AssetCachePolicy;
}

/** 社区素材缓存的回收策略（票 18）。改了**立即生效**（下一次清扫就按新值算），不用重启。 */
export interface AssetCachePolicy {
  /** 多少天没用就清（1..365） */
  maxIdleDays: number;
  /** 占用上限（MB，64..65536） */
  maxMegabytes: number;
}

export const CACHE_POLICY_RANGE = {
  idleDays: { min: 1, max: 365 },
  megabytes: { min: 64, max: 65536 },
} as const;

/** 默认值 = 票 14 定案的那两个常数（30 天 / 1GB） */
export const DEFAULT_CACHE_POLICY: AssetCachePolicy = {
  maxIdleDays: 30,
  maxMegabytes: 1024,
};

/** 策略归一化：缺段 / 非有限值 / 越界一律落到区间内（界面输入与导入共用同一把尺） */
export function normalizeCachePolicy(
  raw: unknown,
  fallback: AssetCachePolicy = DEFAULT_CACHE_POLICY,
): AssetCachePolicy {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clamp = (value: unknown, { min, max }: { min: number; max: number }, dft: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : dft;
  return {
    maxIdleDays: clamp(obj.maxIdleDays, CACHE_POLICY_RANGE.idleDays, fallback.maxIdleDays),
    maxMegabytes: clamp(obj.maxMegabytes, CACHE_POLICY_RANGE.megabytes, fallback.maxMegabytes),
  };
}

/**
 * 导出头带 + 信息区字段（chart-preview 14，字段候选 2026-10-06 用户拍板；`enabled` 2026-10-06 追加）：
 * 导出图**要不要带头带**（封面区 + 信息区），以及信息区显示哪些项。
 * 七项里没有「谱师姓名」——本票不做（用户拍板：后续票再谈）。
 */
export interface ExportFieldSettings {
  /**
   * **头带总开关**（默认开）：关 = 导出图**只画面板区**（没有封面、没有标题 / chips）。
   * 与下面 7 个"信息区写哪些项"的开关是两件事 —— 关了它是"图纸"而不是"空信息的头带"。
   */
  enabled: boolean;
  /** 工程名（副行；与标题重复时自动去重不显示） */
  projectName: boolean;
  /** 谱面标题（大字标题；未填回落工程名） */
  chartTitle: boolean;
  /** 难度 + 等级（如「EXP 32」；level 为空只写难度缩写） */
  difficulty: boolean;
  /** 谱面时长 */
  duration: boolean;
  /** 音符数（口径走 `countChartNotes`） */
  noteCount: boolean;
  /** BPM（多条取绝对值 min–max；单条只写一个值） */
  bpm: boolean;
  /** 导出时间（本地时区，写到分钟） */
  exportedAt: boolean;
  /**
   * **视频开场**（chart-preview 30）：动态预览导出物最前面那段的总开关 + 信息项开关。
   * 与上面 7 个「信息区字段」**互不跟随**（那是长图头带的谱面统计信息，这是歌曲信息）。
   */
  opening: OpeningSettings;
}

/**
 * 视频开场设置（chart-preview 30）：`enabled` 关掉 = 回到"第 0 帧即 0 秒、总长 = 谱面时长"；
 * 三项信息项 = 难度徽章 / 标题条 / 艺人行（本期不做 credits / 谱师名）。
 */
export interface OpeningSettings {
  enabled: boolean;
  items: Record<OpeningItemId, boolean>;
}

/** 开场信息项的候选全列（声明式：未来加项 = 加一个 id + 默认值 + 文案 + 一处绘制） */
export const OPENING_ITEM_IDS = ['difficulty', 'title', 'artist'] as const;

/** 开场信息项 id */
export type OpeningItemId = (typeof OPENING_ITEM_IDS)[number];

/** 开场信息项默认值（**全开**） */
export const DEFAULT_OPENING_ITEMS: Record<OpeningItemId, boolean> = {
  difficulty: true,
  title: true,
  artist: true,
};

/** 导出信息字段的候选全列（归一化与「导出信息」UI 组共用同一份，免得两处各列一遍） */
export const EXPORT_FIELD_KEYS: readonly Exclude<keyof ExportFieldSettings, 'enabled' | 'opening'>[] = [
  'projectName', 'chartTitle', 'difficulty', 'duration', 'noteCount', 'bpm', 'exportedAt',
];

/**
 * 导出默认档（chart-preview 14，用户 2026-10-06 拍板）：**带头带**（`enabled`），
 * 信息区写 **谱面标题 + 难度等级 + BPM**，其余关（工程名 / 时长 / 音符数 / 导出时间）。
 */
export const DEFAULT_EXPORT_FIELDS: ExportFieldSettings = {
  enabled: true,
  projectName: false,
  chartTitle: true,
  difficulty: true,
  duration: false,
  noteCount: false,
  bpm: true,
  exportedAt: false,
  // 视频开场默认全开；**缺字段回落 true**（老用户不得被静默关掉，定案 5）
  opening: { enabled: true, items: { ...DEFAULT_OPENING_ITEMS } },
};

/** 预览标注设置（= `settings.preview`；预览面板的叠加项由它推出） */
export interface PreviewSettings {
  /** BPM 标记：沟槽常显的 BPM 数值 / 同位组摘要 */
  bpmMarks: boolean;
  /** Time 标记：沟槽时间刻度的间隔；`'off'` = 不画 */
  timeMarks: PreviewTimeMarkInterval;
  /** Beat 标记：横网格画到第几级细分（约分分母 ≤ N）；`'off'` = 不画横网格 */
  beatMarks: PreviewBeatMarkDivision;
  /** Combo 标记：每 50 combo 在右沟槽写一个数字（照 Bestdori `chartCombo`） */
  comboMarks: boolean;
  /** 镜向：整条轨道水平镜像（车道左右互换 + 方向箭头翻转，照 Bestdori `styleMirror`） */
  mirror: boolean;
  /**
   * 仿真场音符速度档（chart-preview 05；照 Bestdori `simNoteSpeed`）：
   * 只作用于动态预览，决定接近模型的 T = 游戏分段映射（票 48）：n ≤ 11 → (12 − n)/2、
   * n > 11 → (16 − n)/10 秒（口径来源 = sonolus-bandori-engine `note.duration`）。
   * 白名单与步长见 `SIM_NOTE_SPEED_RANGE`。
   */
  noteSpeed: number;
  /**
   * 仿真场**表演背景**包 ID（chart-preview 41 · ADR-0018 §3：应用级，"我的默认口味"；
   * 新建工程默认沿用上次选的包）。取值 = 取件侧包清单里的包 ID（`bgPackId` 非法 / 不在
   * 清单里 → 归一化回落默认 `skin00`，见 `normalizeSimAssetPackId`）。
   */
  bgPackId: string;
  /**
   * 仿真场**场地皮肤包**（轨道）ID（chart-preview 41 · ADR-0018 §3：应用级，
   * 等同音符速度 / 镜向，是"我看着舒服"）。口径同 `bgPackId`。
   */
  fieldPackId: string;
}

/**
 * 音符速度档白名单（chart-preview 05；**范围 2026-10-08 票 24 定案**）：`1..12` 步长 `0.1`，
 * 默认 **9.5**（用户 2026-10-07 定案："比较适合预览谱面的速度"）。
 *
 * 上界 **12 = 现代 BanG Dream 自己的档位上限**（Bestdori 模拟器封在 11，因为它用的
 * `(12 − n)/2` 在 12 处退化成 0）。映射本体在 `simGeometry.approachSeconds`：票 24 当时只接了
 * 第一支 + 0.1s 地板，票 48（2026-10-18）换成游戏同款分段（第二支 `(16 − n)/10`，12 档 = 0.4s）
 * —— 定的都是同一条口径：**Bestdori 参照实现与游戏本身冲突时优先游戏**
 * （现代游戏是 1..12，1..11 是老版本）。
 */
export const SIM_NOTE_SPEED_RANGE = { min: 1, max: 12, step: 0.1, fallback: 9.5 } as const;

/** Time 标记间隔（秒）——照 Bestdori 的 `chartTime`：off / 1s / 2s / 5s / 10s（chart-preview 08） */
export type PreviewTimeMarkInterval = 'off' | 1 | 2 | 5 | 10;
/** Beat 标记细分档 —— 照 Bestdori 的 `chartBeat`：off / 1/1 / 1/2 / 1/3 / 1/4 / 1/6（chart-preview 08） */
export type PreviewBeatMarkDivision = 'off' | 1 | 2 | 3 | 4 | 6;
/** 预览标注白名单（归一化与 UI 选项共用同一份，免得两处各列一遍） */
export const PREVIEW_TIME_MARK_INTERVALS: readonly PreviewTimeMarkInterval[] = ['off', 1, 2, 5, 10];
export const PREVIEW_BEAT_MARK_DIVISIONS: readonly PreviewBeatMarkDivision[] = ['off', 1, 2, 3, 4, 6];
/**
 * 预览标注默认档（用户 2026-09-30 二轮定案）：BPM 标记开、时间标记 5 秒、节拍线 1/1、
 * Combo 标记关、不镜像。
 * 注意：**宽图导出不走这一份**（导出是固定精简档，见 `preview/static/exportPanels` 的 `EXPORT_MARKERS`）——
 * 用户改的是"自己看谱的习惯"，不该顺手改掉导出物的样子。
 */
export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  bpmMarks: true,
  timeMarks: 5,
  beatMarks: 1,
  comboMarks: true,
  mirror: false,
  noteSpeed: SIM_NOTE_SPEED_RANGE.fallback,
  // 表演背景 / 场地皮肤包各默认 skin00（ADR-0018 §1；非法 ID 读盘时归一化回落）
  bgPackId: SIM_DEFAULT_PACK_IDS.background,
  fieldPackId: SIM_DEFAULT_PACK_IDS.field,
};

/** 音符速度档归一化（读写同一个白名单；快照值对齐步长） */
export function normalizeNoteSpeed(raw: unknown, fallback: number = SIM_NOTE_SPEED_RANGE.fallback): number {
  const { min, max, step } = SIM_NOTE_SPEED_RANGE;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  // 吸附走 `× (1/step)` 而不是 `÷ step`：0.1 不能被二进制精确表示，
  // `9.45 / 0.1` 算出 94.499… ⇒ 半档会被吸到**下**一档（步长 0.1 时逐位都可能错一格）。
  const inv = 1 / step;
  const snapped = Math.round(raw * inv) / inv;
  return Math.min(max, Math.max(min, snapped));
}

/** 音符皮肤六条目（与 renderer/noteSkin.ts 的 NoteSkinItemId 一致；此处独立声明避免 utils→renderer 运行时依赖） */
export interface NoteSkinSelectionRaw {
  tap: string;
  flick: string;
  skill: string;
  dirL: string;
  dirR: string;
  slide: string;
}

const STORAGE_KEY = 'aao.settings.v1';

/** 谱面时长上限（秒）：30 分钟，防误输入把画布撑爆（issue 28 第 2 轮 P6） */
export const MAX_DURATION_SECONDS = 1800;

/** 工作台左右面板的默认宽度上限（issue 97：左右同口径同宽） */
export const DEFAULT_PANEL_WIDTH = 300;

/**
 * 工程详情页左栏（工程列表）宽度的绝对区间，issue 23 #2。
 * 与工作台面板刻意不同口径：那边是可无限压缩的工具/属性面板（夹取随视口 20vw / 50vw），
 * 这边是导航列表、内容宽度固定，所以上下都封死，窄窗口也不该被压到不可用。
 */
export const PROJECT_LIST_WIDTH = { min: 220, max: 420, default: 300 } as const;

/** 详情页左栏宽度的归一化：非有限值 / 越界一律落到区间内（拖拽与导入共用同一把尺） */
export function clampProjectListWidth(value: unknown): number {
  const { min, max, default: dft } = PROJECT_LIST_WIDTH;
  if (typeof value !== 'number' || !Number.isFinite(value)) return dft;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 默认面板宽度：窄视口随 20vw 收缩，宽屏封顶 DEFAULT_PANEL_WIDTH（issue 12 / issue 97 起左右同一公式） */
export function defaultPanelWidth(innerWidth: number): number {
  return Math.min(DEFAULT_PANEL_WIDTH, Math.round(innerWidth * 0.20));
}

export function defaultSettings(osLanguage: string = detectOsLanguageTag()): AppSettings {
  return {
    schemaVersion: 1,
    theme: 'system',
    uiLanguage: resolveUiLanguage(undefined, osLanguage),
    uiTypeScale: 1,
    uiFontStack: 'geist',
    autoCheck: true,
    layout: {
      leftPanel: { width: DEFAULT_PANEL_WIDTH, collapsed: false },
      rightPanel: { width: DEFAULT_PANEL_WIDTH, collapsed: false },
      projectList: { width: PROJECT_LIST_WIDTH.default },
    },
    shortcuts: getDefaultConfig(),
    shortcutLast: {},
    audio: { keySet: DEFAULT_ACTIVE_KEY_SOUND_SET_ID, seVolume: 1, volume: 1 },
    display: {
      noteSize: 1,
      // 长压线不透明度（issue 39 #2）：默认 0.8（用户 2026-09-30 三轮定案：100% 太实）
      slideOpacity: 0.8,
      simultaneousClickLines: true,
      colorAssist: true,
      verticalRatio: 1,
      // 图像品质默认高清（用户 2026-09-30 二轮定案）：画布侧 min(设备像素比, 3)、预览侧 max(设备像素比, 3)
      imageQuality: 'hd',
      gridStyle: 'vivid',
      lineShapeTiers: false,
      gridOpacity: 0.8,
      labelScale: 1,
    },
    visual: { noteSkin: { ...NOTE_SKIN_DEFAULT_SELECTION }, backgroundSkin: { enabled: false, opacity: DEFAULT_BACKGROUND_OPACITY, fit: DEFAULT_BACKGROUND_FIT, scope: DEFAULT_BACKGROUND_SCOPE } },
    curve: { ...DEFAULT_CURVE_CONFIG },
    projects: { sort: 'lastOpened', importWithChart: true, songSort: { ...SONG_SORT_DEFAULT } },
    preview: { ...DEFAULT_PREVIEW_SETTINGS },
    export: { ...DEFAULT_EXPORT_FIELDS },
    cachePolicy: { ...DEFAULT_CACHE_POLICY },
  };
}

/** 字段级合并：从 parsed 读到的有效字段覆盖 defaults，未提供的字段保持默认；保持结构稳定。 */
function mergeSettings(parsed: unknown, osLanguage: string): AppSettings {
  const defaults = defaultSettings(osLanguage);
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const audio = (obj.audio && typeof obj.audio === 'object' ? obj.audio : {}) as Record<string, unknown>;
  const layout = (obj.layout && typeof obj.layout === 'object' ? obj.layout : {}) as Record<string, unknown>;
  const leftPanel = (layout.leftPanel && typeof layout.leftPanel === 'object' ? layout.leftPanel : {}) as Record<string, unknown>;
  const rightPanel = (layout.rightPanel && typeof layout.rightPanel === 'object' ? layout.rightPanel : {}) as Record<string, unknown>;
  const projectList = (layout.projectList && typeof layout.projectList === 'object' ? layout.projectList : {}) as Record<string, unknown>;
  const display = (obj.display && typeof obj.display === 'object' ? obj.display : {}) as Record<string, unknown>;
  const preview = (obj.preview && typeof obj.preview === 'object' ? obj.preview : {}) as Record<string, unknown>;
  const projects = (obj.projects && typeof obj.projects === 'object' ? obj.projects : {}) as Record<string, unknown>;
  const exportRaw = (obj.export && typeof obj.export === 'object' ? obj.export : {}) as Record<string, unknown>;
  const visual = (obj.visual && typeof obj.visual === 'object' ? obj.visual : {}) as Record<string, unknown>;
  const rawNoteSkin = (visual.noteSkin && typeof visual.noteSkin === 'object' ? visual.noteSkin : {}) as Record<string, unknown>;
  // 音符皮肤：仅保留六条目的字符串值；包 id 合法性由 renderer/noteSkin.ts 在读取时归一化
  const noteSkin: Partial<NoteSkinSelectionRaw> = {};
  for (const k of ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'] as const) {
    if (typeof rawNoteSkin[k] === 'string') noteSkin[k] = rawNoteSkin[k] as string;
  }
  const clamp = (v: unknown, min: number, max: number, dft: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dft;
  // 背景皮肤（issue 29 Q4 + 修订）：缺字段/非法值归一化；opacity 缺失 = 默认 0.55（additive，不 bump schemaVersion）
  const rawBackgroundSkin = (visual.backgroundSkin && typeof visual.backgroundSkin === 'object' ? visual.backgroundSkin : {}) as Record<string, unknown>;
  const fitRaw = rawBackgroundSkin.fit;
  const scopeRaw = rawBackgroundSkin.scope;
  const backgroundSkin: NonNullable<AppSettings['visual']['backgroundSkin']> = {
    enabled: typeof rawBackgroundSkin.enabled === 'boolean' ? rawBackgroundSkin.enabled : defaults.visual.backgroundSkin?.enabled ?? false,
    opacity: clamp(rawBackgroundSkin.opacity, 0, 1, DEFAULT_BACKGROUND_OPACITY),
    // 枚举字段白名单归一化：白名单外 → 默认（fit 默认 cover；scope 默认 outsideTrack）
    fit: fitRaw === 'cover' || fitRaw === 'contain' ? fitRaw : DEFAULT_BACKGROUND_FIT,
    scope: scopeRaw === 'outsideTrack' || scopeRaw === 'fullCanvas' ? scopeRaw : DEFAULT_BACKGROUND_SCOPE,
  };
  const quality =
    display.imageQuality === 'smooth' || display.imageQuality === 'standard' || display.imageQuality === 'hd'
      ? display.imageQuality
      : defaults.display.imageQuality;
  // 轨道颜色主题（issue 53 第二轮）：枚举白名单归一化（单一来源 GRID_STYLE_PRESETS），白名单外 → vivid
  const gridStyle = (GRID_STYLE_PRESETS as readonly string[]).includes(display.gridStyle as string)
    ? (display.gridStyle as GridStylePreset)
    : defaults.display.gridStyle;
  return {
    schemaVersion: 1,
    theme: obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system' ? obj.theme : defaults.theme,
    uiLanguage: resolveUiLanguage(obj.uiLanguage, osLanguage),
    uiTypeScale: normalizeUiTypeScale(obj.uiTypeScale, defaults.uiTypeScale),
    uiFontStack: normalizeUiFontStack(obj.uiFontStack, defaults.uiFontStack),
    autoCheck: typeof obj.autoCheck === 'boolean' ? obj.autoCheck : defaults.autoCheck,
    layout: {
      leftPanel: {
        width: typeof leftPanel.width === 'number' && leftPanel.width > 0 ? leftPanel.width : defaults.layout.leftPanel.width,
        collapsed: typeof leftPanel.collapsed === 'boolean' ? leftPanel.collapsed : defaults.layout.leftPanel.collapsed,
      },
      rightPanel: {
        width: typeof rightPanel.width === 'number' && rightPanel.width > 0 ? rightPanel.width : defaults.layout.rightPanel.width,
        collapsed: typeof rightPanel.collapsed === 'boolean' ? rightPanel.collapsed : defaults.layout.rightPanel.collapsed,
      },
      projectList: { width: clampProjectListWidth(projectList.width) },
    },
    // 段内合并：若新 settings 里没有 shortcuts，则沿用 defaults 整体；之后由调用方尝试从旧 key 补齐
    shortcuts: defaults.shortcuts,
    // 屏蔽前的键位（issue 178）：逐条白名单归一化，缺段 / 脏值 = 没有历史（重新启用回落出厂默认）
    shortcutLast: normalizeShortcutMasks(obj.shortcutLast),
    audio: {
      // issue 29 删占位包：未知 id（含历史 'placeholder'/'bangdream'）归一化回落默认包，避免脏 id 驻留持久层
      keySet: typeof audio.keySet === 'string' && isKnownKeySoundSetId(audio.keySet) ? audio.keySet : defaults.audio.keySet,
      seVolume: clamp(audio.seVolume, 0, 1, defaults.audio.seVolume),
      // 播放器主音量（chart-preview 20）：additive 不 bump schemaVersion，缺字段 / 脏值回落 1
      volume: clamp(audio.volume, 0, 1, defaults.audio.volume),
    },
    display: {
      noteSize: clamp(display.noteSize, 0.1, 2, defaults.display.noteSize),
      slideOpacity: clamp(display.slideOpacity, 0.1, 1, defaults.display.slideOpacity),
      simultaneousClickLines: typeof display.simultaneousClickLines === 'boolean' ? display.simultaneousClickLines : defaults.display.simultaneousClickLines,
      colorAssist: typeof display.colorAssist === 'boolean' ? display.colorAssist : defaults.display.colorAssist,
      verticalRatio: clamp(display.verticalRatio, 0.5, 2, defaults.display.verticalRatio),
      imageQuality: quality,
      gridStyle,
      lineShapeTiers: typeof display.lineShapeTiers === 'boolean' ? display.lineShapeTiers : defaults.display.lineShapeTiers,
      gridOpacity: clamp(display.gridOpacity, 0.1, 1, defaults.display.gridOpacity),
      labelScale: clamp(display.labelScale, 0.5, 3, defaults.display.labelScale),
    },
    visual: { noteSkin, backgroundSkin },
    curve: normalizeCurveConfig(obj.curve),
    // 工程管理页配置（启动台排序 issue 19 #4；同步导入谱面代码 issue 28；官方选曲面板排序 票 31）
    projects: {
      sort: normalizeProjectSortKey(projects.sort, defaults.projects.sort),
      importWithChart: typeof projects.importWithChart === 'boolean'
        ? projects.importWithChart
        : defaults.projects.importWithChart,
      songSort: normalizeSongSort(projects.songSort, defaults.projects.songSort),
    },
    // 预览标注（chart-preview 08）：枚举白名单归一化，缺字段 → 默认精简档
    preview: {
      bpmMarks: typeof preview.bpmMarks === 'boolean' ? preview.bpmMarks : defaults.preview.bpmMarks,
      timeMarks: (PREVIEW_TIME_MARK_INTERVALS as readonly unknown[]).includes(preview.timeMarks)
        ? preview.timeMarks as PreviewTimeMarkInterval
        : defaults.preview.timeMarks,
      beatMarks: (PREVIEW_BEAT_MARK_DIVISIONS as readonly unknown[]).includes(preview.beatMarks)
        ? preview.beatMarks as PreviewBeatMarkDivision
        : defaults.preview.beatMarks,
      comboMarks: typeof preview.comboMarks === 'boolean' ? preview.comboMarks : defaults.preview.comboMarks,
      mirror: typeof preview.mirror === 'boolean' ? preview.mirror : defaults.preview.mirror,
      noteSpeed: normalizeNoteSpeed(preview.noteSpeed, defaults.preview.noteSpeed),
      // 仿真场素材包（chart-preview 41）：按取件侧包清单归一化，清单里没有的 ID（含脏值 /
      // 快照缩水后残留的旧选择）静默回落默认 skin00 —— "列表即真相"
      bgPackId: normalizeSimAssetPackId('background', preview.bgPackId),
      fieldPackId: normalizeSimAssetPackId('field', preview.fieldPackId),
    },
    // 导出信息字段（chart-preview 14）：逐字段布尔归一化，缺字段 / 脏值回落默认档
    export: normalizeExportFields(exportRaw, defaults.export),
    // 社区素材缓存回收策略（票 18）：缺段 / 脏值回落 30 天 / 1GB
    cachePolicy: normalizeCachePolicy(obj.cachePolicy, defaults.cachePolicy),
  };
}

/**
 * 导出头带 + 信息区字段归一化：只认布尔值，其余（缺字段 / 字符串 / 数字）逐字段回落默认档。
 * `enabled` 不算字段候选（不进 `EXPORT_FIELD_KEYS`），单独归一 —— **缺按开**（老数据升级后
 * 行为与升级前一致，不会默默变成纯面板图）。
 */
export function normalizeExportFields(
  raw: Record<string, unknown>,
  fallback: ExportFieldSettings = DEFAULT_EXPORT_FIELDS,
): ExportFieldSettings {
  const out = { ...fallback };
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  for (const k of EXPORT_FIELD_KEYS) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean;
  }
  // `opening` 是嵌套对象：`{ ...fallback }` 是浅拷贝，直接改会写脏 `DEFAULT_EXPORT_FIELDS.opening`
  // ⇒ 必须显式造一个新对象（含 items 的新对象）
  out.opening = normalizeOpening(raw.opening, fallback.opening);
  return out;
}

/**
 * 视频开场归一化：缺 `enabled` / 缺任一项都**回落 true**，未知键忽略。
 * `enabled` 缺 = 开（老数据升级后不得被默默关掉，定案 5）。
 */
export function normalizeOpening(
  raw: unknown,
  fallback: OpeningSettings = DEFAULT_EXPORT_FIELDS.opening,
): OpeningSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = typeof src.enabled === 'boolean' ? src.enabled : fallback.enabled !== false;
  // 整段缺失 ⇒ items 全开（fallback 的 items 已经默认全开，这里再兜一层防脏值）
  const rawItems =
    src.items && typeof src.items === 'object'
      ? (src.items as Record<string, unknown>)
      : (fallback.items as unknown as Record<string, unknown>);
  const items: Record<OpeningItemId, boolean> = { ...DEFAULT_OPENING_ITEMS };
  for (const id of OPENING_ITEM_IDS) {
    items[id] = typeof rawItems[id] === 'boolean' ? (rawItems[id] as boolean) : DEFAULT_OPENING_ITEMS[id];
  }
  return { enabled, items };
}

export function loadSettings(
  storage: Pick<Storage, 'getItem'> = localStorage,
  osLanguage: string = detectOsLanguageTag(),
): AppSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const merged = mergeSettings(JSON.parse(raw), osLanguage);
      // 新版 settings 暂未存 shortcuts 段时，从旧 key 补齐；并存时旧 key 不再被读
      if (!('shortcuts' in (JSON.parse(raw) as Record<string, unknown>))) {
        merged.shortcuts = loadConfig(storage);
      } else {
        // 新版直接以 settings.shortcuts 为准（mergeSettings 写入 defaults 后，调用方覆盖）
        const parsed = JSON.parse(raw) as { shortcuts?: unknown };
        if (parsed.shortcuts && typeof parsed.shortcuts === 'object') {
          // 复用 loadConfig 的归一化逻辑
          merged.shortcuts = loadConfig({ getItem: () => JSON.stringify(parsed.shortcuts) });
        }
      }
      return merged;
    }
    // 旧 keys 迁移：快捷键 + audio（audio 已统一在 settings.v1 中，若都没有则全默认）
    const legacyShortcuts = loadConfig(storage);
    // 旧版 settings 仅含 audio，尝试单独读 audio 段
    let audioKeySet: string | null = null;
    try {
      const legacyRaw = storage.getItem(STORAGE_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as { audio?: { keySet?: string } };
        if (legacy.audio && typeof legacy.audio.keySet === 'string') audioKeySet = legacy.audio.keySet;
      }
    } catch { /* ignore */ }
    return {
      ...defaultSettings(osLanguage),
      shortcuts: legacyShortcuts,
      audio: { ...defaultSettings(osLanguage).audio, keySet: audioKeySet && isKnownKeySoundSetId(audioKeySet) ? audioKeySet : DEFAULT_ACTIVE_KEY_SOUND_SET_ID },
    };
  } catch {
    return defaultSettings(osLanguage);
  }
}

export function saveSettings(settings: AppSettings, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  // M2 收口：旧快捷键 key 不再写，避免双份
}

/** 字段级更新助手：M2 收口，ConfigContext 改用此函数做单字段写回，避免重读+整对象覆盖。 */
export function updateSettings(
  prev: AppSettings,
  patch: Partial<{
    theme: AppSettings['theme'];
    uiLanguage: UiLanguage;
    uiTypeScale: number;
    uiFontStack: UiFontStackId;
    autoCheck: boolean;
    layout: AppSettings['layout'];
    shortcuts: AppSettings['shortcuts'];
    shortcutLast: AppSettings['shortcutLast'];
    audio: Partial<AppSettings['audio']>;
    display: Partial<AppSettings['display']>;
    visual: Partial<AppSettings['visual']>;
    curve?: CurveConfig;
    projects?: Partial<AppSettings['projects']>;
    preview?: Partial<AppSettings['preview']>;
    export?: Partial<AppSettings['export']>;
    cachePolicy?: Partial<AppSettings['cachePolicy']>;
  }>,
): AppSettings {
  return {
    schemaVersion: 1,
    theme: patch.theme ?? prev.theme,
    uiLanguage: patch.uiLanguage ?? prev.uiLanguage,
    uiTypeScale: patch.uiTypeScale !== undefined ? normalizeUiTypeScale(patch.uiTypeScale, prev.uiTypeScale) : prev.uiTypeScale,
    uiFontStack: patch.uiFontStack !== undefined ? normalizeUiFontStack(patch.uiFontStack, prev.uiFontStack) : prev.uiFontStack,
    autoCheck: patch.autoCheck ?? prev.autoCheck,
    layout: patch.layout ?? prev.layout,
    shortcuts: patch.shortcuts ?? prev.shortcuts,
    shortcutLast: patch.shortcutLast ? normalizeShortcutMasks(patch.shortcutLast) : prev.shortcutLast,
    audio: { ...prev.audio, ...(patch.audio ?? {}) },
    display: { ...prev.display, ...(patch.display ?? {}) },
    visual: { ...prev.visual, ...(patch.visual ?? {}) },
    curve: patch.curve ? normalizeCurveConfig(patch.curve) : prev.curve,
    projects: { ...prev.projects, ...(patch.projects ?? {}) },
    preview: { ...prev.preview, ...(patch.preview ?? {}) },
    // `opening` 是嵌套对象：段内浅合并会把 `items` 整个抹掉（改 `enabled` 就丢三项开关）
    // ⇒ 显式合并一层（定案：缺字段回落 true、改一项不抹掉其它项）
    export: {
      ...prev.export,
      ...(patch.export ?? {}),
      opening: mergeOpening(prev.export.opening, patch.export?.opening),
    },
    // 社区素材缓存回收策略（票 18）：整段归一化，缺段 / 脏值回落默认档
    cachePolicy: patch.cachePolicy
      ? normalizeCachePolicy({ ...prev.cachePolicy, ...patch.cachePolicy }, prev.cachePolicy)
      : prev.cachePolicy,
  };
}

/** 开场设置的**两层**合并：`enabled` 取新值，`items` 逐项合并（未提的项保持原值） */
export function mergeOpening(
  prev: OpeningSettings | undefined,
  patch: Partial<OpeningSettings> | undefined,
): OpeningSettings {
  const base = normalizeOpening(prev);
  if (!patch) return base;
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled;
  const items: Record<OpeningItemId, boolean> = { ...base.items };
  if (patch.items) {
    for (const id of OPENING_ITEM_IDS) {
      if (typeof patch.items[id] === 'boolean') items[id] = patch.items[id] as boolean;
    }
  }
  return { enabled, items };
}
