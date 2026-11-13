// 片段速度跨度的显示件（issue 186 二轮）：卡片徽标与胶囊共用一份，别在两处各拼一次。
//
// 形态：`120 → 180`（`120 → -120` 表示进倒流区）；`peak === null` 时只有 `120`。
// 负值只给**那个数字**上危险色（ADR-0010 的倒流语义靠颜色表达，不再单设「倒流」徽标）。
// 不给整枚跨度和 aria-label：它总是嵌在"BPM …"或"含 BPM (…) "里，另起一句读屏文案
// 反而会盖掉父级按钮的可读名字（读屏会念成"含 BPM (速度 120 到 180)"）。
import type { PatternBpmRange } from '../../patterns/library';
import './BpmRange.css';

export type BpmRangeProps = PatternBpmRange;

/**
 * 同一份跨度的**纯文本**形态（`120 → 180` / `120`）。
 * 视觉用分段着色（负值单独上危险色），读屏与 title 用这一份，避免文案各写一遍。
 */
export function formatBpmRange(range: PatternBpmRange): string {
  return range.peak === null ? String(range.start) : `${range.start} → ${range.peak}`;
}

const valueClass = (value: number) => `bpm-range__value${value < 0 ? ' is-negative' : ''}`;

export default function BpmRange({ start, peak }: BpmRangeProps) {
  return (
    <span className="bpm-range">
      <span className={valueClass(start)}>{start}</span>
      {peak !== null && (
        <>
          {/* 空格写进文本节点：复制出去/读屏/测试拿到的都是 "120 → 180"，
              视觉间距仍由 CSS gap 给，行盒两端会把这几个空格吃掉，不会双倍 */}
          <span className="bpm-range__arrow">{' → '}</span>
          <span className={valueClass(peak)}>{peak}</span>
        </>
      )}
    </span>
  );
}
