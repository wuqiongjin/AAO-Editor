// issue 210 锁测：非激活页面脱离 Compositor 合成树，消除后台页面无谓 GPU/Retina 合成开销。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, readStripped } from '@/tests/support/source';

const APP_SHELL_CSS = 'src/layouts/AppShell.css';

describe('AppShell · issue 210 非激活页面脱离 Compositor 合成树', () => {
  const css = readStripped(APP_SHELL_CSS);

  it('.app-page 默认非激活态声明 visibility: hidden', () => {
    const pageBody = cssRuleBody(css, '.app-page');
    expect(pageBody).toBeDefined();
    expect(pageBody).toMatch(/visibility:\s*hidden/);
  });

  it('.app-page.is-active 激活态恢复 visibility: visible', () => {
    const activeBody = cssRuleBody(css, '.app-page.is-active');
    expect(activeBody).toBeDefined();
    expect(activeBody).toMatch(/visibility:\s*visible/);
  });

  it('.app-page 过渡包含 opacity 与 visibility 双属性协同（130ms 淡出后脱离合成树）', () => {
    const pageBody = cssRuleBody(css, '.app-page');
    expect(pageBody).toBeDefined();
    expect(pageBody).toMatch(/transition:[^;]*opacity\s+130ms[^;]*visibility\s+130ms/);
  });
});
