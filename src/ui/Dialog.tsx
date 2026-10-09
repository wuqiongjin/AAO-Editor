// 通用弹窗壳（issue 16）：全站弹窗共用的一张脸 —— scrim + panel + head / body / foot 三段。
//
// 视觉定案 C（2026-09-28 用户）：头尾都是 --bg-inset 色带，**色带自己就是分界**（不再加 hairline）；
// 面板 overflow: hidden 把色带裁进圆角里 —— 不裁的话头尾的矩形底会盖掉圆角（方角 bug）。
// 尺寸三档：确认 sm 440 / 表单 md 560 / 谱面代码 lg 920×640。
//
// 行为也收在这儿：Esc 关闭、Tab 只在弹窗内循环（aria-modal 的承诺）、关掉后焦点还给打开它的元素。
// 层次（面板宽度 / 圆角 / 阴影 / 动效 / 遮罩）全在 ui.css，组件只管结构与行为。
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ui.css';

export type DialogSize = 'sm' | 'md' | 'lg';

/** Tab 的落点：按钮之外，输入框 / 链接 / 显式 tabindex 也算一站（issue 16 随壳补齐） */
const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function Dialog({
  size = 'md', role = 'dialog', raised, title, hint, head, description,
  clipBody, onClose, footer, footerAlign = 'end', children,
}: {
  size?: DialogSize;
  role?: 'dialog' | 'alertdialog';
  /** 叠在别的弹窗之上（确认弹窗开在谱面代码弹窗上）时再高一档 */
  raised?: boolean;
  /** 头部标题：一句话说清在问什么 / 在改什么 */
  title?: string;
  /** 标题下的一行说明（表单弹窗的"这一改会怎样"）；确认弹窗没有 */
  hint?: string;
  /** 头部整块自定义（谱面代码弹窗的面包屑）。给了它就不渲染 title / hint */
  head?: ReactNode;
  /** 正文注意行（确认弹窗的「注意：…」）；挂 aria-describedby，读屏念得到 */
  description?: string;
  /** 正文不自己滚（选曲台：只有目录列表滚，tab 才不会被滚动条挤偏） */
  clipBody?: boolean;
  onClose: () => void;
  /** 底栏动作区：默认靠右；工具条形态（谱面代码）用 footerAlign="start" */
  footer: ReactNode;
  footerAlign?: 'end' | 'start';
  children?: ReactNode;
}) {
  const labelId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 键盘监听只挂一次：回调走 ref 读最新的 onClose，免得换 props 就重挂
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 打开它的那枚元素要在**渲染期**记下来：提交阶段确认键就会 autoFocus，
  // 等 useEffect 再读 activeElement 读到的已经是确认键了（issue 13 的经验）。
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null) openerRef.current = document.activeElement as HTMLElement | null;

  // 关掉后把焦点还给打开它的那枚元素：否则键盘用户被丢回 body，得重新 Tab 一遍。
  // 它可能已经不在文档里（卡片菜单关了）——那时 focus 是空操作，无副作用。
  useEffect(() => () => openerRef.current?.focus?.(), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 忽略长按的自动重复（连发会连吃多档）
        if (e.repeat) return;
        // 捕获阶段挂在 window：宿主弹窗（谱面代码弹窗）同样在 window 捕获阶段接管 Esc
        // 且会 stopPropagation —— 事件根本走不到冒泡阶段，只能同阶段接。
        e.stopPropagation();
        closeRef.current();
        return;
      }
      // aria-modal 的承诺得兑现：Tab 只在弹窗内循环，不跑到背后的页面上
      if (e.key !== 'Tab') return;
      const stops = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return createPortal(
    <div className={`dialog__scrim${raised ? ' dialog__scrim--raised' : ''}`} onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={`dialog dialog--${size}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog__head" id={labelId}>
          {head ?? (
            <>
              {title && <h3 className="dialog__title">{title}</h3>}
              {hint && <p className="dialog__hint">{hint}</p>}
            </>
          )}
        </div>
        <div className={`dialog__body${clipBody ? ' dialog__body--clip' : ''}`}>
          {description && <p className="dialog__message" id={descId}>{description}</p>}
          {children}
        </div>
        <div className={`dialog__foot${footerAlign === 'start' ? ' dialog__foot--start' : ''}`}>{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
