// issue 177：页面注册表只保留「位次 + 功能 id」，键位的唯一真相源是 ShortcutConfig。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_ID, PAGE_NAV } from '@/src/layouts/pageNav';
import { FUNCTIONS } from '@/src/chart/config/ShortcutConfig';
import { readStripped } from '@/tests/support/source';

const PAGE_ORDER = ['projects', 'workspace', 'audio', 'preview', 'assets', 'shortcuts', 'settings'];

describe('PAGE_NAV · 位次与切页功能接线', () => {
  it('工程管理页是第一项、启动默认落点；预览紧随音频页（2026-09-30 用户验收拍板）', () => {
    expect(DEFAULT_PAGE_ID).toBe('projects');
    expect(PAGE_NAV.map((p) => p.id)).toEqual(PAGE_ORDER);
  });

  it('七页各挂一个 app 作用域的切页功能，默认 Alt+1..7 与位次同序', () => {
    expect(PAGE_NAV.map((p) => p.functionId)).toEqual([
      'pageProjects', 'pageWorkspace', 'pageAudio', 'pagePreview',
      'pageAssets', 'pageShortcuts', 'pageSettings',
    ]);
    PAGE_NAV.forEach((item, i) => {
      const def = FUNCTIONS.find((f) => f.id === item.functionId);
      expect(def, item.id).toBeDefined();
      expect(def?.scope).toBe('app');
      expect(def?.category).toBe('navigation');
      expect(def?.binding).toBe(`alt+${i + 1}`);
    });
  });

  it('键位不再写死在注册表里：不再有 ⇧⌘ 展示串，也没有供事件匹配的 key 字段', () => {
    const src = readStripped('src/layouts/pageNav.ts');
    expect(src).not.toContain('⇧⌘');
    expect(src).not.toMatch(/\bkey\s*:/);
    expect(src).not.toMatch(/\bshortcut\s*:/);
  });
});

describe('PAGE_NAV · 应用壳接线', () => {
  it('AppShell 默认落在工程管理页，切页走 app 作用域解析，不再按 e.key 硬比对', () => {
    const src = readStripped('src/layouts/AppShell.tsx');
    expect(src).toMatch(/useState<PageId>\(\(\)\s*=>\s*DEFAULT_PAGE_ID\)/);
    expect(src).toContain('PAGE_NAV');
    expect(src).toMatch(/resolveAction\(e, settings\.shortcuts, 'app'\)/);
    expect(src).toContain('isEditableTarget');
    expect(src).not.toMatch(/e\.key\s*===\s*'0'/);
    expect(src).not.toMatch(/isProjectsPrototype/);
  });

  it('AppNav 从 settings.shortcuts 派生提示，屏蔽（null）时不渲染 kbd', () => {
    const src = readStripped('src/layouts/AppNav.tsx');
    expect(src).toContain('settings.shortcuts[functionId]');
    expect(src).toMatch(/\{hint && <kbd>/);
    expect(src).not.toMatch(/item\.shortcut/);
  });

  it('PageRegistry 无条件注册工程管理页', () => {
    const src = readStripped('src/pages/PageRegistry.tsx');
    expect(src).toMatch(/projects:\s*ProjectsPage/);
    expect(src).not.toMatch(/isProjectsPrototype/);
  });

  it('PageRegistry 七条 lazy 全部从 ./ 子目录装入（architecture-refactor 02 落点锁）', () => {
    const src = readStripped('src/pages/PageRegistry.tsx');
    const paths = [...src.matchAll(/lazy\(\(\)\s*=>\s*import\('([^']+)'\)\)/g)].map((m) => m[1]);
    expect(paths).toEqual([
      './projects/ProjectsPage',
      './workspace/WorkspacePage',
      './audio/AudioPage',
      './assets/AssetsPage',
      './settings/SettingsPage',
      './settings/ShortcutsPage',
      './preview/PreviewPage',
    ]);
  });

  it('工程管理页不再把原型挂成默认入口', () => {
    const src = readStripped('src/pages/projects/ProjectsPage.tsx');
    expect(src).not.toMatch(/isProjectsPrototype/);
    expect(src).not.toMatch(/ProjectsPrototype/);
  });
});
