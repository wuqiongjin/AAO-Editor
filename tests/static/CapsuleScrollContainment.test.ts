// 票 246 · 曲线选项胶囊「高度不越界 + 滚轮不出面板」的结构锁。
//
// 为什么只能静态断言：jsdom 没有布局引擎（`scrollHeight` / `clientHeight` 恒 0）也没有滚轮的默认行为，
// 「短窗下胶囊顶出画布区、末行被裁」「面板滚到底后画布跟着跑」两件事都测不出来。滚轮**决策**另有一条
// DOM 锁（tests/dom/workspace/CapsuleWheelContainment.test.tsx）；真实几何（各窗宽下不越界、
// 末行可滚到可见）由 headless Edge 实测把关，数值记在票 246 的 Comments。
//
// 本文件锁的是让那两种病不可能复发的结构事实：外壳有高度上限、展开面是「顶栏 + 可滚面板」的竖排、
// 每个滚动容器自己封住链式溢出、滚轮监听器必须是非被动的（否则 preventDefault 无效）。
import { describe, expect, it } from 'vitest';
import { cssRuleBodyExact, readSource, readStripped } from '@/tests/support/source';

const SHELL_CSS = 'src/pages/workspace/CanvasCapsule.css';
const CURVE_CSS = 'src/pages/workspace/CurveOptionsCapsule.css';
const PASTE_CSS = 'src/pages/workspace/PatternPastePill.css';
const PANEL_CSS = 'src/pages/workspace/CurveConfigPanel.css';

function rule(css: string, selector: string): string {
  const body = cssRuleBodyExact(readStripped(css), selector);
  if (body == null) throw new Error(`${css} 里找不到 ${selector} 规则`);
  return body;
}

describe('basic-editor 246 · 曲线选项胶囊高度上限与滚动封口', () => {
  it('胶囊外壳有高度上限，退路是 min(60vh, 480px)（量不到画布区时的最后一道）', () => {
    expect(rule(SHELL_CSS, '.ccap')).toMatch(/max-height:\s*var\(--capsule-max-h,\s*min\(60vh,\s*480px\)\)/);
  });

  it('展开面是竖排：顶栏定高、面板吃余量（面板不肯缩就顶破上限）', () => {
    expect(rule(CURVE_CSS, '.coc')).toMatch(/display:\s*flex/);
    expect(rule(CURVE_CSS, '.coc')).toMatch(/flex-direction:\s*column/);
    expect(rule(CURVE_CSS, '.coc__head')).toMatch(/flex:\s*0\s+0\s+auto/);
  });

  it('面板自己滚：min-height: 0 才肯缩，缩下来才有地方滚；滚到底不许链给画布', () => {
    for (const [css, selector] of [[CURVE_CSS, '.coc__body'], [PASTE_CSS, '.ppp__body']] as const) {
      const body = rule(css, selector);
      expect(body, selector).toMatch(/flex:\s*1\s+1\s+auto/);
      expect(body, selector).toMatch(/min-height:\s*0/);
      expect(body, selector).toMatch(/overflow-y:\s*auto/);
      expect(body, selector).toMatch(/overscroll-behavior:\s*contain/);
    }
  });

  it('内层网格同样封口（否则网格到底那一格会一路链到画布宿主）', () => {
    expect(rule(PANEL_CSS, '.ccp__grid')).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('两枚胶囊共用同一套外壳行为（高度 + 滚轮），不各写一份', () => {
    for (const file of ['src/pages/workspace/CurveOptionsCapsule.tsx', 'src/pages/workspace/PatternPastePill.tsx']) {
      const src = readStripped(file);
      expect(src, `${file} 没有接高度上限`).toMatch(/useCapsuleMaxHeight\(rootRef,\s*visible\)/);
      expect(src, `${file} 没有接滚轮封口`).toMatch(/useCapsuleWheelContainment\(rootRef,\s*visible\)/);
    }
  });

  it('滚轮监听必须是**非被动**的，且真的吞掉默认行为', () => {
    const src = readSource('src/pages/workspace/useCapsuleWheelContainment.ts');
    expect(src).toMatch(/addEventListener\('wheel',\s*onWheel,\s*\{\s*passive:\s*false\s*\}\)/);
    expect(src).toMatch(/removeEventListener\('wheel',\s*onWheel\)/);
    expect(src).toMatch(/preventDefault\(\)/);
    // 只在 root 内部找可滚容器：找到就逐级接续，找不到也要吞掉
    expect(src).toMatch(/scrollableTargetFor\(/);
  });
});
