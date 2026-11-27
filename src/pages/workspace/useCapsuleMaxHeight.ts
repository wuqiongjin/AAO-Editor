// 画布胶囊的高度上限（票 246）：胶囊浮在画布区里，**最高只能长到「画布区可视高 − 上下留白」**。
//
// 胶囊挂在 `.ws-chart-area`（overflow: auto）内的 sticky 层里，`.ccap` 又是绝对定位、`top: 10px`，
// 所以它的包含块就是那层 sticky —— 高度正好是画布区可视高。面板一旦靠内容自然撑高，
// 短窗口下就会顶出画布区：末行落在可视区外，而当时的胶囊没有任何内部滚动可救。
//
// 做法：把上限量进 `--capsule-max-h`，由 `.ccap { max-height }` 吃掉（CSS 侧还有
// `min(60vh, 480px)` 的退路，供量不到画布区的环境使用）；多出来的高度交给面板自己滚。
import { useLayoutEffect, type RefObject } from 'react';

/** 胶囊与画布区下缘留的空隙；上缘由实测的 `top` 决定，不在这里硬编码 */
export const CAPSULE_BOTTOM_GAP = 10;

/** 再怎么挤也留一条可用高度：顶栏 30px + 至少一行配置，不至于只剩个标题条 */
export const CAPSULE_MIN_HEIGHT = 96;

/** 画布区可视高 → 胶囊可用的最大高度（扣掉上缘偏移与下缘留白，且不低于最小可用高度） */
export function capsuleMaxHeight(hostHeight: number, topGap: number): number {
  // 量不到画布区（尚未挂载 / ResizeObserver 还没回调）时退到最小可用高，别把 NaN 写进 CSS
  if (!Number.isFinite(hostHeight) || hostHeight <= 0) return CAPSULE_MIN_HEIGHT;
  return Math.max(
    CAPSULE_MIN_HEIGHT,
    Math.round(hostHeight - Math.max(0, topGap) - CAPSULE_BOTTOM_GAP),
  );
}

/**
 * @param rootRef 胶囊根（`.ccap`）
 * @param visible 胶囊此刻是否在场：不在场时根节点还没挂上，量也量不到
 */
export function useCapsuleMaxHeight(
  rootRef: RefObject<HTMLDivElement | null>,
  visible: boolean,
): void {
  useLayoutEffect(() => {
    if (!visible) return;
    const el = rootRef.current;
    // offsetParent = 画布区的 sticky 层，它的高度就是画布区可视高
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;

    const apply = () => {
      const hostRect = host.getBoundingClientRect();
      // 上缘偏移取**声明值**而非实测 rect：入场动画 `ccap-pop` 带 translateY(-4px)，
      // 首帧量 rect 会少 4px，上限就多给 4px，面板正好贴到画布区底边。
      const declaredTop = Number.parseFloat(getComputedStyle(el).top);
      const topGap = Number.isFinite(declaredTop)
        ? declaredTop
        : el.getBoundingClientRect().top - hostRect.top;
      el.style.setProperty('--capsule-max-h', `${capsuleMaxHeight(hostRect.height, topGap)}px`);
    };
    apply();
    // 窗口缩放、拖侧栏都会改画布区高度；没有 ResizeObserver 的环境（jsdom）只留初次结果
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [rootRef, visible]);
}
