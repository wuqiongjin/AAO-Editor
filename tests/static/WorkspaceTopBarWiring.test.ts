import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readStripped(relPath: string): string {
  const full = join(process.cwd(), relPath);
  return readFileSync(full, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
}

describe('issue 170 · 工作台顶栏架构与静态接线约束', () => {
  // 票 180：顶栏抽成 WorkspaceTopBar 组件；BPM 标签撤掉（当前 BPM 在画布左下读数，票 179）
  it('WorkspaceTopBar 接入紧凑右簇：缩放微型胶囊 + WorkspaceDisplayPanel；页面只挂组件', () => {
    const ws = readStripped('src/pages/workspace/WorkspacePage.tsx');
    expect(ws).toContain("import WorkspaceTopBar from './WorkspaceTopBar';");
    expect(ws).toContain('<WorkspaceTopBar />');

    const bar = readStripped('src/pages/workspace/WorkspaceTopBar.tsx');
    expect(bar).toContain("import WorkspaceDisplayPanel from './WorkspaceDisplayPanel';");
    expect(bar).toContain("import './WorkspaceTopBar.css';");
    expect(bar).toContain('className="ws-topbar-right"');
    expect(bar).toContain('className="ws-zoom-capsule"');
    expect(bar).toContain('<WorkspaceDisplayPanel />');
    expect(bar).not.toContain('ws-topbar-bpm');

    // 顶栏右簇不再包含旧的分散 ZoomIn / ZoomOut 按钮
    expect(bar).not.toMatch(/ZoomOut/);
    expect(bar).not.toMatch(/ZoomIn/);
  });

  it('WorkspaceTopBar.css 约束尺寸与版式', () => {
    const css = readStripped('src/pages/workspace/WorkspaceTopBar.css');
    expect(css).not.toContain('.ws-topbar-bpm');
    // 缩放微型胶囊：height 26px 统一高度
    expect(css).toMatch(/\.ws-zoom-capsule\s*\{[^}]*height:\s*26px/);
    // 缩放胶囊内部按键与读数区约束
    expect(css).toMatch(/\.ws-zoom-capsule__btn\s*\{[^}]*width:\s*22px/);
    expect(css).toMatch(/\.ws-zoom-capsule__val\s*\{[^}]*min-width:\s*38px/);
  });

  it('WorkspaceDisplayPanel.css 约束入口图标 26×26px 与浮层 320px 宽度', () => {
    const css = readStripped('src/pages/workspace/WorkspaceDisplayPanel.css');
    expect(css).toMatch(/\.ws-topbar-icon-btn\s*\{[^}]*width:\s*26px/);
    expect(css).toMatch(/\.ws-topbar-icon-btn\s*\{[^}]*height:\s*26px/);
    expect(css).toMatch(/\.wdp__panel\s*\{[^}]*width:\s*320px/);
  });

  it('WorkspaceDisplayPanel.tsx 独立导出 panelLayoutFor 且包含 10 项设置与恢复出厂默认', () => {
    const tsx = readStripped('src/pages/workspace/WorkspaceDisplayPanel.tsx');
    expect(tsx).toContain('export function panelLayoutFor(');
    expect(tsx).toContain("label={t('settings.noteSize')}");
    expect(tsx).toContain("label={t('settings.slideOpacity')}");
    expect(tsx).toContain("label={t('settings.simultaneousClickLines')}");
    expect(tsx).toContain("label={t('settings.colorAssist')}");
    expect(tsx).toContain("label={t('settings.verticalRatio')}");
    expect(tsx).toContain("label={t('settings.imageQuality')}");
    expect(tsx).toContain("label={t('settings.gridStyle')}");
    expect(tsx).toContain("label={t('settings.lineShapeTiers')}");
    expect(tsx).toContain("label={t('settings.gridOpacity')}");
    expect(tsx).toContain("label={t('settings.labelScale')}");
    expect(tsx).toContain("t('settings.reset')");
  });
});
