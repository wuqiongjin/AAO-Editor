// issue 80 × 票 84：动态预览的**结构护栏**。
//
// 这里不测帧率（node 没有 GPU，也没有呈现时间），只锁几条"一改坏就掉帧"的接线事实：
//   ① 场地层（背景 / 相框封面 / 场地图 / 判定线）预烘成一张底图，播放期只 drawImage 一次；
//   ② 播放循环里不做一次性工作（不回读像素、不新建画布）；
//   ③ 播放器只按「音频身份 / 就绪门禁 / GPU 渲染器」重建（素材换代走 setFrame）。
//
// 页面的那两条（`coverPending` 门禁、播放器依赖）在 `PreviewPageWiring.test.ts` 的
// 「84 · 相框封面不吃 issue 80 的冷路径」里；真机帧率 / 首播停顿仍以 issue 80 的 PresentMon 探针为准。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('issue 80 · 实时预览性能护栏', () => {
  const playback = readStripped('src/preview/video/sim/simPlayback.ts');
  const field = readStripped('src/preview/video/sim/simField.ts');

  it('场地层走底图：备底图 + 渲染时把 `layers` 交给 `drawSimFrameAt`', () => {
    expect(playback).toMatch(/prepareSimFieldBitmap\(input, density\)/);
    expect(playback).toMatch(/layers\.fieldBitmap = /);
    expect(playback).toMatch(/drawSimFrameAt\(ctx, frame, .*layers\);/);
  });

  it('票 87 / 票 88：尺寸变化不按 metrics 对象身份同步烘底图，让出主线程后再换与回缩', () => {
    expect(playback).not.toMatch(/frame\.metrics !== input\.metrics/);
    expect(playback).toMatch(/yieldPlaybackFrame/);
    expect(playback).toMatch(/setTimeout\(resolve, 16\)/);
    expect(playback).toMatch(/queueSizeBake/);
    expect(playback).toMatch(/scheduleBackingShrink/);
    expect(field).toMatch(/COMBO_SHADOW_CACHE_LIMIT/);
    expect(field).toMatch(/LIFE_GAUGE_CACHE_LIMIT/);
  });

  it('票 88：WebGL VBO 复用 bufferSubData、CanvasSpriteIcon 隔离 smoothing、PlayBar 布局隔离', () => {
    const gpu = readStripped('src/preview/video/sim/simBandGpu.ts');
    const sprite = readStripped('src/ui/CanvasSpriteIcon.tsx');
    const playbarCss = readStripped('src/playback/PlayBar.css');
    expect(gpu).toMatch(/bufferSubData/);
    expect(gpu).not.toMatch(/gl\.bufferData\(gl\.ARRAY_BUFFER,\s*scratch\.data/);
    expect(sprite).toMatch(/ctx\.imageSmoothingQuality\s*=\s*prevQuality/);
    expect(playbarCss).toMatch(/contain:\s*layout\s+style/);
    expect(playbarCss).not.toMatch(/\.play-bar\s*\{[^}]*contain:[^}]*paint/);
  });

  it('票 87：预览设置浮层不再铺全视口 scrim', () => {
    const panel = readStripped('src/pages/preview/PreviewDisplayPanel.tsx');
    const switcher = readStripped('src/pages/workspace/ChartSwitcher.tsx');
    expect(panel).not.toMatch(/pp-menu__scrim/);
    expect(switcher).not.toMatch(/pp-menu__scrim/);
    expect(panel).toMatch(/useDismissOnOutside/);
    expect(switcher).toMatch(/useDismissOnOutside/);
  });

  it('底图烘焙把场地层一起烤（含相框封面）：`prepareSimFieldBitmap` → `drawFieldLayers`', () => {
    expect(field).toMatch(/drawFieldLayers\(ctx, metrics, assets, scene\.bgBrightness\)/);
  });

  it('播放循环里没有一次性工作（同步回读 / 新建画布）', () => {
    expect(playback).not.toMatch(/getImageData/);
    expect(playback).not.toMatch(/createElement\('canvas'\)/);
  });
});
