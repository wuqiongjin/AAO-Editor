// ConfigContext（ADR-0003 §7.3）：统一 versioned settings JSON（ADR-0003 §6）。
// 承载：theme / layout / shortcuts / audio，按字段写回（updateSettings）。
// Editor 只暴露 setShortcutConfig / setKeySetId 两个语义化 setter，底层 updateSettings 维护原子写。
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings, updateSettings, defaultSettings, type AppSettings } from '../utils/AppSettings';
import { getDefaultConfig, type ShortcutConfig } from '../utils/ShortcutConfig';

export interface ConfigContextValue {
  settings: AppSettings;
  setShortcutConfig: (next: ShortcutConfig) => void;
  setKeySetId: (id: string) => void;
  setTheme: (theme: AppSettings['theme']) => void;
  /** 布局（面板宽/折叠，ADR-0003 §6）：字段级写回并持久化 */
  setLayout: (layout: AppSettings['layout']) => void;
  /** 整体替换设置（Q13 配置数据-导入）：经 loadSettings 校验合并后写回 */
  setAllSettings: (next: AppSettings) => void;
  /** 恢复默认设置（Q13 配置数据）：重置为出厂默认并持久化 */
  resetSettings: () => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const setShortcutConfig = (next: ShortcutConfig) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { shortcuts: next });
      saveSettings(merged);
      return merged;
    });
  };

  const setKeySetId = (id: string) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { audio: { keySet: id } });
      saveSettings(merged);
      return merged;
    });
  };

  const setTheme = (theme: AppSettings['theme']) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { theme });
      saveSettings(merged);
      return merged;
    });
  };

  // 布局 setter 需保持引用稳定（Editor 的持久化 effect 依赖它做 deps；不稳定会导致无限重渲染）
  const setLayout = useCallback((layout: AppSettings['layout']) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { layout });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setAllSettings = (next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
  };

  const resetSettings = () => {
    const next = defaultSettings();
    saveSettings(next);
    setSettings(next);
  };

  // 兼容旧 API 形态（保留 default shortcut config 作为回退）
  void getDefaultConfig;

  const value: ConfigContextValue = { settings, setShortcutConfig, setKeySetId, setTheme, setLayout, setAllSettings, resetSettings };
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
