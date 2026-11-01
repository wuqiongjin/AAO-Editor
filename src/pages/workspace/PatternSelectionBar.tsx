// 片段库选择模式底部工具条（issue 193）。
// 提供：已选计数、全选当前结果、导出所选、删除所选、退出/取消选择。
import { memo } from 'react';
import { CheckCheck, FileDown, Trash2 } from 'lucide-react';
import { t } from '../../i18n';

export interface PatternSelectionBarProps {
  selectedCount: number;
  hiddenCount: number;
  canSelectAll: boolean;
  onSelectAll: () => void;
  onExport: () => void;
  onDelete: () => void;
  onExit: () => void;
}

export default memo(function PatternSelectionBar({
  selectedCount,
  hiddenCount,
  canSelectAll,
  onSelectAll,
  onExport,
  onDelete,
  onExit,
}: PatternSelectionBarProps) {
  return (
    <div className="pld-sel-bar" role="toolbar" aria-label={t('patternLibrary.selectedCount', { count: selectedCount })}>
      <div className="pld-sel-bar__info">
        <span className="pld-sel-bar__count">
          {t('patternLibrary.selectedCount', { count: selectedCount })}
        </span>
        {hiddenCount > 0 && (
          <span className="pld-sel-bar__hidden">
            {t('patternLibrary.hiddenSelectedCount', { count: hiddenCount })}
          </span>
        )}
      </div>

      <div className="pld-sel-bar__actions">
        <button
          type="button"
          className="pld-sel-bar__btn"
          disabled={!canSelectAll}
          onClick={onSelectAll}
        >
          <CheckCheck size={12} aria-hidden />
          {t('patternLibrary.selectAllVisible')}
        </button>

        <button
          type="button"
          className="pld-sel-bar__btn"
          disabled={selectedCount === 0}
          onClick={onExport}
        >
          <FileDown size={12} aria-hidden />
          {t('patternLibrary.exportSelected')}
        </button>

        <button
          type="button"
          className="pld-sel-bar__btn pld-sel-bar__btn--danger"
          disabled={selectedCount === 0}
          onClick={onDelete}
        >
          <Trash2 size={12} aria-hidden />
          {t('patternLibrary.deleteSelected')}
        </button>

        <button
          type="button"
          className="pld-sel-bar__btn"
          onClick={onExit}
        >
          {t('patternLibrary.cancelSelection')}
        </button>
      </div>
    </div>
  );
});
