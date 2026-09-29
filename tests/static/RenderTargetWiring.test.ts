// 08 票（架构评审候选 3）：帧构建者与缓存有主的**接线事实**锁。
//
// 本票产出的是结构约定（工作台画布经 RenderTarget 出帧、两层缓存不得再长出模块级可变单例、
// dpr / 尺寸解析只有一处、renderChart 不再被组件直调）——行为侧由
// tests/unit/rendering/cache/TargetIsolation.test.ts、tests/unit/rendering/FrameBuilder.test.ts
// 与既有 cache / perf 套件看守；这里只钉住「没人再手搓一份」。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

/** dir 下全部源码文件（相对仓库根的路径） */
function sourceFiles(dir: string, re = /\.(ts|tsx)$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs, re));
    } else if (re.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const srcFiles = sourceFiles(join(repoRoot, 'src'));

describe('08 · 帧构建者与缓存有主的接线', () => {
  it('工作台画布经 RenderTarget 出帧（不再直调 renderChart、不再内联 dpr 策略）', () => {
    const canvas = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');
    expect(canvas).toContain('createRenderTarget(');
    expect(canvas).toContain('renderFrame(view)');
    expect(canvas).toContain('resolveCanvasDpr(');
    expect(canvas).not.toMatch(/renderChart\s*\(/);
    expect(canvas).not.toContain('devicePixelRatio');
    // 渲染域的绘制面从统一出口取，不再深路径 import 缓存模块
    expect(canvas).not.toContain('rendering/pipeline/');
  });

  it('两层缓存是实例：模块顶层不再有可变单例，创建入口是工厂函数', () => {
    const staticSrc = readStripped('src/rendering/pipeline/staticLayerCache.ts');
    expect(staticSrc).toContain('export function createStaticLayerCache(');
    // 模块顶层（列 0）不得再声明状态；工厂内的状态是缩进的
    expect(staticSrc).not.toMatch(/^let (screenCanvas|stripCanvas|screenBasis|stripMeta|createStaticCanvas)/m);
    expect(staticSrc).not.toMatch(/^(const|let) (screenCanvas|stripCanvas)/m);

    const noteSrc = readStripped('src/rendering/pipeline/noteLayerCache.ts');
    expect(noteSrc).toContain('export function createNoteLayerCache(');
    expect(noteSrc).not.toMatch(/^const tiles = new Map/m);
    expect(noteSrc).not.toMatch(/^let (basis|createTileCanvas|lastNoteLayerStats|playTileSnap|playTileTimer)/m);
    expect(noteSrc).not.toMatch(/^const playTileQueue/m);
  });

  it('renderChart 只经 target 取画布与缓存；缓冲尺寸走 rasterScale 唯一处', () => {
    const render = readStripped('src/rendering/render.ts');
    expect(render).toContain('export function frameFor(target: RenderTarget, view: FrameView): RenderCtx');
    expect(render).toContain('export function renderChart(target: RenderTarget, view: FrameView)');
    expect(render).toContain('target.context()');
    expect(render).toContain('target.staticLayer.draw(');
    expect(render).toContain('target.noteLayer.draw(');
    expect(render).toContain('bufferSizeFor(');
    // 旧的模块级绘制入口不得回归
    expect(render).not.toMatch(/drawStaticLayer\s*\(/);
    expect(render).not.toMatch(/drawNotesLayer\s*\(/);
  });

  it('dpr 策略与缓冲尺寸只在 rasterScale 定义（渲染域其余文件不得内联同一策略）', () => {
    const scaleSrc = readStripped('src/rendering/rasterScale.ts');
    expect(scaleSrc).toContain('export function resolveCanvasDpr(');
    expect(scaleSrc).toContain('export function bufferSizeFor(');
    const offenders = srcFiles
      .filter((f) => f !== 'src/rendering/rasterScale.ts')
      .filter((f) => readStripped(f).includes("imageQuality === 'smooth' ? 1"));
    expect(offenders).toEqual([]);
  });

  it('renderChart 的调用方只有渲染域自己（帧构建者 + 渲染域出口）', () => {
    const OWNERS = ['src/rendering/render.ts', 'src/rendering/RenderTarget.ts', 'src/rendering/index.ts'];
    const offenders = srcFiles
      .filter((f) => !OWNERS.includes(f))
      .filter((f) => /renderChart\s*\(/.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });
});
