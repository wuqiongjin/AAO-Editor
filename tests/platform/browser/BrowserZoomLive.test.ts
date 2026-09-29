// issue 87 锁测：浏览器缩放（Ctrl +/-）期间画布"向外弹一下再回来"的两个信号源。
//
// ① 纯逻辑：缩放探针 —— dpr 变化（浏览器缩放）才开实时窗口期；dpr 不变（窗口拖拽 resize）不布防。
//    `SurfaceSizeMerger` 的 live()=true 会逐帧提交（该行为已有 `SurfaceSizeMerger.test.ts` 两条锁测），
//    这里锁"什么时候该进实时通道"。
// ② 结构断言（三处"接线"，单测跑不到，照 `EditorAudioSessionRefactor.test.ts` 惯例防回归）：
//    - `useSurfaceSize` 把探针并入 merger 的 live 探针；
//    - 提交走 `flushSync`（与容器同帧 —— 实测错位帧 56 → 0）；
//    - **视口夹取走 CSS `max-width: vw`**，且 Editor 不再用 `innerWidth` 算面板宽度 ——
//      夹取若回到 JS 就会走 `.ws-panel` 的 `transition: width 200ms`，重现"面板慢慢让位 →
//      画布先抢占左右栏区域再被回弹挤回"（用户 2026-09-11 复报的症状）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createZoomLiveTracker } from '@/src/chart/layout/zoomLiveTracker';
import { repoRoot } from '@/tests/support/source';

let now = 0;
const makeTracker = (windowMs = 400) => createZoomLiveTracker({ now: () => now, windowMs });

describe('issue 87 · 浏览器缩放探针（dpr 变化 → 实时窗口期）', () => {
  it('首次 observe 只记录初值，不布防（挂载那次 resize 不该凭空开实时窗口）', () => {
    now = 0;
    const t = makeTracker();
    t.observe(2);
    expect(t.isLive()).toBe(false);
  });

  it('dpr 不变（窗口拖拽 resize）不布防 —— issue 36 的节流保留', () => {
    now = 0;
    const t = makeTracker();
    t.observe(1);
    for (let i = 0; i < 20; i++) { now += 20; t.observe(1); }
    expect(t.isLive()).toBe(false);
  });

  it('dpr 变化（浏览器缩放）→ 窗口期内逐帧实时，过期后失效', () => {
    now = 0;
    const t = makeTracker(400);
    t.observe(1);
    now = 100;
    t.observe(1.25); // 缩放：dpr 1 → 1.25
    expect(t.isLive()).toBe(true);
    now = 100 + 399;
    expect(t.isLive()).toBe(true);
    now = 100 + 401;
    expect(t.isLive()).toBe(false);
  });

  it('窗口期内重复同 dpr 不续期；再次变化才续期（连续多级缩放全程实时）', () => {
    now = 0;
    const t = makeTracker(400);
    t.observe(1);
    now = 100; t.observe(1.25);
    now = 300; t.observe(1.25); // 同 dpr：不续期
    expect(now).toBe(300);
    now = 510; // 100+400 已过期
    expect(t.isLive()).toBe(false);
    now = 520; t.observe(1.5); // 再缩放一级 → 续期
    expect(t.isLive()).toBe(true);
  });
});

describe('issue 87 · 接线结构断言（防把缩放信号拆掉）', () => {
  const root = repoRoot;
  const surfaceSrc = readFileSync(join(root, 'src/chart/layout/useSurfaceSize.ts'), 'utf-8');
  const editorSrc = readFileSync(join(root, 'src/pages/workspace/WorkspacePage.tsx'), 'utf-8');

  it('useSurfaceSize 把缩放探针并入 merger 的 live 探针', () => {
    expect(surfaceSrc).toContain('createZoomLiveTracker');
    expect(surfaceSrc).toContain('zoomTrackerRef');
    expect(surfaceSrc).toContain('live: liveProbeRef.current');
    expect(surfaceSrc).toContain("addEventListener('resize'");
  });

  it('提交走 flushSync（与容器同帧对齐，实测错位帧 56 → 0）', () => {
    expect(surfaceSrc).toContain("from 'react-dom'");
    expect(surfaceSrc).toMatch(/flushSync\(\(\)\s*=>\s*setSurface\(/);
  });

  it('视口夹取走 CSS `max-width: vw`（不在 transition 列表 → 缩放时瞬时生效，不产生"面板慢慢让位"）', () => {
    const css = readFileSync(join(root, 'src/layouts/AppShell.css'), 'utf-8');
    const left = css.match(/\.ws-panel-left\s*\{[^}]*\}/)?.[0] ?? '';
    const right = css.match(/\.ws-panel-right\s*\{[^}]*\}/)?.[0] ?? '';
    expect(left).toMatch(/max-width:\s*30vw/);
    expect(right).toMatch(/max-width:\s*24vw/);
    // 面板宽度不能被 `transition: width` 之外的机制拖慢：夹取一旦回到 JS（innerWidth 参与计算），
    // 又会走 `.ws-panel` 的 200ms width 过渡 → 画布"先抢占再回弹"复现。
    expect(editorSrc).not.toMatch(/innerWidth\s*\*\s*0\.(3|24)/);
    expect(editorSrc).not.toContain('effectiveLeftW');
    expect(editorSrc).not.toContain('effectiveRightW');
  });

  it('Editor 只注入用户宽度（夹取已交给 CSS）', () => {
    expect(editorSrc).toContain('${leftPanelWidth}px');
    expect(editorSrc).toContain('${rightPanelWidth}px');
  });
});
