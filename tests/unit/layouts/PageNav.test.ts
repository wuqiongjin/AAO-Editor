// chart-projects 03：启动落点与切页快捷键。页面注册表是单一真相源。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_ID, PAGE_NAV } from '@/src/layouts/pageNav';
import { PAGE_SWITCH_ROWS } from '@/src/settings/shortcutIndexFilter';
import { readStripped } from '@/tests/support/source';

describe('PAGE_NAV · 启动落点与 ⇧⌘0..6', () => {
  it('工程管理页是第一项、启动默认落点，快捷键 ⇧⌘0；预览紧随音频页 ⇧⌘3，其后三页各顺延一位', () => {
    expect(DEFAULT_PAGE_ID).toBe('projects');
    expect(PAGE_NAV.map((p) => [p.id, p.shortcut, p.key])).toEqual([
      ['projects', '⇧⌘0', '0'],
      ['workspace', '⇧⌘1', '1'],
      ['audio', '⇧⌘2', '2'],
      // chart-preview 02（ADR-0016 §4）：预览页紧随音频页（2026-09-30 用户验收拍板）
      ['preview', '⇧⌘3', '3'],
      ['assets', '⇧⌘4', '4'],
      ['shortcuts', '⇧⌘5', '5'],
      ['settings', '⇧⌘6', '6'],
    ]);
  });

  it('快捷键页切页行与 PAGE_NAV 同序同键', () => {
    expect(PAGE_SWITCH_ROWS.map((row) => [row.label, row.combo])).toEqual([
      ['pageSwitch.projects', 'Ctrl/⌘+Shift+0'],
      ['pageSwitch.workspace', 'Ctrl/⌘+Shift+1'],
      ['pageSwitch.audio', 'Ctrl/⌘+Shift+2'],
      ['pageSwitch.preview', 'Ctrl/⌘+Shift+3'],
      ['pageSwitch.assets', 'Ctrl/⌘+Shift+4'],
      ['pageSwitch.shortcuts', 'Ctrl/⌘+Shift+5'],
      ['pageSwitch.settings', 'Ctrl/⌘+Shift+6'],
    ]);
    expect(PAGE_SWITCH_ROWS.every((row) => row.bucket === 'system')).toBe(true);
  });
});

describe('PAGE_NAV · 应用壳接线', () => {
  it('AppShell 默认落在工程管理页，并用 PAGE_NAV 切页，不再按原型 URL 门控', () => {
    const src = readStripped('src/layouts/AppShell.tsx');
    expect(src).toMatch(/useState<PageId>\(\(\)\s*=>\s*DEFAULT_PAGE_ID\)/);
    expect(src).toContain('PAGE_NAV');
    expect(src).not.toMatch(/isProjectsPrototype/);
  });

  it('AppNav 全量渲染 PAGE_NAV，工程管理页不再藏在原型开关后', () => {
    const src = readStripped('src/layouts/AppNav.tsx');
    expect(src).toContain('PAGE_NAV');
    expect(src).not.toMatch(/isProjectsPrototype/);
    expect(src).not.toMatch(/i\.id\s*!==\s*'projects'/);
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
