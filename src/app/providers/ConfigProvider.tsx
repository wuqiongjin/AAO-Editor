// ConfigContext（ADR-0003 §7.3）：统一 versioned settings JSON（ADR-0003 §6）。
// 承载：theme / layout / shortcuts / audio，按字段写回（updateSettings）。
// Editor 只暴露 setShortcutConfig / setKeySetId 两个语义化 setter，底层 updateSettings 维护原子写。
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings, updateSettings, clampProjectListWidth, DEFAULT_BACKGROUND_OPACITY, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_SCOPE, type AppSettings } from '../../chart/config/AppSettings';
import { getDefaultConfig, type ShortcutConfig } from '../../chart/config/ShortcutConfig';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { setActiveUiLanguage } from '../../i18n';
import { syncAssetCachePolicy } from '../../community/assetCachePolicy';
import { trail } from '../../diagnostics/trail';

function persistSettings(merged: AppSettings): AppSettings {
  saveSettings(merged);
  return merged;
}

function noteSettingsChange(keys: string[]): void {
  trail.record({ module: 'settings', action: 'change', meta: { keys } });
}

export interface ConfigContextValue {
  settings: AppSettings;
  setShortcutConfig: (next: ShortcutConfig) => void;
  setKeySetId: (id: string) => void;
  setTheme: (theme: AppSettings['theme']) => void;
  setUiLanguage: (uiLanguage: AppSettings['uiLanguage']) => void;
  /** chrome 字号比例（issue 124）：0.7..1.5 步长 0.1 */
  setUiTypeScale: (uiTypeScale: number) => void;
  /** chrome 无衬线字体档（issue 124） */
  setUiFontStack: (uiFontStack: AppSettings['uiFontStack']) => void;
  /** 启动自动检查（ADR-0021）：写入设置对象 */
  setAutoCheck: (autoCheck: boolean) => void;
  /** 布局（面板宽/折叠，ADR-0003 §6）：字段级写回并持久化 */
  setLayout: (layout: AppSettings['layout']) => void;
  /** 画布显示参数（issue 39 功能设置·画布显示）：字段级写回并持久化 */
  setDisplay: (patch: Partial<AppSettings['display']>) => void;
  /** 预览标注（chart-preview 08）：字段级写回并持久化（预览页的面板与设置页「画布显示」各改各的段） */
  setPreview: (patch: Partial<AppSettings['preview']>) => void;
  /** 导出图文版的信息字段（chart-preview 14）：字段级写回并持久化（与 setPreview 同范式） */
  setExport: (patch: Partial<AppSettings['export']>) => void;
  /** 节奏图示 SE 音量（issue 39 功能设置·播放）：0..1 字段级写回并持久化 */
  setSeVolume: (volume: number) => void;
  /** 播放器主音量（chart-preview 20）：0..1 字段级写回并持久化 */
  setAudioVolume: (volume: number) => void;
  /** 音符皮肤（issue 29）：六条目字段级写回并持久化；包合法性由 renderer/noteSkin.ts 归一化 */
  setNoteSkin: (patch: Partial<AppSettings['visual']['noteSkin']>) => void;
  /** 谱面背景皮肤（issue 29 Q4 + 修订）：字段级写回 settings.visual.backgroundSkin（enabled/opacity/fit/scope）；
   *  图片本体经 utils/backgroundSkin.ts 存取，本方法只管配置位 */
  setBackgroundSkin: (patch: { enabled?: boolean; opacity?: number; fit?: 'cover' | 'contain'; scope?: 'outsideTrack' | 'fullCanvas' }) => void;
  /** 曲线工具配置（issue 114）：整份写回 settings.curve 并持久化（跨会话沿用上次值） */
  setCurveConfig: (config: CurveConfig) => void;
  /** 工程启动台排序（issue 19 #4）：字段级写回 settings.projects.sort 并持久化 */
  setProjectSort: (sort: AppSettings['projects']['sort']) => void;
  /** 同步导入谱面代码（票 28）：字段级写回 settings.projects.importWithChart 并持久化 */
  setImportWithChart: (importWithChart: boolean) => void;
  /** 官方选曲面板排序（票 31 验收回修）：字段级写回 settings.projects.songSort 并持久化 */
  setSongSort: (songSort: AppSettings['projects']['songSort']) => void;
  /** 工程详情页左栏宽度（issue 23 #2）：已夹取到 PROJECT_LIST_WIDTH 区间 */
  setProjectListWidth: (width: number) => void;
  /** 整体替换设置（Q13 配置数据-导入）：经 loadSettings 校验合并后写回 */
  setAllSettings: (next: AppSettings) => void;
  /**
   * 社区素材缓存的回收策略（票 18）：段内浅合并 + 立即推给主进程（下一次清扫就按新值算，不用重启）。
   * 静态演示版没有那条桥 → 静默跳过。
   */
  setCachePolicy: (patch: Partial<AppSettings['cachePolicy']>) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const loaded = loadSettings();
    setActiveUiLanguage(loaded.uiLanguage);
    // 素材缓存的回收策略在主进程里，启动时先按已存的策略拨一次（票 18）
    syncAssetCachePolicy(loaded.cachePolicy);
    return loaded;
  });

  const setShortcutConfig = useCallback((next: ShortcutConfig) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { shortcuts: next }));
    });
    noteSettingsChange(['shortcuts']);
  }, []);

  const setKeySetId = useCallback((id: string) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { audio: { keySet: id } }));
    });
    noteSettingsChange(['audio']);
  }, []);

  const setTheme = useCallback((theme: AppSettings['theme']) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { theme }));
    });
    noteSettingsChange(['theme']);
  }, []);

  const setUiLanguage = useCallback((uiLanguage: AppSettings['uiLanguage']) => {
    setActiveUiLanguage(uiLanguage);
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { uiLanguage }));
    });
    noteSettingsChange(['uiLanguage']);
  }, []);

  const setUiTypeScale = useCallback((uiTypeScale: number) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { uiTypeScale }));
    });
    noteSettingsChange(['uiTypeScale']);
  }, []);

  const setUiFontStack = useCallback((uiFontStack: AppSettings['uiFontStack']) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { uiFontStack }));
    });
    noteSettingsChange(['uiFontStack']);
  }, []);

  const setAutoCheck = useCallback((autoCheck: boolean) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { autoCheck }));
    });
    noteSettingsChange(['autoCheck']);
  }, []);

  // 布局 setter 需保持引用稳定（Editor 的持久化 effect 依赖它做 deps；不稳定会导致无限重渲染）
  const setLayout = useCallback((layout: AppSettings['layout']) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { layout }));
    });
    noteSettingsChange(['layout']);
  }, []);

  const setDisplay = useCallback((patch: Partial<AppSettings['display']>) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { display: patch }));
    });
    noteSettingsChange(['display']);
  }, []);

  // 预览标注（chart-preview 08）：与 setDisplay 同范式（段内浅合并 + 整份写盘）
  const setPreview = useCallback((patch: Partial<AppSettings['preview']>) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { preview: patch }));
    });
    noteSettingsChange(['preview']);
  }, []);

  // 导出信息字段（chart-preview 14）：与 setPreview 同范式（段内浅合并 + 整份写盘）
  const setExport = useCallback((patch: Partial<AppSettings['export']>) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { export: patch }));
    });
    noteSettingsChange(['export']);
  }, []);

  const setSeVolume = useCallback((volume: number) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { audio: { seVolume: volume } }));
    });
    noteSettingsChange(['audio']);
  }, []);

  // 播放器主音量（chart-preview 20）：与 setSeVolume 同范式（段内浅合并 + 整份写盘）。
  // 入口在动态预览的播放条；工作台那档页面内主音量不读它（两者刻意分开）
  const setAudioVolume = useCallback((volume: number) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { audio: { volume } }));
    });
    noteSettingsChange(['audio']);
  }, []);

  // 音符皮肤（issue 29）：与键音同范式——字段级写回、立即生效并持久化
  const setNoteSkin = useCallback((patch: Partial<AppSettings['visual']['noteSkin']>) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { visual: { noteSkin: { ...prev.visual.noteSkin, ...patch } } }));
    });
    noteSettingsChange(['visual']);
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
      return persistSettings(updateSettings(prev, { visual: { backgroundSkin: bg } }));
    });
    noteSettingsChange(['visual']);
  }, []);

  // 曲线工具配置（issue 114）：与皮肤/键音同范式——字段级写回、立即生效并持久化。
  // 引用必须稳定：UIProvider 的 setCurveConfig 依赖它做写透（deps 变化会让工具栏每次渲染换新回调）。
  const setCurveConfig = useCallback((config: CurveConfig) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { curve: config }));
    });
    noteSettingsChange(['curve']);
  }, []);

  // 启动台排序（issue 19 #4）：与皮肤/键音同范式——字段级写回、立即生效并持久化
  const setProjectSort = useCallback((sort: AppSettings['projects']['sort']) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { projects: { sort } }));
    });
    noteSettingsChange(['projects']);
  }, []);

  // 同步导入谱面代码（票 28）：字段级写回 settings.projects.importWithChart 并持久化
  const setImportWithChart = useCallback((importWithChart: boolean) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { projects: { importWithChart } }));
    });
    noteSettingsChange(['projects']);
  }, []);

  // 官方选曲面板排序（票 31 验收回修）：键 + 方向一起写回 settings.projects.songSort 并持久化
  const setSongSort = useCallback((songSort: AppSettings['projects']['songSort']) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, { projects: { songSort } }));
    });
    noteSettingsChange(['projects']);
  }, []);

  // 工程详情页左栏宽度（issue 23 #2）：只改 layout.projectList，不整对象覆写 ——
  // setLayout 会带上 leftPanel/rightPanel 的**旧值**，而那两个归工作台的 UIContext 管，
  // 从这里整写会把工作台刚拖的宽度打回去。
  const setProjectListWidth = useCallback((width: number) => {
    setSettings(prev => {
      return persistSettings(updateSettings(prev, {
        layout: { ...prev.layout, projectList: { width: clampProjectListWidth(width) } },
      }));
    });
    noteSettingsChange(['layout']);
  }, []);

  const setAllSettings = useCallback((next: AppSettings) => {
    setActiveUiLanguage(next.uiLanguage);
    syncAssetCachePolicy(next.cachePolicy);
    persistSettings(next);
    setSettings(next);
    noteSettingsChange(Object.keys(next));
  }, []);

  // 社区素材缓存回收策略（票 18）：与上面同范式；写完顺手推给主进程（改了就生效）
  const setCachePolicy = useCallback((patch: Partial<AppSettings['cachePolicy']>) => {
    setSettings(prev => {
      const merged = persistSettings(updateSettings(prev, { cachePolicy: patch }));
      syncAssetCachePolicy(merged.cachePolicy);
      return merged;
    });
    noteSettingsChange(['cachePolicy']);
  }, []);

  // 兼容旧 API 形态（保留 default shortcut config 作为回退）
  void getDefaultConfig;

  const value: ConfigContextValue = { settings, setShortcutConfig, setKeySetId, setTheme, setUiLanguage, setUiTypeScale, setUiFontStack, setAutoCheck, setLayout, setDisplay, setPreview, setExport, setSeVolume, setAudioVolume, setNoteSkin, setBackgroundSkin, setCurveConfig, setProjectSort, setImportWithChart, setSongSort, setProjectListWidth, setAllSettings, setCachePolicy };
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
