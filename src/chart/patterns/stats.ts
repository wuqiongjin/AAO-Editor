// 片段卡片的**派生统计**（issue 190）。
//
// 两个值都不进 `Pattern` 载荷、不落库、不随分享导出：渲染时按 `notes` 现算。
// 卡片与后续排序（192）都消费这一份，不在界面层各算一套。
import { countChartNotes } from '../editing/NoteEditing';
import type { ChartNote } from '../types';
import type { Pattern } from './types';

export interface PatternStats {
  /** 音符数：与画布右下读数 / combo 同一口径（`countChartNotes`） */
  noteCount: number;
  /** 拍数：片段音符包围盒的 `maxBeat − minBeat`；没有可投影音符时为 0 */
  beatSpan: number;
}

/** 统计只需要音符数组（卡片 / 排序都从完整片段里取这一项） */
type PatternNotes = Pick<Pattern, 'notes'>;

/** 音符数：直接复用画布口径，不另写第二个音符数定义。 */
export function patternNoteCount(pattern: PatternNotes): number {
  return countChartNotes(pattern.notes);
}

/** BPM / System / Opaque 不是音符，也没有可投影的拍位（issue 190 口径）。 */
function isProjectableNote(note: ChartNote): boolean {
  return note.type !== 'BPM' && note.type !== 'System' && note.type !== 'Opaque';
}

/**
 * 拍数跨度 = 片段音符包围盒的 `maxBeat − minBeat`。
 *
 * 与 `capturePattern` 同口径：按存储的 `beat` 算，不折算 `subBeat`；滑条 / 长条按
 * **全部连接点**（含 hidden，它们仍在跨度内）；BPM / System / Opaque 不参与。
 * 没有可投影音符（空片段 / 只有 BPM、System 的脏数据 / 空滑条）→ 0。
 */
export function patternBeatSpan(pattern: PatternNotes): number {
  let min = Infinity;
  let max = -Infinity;
  const addBeat = (beat: number) => {
    if (!Number.isFinite(beat)) return;
    if (beat < min) min = beat;
    if (beat > max) max = beat;
  };

  for (const note of pattern.notes) {
    if (!isProjectableNote(note)) continue;
    if (note.type === 'Slide' || note.type === 'Long') {
      for (const conn of note.connections) addBeat(conn.beat);
    } else {
      addBeat(note.beat);
    }
  }

  return max >= min ? max - min : 0;
}

const statsCache = new WeakMap<PatternNotes, PatternStats>();

/** 同时取两个派生值（卡片只遍历一次调用点；值本身仍是纯函数结果，带 WeakMap 引用级缓存）。 */
export function patternStats(pattern: PatternNotes): PatternStats {
  const cached = statsCache.get(pattern);
  if (cached) return cached;
  const result: PatternStats = {
    noteCount: patternNoteCount(pattern),
    beatSpan: patternBeatSpan(pattern),
  };
  statsCache.set(pattern, result);
  return result;
}

/**
 * 拍数显示：整数不带小数；非整数四舍五入到一位（`10.5 拍`）。
 * 舍入后恰好是整数时仍去掉无意义的 `.0`（如 10.04 → `10 拍`）。
 */
export function formatPatternBeatSpan(span: number): string {
  const rounded = Math.round(span * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
