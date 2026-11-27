// 封面卡：发布弹窗与「编辑工程信息」共用同一套外观 / 拖放 / 悬停操作。
//
// 职责只有画与取文件：保存、清除的语义由调用方决定
// （发布弹窗立即落盘；编辑工程信息先攒在本地，点保存再落）。
// `required` 只影响空态的红色危险样式：custom 曲目发布必填，工程信息里的封面可选。
import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Music2, X } from 'lucide-react';
import { t } from '../i18n';
import './ui.css';

export default function CoverCard({
  editable, hasCover, coverUrl, busy, required = false, onPick, onClear,
}: {
  editable: boolean;
  hasCover: boolean;
  coverUrl: string | null;
  busy: boolean;
  /** 必填缺失态（发布弹窗的 custom 曲目）；工程信息里不传 = 可选 */
  required?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const emptyRequired = !hasCover && editable && required;

  const openPicker = () => {
    if (!editable || busy) return;
    inputRef.current?.click();
  };

  const acceptFile = (file?: File | null) => {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) return;
    onPick(file);
  };

  const dropHandlers = editable ? {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (!busy) setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      if (!busy) acceptFile(event.dataTransfer.files?.[0]);
    },
  } : {};

  return (
    <>
      <div
        className={`cover-card${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}${emptyRequired ? ' is-required' : ''}`}
        aria-busy={busy || undefined}
        {...dropHandlers}
      >
        {hasCover && coverUrl ? (
          <>
            <img className="cover-card__img" src={coverUrl} alt={t('projects.cover')} />
            <span className="cover-card__badge">{t('projects.cover')}</span>
            {editable && (
              <>
                <span className="cover-card__shade" aria-hidden="true" />
                <span className="cover-card__tools">
                  <button type="button" className="cover-card__btn" disabled={busy} onClick={openPicker}>
                    <ImagePlus size={12} aria-hidden="true" />
                    {t('projects.coverReplace')}
                  </button>
                  <button
                    type="button"
                    className="cover-card__btn is-danger"
                    disabled={busy}
                    onClick={onClear}
                  >
                    <X size={12} aria-hidden="true" />
                    {t('projects.coverClear')}
                  </button>
                </span>
              </>
            )}
          </>
        ) : editable ? (
          <button
            type="button"
            className="cover-card__empty"
            disabled={busy}
            onClick={openPicker}
          >
            <ImagePlus size={24} aria-hidden="true" />
            <span className="cover-card__empty-title">{t('projects.publish.coverAdd')}</span>
            <span className="cover-card__empty-hint">
              {required ? t('projects.publish.coverRequired') : t('projects.coverDrop')}
            </span>
          </button>
        ) : (
          <div className="cover-card__empty is-readonly">
            <Music2 size={28} aria-hidden="true" />
            <span className="cover-card__empty-hint">{t('projects.publish.coverFromCatalog')}</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-hidden="true"
        tabIndex={-1}
        className="visually-hidden-input"
        onChange={(event) => {
          acceptFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </>
  );
}
