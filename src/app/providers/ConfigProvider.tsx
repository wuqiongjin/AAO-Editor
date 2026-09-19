// ConfigContext（ADR-0003 §7.3）：统一 versioned settings JSON（ADR-0003 §6）。
// 承载：theme / layout / shortcuts / audio，按字段写回（updateSettings）。
// Editor 只暴露 setShortcutConfig / setKeySetId 两个语义化 setter，底层 updateSettings 维护原子写。
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings, updateSettings, DEFAULT_BACKGROUND_OPACITY, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_SCOPE, type AppSettings } from '../../chart/config/AppSettings';
import { getDefaultConfig, type ShortcutConfig } from '../../chart/config/ShortcutConfig';
import type { CurveConfig } from '../../chart/editing/ToolActionMatrix';

export interface ConfigContextValue {
  settings: AppSettings;
  setShortcutConfig: (next: ShortcutConfig) => void;
  setKeySetId: (id: string) => void;
  setTheme: (theme: AppSettings['theme']) => void;
  /** chrome 字号比例（issue 124）：0.7..1.5 步长 0.1 */
  setUiTypeScale: (uiTypeScale: number) => void;
  /** chrome 无衬线字体档（issue 124） */
  setUiFontStack: (uiFontStack: AppSettings['uiFontStack']) => void;
  /** 布局（面板宽/折叠，ADR-0003 §6）：字段级写回并持久化 */
  setLayout: (layout: AppSettings['layout']) => void;
  /** 画布显示参数（issue 39 功能设置·画布显示）：字段级写回并持久化 */
  setDisplay: (patch: Partial<AppSettings['display']>) => void;
  /** 节奏图示 SE 音量（issue 39 功能设置·播放）：0..1 字段级写回并持久化 */
  setSeVolume: (volume: number) => void;
  /** 音符皮肤（issue 29）：六条目字段级写回并持久化；包合法性由 renderer/noteSkin.ts 归一化 */
  setNoteSkin: (patch: Partial<AppSettings['visual']['noteSkin']>) => void;
  /** 谱面背景皮肤（issue 29 Q4 + 修订）：字段级写回 settings.visual.backgroundSkin（enabled/opacity/fit/scope）；
   *  图片本体经 utils/backgroundSkin.ts 存取，本方法只管配置位 */
  setBackgroundSkin: (patch: { enabled?: boolean; opacity?: number; fit?: 'cover' | 'contain'; scope?: 'outsideTrack' | 'fullCanvas' }) => void;
  /** 曲线工具配置（issue 114）：整份写回 settings.curve 并持久化（跨会话沿用上次值） */
  setCurveConfig: (config: CurveConfig) => void;
  /** 整体替换设置（Q13 配置数据-导入）：经 loadSettings 校验合并后写回 */
  setAllSettings: (next: AppSettings) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const setShortcutConfig = useCallback((next: ShortcutConfig) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { shortcuts: next });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setKeySetId = useCallback((id: string) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { audio: { keySet: id } });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setTheme = useCallback((theme: AppSettings['theme']) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { theme });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setUiTypeScale = useCallback((uiTypeScale: number) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { uiTypeScale });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setUiFontStack = useCallback((uiFontStack: AppSettings['uiFontStack']) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { uiFontStack });
      saveSettings(merged);
      return merged;
    });
  }, []);

  // 布局 setter 需保持引用稳定（Editor 的持久化 effect 依赖它做 deps；不稳定会导致无限重渲染）
  const setLayout = useCallback((layout: AppSettings['layout']) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { layout });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setDisplay = useCallback((patch: Partial<AppSettings['display']>) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { display: patch });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setSeVolume = useCallback((volume: number) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { audio: { seVolume: volume } });
      saveSettings(merged);
      return merged;
    });
  }, []);

  // 音符皮肤（issue 29）：与键音同范式——字段级写回、立即生效并持久化
  const setNoteSkin = useCallback((patch: Partial<AppSettings['visual']['noteSkin']>) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { visual: { noteSkin: { ...prev.visual.noteSkin, ...patch } } });
      saveSettings(merged);
      return merged;
    });
  }, []);

  // 背景皮肤（issue 29 Q4 + 修订）：字段级 patch（enabled/opacity/fit/scope）写回，段内合并保留其余字段
  const setBackgroundSkin = useCallback((patch: { enabled?: boolean; opacity?: number; fit?: 'cover' | 'contain'; scope?: 'outsideTrack' | 'fullCanvas' }) => {
    setSettings(prev => {
      const prevBg = prev.visual.backgroundSkin ?? { enabled: false, opacity: DEFAULT_BACKGROUND_OPACITY, fit: DEFAULT_BACKGROUND_FIT, scope: DEFAULT_BACKGROUND_SCOPE };
      const bg = {
        enabled: prevBg.enabled,
        opacity: prevBg.opacity,
        fit: prevBg.fit,
        scope: prevBg.scope,
        ...patch,
      };
      const merged = updateSettings(prev, { visual: { backgroundSkin: bg } });
      saveSettings(merged);
      return merged;
    });
  }, []);

  // 曲线工具配置（issue 114）：与皮肤/键音同范式——字段级写回、立即生效并持久化。
  // 引用必须稳定：UIProvider 的 setCurveConfig 依赖它做写透（deps 变化会让工具栏每次渲染换新回调）。
  const setCurveConfig = useCallback((config: CurveConfig) => {
    setSettings(prev => {
      const merged = updateSettings(prev, { curve: config });
      saveSettings(merged);
      return merged;
    });
  }, []);

  const setAllSettings = useCallback((next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  // 兼容旧 API 形态（保留 default shortcut config 作为回退）
  void getDefaultConfig;

  const value: ConfigContextValue = { settings, setShortcutConfig, setKeySetId, setTheme, setUiTypeScale, setUiFontStack, setLayout, setDisplay, setSeVolume, setNoteSkin, setBackgroundSkin, setCurveConfig, setAllSettings };
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
