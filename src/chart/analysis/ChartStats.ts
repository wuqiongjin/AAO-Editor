/**
 * 发布弹窗「谱面概览」用的谱面统计（票 61）。
 *
 * 只读**发帖载荷**（`ChartCodeNote[]`）：它是站点真正收到的形态，System / 未知 type 本来就不计，
 * 不必再和内部画的音符对一遍。音符数仍由调用方用 `countChartNotes` 给（编辑器的唯一口径），
 * 本模块只补两件从时间轴来的事实：
 *   - `playableSeconds` = 首击到末击的秒数（不含前后静音；用于平均 NPS 的分母）
 *   - `bpmRange` = BPM 绝对值 min–max 文本（与导出头带同一份 `bpmRangeText`）
 *
 * NPS 本身不在这里算：分子（音符数）是 `countChartNotes` 的口径，留在调用方一处，
 * 避免本模块再造第二份「什么算一个音符」。
 */
import type { ChartCodeNote } from '../editing/ChartConverter';
import { beatSecondsAt, DEFAULT_BPM, type BpmEvent } from '../../audio/AudioTiming';
import { bpmRangeText } from './BpmRange';

export interface ChartCodeStats {
  /** 首击到末击的秒数；0 = 可击打点不足两个或跨度非正 */
  playableSeconds: number;
  /** BPM 区间文本；没有有效 BPM 时回落默认 120 的读数 */
  bpmRange: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function noteType(note: ChartCodeNote): string | null {
  if (!isRecord(note)) return null;
  return typeof note.type === 'string' ? note.type : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 从发帖载荷抽 BPM 事件；首条不在 beat 0 时补默认 120（与编辑器 / 导出头带同口径） */
function bpmEventsOf(chartCode: readonly ChartCodeNote[]): BpmEvent[] {
  const events: BpmEvent[] = [];
  for (const note of chartCode) {
    if (noteType(note) !== 'BPM' || !isRecord(note)) continue;
    const beat = finiteNumber(note.beat);
    const bpm = finiteNumber(note.bpm);
    if (beat == null || bpm == null || bpm === 0) continue;
    events.push({ beat, bpm });
  }
  events.sort((a, b) => a.beat - b.beat);
  if (events.length === 0 || events[0].beat > 0) {
    events.unshift({ beat: 0, bpm: DEFAULT_BPM });
  }
  return events;
}

/** 发帖载荷里的可击打点 beat：单键 / 方向键各自一个，滑条 / 长条按非 hidden 结点计 */
function hittableBeats(chartCode: readonly ChartCodeNote[]): number[] {
  const beats: number[] = [];
  for (const note of chartCode) {
    if (!isRecord(note)) continue;
    const type = noteType(note);
    if (type === 'Single' || type === 'Directional') {
      const beat = finiteNumber(note.beat);
      if (beat != null) beats.push(beat);
      continue;
    }
    if (type !== 'Slide' && type !== 'Long') continue;
    if (!Array.isArray(note.connections)) continue;
    for (const connection of note.connections) {
      if (!isRecord(connection) || connection.hidden === true) continue;
      const beat = finiteNumber(connection.beat);
      if (beat != null) beats.push(beat);
    }
  }
  return beats;
}

export function computeChartCodeStats(chartCode: readonly ChartCodeNote[]): ChartCodeStats {
  const bpmEvents = bpmEventsOf(chartCode);
  const at = beatSecondsAt(bpmEvents);
  const times = hittableBeats(chartCode).map(at);
  let playableSeconds = 0;
  if (times.length >= 2) {
    const min = Math.min(...times);
    const max = Math.max(...times);
    if (max > min) playableSeconds = max - min;
  }
  return {
    playableSeconds,
    bpmRange: bpmRangeText(bpmEvents.map((event) => event.bpm)),
  };
}
