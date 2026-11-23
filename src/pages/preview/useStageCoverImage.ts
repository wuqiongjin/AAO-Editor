// 作用域工程的封面 → 画布可用的图（chart-preview 84 · ADR-0018 §7）。
//
// 「AAO 舞台」这张自带背景图的相框里要填工程封面，绘制层要的是**已解码的图**
// （`CanvasImageSource`），不是 Blob、也不是 DOM 用的 objectURL：
//   - 实时舞台 / 面板 hover 大预览 走本 hook（`createImageBitmap`，与导出同一条解码路径）；
//   - 导出侧自带 `loadCoverImage`（出图只有一次机会，那边 await 到位）。
//
// **未到位就返回 null**（票 84 口径："加载完再画，未到位留空"）：换成新封面时绝不能把
// 上一份工程的封面继续留在相框里 —— 舞台的画布在 `loadSimAssets` 回来之前会一直重绘
// 手上的旧 `assets`，旧封面就会多显示整整一次素材加载的时长。宁可空一帧。
// 旧位图交给 GC，**不显式 close** —— 关掉仍被上一帧引用的位图会让 `drawImage` 抛
// `InvalidStateError`。
import { useEffect, useState } from 'react';
import { loadCoverImage } from '../../preview';

interface DecodedCover {
  blob: Blob;
  image: CanvasImageSource;
}

export function useStageCoverImage(cover: Blob | null | undefined): CanvasImageSource | null {
  const [ready, setReady] = useState<DecodedCover | null>(null);

  useEffect(() => {
    if (!cover || cover.size === 0) return;
    let cancelled = false;
    void loadCoverImage(cover).then((image) => {
      if (!cancelled && image) setReady({ blob: cover, image });
    });
    return () => { cancelled = true; };
  }, [cover]);

  // 只认"当前这份 blob 解出来的图"：换工程 / 换封面时立刻回到 null（留空相框）
  return ready && ready.blob === cover ? ready.image : null;
}
