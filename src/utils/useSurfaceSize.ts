// useSurfaceSize（候选 2 / 架构深化评审候选 2 / issue 36 / issue 38）：
// 渲染面尺寸（chartArea DOM 元素）→ SurfaceSize，委托纯逻辑 SurfaceSizeMerger。
// Editor 只需 (ref) => SurfaceSize 即可拿到合并后的稳定值。
//
// 该 hook 是 6 个会话流"渲染面测量"的拆出（架构深化评审候选 2），
// 行为完全保持：突发/流/尾随状态机 + 退化尺寸跳过 + 已生效值去重。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_SURFACE, type SurfaceSize } from './ChartGeometry';
import { SurfaceSizeMerger, type SurfaceSizeMergerConfig } from './SurfaceSizeMerger';

export interface UseSurfaceSizeOptions extends Omit<SurfaceSizeMergerConfig, 'onCommit'> {
  /** 自定义初始 surface（默认 DEFAULT_SURFACE） */
  initial?: SurfaceSize;
}

export function useSurfaceSize(
  ref: RefObject<HTMLElement | null>,
  options: UseSurfaceSizeOptions = {},
): SurfaceSize {
  const [surface, setSurface] = useState<SurfaceSize>(options.initial ?? DEFAULT_SURFACE);
  // onCommit 引用稳定：避免 merger 每次 useEffect 重建 → 重复挂 RO
  const onCommit = useRef<(v: SurfaceSize) => void>(() => {});
  onCommit.current = setSurface;
  // merger 单例：跨渲染保持状态（lastCommitted/lastValue/lastCallbackAt/...）
  const mergerRef = useRef<SurfaceSizeMerger | null>(null);
  if (mergerRef.current == null) {
    mergerRef.current = new SurfaceSizeMerger({ ...options, onCommit: (v) => onCommit.current(v) });
  } else if (options.sparseGapMs != null || options.streamMs != null || options.trailMs != null
             || options.degenerateThreshold != null || options.now != null) {
    // 极少使用：配置变更时重建（实际只在测试中触发）
    mergerRef.current.destroy();
    mergerRef.current = new SurfaceSizeMerger({ ...options, onCommit: (v) => onCommit.current(v) });
  }
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
      ro.disconnect();
      merger.flush(); // 卸载时结算一次最新值
      merger.destroy();
      // 重建：下次挂载重新初始化
      mergerRef.current = null;
    };
  }, [ref]);
  return surface;
}
