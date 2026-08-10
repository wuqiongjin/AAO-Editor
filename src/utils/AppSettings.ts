// 统一 versioned settings JSON（ADR-0003 §6 / ADR-0004 §7）：
// 合并「快捷键 + 主题 + 布局 + 音频键音」为一份带 schemaVersion 的设置对象。
// 单一 localStorage 键 bangdream.settings.v1，冲突/schema 损坏时回退默认再按字段合并。
//
// 迁移策略：
// - 旧 bangdream.shortcuts.v1 仍可读（一次性回填到新 settings.shortcuts），不再写入。
// - 旧版 schema（仅有 {schemaVersion, audio.keySet}）已包含 audio 段，load 时按字段合并。
import { getDefaultConfig, loadConfig, type ShortcutConfig } from './ShortcutConfig';
import { DEFAULT_ACTIVE_KEY_SOUND_SET_ID } from './KeySound';

export interface AppSettings {
  schemaVersion: 1;
  theme: 'light' | 'dark' | 'system';
  layout: {
    leftPanel: { width: number; collapsed: boolean };
    rightPanel: { width: number; collapsed: boolean };
  };
  shortcuts: ShortcutConfig;
  audio: { keySet: string };
}

const STORAGE_KEY = 'bangdream.settings.v1';

export function defaultSettings(): AppSettings {
  return {
    schemaVersion: 1,
    theme: 'system',
    layout: {
      leftPanel: { width: 470, collapsed: false },
      rightPanel: { width: 300, collapsed: false },
    },
    shortcuts: getDefaultConfig(),
    audio: { keySet: DEFAULT_ACTIVE_KEY_SOUND_SET_ID },
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
    },
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
      audio: { keySet: audioKeySet ?? DEFAULT_ACTIVE_KEY_SOUND_SET_ID },
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
  patch: Partial<{ theme: AppSettings['theme']; layout: AppSettings['layout']; shortcuts: AppSettings['shortcuts']; audio: AppSettings['audio'] }>,
): AppSettings {
  return {
    schemaVersion: 1,
    theme: patch.theme ?? prev.theme,
    layout: patch.layout ?? prev.layout,
    shortcuts: patch.shortcuts ?? prev.shortcuts,
    audio: patch.audio ?? prev.audio,
  };
}
