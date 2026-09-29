// issue 160：全谱段先于全谱可见结点（拆掉 issue 85「整条 Slide 原子叠」）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

function renderNotesSource(src: string): string {
  const m = src.match(/export function renderNotes[\s\S]*?\nfunction renderSlideBody/);
  expect(m, 'render.ts 应存在 renderNotes，且其后为 renderSlideBody').toBeTruthy();
  return m![0];
}

describe('issue 160 · 滑条段全谱先于结点', () => {
  const src = readStripped('src/rendering/render.ts');

  it('renderNotes 内所有 renderSpanBands 出现在 renderSlideBody 之前', () => {
    const body = renderNotesSource(src);
    const band = body.indexOf('renderSpanBands');
    const nodes = body.indexOf('renderSlideBody(');
    expect(band, 'renderNotes 应直接调用 renderSpanBands（全谱段轮）').toBeGreaterThan(-1);
    expect(nodes, 'renderNotes 应在段轮之后调用 renderSlideBody（结点轮）').toBeGreaterThan(band);
    expect(body.slice(0, band)).not.toMatch(/renderSlideBody\(/);
  });

  it('renderSlideBody 不再画段（结点 + flick 挂件轮）', () => {
    const norm = src.replace(/\r\n/g, '\n');
    const m = norm.match(/function renderSlideBody[\s\S]*?\n\}\n/);
    expect(m, 'render.ts 应存在 renderSlideBody').toBeTruthy();
    expect(m![0]).not.toMatch(/renderSpanBands/);
  });
});
