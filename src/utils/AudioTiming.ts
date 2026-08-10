// 音频时间轴与谱面换算（纯逻辑，node 环境可单测）。
// ticket 03 定案：播放 / 预览线 / 按键音共用同一"BPM 事件 → 秒"换算，
// 避免 FinalCanvas 与 AudioEngine 各自实现导致时间轴漂移。
import type { ChartNote } from '../notes/Charts';
import type { KeySoundKind } from './KeySound';
import { BpmTimeline, type BpmTimelineEvent } from './BpmTimeline';

export interface BpmEvent extends BpmTimelineEvent {}

export const DEFAULT_BPM = 120;

/**
 * 从谱面音符提取 BPM 事件并按 beat 升序。
 * 与 FinalCanvas 的时间语义一致：首拍（beat 0）缺省时补默认 120。
 */
export function getBpmEvents(notes: ChartNote[]): BpmEvent[] {
  const events: BpmEvent[] = [];
  for (const note of notes) {
    if (note.type === 'BPM') {
      events.push({ beat: note.beat, bpm: note.bpm });
    }
  }
  events.sort((a, b) => a.beat - b.beat);
  if (events.length === 0 || events[0].beat > 0) {
    events.unshift({ beat: 0, bpm: DEFAULT_BPM });
  }
  return events;
}

/** 以"秒/拍"为单位的 BPM 时间线（每拍 60/bpm 秒） */
function secondsTimeline(events: BpmEvent[]): BpmTimeline {
  return new BpmTimeline(events, (bpm) => 60 / bpm);
}

/** beat → 秒：分段累加，每拍耗时 60/bpm 秒（含 subBeat 已在调用侧折算为精确 beat） */
export function beatToSeconds(events: BpmEvent[], beat: number): number {
  return secondsTimeline(events).positionOfBeat(beat);
}

/** 秒 → beat（含分数段）；与 beatToSeconds 互逆 */
export function secondsToBeat(events: BpmEvent[], seconds: number): number {
  return secondsTimeline(events).beatOfPosition(seconds);
}

/** 按键音事件：每个"会出声"的音符（普通/方向/滑条结点）平铺为音频秒，按时间升序 */
export interface KeySoundEvent {
  time: number;
  lane: number;
  /** 击打样式（ADR-0004 §7：按键音素材包按此分类） */
  kind: KeySoundKind;
  /** 方向键：组合长度 length(1..3)，选对应分档采样（issue 18）；其余样式无 */
  tier?: number;
}

/** 谱面末端尾量拍数（ADR-0004 §3 修订：仅留 1 拍，避免结束后多余网格/空白） */
export const CHART_END_TAIL_BEATS = 1;
/** 空谱兜底时长（秒，播放条可改、会话级） */
export const EMPTY_CHART_DURATION_SECONDS = 30;

/** 某音符最后一个"发声/位置点"的精确 beat（含滑条结点）；无则返回 -Infinity */
function noteEndBeat(note: ChartNote, beatDisplay: number): number {
  const precise = (beat: number, subBeat?: number) => beat + (subBeat ?? 0) / beatDisplay;
  switch (note.type) {
    case 'Single':
    case 'LDirectional':
    case 'RDirectional':
      return precise(note.beat, note.subBeat);
    case 'Slide':
    case 'Long':
      return note.connections.reduce(
        (max, c) => Math.max(max, precise(c.beat, c.subBeat)),
        -Infinity,
      );
    case 'BPM':
    case 'System':
      return note.beat;
  }
}

/** 全谱最大精确 beat（含滑条结点）；空谱返回 -Infinity */
function maxNoteBeat(notes: ChartNote[], beatDisplay: number): number {
  let maxBeat = -Infinity;
  for (const note of notes) {
    maxBeat = Math.max(maxBeat, noteEndBeat(note, beatDisplay));
  }
  return maxBeat;
}

/** 谱面末端 beat = 最大 beat + 尾量（1 拍）；空谱返回 null（调用方用默认） */
export function computeChartEndBeat(notes: ChartNote[], beatDisplay: number): number | null {
  const m = maxNoteBeat(notes, beatDisplay);
  if (!isFinite(m)) return null;
  return m + CHART_END_TAIL_BEATS;
}

/** 谱面末端时长（秒）：所有音符最大 beat 经 BPM 换算 + 尾量（1 拍）；空谱返回 null（调用方用默认 30s） */
export function computeChartEndSeconds(notes: ChartNote[], beatDisplay: number, bpmEvents: BpmEvent[]): number | null {
  const maxBeat = maxNoteBeat(notes, beatDisplay);
  if (!isFinite(maxBeat)) return null;
  const endSeconds = beatToSeconds(bpmEvents, maxBeat);
  const tailSeconds =
    beatToSeconds(bpmEvents, maxBeat + CHART_END_TAIL_BEATS) - endSeconds;
  return endSeconds + tailSeconds;
}

export function buildKeyEvents(notes: ChartNote[], beatDisplay: number, bpmEvents: BpmEvent[]): KeySoundEvent[] {
  const out: KeySoundEvent[] = [];
  const push = (beat: number, lane: number, kind: KeySoundEvent['kind'], subBeat?: number, tier?: number) => {
    const preciseBeat = beat + (subBeat ?? 0) / beatDisplay;
    out.push({ time: beatToSeconds(bpmEvents, preciseBeat), lane, kind, tier });
  };
  for (const note of notes) {
    switch (note.type) {
      case 'Single':
        push(note.beat, note.lane, note.flick ? 'flick' : note.skill ? 'skill' : 'tap', note.subBeat);
        break;
      case 'LDirectional':
      case 'RDirectional':
        // 方向键：击打样式 directional，按组合长度(1..3)分档音效（issue 18）
        push(note.beat, note.lane, 'directional', note.subBeat, note.length);
        break;
      case 'Slide':
      case 'Long':
        for (const conn of note.connections) {
          // hidden 结点不显示、也不应发声（SP 绿条/新型滑条中间隐藏点）
          if (conn.hidden) continue;
          push(conn.beat, conn.lane, 'slide', conn.subBeat);
        }
        break;
      default:
        break; // BPM / System 不发声
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}