// 画布胶囊的滚轮封口（票 246）：**胶囊里的滚轮只滚胶囊，滚到端点也不落到画布上**。
//
// 画布的滚轮处理挂在 canvas 元素上（缩放 / 加速 / Shift 归一到纵向），胶囊上的 wheel 到不了它；
// 浏览器于是按默认规则交给最近的滚动祖先 —— 也就是 `.ws-chart-area`。于是面板滚到底之后继续滚，
// 画布跟着跑，面板上没有一处「安全区」。
//
// 做法：在胶囊根上挂**非被动** wheel（React 的 onWheel 在根容器上是被动的，preventDefault 无效），
// 自己接管这段滚动：按「指针所在链」由内向外找第一个还能滚的容器（网格 → 面板），滚它；
// 一个都没有时只吞掉默认行为。CSS 侧的 `overscroll-behavior: contain` 是第二道防线 ——
// 管的是触控等不走 wheel 的路径。
import { useEffect, type RefObject } from 'react';
import { wheelDeltaPx } from '../../chart/components/canvas/wheelScroll';

function isScrollableY(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function canScrollFurther(el: HTMLElement, delta: number): boolean {
  return delta > 0
    ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
    : el.scrollTop > 1;
}

/** 最近的 HTML 祖先：wheel 的 target 可能是 `<svg>` / `<path>`（模板与缓动缩略图就画在按钮里） */
function nearestHtmlAncestor(target: Element | null): HTMLElement | null {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

/**
 * 指针所在链上第一个「还能往 delta 方向滚」的容器 —— 只在 `root` 内部找（不进画布）。
 *
 * 找到就滚它，让内层滚完由外层接续；找不到说明胶囊里已经没得滚，
 * 调用方必须把 wheel 吞掉，否则会落到画布宿主上。
 */
export function scrollableTargetFor(
  target: Element | null,
  root: HTMLElement,
  delta: number,
): HTMLElement | null {
  // 起点不能直接判 `instanceof HTMLElement`：命中缩略图时 target 是 SVG 元素，判不过就整条链
  // 都走不到，表现为「指针压在卡片图上滚不动、移到卡片文字上又能滚」。
  for (let el = nearestHtmlAncestor(target); el && el !== root; el = el.parentElement) {
    if (isScrollableY(el) && canScrollFurther(el, delta)) return el;
  }
  return null;
}

/**
 * @param rootRef 胶囊根（`.ccap`）
 * @param visible 胶囊此刻是否在场：不在场时根节点还没挂上，监听也无处可挂
 */
export function useCapsuleWheelContainment(
  rootRef: RefObject<HTMLDivElement | null>,
  visible: boolean,
): void {
  useEffect(() => {
    if (!visible) return;
    const el = rootRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Ctrl+滚轮是缩放（画布那套），不归这里管
      if (e.ctrlKey) return;
      // 与画布同口径：Shift+滚轮在 Windows 上只给 deltaX，取较大的那个当纵向滚动量
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const delta = wheelDeltaPx(raw, e.deltaMode, el.clientHeight || 1);
      if (delta === 0) return;
      // 不论胶囊里滚没滚动，都不许默认行为把事件交给画布宿主
      e.preventDefault();
      const target = scrollableTargetFor(e.target as Element | null, el, delta);
      if (target) target.scrollTop += delta;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rootRef, visible]);
}
