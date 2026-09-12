// issue 97：工作台左右面板默认宽度同口径 —— 公式纯函数 + 出厂默认 + 接线静态断言。
// 背景：默认宽度原本两套（左 min(380,30vw) / 右 min(300,20vw)，且真正的首屏默认在
// AppSettings.defaultSettings().layout（挂载 hydrate 覆盖 UIProvider useState 初值））。
// 用户拍板：左默认 = 右默认。本文件锁「公式、默认值、接线、CSS 兜底」四处不回分叉。
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_PANEL_WIDTH, defaultPanelWidth, defaultSettings } from '../../src/chart/config/AppSettings';

describe('issue 97 · defaultPanelWidth 公式（px 上限 + 20vw 兜底）', () => {
    test('宽屏封顶 DEFAULT_PANEL_WIDTH，窄屏随 20vw 收缩', () => {
        expect(defaultPanelWidth(1920)).toBe(300);
        expect(defaultPanelWidth(1280)).toBe(256);
        expect(defaultPanelWidth(1000)).toBe(200);
    });
});

describe('issue 97 · 出厂默认：左右面板同宽', () => {
    test('defaultSettings().layout 左 = 右 = DEFAULT_PANEL_WIDTH', () => {
        const s = defaultSettings();
        expect(s.layout.leftPanel.width).toBe(DEFAULT_PANEL_WIDTH);
        expect(s.layout.rightPanel.width).toBe(DEFAULT_PANEL_WIDTH);
    });
});

describe('issue 97 · 接线静态断言（初值与 CSS 兜底不再分叉）', () => {
    const root = join(__dirname, '../..');
    const providerSrc = readFileSync(join(root, 'src/app/providers/UIProvider.tsx'), 'utf-8');
    const cssSrc = readFileSync(join(root, 'src/layouts/AppShell.css'), 'utf-8');

    test('UIProvider 左右两个 useState 初值都走 defaultPanelWidth（旧公式退场）', () => {
        expect(providerSrc.match(/defaultPanelWidth\(/g)?.length).toBe(2);
        expect(providerSrc).not.toContain('0.30');
        expect(providerSrc).not.toContain('380');
    });

    test('AppShell.css 左右面板 width 兜底一致（DEFAULT_PANEL_WIDTH = 300px）', () => {
        expect(cssSrc).toMatch(/\.ws-panel-left\s*\{[^}]*var\(--ws-left-w,\s*300px\)/s);
        expect(cssSrc).toMatch(/\.ws-panel-right\s*\{[^}]*var\(--ws-right-w,\s*300px\)/s);
    });
});
