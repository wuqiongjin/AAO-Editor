// 片段卡片动作菜单（issue 185；2026-10-31 验收把"hover 才出现的两个图标"换成常驻 ⋯）。
//
// 为什么常驻：hover 才出现的入口等于"靠运气发现"，而 186 会把卡片本体变成"点击粘贴"，
// 右上角再放两个不可见热区就是误触源。⋯ 一直可见、点开才出菜单，菜单也容得下以后加项。
// 整库导入导出不走这里 —— 那是抽屉头 ⋯ 的家（187）。
//
// 浮层用 portal + fixed：抽屉列表是滚动容器，绝对定位的菜单会在底部被裁掉。
import { createPortal } from 'react-dom';
import { FileDown, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { t } from '../../i18n';
import { useAnchoredMenu } from './useAnchoredMenu';

export default function PatternCardMenu({ isPinned, onTogglePin, onExport, onDelete }: {
  isPinned: boolean;
  onTogglePin: () => void;
  /** 导出该条（issue 187）：写文件由抽屉 / `shareFile` 负责，菜单只管触发 */
  onExport: () => void;
  onDelete: () => void;
}) {
  const { open, pos, triggerRef, hide, toggle } = useAnchoredMenu();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pld-card__more"
        aria-label={t('patternLibrary.actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('patternLibrary.actions')}
        onClick={toggle}
      >
        <MoreHorizontal size={14} />
      </button>

      {open && pos && createPortal(
        <>
          <span className="pld-menu__scrim" onClick={hide} />
          <div className="pld-menu" role="menu" aria-label={t('patternLibrary.actions')} style={pos}>
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item"
              onClick={() => { hide(); onTogglePin(); }}
            >
              {isPinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
              {isPinned ? t('patternLibrary.unpin') : t('patternLibrary.pin')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item"
              onClick={() => { hide(); onExport(); }}
            >
              <FileDown size={13} aria-hidden />
              {t('patternLibrary.export')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item pld-menu__item--danger"
              onClick={() => { hide(); onDelete(); }}
            >
              <Trash2 size={13} aria-hidden />
              {t('patternLibrary.delete')}
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
