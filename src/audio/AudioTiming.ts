// 音频时间轴与谱面换算（纯逻辑，node 环境可单测）。
// ticket 03 定案：播放 / 预览线 / 按键音共用同一"BPM 事件 → 秒"换算，
// 避免 FinalCanvas 与 AudioEngine 各自实现导致时间轴漂移。
import type { ChartNote } from '../chart/types';
import type { KeySoundKind } from './KeySound';
import { BpmTimeline, type BpmBeatSolution, type BpmTimelineEvent } from '../chart/geometry/BpmTimeline';
import { trueBeat } from '../chart/editing/ChartEndBounds';

export type BpmEvent = BpmTimelineEvent;

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

/** 秒 → beat：**最大 beat 解**（倒流区里同一秒有多解的默认口径，ADR-0010 结论 5） */
export function secondsToBeat(events: BpmEvent[], seconds: number): number {
  return secondsTimeline(events).maxBeatSolutionOf(seconds).beat;
}

/** 秒 → **全部 beat 解**（含所属 BPM 段序号）：需要按层行事时用（ADR-0010 结论 5） */
export function secondsSolutionsOf(events: BpmEvent[], seconds: number): BpmBeatSolution[] {
  return secondsTimeline(events).beatSolutionsOf(seconds);
}

/**
 * 该秒**属于哪一段**（BPM 段序号，倒流区里取**最大 beat 解**所在段）——「按秒取区间」的唯一实现
 * （拍号显示 / 实时 BPM 区等）：调用点不要自己从解集里"取末项"，那是取解规则的第二份实现。
 */
export function secondsSegmentIndex(events: BpmEvent[], seconds: number): number {
  return secondsTimeline(events).maxBeatSolutionOf(seconds).segmentIndex;
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

/** 空谱兜底时长（秒，ADR-0005 §4：无音频时默认谱面长度，可手动改并持久化） */
export const EMPTY_CHART_DURATION_SECONDS = 30;

/**
 * 谱面代码最后音符的结束时间（秒，ADR-0005 §4.5）：无音频导入谱面代码时，
 * 若代码比当前谱面长度更长，用此值延长谱面长度到代码结尾。不含尾量。
 *
 * issue 104 修法 6：改为**全谱最大秒**（逐个元素位置点正向求值取 max），
 * 而不是旧口径的"最大 beat 的秒"——倒流区里后者的最大 beat 可能落在折返的**回程**上，
 * 其秒反而更小，会漏掉真正的末端（谱面被截短）。
 */
export function maxNoteEndSeconds(notes: ChartNote[], beatDisplay: number, bpmEvents: BpmEvent[]): number {
  const bd = beatDisplay > 0 ? beatDisplay : 1;
  const at = (beat: number, subBeat?: number) => beatToSeconds(bpmEvents, trueBeat(beat, subBeat, bd));
  let max = -Infinity;
  for (const note of notes) {
    switch (note.type) {
      case 'Single':
      case 'LDirectional':
      case 'RDirectional':
        max = Math.max(max, at(note.beat, note.subBeat));
        break;
      case 'Slide':
      case 'Long':
        for (const c of note.connections) max = Math.max(max, at(c.beat, c.subBeat));
        break;
      default:
        // BPM / System：位置本身也算内容末端（与旧口径一致）
        max = Math.max(max, at(note.beat));
        break;
    }
  }
  return isFinite(max) ? max : 0;
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
          // 结点按键音跟随其击打样式：flick 结点发声效、skill 结点发技能音、普通结点发 slide 音
          const kind: KeySoundEvent['kind'] = conn.flick ? 'flick' : conn.skill ? 'skill' : 'slide';
          push(conn.beat, conn.lane, kind, conn.subBeat);
        }
        break;
      default:
        break; // BPM / System 不发声
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}