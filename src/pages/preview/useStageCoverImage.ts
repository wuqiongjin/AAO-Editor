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
//
// `pending` 是给实时舞台的**取素材门禁**（票 84 + issue 80）：封面还在解码时先别取场地素材，
// 否则会按"空相框"取一遍、解码完再取第二遍 —— 两遍解码 + `assets` 两次换身份，第二遍还会把
// 播放器（连同 BGM 解码）一起重建。
import { useEffect, useState } from 'react';
import { loadCoverImage } from '../../preview';

interface DecodedCover {
  blob: Blob;
  /** 解码失败 = null（照样算"落定"，否则 pending 永远为 true、舞台永远不取素材） */
  image: CanvasImageSource | null;
}

export interface StageCoverImage {
  /** 已解码的封面（null = 工程没有封面 / 解码失败 → 相框留空） */
  image: CanvasImageSource | null;
  /** 当前 blob 的解码还没落定（true 时舞台要等它，别按"空相框"去取素材） */
  pending: boolean;
}

export function useStageCoverImage(cover: Blob | null | undefined): StageCoverImage {
  const [ready, setReady] = useState<DecodedCover | null>(null);

  useEffect(() => {
    if (!cover || cover.size === 0) return;
    let cancelled = false;
    void loadCoverImage(cover).then((image) => {
      if (!cancelled) setReady({ blob: cover, image });
    });
    return () => { cancelled = true; };
  }, [cover]);

  // 只认"当前这份 blob 解出来的图"：换工程 / 换封面时立刻回到 null（留空相框）
  const hasCover = !!cover && cover.size > 0;
  return {
    image: ready && ready.blob === cover ? ready.image : null,
    pending: hasCover && ready?.blob !== cover,
  };
}
