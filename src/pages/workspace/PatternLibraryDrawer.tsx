// 片段库抽屉外壳（issue 177 Q1 / Q8 / Q14，票 180）：展开占布局（不压画布）、左缘可拖宽、收起完全消失。
// 片段内容（收藏 / 缩略图 / 拖回谱面）归 issue 164，这里只有标题、空状态与「收藏选区」占位。
import { memo, useEffect, useRef, useState } from 'react';
import { BookmarkPlus, LibraryBig, X } from 'lucide-react';
import { useConfig } from '../../app/ProviderTree';
import { PATTERN_DRAWER_WIDTH } from '../../chart/config/AppSettings';
import { t } from '../../i18n';
import './PatternLibraryDrawer.css';

interface PatternLibraryDrawerProps {
  /** 拖宽开始 / 结束：页面据此暂停画布实时重绘（与旧面板拖拽同口径） */
  onResizingChange?: (resizing: boolean) => void;
}

export default memo(function PatternLibraryDrawer({ onResizingChange }: PatternLibraryDrawerProps) {
  const { settings, setPatternDrawer } = useConfig();
  const storedWidth = settings.layout.patternDrawer.width;
  // 拖动中只改本地宽度，松手才写设置：每帧写 localStorage + 广播设置变更不划算
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = dragWidth ?? storedWidth;

  const resizing = dragWidth !== null;
  const onResizingChangeRef = useRef(onResizingChange);
  onResizingChangeRef.current = onResizingChange;
  useEffect(() => {
    if (!resizing) return;
    onResizingChangeRef.current?.(true);
    const widthAt = (clientX: number) => {
      const drag = dragRef.current!;
      return Math.max(PATTERN_DRAWER_WIDTH.min, Math.round(drag.startWidth + drag.startX - clientX));
    };
    let latest = dragRef.current!.startWidth;
    const onMove = (e: MouseEvent) => {
      latest = widthAt(e.clientX);
      setDragWidth(latest);
    };
    const onUp = () => {
      // CSS `max-width: 32vw` 只夹显示宽度；落盘也按当下视口夹一次，免得存下一个看不见的宽度
      setPatternDrawer({ width: Math.min(latest, Math.max(PATTERN_DRAWER_WIDTH.min, Math.round(window.innerWidth * 0.32))) });
      dragRef.current = null;
      setDragWidth(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onResizingChangeRef.current?.(false);
    };
  }, [resizing, setPatternDrawer]);

  return (
    <aside className="pld ws-island" aria-label={t('patternLibrary.title')} style={{ width }}>
      <div
        className={`pld__resizer${resizing ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('patternLibrary.resize')}
        onMouseDown={(e) => {
          e.preventDefault();
          dragRef.current = { startX: e.clientX, startWidth: width };
          setDragWidth(width);
        }}
      />
      <header className="pld__head">
        <span className="pld__title">{t('patternLibrary.title')}</span>
        <button
          type="button"
          className="pld__close"
          onClick={() => setPatternDrawer({ open: false })}
          aria-label={t('patternLibrary.close')}
          title={t('patternLibrary.close')}
        >
          <X size={15} />
        </button>
      </header>
      <div className="pld__empty">
        <LibraryBig size={28} aria-hidden />
        <b>{t('patternLibrary.emptyTitle')}</b>
        <span>{t('patternLibrary.emptyHint')}</span>
      </div>
      <footer className="pld__foot">
        <button type="button" className="pld__save" disabled title={t('patternLibrary.saveSoon')}>
          <BookmarkPlus size={15} aria-hidden />
          {t('patternLibrary.save')}
        </button>
      </footer>
    </aside>
  );
});
