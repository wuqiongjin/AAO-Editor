// 音频时间轴与谱面换算（纯逻辑，node 环境可单测）。
// ticket 03 定案：播放 / 预览线 / 按键音共用同一"BPM 事件 → 秒"换算，
// 避免 FinalCanvas 与 AudioEngine 各自实现导致时间轴漂移。
import type { ChartNote } from '../notes/Charts';

export interface BpmEvent {
  beat: number;
  bpm: number;
}

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

/** beat → 秒：分段累加，每拍耗时 60/bpm 秒（含 subBeat 已在调用侧折算为精确 beat） */
export function beatToSeconds(events: BpmEvent[], beat: number): number {
  let seconds = 0;
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    if (beat <= cur.beat) break;
    const segEnd = next ? next.beat : Infinity;
    const segLen = Math.min(segEnd, beat) - cur.beat;
    if (segLen > 0) {
      seconds += segLen * (60 / cur.bpm);
    }
    if (segEnd >= beat) break;
  }
  return seconds;
}

/** 秒 → beat（含分数段）；与 beatToSeconds 互逆 */
export function secondsToBeat(events: BpmEvent[], seconds: number): number {
  let remaining = seconds;
  for (let i = 0; i < events.length; i++) {
    const cur = events[i];
    const next = events[i + 1];
    const segLenBeats = next ? next.beat - cur.beat : Infinity;
    if (!isFinite(segLenBeats)) {
      return cur.beat + remaining * (cur.bpm / 60);
    }
    const segSeconds = segLenBeats * (60 / cur.bpm);
    if (remaining < segSeconds) {
      return cur.beat + remaining * (cur.bpm / 60);
    }
    remaining -= segSeconds;
  }
  return events.length > 0 ? events[events.length - 1].beat : 0;
}

/** 按键音事件：每个"会出声"的音符（普通/方向/滑条结点）平铺为音频秒，按时间升序 */
export interface KeySoundEvent {
  time: number;
  lane: number;
}

export function buildKeyEvents(notes: ChartNote[], beatDisplay: number, bpmEvents: BpmEvent[]): KeySoundEvent[] {
  const out: KeySoundEvent[] = [];
  const push = (beat: number, lane: number, subBeat?: number) => {
    const preciseBeat = beat + (subBeat ?? 0) / beatDisplay;
    out.push({ time: beatToSeconds(bpmEvents, preciseBeat), lane });
  };
  for (const note of notes) {
    switch (note.type) {
      case 'Single':
      case 'LDirectional':
      case 'RDirectional':
        push(note.beat, note.lane, note.subBeat);
        break;
      case 'Slide':
      case 'Long':
        for (const conn of note.connections) {
          push(conn.beat, conn.lane, conn.subBeat);
        }
        break;
      default:
        break; // BPM / System 不发声
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}