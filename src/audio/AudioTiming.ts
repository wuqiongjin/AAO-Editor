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

/**
 * 同一份 BPM 事件上**复用一条时间线**做多次 beat→秒 换算（票 69）。
 * `beatToSeconds` 每次调用都会新建 `BpmTimeline`（构造是 O(BPM 段数)）：长谱派生逐音符、
 * 键音事件表逐结点调用就成了 O(n × BPM 段)。整轮派生只调一次本函数，之后逐次查询是 O(log BPM)。
 */
export function beatSecondsAt(events: BpmEvent[]): (beat: number) => number {
  const timeline = secondsTimeline(events);
  return (beat: number) => timeline.positionOfBeat(beat);
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

/**
 * 发声计划表里的一条：某时刻要触发的一份采样。
 * 谱面音符 / 滑条非 hidden 结点**逐结点计入**，同刻同采样的多次触发归并成一条（issue 231 Q9）；
 * 归并只减触发次数，不删谱面音符、不屏蔽结点、不静音。
 */
export interface KeySoundEvent {
  time: number;
  /** 击打样式（ADR-0004 §7：按键音素材包按此分类） */
  kind: KeySoundKind;
  /** 方向键：组合长度 length(1..3)，选对应分档采样（issue 18）；其余样式无 */
  tier?: number;
  /**
   * 该条发声的峰值缩放系数（issue 231 后续修订）：同刻还留着 N 份**不同**采样时为 `1/√N`，
   * 让多押与单声听感响度相当；单声（N=1）省略即 `1`。
   * 只作用于这一时刻这一组，不改其它时刻、不改总线音量（无动态压缩的 pumping）。
   */
  gain?: number;
}

/**
 * 「同一份发音」的等价键（issue 231 Q5′/Q9）：按**解析后的采样文件**判同，不按 kind / tier 判同。
 * 四个素材包里 `tap` 与 `slide` 都解析到同一份 perfect.mp3，方向键 1/2/3 档各一份文件，
 * `flick` / `skill` 各一份 ⇒ 共 6 类。`buildKeyEvents` 拿不到运行时 keySet，故把这份共享关系
 * 静态化在这里；`KeySound.test.ts` 有守约用例钉住「四包 tap ≡ slide」这个前提。
 * 采样未就绪时的振荡器兜底音色按 `kind` 取（`KEY_SOUND_DEFAULT_TONES`），故 `tap ≡ slide`
 * 这一组在兜底路径保留组内首条的音色；真实采样路径不受影响（issue 231 不统一兜底音色）。
 */
function sampleEquivalenceKey(kind: KeySoundKind, tier?: number): string {
  if (kind === 'directional') return `directional-${tier ?? 1}`;
  if (kind === 'tap' || kind === 'slide') return 'perfect';
  return kind;
}

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
        if (note.beat < 0) break;
        max = Math.max(max, at(note.beat, note.subBeat));
        break;
      case 'Slide':
      case 'Long':
        for (const c of note.connections) {
          if (c.beat < 0) continue;
          max = Math.max(max, at(c.beat, c.subBeat));
        }
        break;
      case 'BPM':
        max = Math.max(max, at(note.beat));
        break;
      default:
        break;
    }
  }
  return isFinite(max) ? max : 0;
}

export function buildKeyEvents(notes: ChartNote[], beatDisplay: number, bpmEvents: BpmEvent[]): KeySoundEvent[] {
  const out: KeySoundEvent[] = [];
  // 票 69：整张表只用一条时间线（逐结点 new BpmTimeline 是首帧的 CPU 热点之一）
  const secondsOf = beatSecondsAt(bpmEvents);
  const push = (beat: number, kind: KeySoundEvent['kind'], subBeat?: number, tier?: number) => {
    const preciseBeat = beat + (subBeat ?? 0) / beatDisplay;
    out.push({ time: secondsOf(preciseBeat), kind, tier });
  };
  for (const note of notes) {
    switch (note.type) {
      case 'Single':
        if (note.beat < 0) break;
        push(note.beat, note.flick ? 'flick' : note.skill ? 'skill' : 'tap', note.subBeat);
        break;
      case 'LDirectional':
      case 'RDirectional': {
        if (note.beat < 0) break;
        const tier = Math.min(3, Math.max(1, note.length > 3 ? 3 : note.length));
        push(note.beat, 'directional', note.subBeat, tier);
        break;
      }
      case 'Slide':
      case 'Long':
        for (let i = 0; i < note.connections.length; i++) {
          const conn = note.connections[i]!;
          if (conn.hidden || conn.beat < 0) continue;
          // issue 221: 首结点忽略 flick（只当普通滑条起点发声）
          const isStart = i === 0 && note.connections.length > 1;
          const kind: KeySoundEvent['kind'] = (conn.flick && !isStart) ? 'flick' : conn.skill ? 'skill' : 'slide';
          push(conn.beat, kind, conn.subBeat);
        }
        break;
      default:
        break; // BPM / System 不发声
    }
  }
  out.sort((a, b) => a.time - b.time);
  // 同刻（严格相等 time）+ 同一份采样的多条触发归并为一条发声计划，组内仍发声一次；
  // 不同采样各发一次。不加容差、不按 beat 分组、不按轨道区分（issue 231 Q9/Q10）。
  const plan: KeySoundEvent[] = [];
  let groupTime = NaN;
  let groupKeys = new Set<string>();
  for (const evt of out) {
    if (evt.time !== groupTime) {
      groupTime = evt.time;
      groupKeys = new Set<string>();
    }
    const key = sampleEquivalenceKey(evt.kind, evt.tier);
    if (groupKeys.has(key)) continue;
    groupKeys.add(key);
    plan.push(evt);
  }
  // 同刻不同采样的响度归一（issue 231 后续修订）：归并后一个时刻可能仍留着 N 份不同采样，
  // 叠加能量约按 √N 增长，实测比单声响 +3.5~+13.3 dB。给该组每条乘 1/√N 让响度相当：
  // 只作用于这一组自己的增益，不改其它时刻 ⇒ 单声恒为 1，无「后随单声变小」。
  // plan 已按 time 升序，同刻严格相等且连续。
  for (let i = 0; i < plan.length;) {
    let j = i + 1;
    while (j < plan.length && plan[j]!.time === plan[i]!.time) j++;
    if (j - i > 1) {
      const gain = 1 / Math.sqrt(j - i);
      for (let k = i; k < j; k++) plan[k]!.gain = gain;
    }
    i = j;
  }
  return plan;
}