// issue 126：Electron 窗体 OS chrome 跟 settings.theme（主进程入口 + 渲染侧同步接线）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DARK_BG,
  LIGHT_BG,
  chromeBackgroundFor,
  normalizeAppTheme,
  resolvedAppearance,
} from '../../electron/windowChrome.cjs';

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const mainSrc = stripComments(read('electron/main.cjs'));
const preloadSrc = stripComments(read('electron/preload.js'));
const themeSrc = stripComments(read('src/app/styles/theme.ts'));

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
});
