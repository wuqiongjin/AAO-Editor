// 片段库抽屉头的 ⋯ 菜单（issue 187）：整库「导出片段库」/「导入片段库」。
//
// 分工写死（185 验收）：整库导入导出的家在这里；单条导出在卡片的 ⋯ 菜单。
// 浮层走 `useAnchoredMenu`（与卡片 ⋯ 同一套定位 / Esc / 回焦 —— 抽屉列表是滚动容器，必须 portal + fixed）。
import { createPortal } from 'react-dom';
import { FileDown, FileUp, MoreHorizontal } from 'lucide-react';
import { t } from '../../i18n';
import { useAnchoredMenu } from './useAnchoredMenu';

interface PatternLibraryMenuProps {
  /** 库还没载入 / 空库时不能导出（导出一份空信封没有意义） */
  canExport: boolean;
  /** 置灰原因（载入中 / 读失败 / 空库由调用方分档）；缺省按空库文案 */
  exportDisabledHint?: string;
  onExport: () => void;
  onImport: () => void;
}

export default function PatternLibraryMenu({
  canExport, exportDisabledHint, onExport, onImport,
}: PatternLibraryMenuProps) {
  const { open, pos, triggerRef, hide, toggle } = useAnchoredMenu();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pld__head-more"
        aria-label={t('patternLibrary.libraryActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('patternLibrary.libraryActions')}
        onClick={toggle}
      >
        <MoreHorizontal size={15} />
      </button>

      {open && pos && createPortal(
        <>
          <span className="pld-menu__scrim" onClick={hide} />
          <div className="pld-menu" role="menu" aria-label={t('patternLibrary.libraryActions')} style={pos}>
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item"
              disabled={!canExport}
              title={canExport ? undefined : (exportDisabledHint ?? t('patternLibrary.exportUnavailable'))}
              onClick={() => { hide(); onExport(); }}
            >
              <FileDown size={13} aria-hidden />
              {t('patternLibrary.exportLibrary')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pld-menu__item"
              onClick={() => { hide(); onImport(); }}
            >
              <FileUp size={13} aria-hidden />
              {t('patternLibrary.importLibrary')}
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
