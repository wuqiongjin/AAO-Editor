// issue 121 锁测：快捷键页侧栏「索引筛选」是粗桶（≠ ADR-0002 tooltip 类别），
// 切页六行进表归系统；搜索 ∩ 当前桶；筛选态不写入 AppSettings。
import { describe, it, expect } from 'vitest';
import { FUNCTIONS, getDefaultConfig } from '@/src/chart/config/ShortcutConfig';
import {
  INDEX_FILTERS,
  bucketForCategory,
  filterFunctions,
  shortcutTableEmptyKind,
  restoreDefaultsInFilter,
} from '@/src/settings/shortcutIndexFilter';
import { t } from '@/src/i18n';
import { defaultSettings } from '@/src/chart/config/AppSettings';
import { stripComments, readSource } from '@/tests/support/source';


describe('issue 121 · 索引筛选桶归属', () => {
  it('切页七功能在表内（issue 177），且都归系统', () => {
    const pages = FUNCTIONS.filter((f) => f.scope === 'app');
    expect(pages).toHaveLength(7);
    expect(pages.every((f) => bucketForCategory(f.category) === 'system')).toBe(true);
  });

  it('每条 FunctionId 恰好落入一个非「全部」桶，「其它」默认空', () => {
    const assigned = new Map<string, string>();
    for (const f of FUNCTIONS) {
      const bucket = bucketForCategory(f.category);
      expect(bucket).not.toBe('all');
      assigned.set(f.id, bucket);
    }
    expect(assigned.size).toBe(FUNCTIONS.length);
    expect([...assigned.values()].every((b) => b !== 'other')).toBe(true);
    expect(filterFunctions(FUNCTIONS, 'other', '', getDefaultConfig())).toEqual([]);
  });

  it('类别 → 粗桶对照表与定案一致（布局=系统，播放=播放）', () => {
    // 期望值来自 issue 121 定案表，不从 CATEGORY_TO_BUCKET 抄
    const expected: Record<string, 'system' | 'noteTools' | 'editTools' | 'playback'> = {
      layout: 'system',
      mouse: 'noteTools', bpm: 'noteTools', single: 'noteTools', flick: 'noteTools',
      skill: 'noteTools', ldirectional: 'noteTools', rdirectional: 'noteTools', slide: 'noteTools', curve: 'noteTools',
      copy: 'editTools', paste: 'editTools', cut: 'editTools', delete: 'editTools',
      mirror: 'editTools', noteCode: 'editTools', undo: 'editTools', redo: 'editTools',
      play: 'playback',
      navigation: 'system',
    };
    for (const f of FUNCTIONS) {
      expect(bucketForCategory(f.category), f.id).toBe(expected[f.category]);
    }
  });

  it('索引筛选标签是粗桶名，不含 ADR 类别细分组', () => {
    expect(INDEX_FILTERS.map((f) => t(f.label))).toEqual([
      '全部', '系统', '音符工具', '编辑工具', '播放', '其它',
    ]);
    const labels = INDEX_FILTERS.map((f) => t(f.label)).join(' ');
    expect(labels).not.toMatch(/单键|复制|布局/);
  });
});

describe('issue 121 · 搜索 ∩ 桶', () => {
  it('桶=播放 + 搜索「单键」→ 空', () => {
    const cfg = getDefaultConfig();
    expect(filterFunctions(FUNCTIONS, 'playback', '单键', cfg)).toEqual([]);
  });

  it('空态：其它=空桶；播放+「单键」=搜索空', () => {
    const cfg = getDefaultConfig();
    const otherHits = filterFunctions(FUNCTIONS, 'other', '', cfg).length;
    const playHits = filterFunctions(FUNCTIONS, 'playback', '', cfg).length;
    const playSearchHits = filterFunctions(FUNCTIONS, 'playback', '单键', cfg).length;
    expect(shortcutTableEmptyKind(otherHits, otherHits)).toBe('empty-bucket');
    expect(shortcutTableEmptyKind(playHits, playSearchHits)).toBe('empty-search');
  });
});

describe('issue 121 · 恢复默认跟当前桶', () => {
  it('全部 = 整表出厂；播放桶不改动单键', () => {
    const dirty = getDefaultConfig();
    dirty.play = 'p';
    dirty.switchSingle = 'z';
    expect(restoreDefaultsInFilter(dirty, 'all')).toEqual(getDefaultConfig());
    const onlyPlay = restoreDefaultsInFilter(dirty, 'playback');
    expect(onlyPlay.play).toBe(' ');
    expect(onlyPlay.jumpToMarker).toBe('ctrl+ ');
    expect(onlyPlay.switchSingle).toBe('z');
  });

  it('其它桶无可改项 = 原样；出厂键被桶外占用则卸掉占用方', () => {
    const cfg = getDefaultConfig();
    expect(restoreDefaultsInFilter(cfg, 'other')).toEqual(cfg);
    cfg.switchSingle = ' '; // 占了播放出厂空格
    cfg.play = 'p';
    const next = restoreDefaultsInFilter(cfg, 'playback');
    expect(next.play).toBe(' ');
    expect(next.switchSingle).toBeNull();
  });

  it('issue 150 · 有搜索交集时只重置 onlyIds 中的项', () => {
    const dirty = getDefaultConfig();
    dirty.copy = 'x';
    dirty.paste = 'y';
    dirty.cut = 'z';
    const next = restoreDefaultsInFilter(dirty, 'editTools', FUNCTIONS, getDefaultConfig(), ['copy']);
    expect(next.copy).toBe(getDefaultConfig().copy);
    expect(next.paste).toBe('y');
    expect(next.cut).toBe('z');
  });

  it('issue 150 · onlyIds + 全部桶不整表恢复', () => {
    const dirty = getDefaultConfig();
    dirty.play = 'p';
    dirty.copy = 'x';
    const next = restoreDefaultsInFilter(dirty, 'all', FUNCTIONS, getDefaultConfig(), ['copy']);
    expect(next.copy).toBe(getDefaultConfig().copy);
    expect(next.play).toBe('p');
  });
});

describe('issue 121 · 筛选不写入设置对象', () => {
  it('AppSettings / defaultSettings 无筛选字段', () => {
    const keys = Object.keys(defaultSettings());
    expect(keys).not.toContain('shortcutIndexFilter');
    expect(keys).not.toContain('indexFilter');
    const src = stripComments(readSource('src/chart/config/AppSettings.ts'));
    expect(src).not.toMatch(/indexFilter|shortcutIndexFilter|IndexFilterId/);
  });

  it('ShortcutsPage 用 useState 持筛选，不调 setSettings 写桶', () => {
    const src = stripComments(readSource('src/pages/settings/ShortcutsPage.tsx'));
    expect(src).toMatch(/useState.*IndexFilterId|useState<IndexFilterId>/);
    expect(src).toContain('AppPageShell.Sidebar');
    expect(src).toContain('empty-bucket');
    expect(src).toContain('empty-search');
    expect(src).toContain('shortcuts.emptyBucket');
    expect(src).toContain('restoreDefaultsInFilter');
    expect(src).toMatch(/key=\{indexFilter\}/);
    expect(src).toContain('shortcut-table-body');
    expect(src).not.toMatch(/setSettings\([^)]*indexFilter/);
    expect(src).not.toMatch(/shortcuts:\s*\{[^}]*indexFilter/);
  });

  it('滚动看护：真滚动在表上；clip 不写在全局 .app-stagger / Body', () => {
    // 测不了「动画中闪条」的像素时序；锁两次翻车的结构：
    // clip 在滚动容器上 → 条没了；表体 shrink+clip → 条没了；body 挂 stagger → 装得下也闪条。
    const tokens = stripComments(readSource('src/app/styles/tokens.css'));
    expect(tokens).not.toMatch(/(?:^|\n)\.app-stagger\s*\{[^}]*overflow\s*:/);
    const bodySrc = stripComments(readSource('src/layouts/AppPageShell.tsx'));
    expect(bodySrc).not.toMatch(/classes\s*=\s*\[[^\]]*app-stagger/);
    const css = stripComments(readSource('src/layouts/AppShell.css'));
    expect(css).toMatch(/\.shortcut-table-body\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/\.shortcut-table-body\s*\{[^}]*overflow:\s*clip/);
    expect(css).toMatch(/\.app-page-shell__body\.is-fill\s+\.shortcut-table\s*\{[^}]*overflow-y:\s*auto/);
  });
});

describe('issue 127 · 换索引筛滚动回顶', () => {
  it('indexFilter 变化时 .shortcut-table 滚回顶；搜索 query 变化不重置', () => {
    const src = stripComments(readSource('src/pages/settings/ShortcutsPage.tsx'));
    expect(src).toMatch(/ref=\{shortcutTableRef\}[^>]*className="shortcut-table"|className="shortcut-table"[^>]*ref=\{shortcutTableRef\}/);
    expect(src).toMatch(/shortcutTableRef\.current\?\.scrollTo\(\{\s*top:\s*0\s*\}\)/);
    expect(src).toMatch(/\},\s*\[indexFilter\]\)/);
    expect(src).not.toMatch(/\},\s*\[indexFilter,\s*query\]\)/);
    expect(src).not.toMatch(/\},\s*\[query\]\)/);
  });
});
