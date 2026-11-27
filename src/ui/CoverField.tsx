// 受控封面字段：给「编辑工程信息」这类**攒到保存才落盘**的表单用。
//
// 视觉 / 拖放 / 更换 / 清除全部复用 CoverCard，与发布弹窗同一套外观；
// 本组件只负责三态适配：
//   null   —— 沿用既有封面（预览走 previewUrl）
//   File   —— 刚选的新图（预览用 useEphemeralCoverUrl 自己开）
//   'clear'—— 用户点了「清除」，保存时落 clearCover
import CoverCard from './CoverCard';
import { useEphemeralCoverUrl } from './coverUrl';

export type CoverValue = File | 'clear' | null;

export interface CoverFieldProps {
  /** 可访问名（读屏念「封面」）；视觉标签由封面卡自身的 badge / 空态承担 */
  label: string;
  value: CoverValue;
  /** 既有封面的预览 URL（调用方开好 objectURL）；新选的 File 由本组件自己开 */
  previewUrl?: string | null;
  onChange: (next: CoverValue) => void;
}

export default function CoverField({ label, value, previewUrl = null, onChange }: CoverFieldProps) {
  const pickedUrl = useEphemeralCoverUrl(value instanceof File ? value : undefined);
  // 三态自洽：'clear' 由本组件自己吃掉（调用方不必再为清除而把 previewUrl 置空）；
  // 新选的 File 用自己那份 URL 盖住既有封面。
  const preview = value === 'clear' ? null : (pickedUrl ?? previewUrl);

  return (
    <div className="cover-field" role="group" aria-label={label}>
      <CoverCard
        editable
        hasCover={!!preview}
        coverUrl={preview}
        busy={false}
        required={false}
        onPick={onChange}
        onClear={() => onChange('clear')}
      />
    </div>
  );
}
