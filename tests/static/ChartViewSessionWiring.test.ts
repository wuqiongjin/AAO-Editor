// architecture-refactor/09（架构评审候选 4）· 谱面视口会话接线锁。
//
// 本票是纯搬迁（行为零变化，净值网 = 既有全量用例 + dom 行为锁 `tests/dom/playback/ChartViewSession.test.tsx`
// + 用户页面验收），行为测试抓不住"视口装配又搬回页面 / 会话又读起 Context / 页面又自己直写滚动 DOM /
// 第二个消费者又复制一份装配"这类回潮 —— 落点是结构事实，照 ProjectDomainLayout / PagesConvergence
// 惯例用静态源码断言看守。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

const VIEW_SESSION = 'src/playback/useChartViewSession.ts';
const editor = readStripped('src/pages/workspace/WorkspacePage.tsx');
const view = readStripped(VIEW_SESSION);

/** src/ 下全部 .ts/.tsx（相对仓库根的路径） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const HOOKS = ['useSurfaceSize', 'useChartSpace', 'useScrollModel', 'usePlaybackCoordinator'];
/** 四个 hook 的**定义**文件（它们自己不算调用点） */
const DEFINITIONS = [
  'src/chart/layout/useSurfaceSize.ts',
  'src/chart/geometry/ChartSpace.ts',
  'src/playback/useScrollModel.ts',
  'src/playback/usePlaybackCoordinator.ts',
];

function callSites(hook: string): string[] {
  return sourceFiles(join(repoRoot, 'src'))
    .filter((f) => !DEFINITIONS.includes(f))
    .filter((f) => new RegExp(`${hook}\\s*\\(`).test(readStripped(f)));
}

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

  it('四条流在全仓只有会话一处调用点（预览不得再复制一份装配）', () => {
    for (const hook of HOOKS) {
      expect(callSites(hook), `${hook} 的调用点`).toEqual([VIEW_SESSION]);
    }
  });

  it('会话是四条流与滚动 DOM 不变量的唯一宿主', () => {
    expect(view).toMatch(/useSurfaceSize\s*\(/);
    expect(view).toMatch(/useChartSpace\s*\(/);
    expect(view).toMatch(/useScrollModel\s*\(/);
    expect(view).toMatch(/usePlaybackCoordinator\s*\(/);
    // 比例位回写 + 重锚 + issue 166 的两处（首次置底、归零到 beat 0）—— 程序化写 scrollTop
    // 的每一处都必须登记回声，否则它自己引发的 scroll 事件会被当成手滚反算出错误的秒数。
    // 置底 + 比例位回写 + 同源写入 helper（重锚 / 归零共用）—— 程序化写 scrollTop 的每一处
    // 都必须登记回声，否则它自己引发的 scroll 事件会被当成手滚反算出错误的秒数（issue 166）。
    expect((view.match(/registerScrollEcho\(/g) ?? []).length).toBe(3);
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
