// issue 160：全谱段先于全谱可见结点（拆掉 issue 85「整条 Slide 原子叠」）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

function renderNotesSource(src: string): string {
  const m = src.match(/export function renderNotes[\s\S]*?\nexport function renderNoteBands/);
  expect(m, 'render.ts 应存在 renderNotes，且其后为同源带体遍历').toBeTruthy();
  return m![0];
}

describe('issue 160 · 滑条段全谱先于结点', () => {
  const src = readStripped('src/rendering/render.ts');

  it('renderNotes 的同源带体轮在可见结点轮之前', () => {
    const body = renderNotesSource(src);
    const band = body.indexOf('renderNoteBands(');
    const nodes = body.indexOf('renderSlideBody(');
    expect(band, 'renderNotes 应调用 renderNoteBands（全谱段轮）').toBeGreaterThan(-1);
    expect(nodes, 'renderNotes 应在段轮之后调用 renderSlideBody（结点轮）').toBeGreaterThan(band);
    expect(body.slice(0, band)).not.toMatch(/renderSlideBody\(/);
    const bandBody = src.match(/export function renderNoteBands[\s\S]*?\n\}/)?.[0];
    expect(bandBody).toMatch(/visibleNotes\.forEach/);
    expect(bandBody).toMatch(/renderSpanBands\(/);
    expect(bandBody).not.toMatch(/renderSlideBody\(/);
  });

  it('renderSlideBody 不再画段（结点 + flick 挂件轮）', () => {
    const norm = src.replace(/\r\n/g, '\n');
    const m = norm.match(/function renderSlideBody[\s\S]*?\n\}\n/);
    expect(m, 'render.ts 应存在 renderSlideBody').toBeTruthy();
    expect(m![0]).not.toMatch(/renderSpanBands/);
  });
});
