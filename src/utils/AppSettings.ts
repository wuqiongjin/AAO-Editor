// 统一 versioned settings JSON（ADR-0003 §6 / ADR-0004 §7）：
// 合并「快捷键 + 主题 + 布局 + 音频键音」为一份带 schemaVersion 的设置对象。
// 单一 localStorage 键 bangdream.settings.v1，冲突/schema 损坏时回退默认再按字段合并。
//
// 迁移策略：
// - 旧 bangdream.shortcuts.v1 仍可读（一次性回填到新 settings.shortcuts），不再写入。
// - 旧版 schema（仅有 {schemaVersion, audio.keySet}）已包含 audio 段，load 时按字段合并。
import { getDefaultConfig, loadConfig, type ShortcutConfig } from './ShortcutConfig';
import { DEFAULT_ACTIVE_KEY_SOUND_SET_ID } from './KeySound';
import { NOTE_SKIN_DEFAULT_SELECTION } from '../renderer/noteSkinRegistry.gen';

export interface AppSettings {
  schemaVersion: 1;
  theme: 'light' | 'dark' | 'system';
  layout: {
    leftPanel: { width: number; collapsed: boolean };
    rightPanel: { width: number; collapsed: boolean };
  };
  shortcuts: ShortcutConfig;
  audio: { keySet: string; /** 节奏图示 SE 音量（键音独立音量，0..1，0=静音），issue 39 #7 */ seVolume: number };
  /** 画布显示 / 播放参数（issue 39 功能设置组）。数值均以比例存储：100% = 1。 */
  display: {
    /** 节奏图示大小（音符占轨道比例），0.1..2.0，issue 39 #1 */
    noteSize: number;
    /** 长压线不透明度，0.1..1.0，issue 39 #2 */
    slideOpacity: number;
    /** 同时点击线开关（同节拍音符连接线），issue 39 #3 */
    simultaneousClickLines: boolean;
    /** 色觉辅助开关（tap 实/虚拍款式），issue 39 #4 —— 本轮仅存未渲染，虚拍图标待 Issue-41 */
    colorAssist: boolean;
    /** 纵向比例（每小节纵向高度），0.5..2.0，与画布整体缩放正交，issue 39 #5 */
    verticalRatio: number;
    /** 图像品质（三档），issue 39 #6 */
    imageQuality: 'smooth' | 'standard' | 'hd';
  };
  /** 素材域（issue 29 音符皮肤）：六条目 → 皮肤包 id。包合法性由 renderer/noteSkin.ts 归一化（缺省/非法回退默认包） */
  visual: {
    noteSkin: Partial<NoteSkinSelectionRaw>;
  };
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

const STORAGE_KEY = 'bangdream.settings.v1';

/** 谱面时长上限（秒）：30 分钟，防误输入把画布撑爆（issue 28 第 2 轮 P6） */
export const MAX_DURATION_SECONDS = 1800;

export function defaultSettings(): AppSettings {
  return {
    schemaVersion: 1,
    theme: 'system',
    layout: {
      leftPanel: { width: 380, collapsed: false },
      rightPanel: { width: 300, collapsed: false },
    },
    shortcuts: getDefaultConfig(),
    audio: { keySet: DEFAULT_ACTIVE_KEY_SOUND_SET_ID, seVolume: 1 },
    display: {
      noteSize: 1,
      slideOpacity: 1,
      simultaneousClickLines: true,
      colorAssist: true,
      verticalRatio: 1,
      imageQuality: 'standard',
    },
    visual: { noteSkin: { ...NOTE_SKIN_DEFAULT_SELECTION } },
  };
}

/** 字段级合并：从 parsed 读到的有效字段覆盖 defaults，未提供的字段保持默认；保持结构稳定。 */
function mergeSettings(parsed: unknown): AppSettings {
  const defaults = defaultSettings();
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const audio = (obj.audio && typeof obj.audio === 'object' ? obj.audio : {}) as Record<string, unknown>;
  const layout = (obj.layout && typeof obj.layout === 'object' ? obj.layout : {}) as Record<string, unknown>;
  const leftPanel = (layout.leftPanel && typeof layout.leftPanel === 'object' ? layout.leftPanel : {}) as Record<string, unknown>;
  const rightPanel = (layout.rightPanel && typeof layout.rightPanel === 'object' ? layout.rightPanel : {}) as Record<string, unknown>;
  const display = (obj.display && typeof obj.display === 'object' ? obj.display : {}) as Record<string, unknown>;
  const visual = (obj.visual && typeof obj.visual === 'object' ? obj.visual : {}) as Record<string, unknown>;
  const rawNoteSkin = (visual.noteSkin && typeof visual.noteSkin === 'object' ? visual.noteSkin : {}) as Record<string, unknown>;
  // 音符皮肤：仅保留六条目的字符串值；包 id 合法性由 renderer/noteSkin.ts 在读取时归一化
  const noteSkin: Partial<NoteSkinSelectionRaw> = {};
  for (const k of ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'] as const) {
    if (typeof rawNoteSkin[k] === 'string') noteSkin[k] = rawNoteSkin[k] as string;
  }
  const clamp = (v: unknown, min: number, max: number, dft: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dft;
  const quality =
    display.imageQuality === 'smooth' || display.imageQuality === 'standard' || display.imageQuality === 'hd'
      ? display.imageQuality
      : defaults.display.imageQuality;
  return {
    schemaVersion: 1,
    theme: obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system' ? obj.theme : defaults.theme,
    layout: {
      leftPanel: {
        width: typeof leftPanel.width === 'number' && leftPanel.width > 0 ? leftPanel.width : defaults.layout.leftPanel.width,
        collapsed: typeof leftPanel.collapsed === 'boolean' ? leftPanel.collapsed : defaults.layout.leftPanel.collapsed,
      },
      rightPanel: {
        width: typeof rightPanel.width === 'number' && rightPanel.width > 0 ? rightPanel.width : defaults.layout.rightPanel.width,
        collapsed: typeof rightPanel.collapsed === 'boolean' ? rightPanel.collapsed : defaults.layout.rightPanel.collapsed,
      },
    },
    // 段内合并：若新 settings 里没有 shortcuts，则沿用 defaults 整体；之后由调用方尝试从旧 key 补齐
    shortcuts: defaults.shortcuts,
    audio: {
      keySet: typeof audio.keySet === 'string' ? audio.keySet : defaults.audio.keySet,
      seVolume: clamp(audio.seVolume, 0, 1, defaults.audio.seVolume),
    },
    display: {
      noteSize: clamp(display.noteSize, 0.1, 2, defaults.display.noteSize),
      slideOpacity: clamp(display.slideOpacity, 0.1, 1, defaults.display.slideOpacity),
      simultaneousClickLines: typeof display.simultaneousClickLines === 'boolean' ? display.simultaneousClickLines : defaults.display.simultaneousClickLines,
      colorAssist: typeof display.colorAssist === 'boolean' ? display.colorAssist : defaults.display.colorAssist,
      verticalRatio: clamp(display.verticalRatio, 0.5, 2, defaults.display.verticalRatio),
      imageQuality: quality,
    },
    visual: { noteSkin },
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): AppSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const merged = mergeSettings(JSON.parse(raw));
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
      ...defaultSettings(),
      shortcuts: legacyShortcuts,
      audio: { ...defaultSettings().audio, keySet: audioKeySet ?? DEFAULT_ACTIVE_KEY_SOUND_SET_ID },
    };
  } catch {
    return defaultSettings();
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
    layout: AppSettings['layout'];
    shortcuts: AppSettings['shortcuts'];
    audio: Partial<AppSettings['audio']>;
    display: Partial<AppSettings['display']>;
    visual: Partial<AppSettings['visual']>;
  }>,
): AppSettings {
  return {
    schemaVersion: 1,
    theme: patch.theme ?? prev.theme,
    layout: patch.layout ?? prev.layout,
    shortcuts: patch.shortcuts ?? prev.shortcuts,
    audio: { ...prev.audio, ...(patch.audio ?? {}) },
    display: { ...prev.display, ...(patch.display ?? {}) },
    visual: { ...prev.visual, ...(patch.visual ?? {}) },
  };
}
