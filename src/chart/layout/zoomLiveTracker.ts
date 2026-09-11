// 浏览器缩放探针（issue 87，纯逻辑、可单测）。
//
// 背景：浏览器缩放（Ctrl +/-）会改 `window.devicePixelRatio`，窗口**拖拽** resize 不会 ——
// 这是两者唯一可靠的区分信号。缩放期间侧面板的夹取宽度可能突然生效（面板变窄）、
// chartArea 宽度随之在 200ms 内连续变化；若这串回调被 `SurfaceSizeMerger` 判为"流"后**冻结提交**，
// 容器已变而画布仍停在旧 `surf`（canvas CSS 尺寸 = surf）→ 出现"向外弹一下再回来"。
// 故缩放期间把测量送进实时通道（逐帧提交），窗口拖拽 resize 保留 issue 36 的节流。
export interface ZoomLiveTracker {
  /** 每次 window resize 喂入当前 devicePixelRatio；与上次不同即视为"浏览器缩放"，开启实时窗口期 */
  observe(dpr: number): void;
  /** 是否处于"缩放实时"窗口期 */
  isLive(): boolean;
}

export interface ZoomLiveTrackerOptions {
  /** 时间源（默认 performance.now，可注入以单测） */
  now?: () => number;
  /** dpr 变化后的实时窗口时长（ms）；覆盖面板 200ms 宽度过渡 + 尾随结算余量 */
  windowMs?: number;
}

export function createZoomLiveTracker(options: ZoomLiveTrackerOptions = {}): ZoomLiveTracker {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const windowMs = options.windowMs ?? 400;
  let lastDpr = 0;
  let liveUntil = 0;

  return {
    observe(dpr: number) {
      // 首次 observe 只记录初值：挂载那一次 resize 不该凭空开一个实时窗口
      if (lastDpr !== 0 && Math.abs(dpr - lastDpr) > 1e-6) {
        liveUntil = now() + windowMs;
      }
      lastDpr = dpr;
    },
    isLive() {
      return now() < liveUntil;
    },
  };
}
