// 片段库抽屉搜索行的排序按钮与浮层菜单（issue 192）。
//
// 交互口径：
// - 触发器：搜索行右侧方块按钮（ArrowUpDown 图标，28×28px，与搜索框等高）；
// - 浮层：复用 useAnchoredMenu（portal + fixed），8 个选项成对排列；
// - 当前选中项左侧打勾（Check 图标）。
import { createPortal } from 'react-dom';
import { ArrowUpDown, Check } from 'lucide-react';
import type { PatternSortDirection, PatternSortKey, PatternSortPreference } from '../../patterns/library';
import { t, type MessageKey } from '../../i18n';
import { useAnchoredMenu } from './useAnchoredMenu';

interface SortOption {
  key: PatternSortKey;
  direction: PatternSortDirection;
  labelKey: MessageKey;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'createdAt', direction: 'desc', labelKey: 'patternLibrary.sort.createdAtDesc' },
  { key: 'createdAt', direction: 'asc', labelKey: 'patternLibrary.sort.createdAtAsc' },
  { key: 'name', direction: 'asc', labelKey: 'patternLibrary.sort.nameAsc' },
  { key: 'name', direction: 'desc', labelKey: 'patternLibrary.sort.nameDesc' },
  { key: 'noteCount', direction: 'desc', labelKey: 'patternLibrary.sort.noteCountDesc' },
  { key: 'noteCount', direction: 'asc', labelKey: 'patternLibrary.sort.noteCountAsc' },
  { key: 'beatSpan', direction: 'desc', labelKey: 'patternLibrary.sort.beatSpanDesc' },
  { key: 'beatSpan', direction: 'asc', labelKey: 'patternLibrary.sort.beatSpanAsc' },
];

export interface PatternLibrarySortMenuProps {
  value: PatternSortPreference;
  onChange: (sort: PatternSortPreference) => void;
  disabled?: boolean;
}

export default function PatternLibrarySortMenu({
  value,
  onChange,
  disabled = false,
}: PatternLibrarySortMenuProps) {
  const { open, pos, triggerRef, hide, toggle } = useAnchoredMenu();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pld__sort-btn"
        disabled={disabled}
        aria-label={t('patternLibrary.sort')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('patternLibrary.sort')}
        onClick={toggle}
      >
        <ArrowUpDown size={13} />
      </button>

      {open && pos && createPortal(
        <>
          <span className="pld-menu__scrim" onClick={hide} />
          <div
            className="pld-menu pld-menu--sort"
            role="menu"
            aria-label={t('patternLibrary.sort')}
            style={pos}
          >
            {SORT_OPTIONS.map((opt) => {
              const isActive = value.key === opt.key && value.direction === opt.direction;
              return (
                <button
                  key={`${opt.key}-${opt.direction}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`pld-menu__item${isActive ? ' is-active' : ''}`}
                  onClick={() => {
                    hide();
                    onChange({ key: opt.key, direction: opt.direction });
                  }}
                >
                  <span className="pld-menu__item-check" aria-hidden>
                    {isActive && <Check size={12} strokeWidth={2.5} />}
                  </span>
                  <span>{t(opt.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
