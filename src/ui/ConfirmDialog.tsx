// 确认弹窗：delete / overwrite 类「二选一」的问询。
// 自绘相对原生多出来的三件事：样式跟主题走、确认键文案与危险色可定、焦点可控
// （打开落在确认键、Tab 不越出弹窗、关掉还给原来的落点）。
//
// 只管「问一句、等一个二选一」：表单型弹窗（新建 / 编辑工程）是另一类壳，
// 两者收编成同一个 Dialog 是另一件事，这里不替它做决定。
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import ActionBtn from './ActionBtn';
import './ui.css';

export default function ConfirmDialog({
  title, message, confirmLabel, onConfirm, onCancel,
}: {
  title: string;
  /** 正文。字符串里的 \n 按换行渲染（删除工程要多带一句已上传提示）。 */
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 键盘监听只挂一次：回调走 ref 读最新的 onCancel，免得换 props 就重挂
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  // 打开它的那枚元素要在**渲染期**记下来：提交阶段确认键就会 autoFocus，
  // 等 useEffect 再读 activeElement 读到的已经是确认键了。
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null) openerRef.current = document.activeElement as HTMLElement | null;

  // 关掉后把焦点还给打开它的那枚元素：否则键盘用户被丢回 body，得重新 Tab 一遍。
  // 它可能已经不在文档里（卡片菜单关了）——那时 focus 是空操作，无副作用。
  useEffect(() => () => openerRef.current?.focus?.(), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 捕获阶段挂在 window：宿主弹窗（如谱面代码弹窗）同样在 window 捕获阶段接管 Esc
        // 且会 stopPropagation —— 事件根本走不到冒泡阶段，只能同阶段接。
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      // aria-modal 的承诺得兑现：Tab 只在弹窗内循环，不跑到背后的页面上
      if (e.key !== 'Tab') return;
      const stops = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
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
    <div className="confirm-dialog__scrim" onMouseDown={onCancel}>
      <div
        ref={panelRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="confirm-dialog__title" id={titleId}>{title}</h3>
        <p className="confirm-dialog__message" id={messageId}>{message}</p>
        <div className="confirm-dialog__actions">
          <ActionBtn onClick={onCancel}>{t('ui.cancel')}</ActionBtn>
          <ActionBtn variant="danger" autoFocus onClick={onConfirm}>{confirmLabel}</ActionBtn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
