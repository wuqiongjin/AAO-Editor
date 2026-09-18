// issue 120：内容壳 W → L / 侧栏 / 正文 / R。期望值按默认窗锚点手算，不复用生产公式。
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CONTENT_SHELL_BODY_ANCHOR,
  CONTENT_SHELL_BODY_MAX,
  CONTENT_SHELL_GAP,
  CONTENT_SHELL_GUTTER_MIN,
  CONTENT_SHELL_INSET_L_ANCHOR,
  CONTENT_SHELL_INSET_L_MAX,
  CONTENT_SHELL_NAV_COLLAPSED,
  CONTENT_SHELL_WINDOW_DEFAULT,
  layoutContentShell,
} from '../../src/layouts/contentShellGeometry';

function rowSum(g: ReturnType<typeof layoutContentShell>, W: number) {
  return g.L + g.sidebar + CONTENT_SHELL_GAP + g.body + g.R;
}

describe('issue 120 · 内容壳几何', () => {
  test('默认窗（折叠导航）：正文 920，L 仍为 51，R 吃剩余', () => {
    const W = CONTENT_SHELL_WINDOW_DEFAULT - CONTENT_SHELL_NAV_COLLAPSED; // 1208
    const g = layoutContentShell(W);
    expect(W).toBe(1208);
    expect(g.sidebar).toBe(151);
    expect(g.body).toBe(CONTENT_SHELL_BODY_ANCHOR);
    expect(g.L).toBe(CONTENT_SHELL_INSET_L_ANCHOR);
    expect(g.R).toBe(62);
    expect(rowSum(g, W)).toBe(W);
  });

  test('再变窄：L/R 一起减，先碰到 L_min 后只减 R', () => {
    const W = 1140;
    const g = layoutContentShell(W);
    // S=clamp(140, 142.5, 200)=142.5；行内 973.5；相对默认缺 59.5
    // 各减 29.75 → L=21.25 R=32.25，正文仍 920
    expect(g.sidebar).toBe(142.5);
    expect(g.body).toBe(920);
    expect(g.L).toBe(21.25);
    expect(g.R).toBe(32.25);
    expect(rowSum(g, W)).toBe(W);
  });

  test('再变窄：L 先到 16 之后只减 R，正文仍 920', () => {
    const W = 1122;
    const g = layoutContentShell(W);
    expect(g.sidebar).toBe(140.25);
    expect(g.L).toBe(CONTENT_SHELL_GUTTER_MIN);
    expect(g.R).toBe(21.75);
    expect(g.body).toBe(920);
    expect(rowSum(g, W)).toBe(W);
  });

  test('再变窄：间隙吃到 16 之后才减正文', () => {
    const W = 1000;
    const g = layoutContentShell(W);
    expect(g.sidebar).toBe(140);
    expect(g.L).toBe(CONTENT_SHELL_GUTTER_MIN);
    expect(g.R).toBe(CONTENT_SHELL_GUTTER_MIN);
    expect(g.body).toBe(804);
    expect(g.body).toBeLessThan(CONTENT_SHELL_BODY_ANCHOR);
    expect(rowSum(g, W)).toBe(W);
  });

  test('再变宽：间隙冻在默认档，正文随剩余 1:1 直到 B_max', () => {
    const W = 1600;
    const g = layoutContentShell(W);
    expect(g.sidebar).toBe(200);
    expect(g.L).toBe(CONTENT_SHELL_INSET_L_ANCHOR);
    expect(g.R).toBe(62);
    expect(g.body).toBe(1263);
    expect(g.body).toBeLessThan(CONTENT_SHELL_BODY_MAX);
    expect(rowSum(g, W)).toBe(W);
  });

  test('正文到 1440 后左右一起加；L 到 L_max 之后只加 R', () => {
    const atCap = layoutContentShell(1777);
    expect(atCap.body).toBe(CONTENT_SHELL_BODY_MAX);
    expect(atCap.L).toBe(CONTENT_SHELL_INSET_L_ANCHOR);
    expect(atCap.R).toBe(62);

    const together = layoutContentShell(1800);
    expect(together.body).toBe(1440);
    expect(together.L).toBe(62.5);
    expect(together.R).toBe(73.5);

    const afterLMax = layoutContentShell(1900);
    expect(afterLMax.body).toBe(1440);
    expect(afterLMax.L).toBe(CONTENT_SHELL_INSET_L_MAX);
    expect(afterLMax.R).toBe(140);
    expect(rowSum(afterLMax, 1900)).toBe(1900);
  });
});

describe('issue 120 · 接线', () => {
  const root = join(__dirname, '../..');
  const css = readFileSync(join(root, 'src/layouts/AppPageShell.css'), 'utf-8');
  const tsx = readFileSync(join(root, 'src/layouts/AppPageShell.tsx'), 'utf-8');

  test('废 0.3 公式；L_max 令牌与常量同值', () => {
    expect(css).not.toMatch(/\*\s*0\.3/);
    expect(css).toContain('--aps-inset-l-max');
    expect(css).toMatch(new RegExp(`--aps-inset-l-max:\\s*${CONTENT_SHELL_INSET_L_MAX}px`));
    expect(tsx).toContain('layoutContentShell');
  });
});
