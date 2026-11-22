// chart-projects 44：工程启动台渲染隔离与防裁切静态锁 ——
// 1. .pb-card 本体不得裸挂 content-visibility: auto（会裁掉 7px 选中外框与 -2px hover 抬升）；
//    必须经 .pb-card-wrap（padding: 8px; margin: -8px）预留 >=8px 溢出空间；
// 2. ProjectCard 必须使用 memo 隔离 selectedId 变化，闭合态卡片菜单不得预构造菜单项子节点。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const css = readStripped('src/pages/projects/ProjectsPage.css');
const hub = readStripped('src/pages/projects/components/ProjectHub.tsx');

describe('chart-projects 44 · 启动台滚动与渲染防回退锁', () => {
  it('content-visibility: auto 必须挂在预留 8px 溢出的 .pb-card-wrap 上，不得裸挂 .pb-card', () => {
    const wrapMatch = css.match(/\.pb-card-wrap\s*\{([^}]*)\}/);
    expect(wrapMatch).not.toBeNull();
    const wrapBody = wrapMatch![1];
    expect(wrapBody).toMatch(/padding:\s*8px/);
    expect(wrapBody).toMatch(/margin:\s*-8px/);
    expect(wrapBody).toMatch(/content-visibility:\s*auto/);

    const cardMatch = css.match(/\.pb-card\s*\{([^}]*)\}/);
    expect(cardMatch).not.toBeNull();
    expect(cardMatch![1]).not.toMatch(/content-visibility/);
  });

  it('ProjectCard 使用 memo 隔离，且卡片菜单闭合态走函数 children 延迟构造', () => {
    expect(hub).toMatch(/const ProjectCard = memo\(/);
    expect(hub).toMatch(/<Menu[\s\S]*?>\s*\{\(\)\s*=>/);
  });
});
