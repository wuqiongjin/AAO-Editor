// ConfigContext（ADR-0003 §7.3）：配置 token + 导入导出的配置。
// 当前承载：快捷键配置（ADR-0002）+ 音频键音素材（ADR-0004 §7 settings）。
// ADR-0003 完整 settings（theme/layout/shortcuts 合并）后续在此扩展，本期先隔离收纳既有配置状态。
import { createContext, useContext, useState, type ReactNode } from 'react';
import { loadConfig, saveConfig, type ShortcutConfig } from '../utils/ShortcutConfig';
import { loadSettings, saveSettings } from '../utils/AppSettings';

export interface ConfigContextValue {
  shortcutConfig: ShortcutConfig;
  updateShortcutConfig: (next: ShortcutConfig) => void;
  keySetId: string;
  setKeySetId: (id: string) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  // 快捷键配置（ADR-0002）：localStorage 持久化；修改即保存
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(() => loadConfig());
  // 键音素材（ADR-0004 §7 settings）
  const [keySetId, setKeySetIdState] = useState(() => loadSettings().audio.keySet);

  const updateShortcutConfig = (next: ShortcutConfig) => {
    setShortcutConfig(next);
    saveConfig(next);
  };

  const setKeySetId = (id: string) => {
    setKeySetIdState(id);
    saveSettings({ ...loadSettings(), audio: { keySet: id } });
  };

  const value: ConfigContextValue = { shortcutConfig, updateShortcutConfig, keySetId, setKeySetId };
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}