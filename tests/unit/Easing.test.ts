// issue 09 S2 / ADR-0009 §2：缓动函数表锁测。
// 公式与 Bestdori 制谱器 bundle 逐函数对齐（10 族基函数 × 4 型分派）；
// 锚点值 = 标准 Penner 公式的解析值（手算可复核），改公式必先改 ADR-0009。
import { describe, it, expect } from 'vitest';
import {
  easing, easeOutBounce, EASING_FAMILIES, EASING_TYPES, MONOTONIC_FAMILIES,
} from '../../src/chart/editing/Easing';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('issue 09 · 缓动函数表（10 族 × 4 型）', () => {
  it('全 40 组合：f(0)=0、f(1)=1 边界精确', () => {
    for (const family of EASING_FAMILIES) {
      for (const type of EASING_TYPES) {
        const f = easing(family, type);
        expect(close(f(0), 0), `${family}/${type}(0)`).toBe(true);
        expect(close(f(1), 1), `${family}/${type}(1)`).toBe(true);
      }
    }
  });

  it('全 40 组合：中点 inOut/outIn 恒 0.5（a(1)/2 与 (1+a(0))/2）', () => {
    for (const family of EASING_FAMILIES) {
      expect(close(easing(family, 'inOut')(0.5), 0.5), `${family}/inOut(.5)`).toBe(true);
      expect(close(easing(family, 'outIn')(0.5), 0.5), `${family}/outIn(.5)`).toBe(true);
    }
  });

  it('单调族（7 族 × 4 型）在 0..1 上单调非递减', () => {
    for (const family of MONOTONIC_FAMILIES) {
      for (const type of EASING_TYPES) {
        const f = easing(family, type);
        let prev = f(0);
        for (let k = 1; k <= 32; k++) {
          const v = f(k / 32);
          expect(v, `${family}/${type}(${k}/32)`).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = v;
        }
      }
    }
  });

  it('解析锚点：quad / cubic / sine / expo / circ', () => {
    expect(close(easing('quad', 'in')(0.5), 0.25)).toBe(true);
    expect(close(easing('quad', 'out')(0.5), 0.75)).toBe(true);
    expect(close(easing('quad', 'out')(0.25), 1 - 0.75 * 0.75)).toBe(true); // 1-a(0.75)
    expect(close(easing('cubic', 'in')(0.5), 0.125)).toBe(true);
    expect(close(easing('cubic', 'inOut')(0.25), 0.0625)).toBe(true); // a(0.5)/2
    expect(close(easing('sine', 'in')(0.5), 1 - Math.SQRT1_2)).toBe(true); // 1-cos(π/4)
    expect(close(easing('expo', 'in')(1), 1)).toBe(true);
    expect(close(easing('expo', 'in')(0.5), Math.pow(2, -5))).toBe(true);
    expect(close(easing('circ', 'in')(0.5), 1 - Math.sqrt(0.75))).toBe(true);
  });

  it('解析锚点：back 过冲（负值起步）与 out 型对称', () => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    expect(close(easing('back', 'in')(0.5), c3 * 0.125 - c1 * 0.25)).toBe(true);
    // back/in(0.1) < 0（过冲）
    expect(easing('back', 'in')(0.1)).toBeLessThan(0);
    // out(p) = 1 - a(1-p)
    expect(close(easing('back', 'out')(0.5), 1 - (c3 * 0.125 - c1 * 0.25))).toBe(true);
  });

  it('解析锚点：bounce（easeOutBounce 参考值）与 elastic 边界', () => {
    expect(close(easeOutBounce(0.5), 0.765625)).toBe(true);
    expect(close(easeOutBounce(1), 1)).toBe(true);
    expect(close(easeOutBounce(0), 0)).toBe(true);
    // bounce/in(p) = 1 - easeOutBounce(1-p)
    expect(close(easing('bounce', 'in')(0.5), 1 - 0.765625)).toBe(true);
    // elastic：in 型下穿 0（回缩）、out 型上穿 1（过冲），边界精确
    const ein = easing('elastic', 'in');
    const out = easing('elastic', 'out');
    let hasOvershoot = false;
    let hasUndershoot = false;
    for (let k = 1; k < 32; k++) {
      if (out(k / 32) > 1) hasOvershoot = true;
      if (ein(k / 32) < 0) hasUndershoot = true;
    }
    expect(hasOvershoot).toBe(true);
    expect(hasUndershoot).toBe(true);
  });
});
