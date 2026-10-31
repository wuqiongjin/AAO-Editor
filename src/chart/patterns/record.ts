// 片段记录的校验与库文件映射（issue 184）。
//
// 两处共用同一份「什么算一条好片段」：存储载入（坏条目直接丢）与分享文件解析（坏条目进清单报数）。
// 校验故意宽松——只认能安全消费的字段；未知附加字段原样保留（ADR-0014 的保真气质）。
import type { ChartNote, NoteType } from '../types';
import {
  PATTERN_LIBRARY_SCHEMA_VERSION,
  type Pattern,
  type PatternBpmContext,
  type PatternLibraryDoc,
} from './types';

export type PatternInvalidReason =
  | 'not-an-object'
  | 'invalid-id'
  | 'invalid-name'
  | 'invalid-createdAt'
  | 'invalid-notes'
  | 'invalid-bpm-context';

/**
 * 已知键型表。用 `Record<NoteType, true>` 而不是手抄字符串数组：
 * 将来 `NoteType` 加成员时这里漏填会直接编译红，不会静默拒收新键型。
 */
const KNOWN_NOTE_TYPES: Record<NoteType, true> = {
  Single: true,
  LDirectional: true,
  RDirectional: true,
  Slide: true,
  Long: true,
  BPM: true,
  System: true,
  Opaque: true,
};

function isKnownNoteType(type: string): type is NoteType {
  return Object.prototype.hasOwnProperty.call(KNOWN_NOTE_TYPES, type);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidConnection(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isFiniteNumber(value.beat) && isFiniteNumber(value.lane);
}

/** 片段里只可能是选区音符（键型 / 滑条），但仍按全键型校验，避免把脏数据带进渲染层。 */
function isValidNote(value: unknown): value is ChartNote {
  if (!isPlainObject(value)) return false;
  const type = value.type;
  if (typeof type !== 'string' || !isKnownNoteType(type)) return false;
  if (type === 'Slide' || type === 'Long') {
    const connections = value.connections;
    return Array.isArray(connections) && connections.length > 0 && connections.every(isValidConnection);
  }
  if (!isFiniteNumber(value.beat)) return false;
  // BPM / System / Opaque 没有 lane（也不会出现在选区里）；键型音符必须带轨道
  if (type === 'BPM' || type === 'System' || type === 'Opaque') return true;
  return isFiniteNumber(value.lane);
}

function isValidBpmContext(value: unknown): value is PatternBpmContext {
  if (!isPlainObject(value)) return false;
  if (!isFiniteNumber(value.startBpm)) return false;
  const events = value.events;
  if (!Array.isArray(events)) return false;
  return events.every(
    (event) => isPlainObject(event) && isFiniteNumber(event.deltaBeat) && isFiniteNumber(event.bpm),
  );
}

/** 一条片段哪里不合格；合格 → null。 */
export function patternInvalidReason(value: unknown): PatternInvalidReason | null {
  if (!isPlainObject(value)) return 'not-an-object';
  if (typeof value.id !== 'string' || value.id.trim() === '') return 'invalid-id';
  if (typeof value.name !== 'string') return 'invalid-name';
  if (!isFiniteNumber(value.createdAt)) return 'invalid-createdAt';
  if (!Array.isArray(value.notes) || value.notes.length === 0 || !value.notes.every(isValidNote)) {
    return 'invalid-notes';
  }
  if (!isValidBpmContext(value.bpmContext)) return 'invalid-bpm-context';
  return null;
}

export function isPatternValue(value: unknown): value is Pattern {
  return patternInvalidReason(value) === null;
}

/**
 * 库文件 / wire doc → 片段列表。
 * 版本不认识或结构不成立 → 空库（**不**顺手覆盖盘上文件；Electron 侧另有 `.broken` 备份）。
 */
export function patternsFromLibraryDoc(doc: unknown): Pattern[] {
  if (!isPlainObject(doc)) return [];
  if (doc.schemaVersion !== PATTERN_LIBRARY_SCHEMA_VERSION) return [];
  const patterns = doc.patterns;
  if (!Array.isArray(patterns)) return [];
  return patterns.filter(isPatternValue);
}

export function libraryDocFromPatterns(patterns: readonly Pattern[]): PatternLibraryDoc {
  return { schemaVersion: PATTERN_LIBRARY_SCHEMA_VERSION, patterns: [...patterns] };
}
