// 轻量应用配置（ADR-0004 §7 实现确认）：本期仅存 audio.keySet，
// ADR-0003 完整 settings（theme/layout/shortcuts 合并）后续再做，本期隔离不返工。
import { DEFAULT_ACTIVE_KEY_SOUND_SET_ID } from './KeySound';

export interface AppSettings {
  schemaVersion: 1;
  audio: { keySet: string };
}

const STORAGE_KEY = 'bangdream.settings.v1';

export function defaultSettings(): AppSettings {
  return { schemaVersion: 1, audio: { keySet: DEFAULT_ACTIVE_KEY_SOUND_SET_ID } };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): AppSettings {
  const defaults = defaultSettings();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      schemaVersion: 1,
      audio: {
        keySet:
          typeof parsed?.audio?.keySet === 'string' ? parsed.audio.keySet : defaults.audio.keySet,
      },
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}