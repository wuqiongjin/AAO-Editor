// chart-preview 02 落点锁：预览页的**壳接线**与**域骨架**是结构事实，DOM 测试抓不住——
// 它只认源码路径与 import 形态。手法照 RenderingConvergence.test.ts：读源码 / 扫目录 /
// 解析 import specifier。
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_NAV } from '@/src/layouts/pageNav';
import { PAGE_REGISTRY } from '@/src/pages/PageRegistry';
import { PAGE_SWITCH_ROWS } from '@/src/settings/shortcutIndexFilter';
import { readStripped, repoRoot } from '@/tests/support/source';

/** dir 下全部源码文件（相对仓库根的路径） */
function sourceFiles(dir: string, re = /\.(ts|tsx|css)$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs, re));
    } else if (re.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

/** 目录下直接子项（文件 + 目录）名，排序后返回 */
function entries(dir: string): string[] {
  return readdirSync(join(repoRoot, dir)).sort();
}

/** 单个源码文件里的 import specifier（含 `from '…'`、`import('…')`） */
function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** 把 specifier 解析成仓库相对路径（裸包名返回 null） */
function resolveSpec(spec: string, file: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    return relative(repoRoot, resolve(dirname(join(repoRoot, file)), spec)).split('\\').join('/');
  }
  return null;
}

/** 预览页紧随音频页（2026-09-30 用户验收拍板）：末位留给工具类页面（快捷键 / 设置） */
const PAGE_ORDER = ['projects', 'workspace', 'audio', 'preview', 'assets', 'shortcuts', 'settings'];

describe('chart-preview 02 · 预览页的壳接线', () => {
  it('壳三处同步：PageId / PAGE_NAV / PAGE_REGISTRY 都有 preview，导航位次紧随音频页', () => {
    // PageId union：Record<PageId,…> 只保证"注册表不漏"，反向（联合里有、别处没有）靠这条
    expect(readStripped('src/layouts/AppNav.tsx')).toMatch(/export type PageId =[^;]*'preview'/);

    const navIds = PAGE_NAV.map((item) => item.id);
    expect(navIds).toEqual(PAGE_ORDER);
    expect(PAGE_NAV.find((item) => item.id === 'preview')).toMatchObject({ shortcut: '⇧⌘3', key: '3' });

    expect(Object.keys(PAGE_REGISTRY).sort()).toEqual([...navIds].sort());
    expect(readStripped('src/pages/PageRegistry.tsx')).toContain("lazy(() => import('./preview/PreviewPage'))");
  });

  it('切页快捷键表跟着预览页多一行（Ctrl/⌘+Shift+3），与 PAGE_NAV 同序同键', () => {
    expect(PAGE_SWITCH_ROWS.map((row) => row.label)).toEqual([
      'pageSwitch.projects', 'pageSwitch.workspace', 'pageSwitch.audio', 'pageSwitch.preview',
      'pageSwitch.assets', 'pageSwitch.shortcuts', 'pageSwitch.settings',
    ]);
    expect(PAGE_SWITCH_ROWS[3].combo).toBe('Ctrl/⌘+Shift+3');
    expect(PAGE_SWITCH_ROWS).toHaveLength(PAGE_NAV.length);
  });

  it('进预览页不 ensure 当前工程：NEEDS_CURRENT_PROJECT 仍只有工作台', () => {
    const src = readStripped('src/layouts/AppShell.tsx');
    const literal = src.match(/NEEDS_CURRENT_PROJECT[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(literal?.[1].match(/'[^']+'/g)).toEqual(["'workspace'"]);
  });

  it('预览页自渲染全幅布局（票 10）：脱离 AppPageShell、标题区撤销、模式切换当页头', () => {
    const src = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(src).not.toContain('AppPageShell');
    // 标题区（eyebrow + 标题）整块撤销（2026-10-02 用户验收：模式名即标题），i18n 键一并退场
    expect(src).not.toContain('page-intro');
    expect(src).not.toContain('preview.header.');
    // 页头 = 模式切换独占一行（样式变体 D 定案；原型原件留档在 proto/ 分支，不进 main）
    expect(src).toMatch(/preview-header/);
    expect(src).toContain('preview.modes.aria');
    expect(src).not.toMatch(/PreviewHeaderProto|pvproto/);
    // 左簇只剩作用对象：作用域条 →「/」→ 谱面切换器（模式切换不在工具栏；
    // 分隔符 = issue 11 #5，纯视觉、aria-hidden）
    const left = src.slice(src.indexOf('preview-toolbar__left'), src.indexOf('preview-stage'));
    expect(left).toMatch(/ScopePicker[\s\S]*preview-toolbar__sep[\s\S]*PreviewChartSwitcher/);
    expect(left).toContain('aria-hidden="true"');
    expect(left).not.toContain('preview-modes');
    // 显示控件不再套外壳（2026-10-02 用户验收：外壳多余、白占高度）
    expect(src).not.toContain('preview-toolbar__controls');
  });

  it('全屏只留一枚退出钮（issue 12）：.preview-fs 不再整体挂那一排控件', () => {
    const src = readStripped('src/pages/preview/PreviewPage.tsx');
    const fsBlock = src.slice(src.indexOf('preview-fs'));
    expect(fsBlock).not.toMatch(/PreviewStaticToolbar/);
    expect(fsBlock).toMatch(/PreviewExitFullscreenButton/);

    // 退出钮 icon-only：不传 `label`（IconButton 一见 label 就出文字），可访问名 / tooltip 仍在
    const toolbar = readStripped('src/pages/preview/PreviewStaticToolbar.tsx');
    const exitBlock = toolbar.slice(toolbar.indexOf('export function PreviewExitFullscreenButton'));
    expect(exitBlock).not.toMatch(/\slabel=/);
    expect(exitBlock).toMatch(/aria-label=/);
    expect(exitBlock).toMatch(/title=/);
  });

  it('页头分割线是页头级的层次所在（样式变体 D 的落点）', () => {
    const css = readStripped('src/pages/preview/PreviewPage.css');
    expect(css).toMatch(/\.preview-modes\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/);
    expect(css).not.toContain('preview-toolbar__controls');
  });
});

describe('chart-preview 02 · 预览域骨架与依赖方向', () => {
  it('src/preview 是新顶层域：barrel + static/ + video/（各自带类型契约）', () => {
    expect(entries('src/preview')).toEqual(['index.ts', 'static', 'types.ts', 'video']);
    // 03 起 static/ 是实件：面板模型（panelLayout）/ 出图器（panelPainter）/ 显示档（displayProfile）
    // / 画面（StaticPreviewView）/ 宽图导出（exportPanels）/ 二进制另存（saveBinary）
    expect(entries('src/preview/static')).toEqual([
      'StaticPreviewView.css',
      'StaticPreviewView.tsx',
      'displayProfile.ts',
      'exportPanels.ts',
      'index.ts',
      'panelLayout.ts',
      'panelPainter.ts',
      'saveBinary.ts',
    ]);
    expect(entries('src/preview/video')).toEqual(['index.ts']);
  });

  it('预览域不 import pages/（ADR-0016 §3 单向依赖）', () => {
    const offenders = sourceFiles(join(repoRoot, 'src/preview'))
      .filter((file) => importSpecifiers(readStripped(file))
        .some((spec) => (resolveSpec(spec, file) ?? '').startsWith('src/pages/')));
    expect(offenders).toEqual([]);
  });
});
