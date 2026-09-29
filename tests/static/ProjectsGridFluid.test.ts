// issue 19 #5：启动台「全部工程」卡片流式铺满的防回潮网。
//
// 为什么是静态源码断言：轨道宽度与卡片比例是 CSS 事实，jsdom 不加载外部 CSS、
// 也没有布局引擎 —— 像素结论（末列是否贴右缘）走票内的人工门票 / Playwright 实测。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const css = readStripped('src/pages/projects/ProjectsPage.css');
// 拆解后封面档位分住两个视图文件：hub 有网格卡与 hero，detail 有头部
const hub = readStripped('src/pages/projects/components/ProjectHub.tsx');
const detail = readStripped('src/pages/projects/components/ProjectDetail.tsx');

describe('issue 19 #5 · 卡片流式铺满', () => {
  it('.pb-grid 用 minmax 流式轨道，不再是固定 172px（右侧留白的根）', () => {
    expect(css).toMatch(/\.pb-grid\s*\{[^}]*repeat\(auto-fill,\s*minmax\(172px,\s*1fr\)\)/);
    expect(css).not.toMatch(/repeat\(auto-fill,\s*172px\)/);
  });

  it('流式档靠 aspect-ratio 撑方；网格卡封面走流式档，hero / 详情仍固定尺寸', () => {
    expect(css).toMatch(/\.pp-cover--fluid\s*\{[^}]*aspect-ratio:\s*1/);
    expect(hub).toMatch(/<Cover project=\{p\} size=\{172\} fluid \/>/);
    // hero 的 120 与详情的 96 不该被顺手改成流式
    expect(hub).toMatch(/<Cover project=\{selected\} size=\{120\} \/>/);
    expect(detail).toMatch(/<Cover project=\{sel\} size=\{96\} \/>/);
  });
});
