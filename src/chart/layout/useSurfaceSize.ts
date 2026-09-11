// useSurfaceSize（候选 2 / 架构深化评审候选 2 / issue 36 / issue 38 / issue 87）：
// 渲染面尺寸（chartArea DOM 元素）→ SurfaceSize，委托纯逻辑 SurfaceSizeMerger。
// Editor 只需 (ref) => SurfaceSize 即可拿到合并后的稳定值。
//
// 该 hook 是 6 个会话流"渲染面测量"的拆出（架构深化评审候选 2），
// 行为完全保持：突发/流/尾随状态机 + 退化尺寸跳过 + 已生效值去重。
//
// issue 87 追加：**浏览器缩放**（Ctrl +/-，会改 devicePixelRatio）也必须走实时通道。
// 缩放会让侧面板的夹取宽度突然生效 → chartArea 宽度在 200ms 内连续变化；若这段回调被
// 冻结提交，画布（CSS 尺寸 = 旧 surf）会与容器脱节，出现"外弹再回弹"。
// 窗口拖拽 resize（dpr 不变）保留原节流，issue 36 的性能目标不回归。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { type SurfaceSize } from '../geometry/ChartGeometry';
import { SurfaceSizeMerger, type SurfaceSizeMergerConfig } from './SurfaceSizeMerger';
import { createZoomLiveTracker, type ZoomLiveTracker } from './zoomLiveTracker';

export interface UseSurfaceSizeOptions extends Omit<SurfaceSizeMergerConfig, 'onCommit'> {
  /** 自定义初始 surface（默认 null——ResizeObserver 尚未回调，组件不渲染） */
  initial?: SurfaceSize;
}

export function useSurfaceSize(
  ref: RefObject<HTMLElement | null>,
  options: UseSurfaceSizeOptions = {},
): SurfaceSize | null {
  const [surface, setSurface] = useState<SurfaceSize | null>(options.initial ?? null);
  // onCommit 引用稳定：避免 merger 每次 useEffect 重建 → 重复挂 RO。
  //
  // issue 87（2026-09-11 实测定位）：**必须用 flushSync 提交**。ResizeObserver 回调是在 layout 之后、
  // paint 之前触发的；若这里只做普通的异步 setState，React 要到**下一帧**才改到 canvas 的 CSS 尺寸
  // （canvas CSS 宽 = surf.w）——于是容器已按新尺寸排好、画布仍停在旧 surf：放大时旧画布**比容器宽**
  // （被裁一帧）、缩小时**比容器窄**（留黑边），随后"回弹"到位。实测（Playwright 逐帧）：
  // 1160px/1.1x 缩放瞬间 areaW=428 而 canvasCssW=548（+120px），下一帧才归零。
  // flushSync 让本次提交在该回调内同步渲染完，画布尺寸与容器在同一帧对齐（差 0px）。
  // 安全性：画布在 `position: sticky` 的离屏包裹里、不参与 chartArea 的尺寸计算 → 不会触发
  // ResizeObserver 循环告警。
  const onCommit = useRef<(v: SurfaceSize) => void>(() => {});
  onCommit.current = (v: SurfaceSize) => {
    flushSync(() => setSurface(v));
  };

  // issue 87：浏览器缩放探针（dpr 变化 → 实时窗口期）
  const zoomTrackerRef = useRef<ZoomLiveTracker | null>(null);
  if (zoomTrackerRef.current == null) zoomTrackerRef.current = createZoomLiveTracker();

  // 外部 live 探针（面板折叠/拖拽）+ 缩放窗口期 → 合并成统一的实时判定；引用恒定，merger 只构造一次
  const liveRef = useRef(options.live);
  liveRef.current = options.live;
  const liveProbeRef = useRef<(() => boolean) | null>(null);
  if (liveProbeRef.current == null) {
    liveProbeRef.current = () =>
      (liveRef.current?.() ?? false) || (zoomTrackerRef.current?.isLive() ?? false);
  }

  // merger 单例：跨渲染保持状态（lastCommitted/lastValue/lastCallbackAt/...）
  const mergerRef = useRef<SurfaceSizeMerger | null>(null);
  if (mergerRef.current == null) {
    mergerRef.current = new SurfaceSizeMerger({ ...options, live: liveProbeRef.current, onCommit: (v) => onCommit.current(v) });
  } else if (options.sparseGapMs != null || options.streamMs != null || options.trailMs != null
             || options.degenerateThreshold != null || options.now != null) {
    // 极少使用：配置变更时重建（实际只在测试中触发）
    mergerRef.current.destroy();
    mergerRef.current = new SurfaceSizeMerger({ ...options, live: liveProbeRef.current, onCommit: (v) => onCommit.current(v) });
  }

  // 记录 devicePixelRatio：只在它变化（= 浏览器缩放）时开启实时窗口期
  useEffect(() => {
    const tracker = zoomTrackerRef.current!;
    const onResize = () => tracker.observe(window.devicePixelRatio || 1);
    tracker.observe(window.devicePixelRatio || 1); // 初值（不布防）
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const merger = mergerRef.current!;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        merger.feed({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => {
      // issue 50 修复：仅断开 RO；merger 单例由 GC 在组件真卸载时回收（不主动 destroy）。
      // 原因：React 18 StrictMode dev 下 effect cleanup 会在 mount→unmount→remount 循环里被反复调用，
      // 任何 `mergerRef.current = null` / `merger.destroy()` 都会在 RO callback 异步 fire 之前把 merger
      // 置空，导致 `merger.feed()` 抛 TypeError、setSurface 永远不触发、FinalVirtualCanvas 整个不渲染。
      // merger 只持有 1 个 ResizeObserver 回调 + 几个状态字段，由 GC 回收即可。
      ro.disconnect();
    };
  }, [ref]);
  return surface;
}
