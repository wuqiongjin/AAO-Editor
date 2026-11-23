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
    expect(playback).toMatch(/layers\.fieldBitmap = prepareSimFieldBitmap\(input, density\)/);
    expect(playback).toMatch(/drawSimFrameAt\(ctx, frame, .*layers\);/);
  });

  it('底图烘焙把场地层一起烤（含相框封面）：`prepareSimFieldBitmap` → `drawFieldLayers`', () => {
    expect(field).toMatch(/drawFieldLayers\(ctx, metrics, assets, scene\.bgBrightness\)/);
  });

  it('播放循环里没有一次性工作（同步回读 / 新建画布）', () => {
    expect(playback).not.toMatch(/getImageData/);
    expect(playback).not.toMatch(/createElement\('canvas'\)/);
  });
});
