// 画布左上角选项胶囊的展开/收起行为（issue 180 Q15 定案，issue 186 起由两枚胶囊共用）：
// 切走工具即收起且不残留上次的展开态、点外面收回、Esc 收回（并拦住 Esc，不让它继续走画布五档链）。
// 无关闭钮 —— 收回的入口就是"点外面 / Esc / 切走工具"。
import { useCallback, useEffect, useRef, useState } from 'react';

export interface CanvasCapsuleState {
  open: boolean;
  /** 胶囊本体（点它开合） */
  toggle: () => void;
  /** 收起（不回焦：点外面 / 选完之后） */
  dismiss: () => void;
  /** 整枚胶囊的根（判"点外面"用） */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** 胶囊本体（Esc 收起后把焦点还给它） */
  pillRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * @param visible 该胶囊此刻是否该出现（通常 = 某个持工具态）。false → 收起并丢弃展开态。
 */
export function useCanvasCapsule(visible: boolean): CanvasCapsuleState {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // 切走工具即消失；再切回必须先出收起的胶囊，不能残留上次的展开态
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!open || !visible) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      pillRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, visible]);

  return { open, toggle, dismiss, rootRef, pillRef };
}
