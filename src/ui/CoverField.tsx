// 封面上传字段：自绘上传区 + 隐藏的原生 input（后者只当取文件的通道）。
//
// 受控值 `value` 三态：
//   null   —— 沿用既有封面（预览走 `previewUrl`，由外部开好 objectURL）
//   File   —— 刚选的新图（预览由本组件自己开 objectURL）
//   'clear' —— 用户点了「清除」，保存时落 `clearCover`
//
// 不做裁剪、不做比例校验，显示统一 `object-fit: cover`。
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import { t } from '../i18n';
import './ui.css';

export type CoverValue = File | 'clear' | null;

/**
 * Blob → objectURL。空 Blob 画不出图（建出来的 URL 只会是一张破图），当「无封面」处理。
 * 工程页的封面占位、编辑弹窗的预览共用这一份实现。
 */
export function useCoverUrl(blob?: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || blob.size === 0) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export interface CoverFieldProps {
  /** 字段标题（调用方 i18n 后传入：本组件不猜文案语境） */
  label: string;
  value: CoverValue;
  /** 既有封面的预览 URL（调用方开好 objectURL）；新选的 File 由本组件自己开，两者不重复建 */
  previewUrl?: string | null;
  onChange: (next: CoverValue) => void;
}

export default function CoverField({ label, value, previewUrl = null, onChange }: CoverFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const [dragging, setDragging] = useState(false);
  const pickedUrl = useCoverUrl(value instanceof File ? value : undefined);
  // 三态自洽：'clear' 由本组件自己吃掉（调用方不必再为清除而把 previewUrl 置空）；
  // 新选的 File 用自己那份 URL 盖住既有封面。
  const preview = value === 'clear' ? null : (pickedUrl ?? previewUrl);

  const openPicker = () => inputRef.current?.click();

  // 类型仍限 image/*；拖放进来的文件没有 type 时放行（交由 accept 之外的实际解码兜底）。
  const acceptImage = (file?: File | null) => {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) return;
    onChange(file);
  };

  return (
    // role=group + aria-labelledby：让标题与上传区在程序层面是一组
    <div className="cover-field" role="group" aria-labelledby={labelId}>
      <span className="cover-field__label" id={labelId}>{label}</span>
      {preview ? (
        <div className="cover-field__preview">
          <img className="cover-field__thumb" src={preview} alt={label} />
          <span className="cover-field__actions">
            <button type="button" className="cover-field__btn" onClick={openPicker}>
              {t('projects.coverReplace')}
            </button>
            <button type="button" className="cover-field__btn is-danger" onClick={() => onChange('clear')}>
              {t('projects.coverClear')}
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={`cover-field__drop${dragging ? ' is-dragging' : ''}`}
          onClick={openPicker}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          // 指针在内部子元素之间穿行也会冒 dragleave：只在真正离开本区时收高亮
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e: DragEvent<HTMLButtonElement>) => {
            e.preventDefault();
            setDragging(false);
            acceptImage(e.dataTransfer.files?.[0]);
          }}
        >
          <span className="cover-field__icon" aria-hidden="true"><ImagePlus size={20} /></span>
          <span className="cover-field__title">{t('projects.coverPick')}</span>
          <span className="cover-field__hint">{t('projects.coverDrop')}</span>
        </button>
      )}
      {/* 无条件挂载：挂进某个分支里，另一分支的「更换」就点不到它 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-hidden="true"
        tabIndex={-1}
        className="visually-hidden-input"
        onChange={(e) => {
          acceptImage(e.target.files?.[0]);
          e.target.value = ''; // 清空才能再选同一个文件
        }}
      />
    </div>
  );
}
