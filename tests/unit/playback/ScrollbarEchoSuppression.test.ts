// issue 98 · 快速缩放音符相对网格跳动：三分量修复的回归看守。
// 分量 ①（瓦片位图 round 量化）由 RendererPerf.test.ts「issue 98」用例看守；
// 本文件看守分量 ②（精灵整像素对齐）与分量 ③（滚动条自回声反算）。
//
// 分量 ③ 是浏览器 DOM 时序（滚动偏移按设备像素取整 + scroll 事件异步派发），
// 单测只能锁纯判定函数与接线，端到端行为由 scripts/watch-scroll-family.mjs（不入库）
// 像素实测看守：缩放爆发期 scrollY 违例（|Δsy| > 0.02 virtual px）= 0。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isProgrammaticScrollEcho, registerScrollEcho, SCROLL_ECHO_TTL_MS } from '@/src/playback/useScrollModel';
import { repoRoot } from '@/tests/support/source';

describe('issue 98 · 程序化滚动写入的回声识别（isProgrammaticScrollEcho）', () => {
  it('设备像素取整的回声（|差| ≤ 1px）= 吞掉', () => {
    expect(isProgrammaticScrollEcho(5000, 5000)).toBe(true);      // 精确回声
    expect(isProgrammaticScrollEcho(5000.4, 5000)).toBe(true);    // +0.5px 取整
    expect(isProgrammaticScrollEcho(4999.6, 5000)).toBe(true);    // −0.5px 取整
    expect(isProgrammaticScrollEcho(5001, 5000)).toBe(true);      // 容差边界 +1
    expect(isProgrammaticScrollEcho(4999, 5000)).toBe(true);      // 容差边界 −1
  });

  it('真实用户滚动（超出容差 / 无登记）= 照常处理', () => {
    expect(isProgrammaticScrollEcho(5001.5, 5000)).toBe(false);
    expect(isProgrammaticScrollEcho(4998.5, 5000)).toBe(false);
    expect(isProgrammaticScrollEcho(3000, 5000)).toBe(false);
    expect(isProgrammaticScrollEcho(5000, null)).toBe(false);     // 无程序化写入登记
  });

  it('TTL 过后同一 scrollTop 不再当回声（滚动条事后滚回开头必须反算）', () => {
    const gate = registerScrollEcho(5000, 0);
    expect(isProgrammaticScrollEcho(5000, gate, 0)).toBe(true);
    expect(isProgrammaticScrollEcho(5000, gate, SCROLL_ECHO_TTL_MS)).toBe(true);
    expect(isProgrammaticScrollEcho(5000, gate, SCROLL_ECHO_TTL_MS + 1)).toBe(false);
  });
});

describe('issue 98 · 谱面视口会话接线静态断言（防重构复活回声反算）', () => {
  // architecture-refactor/09（候选 4）：滚动条 onScroll 与回声登记搬进谱面视口会话，断言随宿主改锚；
  // 断言语义逐条不变（回声检查位置 + 两处登记）。
  const sessionSrc = readFileSync(join(repoRoot, 'src/playback/useChartViewSession.ts'), 'utf-8');

  it('onScrollbarScroll 在反算 scrollY 前吞掉程序化写入的回声', () => {
    // 回声检查必须先于 maxScroll 反算（否则取整值已进入 scrollY）
    const handler = sessionSrc.slice(sessionSrc.indexOf('const onScrollbarScroll'));
    const echoAt = handler.indexOf('isProgrammaticScrollEcho(scrollTop');
    const maxScrollAt = handler.indexOf('target.scrollHeight - target.clientHeight');
    expect(echoAt).toBeGreaterThan(-1);
    expect(maxScrollAt).toBeGreaterThan(echoAt);
  });

  it('两处程序化 scrollTop 写入都登记期望值（缩放比例位回写 + 重锚）', () => {
    expect(sessionSrc).toMatch(/programmaticScrollTopRef\.current = registerScrollEcho\(targetScrollTop\)/);
    expect(sessionSrc).toMatch(/programmaticScrollTopRef\.current = registerScrollEcho\(target\.scrollTop\)/);
  });
});

describe('issue 98 · 精灵绘制不做整像素对齐（防 Math.round 复活）', () => {
  const spriteSrc = readFileSync(join(repoRoot, 'src/ui/CanvasSpriteIcon.tsx'), 'utf-8');

  it('drawSingle 的 dx/dy 不做整像素取整', () => {
    expect(spriteSrc).not.toMatch(/Math\.round\(cfg\.canvasX/);
    expect(spriteSrc).not.toMatch(/Math\.round\(cfg\.canvasY/);
  });
});
