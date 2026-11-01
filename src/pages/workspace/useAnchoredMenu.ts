// 锚定浮层的共用交互（issue 185 / 187）：⋯ 触发钮 + portal 菜单。
//
// 片段库现在有两个 ⋯（卡片动作 / 抽屉头整库动作）——定位、Esc 关闭、焦点回归
// 只留这一份，免得两处菜单的手感各自漂。
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

export interface AnchoredMenu {
  open: boolean;
  /** 相对视口的 fixed 定位（由触发钮矩形算得；没打开时为 null） */
  pos: CSSProperties | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** 关闭并回焦到触发钮（Esc 用） */
  close: () => void;
  /** 关闭但不抢焦点（点遮罩 / 点菜单项用） */
  hide: () => void;
  /** 触发器点击：算位置后打开；再点一次关闭 */
  toggle: () => void;
}

export function useAnchoredMenu(): AnchoredMenu {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const hide = useCallback(() => setOpen(false), []);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Esc 关闭：捕获阶段接，免得被画布那套全局快捷键先吃掉（同卡片菜单 / 弹窗壳口径）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    setPos({
      top: (rect?.bottom ?? 0) + 4,
      right: Math.max(8, window.innerWidth - (rect?.right ?? window.innerWidth)),
    });
    setOpen(true);
  }, [open]);

  return { open, pos, triggerRef, close, hide, toggle };
}
