// issue 128 锁测：界面语言 zh-CN / en（手搓字典，不引进 i18next）
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '../../src/chart/config/AppSettings';
import {
  mapOsLanguageTag, resolveUiLanguage, lookupMessage, tFor, tPluralFor,
} from '../../src/i18n';

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function memStorage(seed?: string) {
  let data: string | null = seed ?? null;
  return {
    raw: () => data,
    getItem: (k: string) => (k === 'bangdream.settings.v1' ? data : null),
    setItem: (k: string, v: string) => { if (k === 'bangdream.settings.v1') data = v; },
  };
}

describe('issue 128 · OS locale → uiLanguage', () => {
  it('zh-TW / zh-HK / zh-Hant → zh-CN；fr → en；en-GB → en', () => {
    expect(mapOsLanguageTag('zh-TW')).toBe('zh-CN');
    expect(mapOsLanguageTag('zh-HK')).toBe('zh-CN');
    expect(mapOsLanguageTag('zh-Hant')).toBe('zh-CN');
    expect(mapOsLanguageTag('fr')).toBe('en');
    expect(mapOsLanguageTag('en-GB')).toBe('en');
    expect(mapOsLanguageTag('zh-CN')).toBe('zh-CN');
    expect(mapOsLanguageTag('zh')).toBe('zh-CN');
    expect(mapOsLanguageTag('zh-Hans')).toBe('zh-CN');
  });

  it('已存合法值保留，不跟 OS', () => {
    expect(resolveUiLanguage('en', 'zh-CN')).toBe('en');
    expect(resolveUiLanguage('zh-CN', 'en-US')).toBe('zh-CN');
  });
});

describe('issue 128 · mergeSettings uiLanguage', () => {
  it('缺字段 / 脏值走注入的 OS 映射；additive 不 bump schemaVersion', () => {
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' })), 'fr').uiLanguage).toBe('en');
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1 })), 'zh-TW').uiLanguage).toBe('zh-CN');
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, uiLanguage: 'ja' })), 'en-GB').uiLanguage).toBe('en');
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, uiLanguage: 'en' })), 'zh-CN').uiLanguage).toBe('en');
    expect(defaultSettings('zh-CN').schemaVersion).toBe(1);
    expect(stripComments(read('src/chart/config/AppSettings.ts'))).not.toMatch(/schemaVersion:\s*[2-9]/);
  });

  it('saveSettings → loadSettings 往返带上 uiLanguage（导入导出同源）', () => {
    const st = memStorage();
    const next: AppSettings = { ...defaultSettings('zh-CN'), uiLanguage: 'en' };
    saveSettings(next, st);
    expect(loadSettings(st, 'zh-CN').uiLanguage).toBe('en');
    expect(JSON.parse(st.raw()!).uiLanguage).toBe('en');
  });

  it('updateSettings 写入 uiLanguage 且不 bump schemaVersion', () => {
    const merged = updateSettings(defaultSettings('zh-CN'), { uiLanguage: 'en' });
    expect(merged.schemaVersion).toBe(1);
    expect(merged.uiLanguage).toBe('en');
  });
});

describe('issue 128 · 缺键回退 zh-CN', () => {
  it('en 缺句回退 zh-CN 原文', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(lookupMessage('en', 'only-zh', undefined, {
      'zh-CN': { 'only-zh': '中文原句' },
      en: {},
    })).toBe('中文原句');
    expect(tFor('en', 'i18n.fallbackProbe')).toBe('回退探针');
    warn.mockRestore();
  });
});

describe('issue 128 · 方向键英语专名', () => {
  it('全称 Left/Right Directional Flick；顶栏短名不是全称', () => {
    expect(tFor('en', 'tool.dirL.full')).toBe('Left Directional Flick');
    expect(tFor('en', 'tool.dirR.full')).toBe('Right Directional Flick');
    expect(tFor('en', 'tool.dirL.short')).toBe('Left');
    expect(tFor('en', 'tool.dirR.short')).toBe('Right');
    expect(tFor('en', 'tool.dirL.short')).not.toBe(tFor('en', 'tool.dirL.full'));
    expect(tFor('en', 'tool.single')).toBe('Single');
    expect(tFor('en', 'tool.flick')).toBe('Flick');
    expect(tFor('en', 'tool.skill')).toBe('Skill');
    expect(tFor('en', 'tool.slide')).toBe('Slide');
  });
});

describe('issue 128 · 英语复数 one/other', () => {
  it('count=1 走 one，其余 other', () => {
    expect(tPluralFor('en', 'noteInfo.selected', 1)).toBe('1 note selected');
    expect(tPluralFor('en', 'noteInfo.selected', 2)).toBe('2 notes selected');
  });
});

describe('issue 128 · 不引进 i18next', () => {
  it('package.json 与源码零 i18next', () => {
    expect(read('package.json')).not.toMatch(/i18next/);
    const src = [
      read('src/i18n/t.ts'),
      read('src/i18n/resolveUiLanguage.ts'),
      read('src/chart/config/AppSettings.ts'),
      read('electron/i18n.cjs'),
    ].join('\n');
    expect(src).not.toMatch(/i18next/);
  });
});

describe('issue 128 · 切语言立即换文案', () => {
  it('useApplyUiLanguage 在 render 期写入 locale，不把 setActiveUiLanguage 只放进 effect', () => {
    const src = read('src/i18n/useApplyUiLanguage.ts');
    const hook = src.slice(src.indexOf('export function useApplyUiLanguage'));
    const effectIdx = hook.indexOf('useEffect');
    const setIdx = hook.indexOf('setActiveUiLanguage(locale)');
    expect(setIdx).toBeGreaterThan(0);
    expect(setIdx).toBeLessThan(effectIdx);
    expect(hook.slice(effectIdx)).not.toMatch(/setActiveUiLanguage/);
  });

  it('AppShell 订阅 settings.uiLanguage，避免壳层只调 t() 而不重渲', () => {
    const src = stripComments(read('src/layouts/AppShell.tsx'));
    expect(src).toMatch(/useConfig/);
    expect(src).toMatch(/uiLanguage/);
  });
});
