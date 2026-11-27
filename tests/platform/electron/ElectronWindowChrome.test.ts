// issue 126：Electron 窗体 OS chrome 跟 settings.theme（主进程入口 + 渲染侧同步接线）。
import { describe, it, expect } from 'vitest';
import {
  DARK_BG,
  LIGHT_BG,
  applyNativeThemeSource,
  chromeBackgroundFor,
  normalizeAppTheme,
  resolvedAppearance,
  syncAllWindowsChrome,
} from '@/electron/window/windowChrome.cjs';
import { stripComments, readSource, readSources } from '@/tests/support/source';


const mainSrc = readSources(['electron/main.cjs', 'electron/window/windowChrome.cjs', 'electron/window/createWindow.cjs'], true);
const preloadSrc = stripComments(readSource('electron/preload.js'));
const themeSrc = stripComments(readSource('src/app/styles/theme.ts'));

describe('issue 126 · windowChrome 纯函数', () => {
  it('背景色对齐 tokens.css --bg', () => {
    expect(LIGHT_BG).toBe('#f6f7f9');
    expect(DARK_BG).toBe('#15181d');
    expect(chromeBackgroundFor('light')).toBe(LIGHT_BG);
    expect(chromeBackgroundFor('dark')).toBe(DARK_BG);
  });

  it('normalizeAppTheme 与 resolvedAppearance', () => {
    expect(normalizeAppTheme('dark')).toBe('dark');
    expect(normalizeAppTheme('bogus')).toBe('system');
    expect(resolvedAppearance('light', true)).toBe('light');
    expect(resolvedAppearance('dark', false)).toBe('dark');
    expect(resolvedAppearance('system', true)).toBe('dark');
    expect(resolvedAppearance('system', false)).toBe('light');
  });
});

describe('issue 257 · nativeTheme 源同值不重复赋值（退出通道 / 能耗）', () => {
  it('同值跳过、不同值才写：updated → sync 不会自激成永动循环', () => {
    let writes = 0;
    let value = 'system';
    const nativeTheme = {
      get themeSource() { return value; },
      set themeSource(next: string) { writes += 1; value = next; },
    };

    applyNativeThemeSource('system', nativeTheme);
    expect(writes).toBe(0);
    expect(value).toBe('system');

    applyNativeThemeSource('dark', nativeTheme);
    expect(writes).toBe(1);
    applyNativeThemeSource('dark', nativeTheme);
    expect(writes).toBe(1);

    applyNativeThemeSource('bogus', nativeTheme);
    expect(writes).toBe(2);
    expect(value).toBe('system');
  });

  it('system 主题下 OS 深浅切换仍更新窗体背景（同值跳过不冻结 chrome）', () => {
    let dark = false;
    let writes = 0;
    let themeSource = 'system';
    const colors: string[] = [];
    const nativeTheme = {
      get themeSource() { return themeSource; },
      set themeSource(next: string) { writes += 1; themeSource = next; },
      get shouldUseDarkColors() { return dark; },
    };
    const win = { setBackgroundColor: (color: string) => colors.push(color) };
    const deps = { nativeTheme, BrowserWindow: { getAllWindows: () => [win] } };

    syncAllWindowsChrome(deps);
    dark = true;
    syncAllWindowsChrome(deps);

    expect(colors).toEqual([LIGHT_BG, DARK_BG]);
    expect(writes).toBe(0);
  });
});

describe('issue 126 · 主进程 / preload / 渲染侧接线', () => {
  it('主进程：nativeTheme、backgroundColor、windowChrome:sync', () => {
    expect(mainSrc).toMatch(/nativeTheme/);
    expect(mainSrc).toMatch(/windowChrome\.cjs/);
    expect(mainSrc).toMatch(/backgroundColor:\s*chromeBackgroundFor/);
    expect(mainSrc).toMatch(/applyNativeThemeSource/);
    expect(mainSrc).toMatch(/applyBrowserWindowChrome/);
    expect(mainSrc).toMatch(/['"]windowChrome:sync['"]/);
    expect(mainSrc).toMatch(/titleBarStyle:\s*'default'/);
    expect(mainSrc).not.toMatch(/titleBarOverlay/);
    expect(mainSrc).not.toMatch(/-webkit-app-region/);
  });

  it('preload 暴露 windowChrome.sync', () => {
    expect(preloadSrc).toMatch(/windowChrome\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]windowChrome:sync['"]/);
  });

  it('useApplyTheme 同步主进程，不只改 data-theme', () => {
    expect(themeSrc).toMatch(/syncElectronWindowChrome/);
    expect(themeSrc).toMatch(/windowChrome/);
    expect(themeSrc).toMatch(/dataset\.theme\s*=\s*resolveTheme/);
  });

  it('issue 215 · Windows 平台禁用 DirectComposition 与原生遮挡节流，避免 Alt+Tab 切换时 DWM 硬件图层竞争导致丢帧', () => {
    expect(mainSrc).toMatch(/disable-direct-composition/);
    expect(mainSrc).toMatch(/CalculateNativeWinOcclusion/);
    expect(mainSrc).toMatch(/disable-backgrounding-occluded-windows/);
    expect(mainSrc).toMatch(/backgroundThrottling:\s*false/);
  });
});
