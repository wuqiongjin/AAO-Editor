// issue 11：封面占位色相的护栏。
// 色相一旦算出 NaN / Infinity，整条 `hsl()` 就是非法值，浏览器会把 background 声明整条丢掉
// —— 与 issue 11 的症状（封面一片空白）无法从外部区分。这里锁住取值域。
import { describe, expect, it } from 'vitest';
import { projectCoverHue } from '@/src/chart/project/projectCatalog';

const IDS = [
  '',                                   // 极端：空 id
  'p',
  'pNoCover',
  'p0123456789abcdef0123456789abcdef',  // newProjectId() 形态（p + 32 位 hex）
  'ẞ',                                  // 非 ASCII
  '🙂',                                  // 代理对
  'a'.repeat(4096),                     // 超长
  '../../etc/passwd',                   // 非法 id 也不许崩成 NaN
];

describe('issue 11 · 封面占位色相 projectCoverHue', () => {
  it.each(IDS)('对 %j 返回 0..359 的有限整数', (id) => {
    const hue = projectCoverHue(id);
    expect(Number.isFinite(hue)).toBe(true);
    expect(Number.isInteger(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThanOrEqual(359);
  });

  it('同一 id 稳定派生（不入库，跨会话必须同色）', () => {
    const id = 'p0123456789abcdef0123456789abcdef';
    expect(projectCoverHue(id)).toBe(projectCoverHue(id));
  });

  it('色相直接可拼进 hsl()，不产出非法颜色', () => {
    for (const id of IDS) {
      const css = `hsl(${projectCoverHue(id)} 70% 55%)`;
      expect(css).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
