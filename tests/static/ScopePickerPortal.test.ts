// issue 22（ADR-0015 §6）：作用域切换器的三条结构性约定。
//
// 都是"重构时会被悄悄改坏、但行为测试抓不住"的那类：
//
// 1. 浮层必须走 `createPortal`。组件住在区块头右侧 / 工具栏左簇，而 AppPageShell.Body 的直系子元素带
//    `.app-stagger` 进场动画（终止态 transform: translateY(0) + fill: both）——动画一填死，
//    每个直系子元素就成了常驻 stacking context，浮层的 z-index 被关在里面；卡片还有
//    `overflow: clip`，长列表会被直接裁掉。这条塌过一次，塌的方式是"面板不显示"，不是报错。
//
// 2. 配色一律走设计令牌（ADR-0003）。硬编码色值在暗色主题下要么读不出来、要么和周围对不上，
//    而它自己是能编译、能渲染的，只有眼看才发现。token 是否有定义由 TokenUsageWiring 管，
//    这里只管"有没有绕过 token"。
//
// 3. 面板贴哪条边跟随落点（2026-10-05 用户定案）：预览页在工具栏左簇 → 左对齐（吃默认），
//    音频页在区块头右侧 → 右对齐（显式传）。两页共用组件，改坏的方式是"把一边的口径复制给另一边"。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

const COMPONENT = 'src/ui/ScopePicker.tsx';

const stripped = readStripped(COMPONENT);

/** 硬编码色值：hex / rgb[a]() / hsl[a]() */
const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

describe('issue 22 · 作用域切换器 · 结构约定', () => {
  it('浮层走 createPortal 挂到 body 上', () => {
    expect(stripped).toMatch(/createPortal\(/);
    expect(stripped).toMatch(/,\s*document\.body,?\s*\)/);
  });

  it('组件本体不出现硬编码色值（配色全部来自 ui.css 的 token）', () => {
    const hits = stripped
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => HARDCODED_COLOR.test(line))
      .map(([n, line]) => `${COMPONENT}:${n}  ${line.trim()}`);

    expect(hits).toEqual([]);
  });

  it('样式的落点是 ui.css 的「作用域条 / 切换器」段，且该段不出现硬编码色值', () => {
    const css = readSource('src/ui/ui.css');
    const start = css.indexOf('作用域条 / 切换器');
    expect(start).toBeGreaterThan(-1);

    // 段落边界：段头注释开始 → 下一个同级段头注释之前
    const rest = css.slice(start);
    const end = rest.indexOf('/* ====', 10);
    const section = end === -1 ? rest : rest.slice(0, end);

    const hits = section
      .split('\n')
      .filter((line) => HARDCODED_COLOR.test(line))
      .map((line) => line.trim());

    expect(hits).toEqual([]);
    expect(section).toMatch(/\.scope-picker\b/);
    expect(section).toMatch(/\.scope-panel\b/);
  });

  it('面板贴边按落点分置：音频页显式右对齐，预览页不吃右对齐（默认左对齐）', () => {
    expect(readStripped('src/pages/audio/AudioPage.tsx')).toMatch(/align="right"/);
    expect(readStripped('src/pages/preview/PreviewPage.tsx')).not.toMatch(/align="right"/);
  });
});
