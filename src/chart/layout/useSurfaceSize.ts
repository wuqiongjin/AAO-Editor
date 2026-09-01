// useSurfaceSize（候选 2 / 架构深化评审候选 2 / issue 36 / issue 38）：
// 渲染面尺寸（chartArea DOM 元素）→ SurfaceSize，委托纯逻辑 SurfaceSizeMerger。
// Editor 只需 (ref) => SurfaceSize 即可拿到合并后的稳定值。
//
// 该 hook 是 6 个会话流"渲染面测量"的拆出（架构深化评审候选 2），
// 行为完全保持：突发/流/尾随状态机 + 退化尺寸跳过 + 已生效值去重。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_SURFACE, type SurfaceSize } from '../geometry/ChartGeometry';
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
    // merger 必须在当前 effect 内保证有效（StrictMode 第二次挂载时 render 还没跑，
    // mergerRef.current 可能已被上轮 cleanup 置 null）；这里本地 lazy 创建。
    let merger = mergerRef.current;
    if (!merger || (merger as unknown as { destroyed?: boolean }).destroyed) {
      merger = new SurfaceSizeMerger({ ...options, onCommit: (v) => onCommit.current(v) });
      mergerRef.current = merger as SurfaceSizeMerger;
    }
    // 标记 merger 在当前 effect 周期内有效；cleanup 后回调若仍触发，则直接忽略
    // 修复：之前 cleanup 中 ro.disconnect() 后 merger.destroy()，但 RO 回调可能已入队
    // 在 disconnect 之后才执行 → 访问 null merger.feed 抛 TypeError。
    let alive = true;
    const ro = new ResizeObserver((entries) => {
      if (!alive) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        merger.feed({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
      merger.flush(); // 卸载时结算一次最新值
      merger.destroy();
      // 不再 mergerRef.current = null；下次 useEffect 内会自动 lazy 重建。
      // StrictMode 双挂载场景：第一次 cleanup destroy 旧 merger，第二次 mount 时
      // mergerRef.current 仍指向已 destroy 的对象，本函数开头判 destroyed 会替换。
    };
  }, [ref]);
  return surface;
}
