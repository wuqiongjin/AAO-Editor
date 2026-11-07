// 片段采集（issue 184 / ADR-0023 §1）。
//
// 两件事：
// 1. 音符 = `copySelection` 的产物（与剪贴板同一套形态归一，不另写一套），再**递归剥 `source`**
//    —— 原谱 overlay 的语境是「这一份谱面代码」，片段要跨工程长期存活，带过去会变幽灵字段。
// 2. 速度语境 = 起点生效 BPM（稳定排序后最后一条 `beat ≤ minBeat`）+ `(minBeat, maxBeat]` 内事件
//    （相对 `minBeat` 记 `deltaBeat`，起拍那条就是 `startBpm`，不重复存）。
import type { ChartNote, SelectionItem } from '../chart/types';
import { copySelection } from '../chart/editing/SelectionEditing';
import { effectiveBpmAt } from './PasteBpmDecision';
import type { PatternBpmEvent, PatternPayload } from './types';

/** 递归剥掉任意层级的 `source`（音符本体 + 滑条连接点 + 将来嵌套结构一视同仁）。 */
function stripSourceDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripSourceDeep(item)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'source') continue;
      out[key] = stripSourceDeep(item);
    }
    return out as T;
  }
  return value;
}

/**
 * 音符包围盒：滑条 / 长条按**全部连接点**算（hidden 也算，它们仍在跨度内）。
 *
 * 口径 = 存储的 `beat`（不做 `subBeat` 折算）：本仓放置写的是**小数拍 + `subBeat: 0`**
 * （`BeatSnap.ts`：改档不移动既有音符），且 ADR-0023 §1 的 `startBpm` 前驱比较也以 `beat` 定义。
 * 片段的 `subBeat` 原样保留在音符里，粘贴时随音符一起平移（ADR-0023 §2）。
 */
function collectBeats(notes: readonly ChartNote[]): number[] {
  const beats: number[] = [];
  for (const note of notes) {
    if (note.type === 'Slide' || note.type === 'Long') {
      for (const conn of note.connections) {
        if (Number.isFinite(conn.beat)) beats.push(conn.beat);
      }
      continue;
    }
    if (Number.isFinite(note.beat)) beats.push(note.beat);
  }
  return beats;
}

/** 跨度内 `(minBeat, maxBeat]` 的事件，按 beat 升序（稳定排序，同拍保持数组序）。 */
function resolveEvents(notes: readonly ChartNote[], minBeat: number, maxBeat: number): PatternBpmEvent[] {
  const events: PatternBpmEvent[] = [];
  for (const note of notes) {
    if (note.type !== 'BPM') continue;
    if (!Number.isFinite(note.beat) || !Number.isFinite(note.bpm)) continue;
    if (note.beat <= minBeat || note.beat > maxBeat) continue;
    events.push({ deltaBeat: note.beat - minBeat, bpm: note.bpm });
  }
  return events.sort((a, b) => a.deltaBeat - b.deltaBeat);
}

/**
 * 把选区采集为片段载荷。空选区（或选区全部落空）→ `null`（不产出、不落库）。
 *
 * 返回的 notes 是**深拷贝**，调用方随便改都不会污染源谱面。
 */
export function capturePattern(
  notes: ChartNote[],
  selection: SelectionItem[],
): PatternPayload | null {
  const copied = copySelection(notes, selection);
  if (copied.length === 0) return null;

  const captured = stripSourceDeep(structuredClone(copied));
  const beats = collectBeats(captured);
  if (beats.length === 0) return null;

  let minBeat = beats[0]!;
  let maxBeat = beats[0]!;
  for (const beat of beats) {
    if (beat < minBeat) minBeat = beat;
    if (beat > maxBeat) maxBeat = beat;
  }

  return {
    notes: captured,
    bpmContext: {
      // 与粘贴侧"目标落点生效 BPM"同一个函数（不是各算一套）：采集的是源谱面在 minBeat 处的生效值
      startBpm: effectiveBpmAt(notes, minBeat),
      events: resolveEvents(notes, minBeat, maxBeat),
    },
  };
}
