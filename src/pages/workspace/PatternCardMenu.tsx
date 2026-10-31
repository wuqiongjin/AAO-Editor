// 片段卡片动作菜单（issue 185；2026-10-31 验收把"hover 才出现的两个图标"换成常驻 ⋯）。
//
// 为什么常驻：hover 才出现的入口等于"靠运气发现"，而 186 会把卡片本体变成"点击粘贴"，
// 右上角再放两个不可见热区就是误触源。⋯ 一直可见、点开才出菜单，菜单也容得下以后加项。
// 整库导入导出不走这里 —— 那是抽屉头 ⋯ 的家（187）。
//
// 浮层用 portal + fixed：抽屉列表是滚动容器，绝对定位的菜单会在底部被裁掉。
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, MoreHorizontal, Trash2 } from 'lucide-react';
import { t } from '../../i18n';

export default function PatternCardMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Esc 关闭：捕获阶段接，免得被画布那套全局快捷键先吃掉（同弹窗壳口径）
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
        onClick={() => {
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
        }}
      >
        <MoreHorizontal size={14} />
      </button>

      {open && pos && createPortal(
        <>
          <span className="pld-menu__scrim" onClick={() => setOpen(false)} />
          <div className="pld-menu" role="menu" aria-label={t('patternLibrary.actions')} style={pos}>
            {/* 动作落 187：先占位，与 183 的占位口径一致 */}
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item"
              disabled
              title={t('patternLibrary.exportSoon')}
            >
              <FileDown size={13} aria-hidden />
              {t('patternLibrary.export')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item pld-menu__item--danger"
              onClick={() => { setOpen(false); onDelete(); }}
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
