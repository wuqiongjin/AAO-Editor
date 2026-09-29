// architecture-refactor/09（架构评审候选 4）· 谱面视口会话接线锁。
//
// 本票是纯搬迁（行为零变化，净值网 = 既有全量用例 + 用户页面验收），行为测试抓不住
// "视口装配又搬回页面 / 会话又读起 Context / 页面又自己直写滚动 DOM" 这类回潮 ——
// 落点是结构事实，照 ProjectDomainLayout / PagesConvergence 惯例用静态源码断言看守。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const editor = readStripped('src/pages/workspace/WorkspacePage.tsx');
const view = readStripped('src/playback/useChartViewSession.ts');

describe('architecture-refactor 09 · 谱面视口会话的落点与接线', () => {
  it('页面不再自己装配四条流（渲染面 / 几何 / 滚动 / 播放）', () => {
    expect(editor).not.toMatch(/useSurfaceSize|useChartSpace|useScrollModel|usePlaybackCoordinator/);
    expect(editor).toMatch(/useChartViewSession\s*\(/);
  });

  it('页面不再直写滚动 DOM 不变量（回声登记 / 比例位回写 / 重锚消费）', () => {
    expect(editor).not.toMatch(/registerScrollEcho|isProgrammaticScrollEcho|programmaticScrollTopRef/);
    expect(editor).not.toMatch(/consumePendingReAnchor|takePendingReAnchor|markInitialized/);
    expect(editor).not.toMatch(/querySelector\(['"]\.virtual-content/);
    expect(editor).not.toMatch(/handleScrollbarChange|handleVirtualScrollChange/);
  });

  it('页面把会话输出接进 JSX（滚动条 onScroll / 画布 onScrollChange / 虚拟高度）', () => {
    expect(editor).toMatch(/onScroll=\{viewSession\.onScrollbarScroll\}/);
    expect(editor).toMatch(/onScrollChange=\{viewSession\.onCanvasScrollChange\}/);
    // .virtual-content 的高度仍由会话的 virtualHeight 驱动（页面只渲染）
    expect(editor).toMatch(/className="virtual-content"[\s\S]{0,160}height: virtualHeight/);
  });

  it('会话是四条流与滚动 DOM 不变量的唯一宿主', () => {
    expect(view).toMatch(/useSurfaceSize\s*\(/);
    expect(view).toMatch(/useChartSpace\s*\(/);
    expect(view).toMatch(/useScrollModel\s*\(/);
    expect(view).toMatch(/usePlaybackCoordinator\s*\(/);
    expect(view).toMatch(/registerScrollEcho\(/);
    expect((view.match(/registerScrollEcho\(/g) ?? []).length).toBe(2); // 比例位回写 + 重锚
    expect(view).toMatch(/querySelector\(['"]\.virtual-content/);
    expect(view).toMatch(/markInitialized\s*\(/);
    expect(view).toMatch(/consumePendingReAnchor\(/);
  });

  it('会话按既有次序组装：几何 → 滚动 → 播放', () => {
    const order = ['useChartSpace(', 'useScrollModel(', 'usePlaybackCoordinator(']
      .map((needle) => view.indexOf(needle));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('会话不读 Context、不 import pages / preview（两个消费者共用同一 interface 的前提）', () => {
    expect(view).not.toMatch(/ProviderTree/);
    expect(view).not.toMatch(/pages\//);
    expect(view).not.toMatch(/preview/);
  });
});
