// issue 124 锁测：chrome 界面字号 / 字体栈（与画布 labelScale 正交）
import { describe, it, expect } from 'vitest';
import {
  defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '@/src/chart/config/AppSettings';
import { applyChromeTypography, UI_FONT_SANS_STACKS } from '@/src/app/styles/chromeTypography';
import { stripComments, readSource } from '@/tests/support/source';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';


describe('issue 124 · mergeSettings 界面字号 / 字体栈', () => {
  it('出厂默认：字号 100%、字体 geist；additive 不 bump schemaVersion', () => {
    const d = defaultSettings();
    expect(d.uiTypeScale).toBe(1);
    expect(d.uiFontStack).toBe('geist');
    expect(d.schemaVersion).toBe(1);
    expect(stripComments(readSource('src/chart/config/AppSettings.ts'))).not.toMatch(/schemaVersion:\s*[2-9]/);
  });

  it('缺字段回落出厂', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    const s = loadSettings(st);
    expect(s.uiTypeScale).toBe(1);
    expect(s.uiFontStack).toBe('geist');
  });

  it('非法字号夹紧到 0.7..1.5 且步长 0.1', () => {
    const load = (uiTypeScale: unknown) =>
      loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, uiTypeScale }))).uiTypeScale;

    expect(load(0.64)).toBe(0.7);
    expect(load(0.73)).toBe(0.7);
    expect(load(1.26)).toBe(1.3);
    expect(load(1.56)).toBe(1.5);
    expect(load(1.14)).toBe(1.1);
    expect(load(0.95)).toBe(1);
    expect(load('110%')).toBe(1);
    expect(load(NaN)).toBe(1);
    expect(load(null)).toBe(1);
  });

  it('未知字体档回落出厂 geist；合法档保留', () => {
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, uiFontStack: 'comic' }))).uiFontStack).toBe('geist');
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, uiFontStack: 'yahei' }))).uiFontStack).toBe('yahei');
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, uiFontStack: 'noto' }))).uiFontStack).toBe('noto');
  });

  it('saveSettings → loadSettings 往返带上 uiTypeScale 与 uiFontStack（导入导出同源）', () => {
    const st = memStorage();
    const next: AppSettings = {
      ...defaultSettings(),
      uiTypeScale: 1.2,
      uiFontStack: 'noto',
    };
    saveSettings(next, st);
    const loaded = loadSettings(st);
    expect(loaded.uiTypeScale).toBe(1.2);
    expect(loaded.uiFontStack).toBe('noto');
    const exported = JSON.parse(st.raw()!);
    expect(exported.uiTypeScale).toBe(1.2);
    expect(exported.uiFontStack).toBe('noto');
  });

  it('updateSettings 写入这两字段且不 bump schemaVersion', () => {
    const merged = updateSettings(defaultSettings(), { uiTypeScale: 0.8, uiFontStack: 'yahei' });
    expect(merged.schemaVersion).toBe(1);
    expect(merged.uiTypeScale).toBe(0.8);
    expect(merged.uiFontStack).toBe('yahei');
  });
});

describe('issue 124 · applyChromeTypography 与 --font-mono', () => {
  it('把字号比例和 sans 栈写到 style；不写 --font-mono', () => {
    const props = new Map<string, string>();
    applyChromeTypography(
      { setProperty: (name, value) => { props.set(name, value); } },
      { uiTypeScale: 1.1, uiFontStack: 'yahei' },
    );
    expect(props.get('--ui-type-scale')).toBe('1.1');
    expect(props.get('--font-sans')).toBe(UI_FONT_SANS_STACKS.yahei);
    expect(props.has('--font-mono')).toBe(false);
  });

  it('源码：apply 路径不改写 --font-mono', () => {
    const src = stripComments(readSource('src/app/styles/chromeTypography.ts'));
    expect(src).not.toMatch(/--font-mono/);
    expect(src).toMatch(/--font-sans/);
    expect(src).toMatch(/--ui-type-scale/);
  });

  it('tokens.css：--text-* 只乘 --ui-type-scale；--font-mono 仍是出厂栈', () => {
    const css = stripComments(readSource('src/app/styles/tokens.css'));
    expect(css).toMatch(/--text-xs:\s*calc\(12px\s*\*\s*var\(--ui-type-scale\)\)/);
    expect(css).toMatch(/--text-sm:\s*calc\(13px\s*\*\s*var\(--ui-type-scale\)\)/);
    expect(css).toMatch(/--text-2xs:\s*calc\(11px\s*\*\s*var\(--ui-type-scale\)\)/);
    expect(css).toMatch(/--text-base:\s*calc\(14px\s*\*\s*var\(--ui-type-scale\)\)/);
    expect(css).toMatch(/--font-mono:\s*"SF Mono"/);
    expect(css).toMatch(/--ui-type-scale:\s*1/);
  });
});

describe('issue 124 · 设置行接到 token', () => {
  it('设置行标题 --text-sm、说明 --text-2xs，不再写死 px', () => {
    const css = stripComments(readSource('src/layouts/AppShell.css'));
    expect(css).toMatch(/\.settings-row strong[\s\S]{0,80}font-size:\s*var\(--text-sm\)/);
    expect(css).toMatch(/\.settings-row span[\s\S]{0,80}font-size:\s*var\(--text-2xs\)/);
    expect(css).not.toMatch(/\.settings-row strong[\s\S]{0,80}font-size:\s*\d+(\.\d+)?px/);
    expect(css).not.toMatch(/\.settings-row span[\s\S]{0,80}font-size:\s*\d+(\.\d+)?px/);
  });

  it('外观滑杆 70–150；不放档旁样张', () => {
    const src = stripComments(readSource('src/settings/SettingsPage.tsx'));
    expect(src).not.toContain('Aa 设置 Settings');
    expect(src).not.toContain('ui-font-preview');
    expect(src).toMatch(/uiTypeScale[\s\S]{0,200}min=\{70\}/);
    expect(src).toMatch(/max=\{150\}/);
  });
});
