import { useEffect, useRef, type RefObject } from 'react';

/**
 * 票 87：用捕获阶段的 pointerdown 关浮层，不再铺全视口 `.pp-menu__scrim`。
 * 全视口层会把正在播的 canvas 抬进新合成层，播放中打开设置 / 切谱会顿一下。
 */
export function useDismissOnOutside(
  enabled: boolean,
  onDismiss: () => void,
  ignore: ReadonlyArray<RefObject<Element | null>>,
): void {
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      for (const ref of ignoreRef.current) {
        if (ref.current?.contains(target)) return;
      }
      dismissRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [enabled]);
}
