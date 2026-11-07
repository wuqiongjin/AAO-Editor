// 谱面音符的语义相等比较（issue 57 bug4：历史去重；issue 221：对齐 source 与 charge 保真）。
// 背景：同位置重复放置同类音符时，handleNoteReplacement 按覆盖规则返回 shouldReplace=true，
// 产出一个"内容未变但对象重建"的新快照；若照常压栈，Ctrl+Z 要按同样多次才能退掉第一次真实改动。
// 比较口径 = 渲染/编辑与数据语义：
//   - boolean 标记（flick/skill/hidden/charge）按键缺省 === false（所有消费点均真值判断）；
//   - subBeat 键缺省 === 0；
//   - source 携带未知字段 / 自定义属性 / 跨类型字段（issue 221）：按深层 JSON 值比对，有属性改动不被去重吞掉；
//   - 其余字段严格 ===。
// 语义不同的快照（如方向键 length+1、flick→skill 切换、source 属性增删改）不会被误判相等。
import type {
  ChartNote, SingleNote, LDirectionalNote, SlideNote, BpmNote, SystemNote, ConnectionNote, OpaqueNote, ChartSourceObject,
} from '../types';

function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => jsonValueEqual(v, bArr[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  for (const k of Object.keys(aObj)) {
    if (aObj[k] === undefined) continue;
    if (!jsonValueEqual(aObj[k], bObj[k])) return false;
  }
  for (const k of Object.keys(bObj)) {
    if (bObj[k] === undefined) continue;
    if (aObj[k] === undefined) return false;
  }
  return true;
}

function isEmptyObject(obj: Record<string, unknown>): boolean {
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) return false;
  }
  return true;
}

/** 比较 source 自定义属性 / 跨类型字段（issue 221） */
export function sourceEqual(a: ChartSourceObject | undefined, b: ChartSourceObject | undefined): boolean {
  if (a === b) return true;
  const aEmpty = !a || isEmptyObject(a);
  const bEmpty = !b || isEmptyObject(b);
  if (aEmpty && bEmpty) return true;
  if (aEmpty !== bEmpty) return false;
  return jsonValueEqual(a, b);
}

const connEqual = (a: ConnectionNote, b: ConnectionNote): boolean =>
  a.beat === b.beat && a.lane === b.lane &&
  (a.subBeat || 0) === (b.subBeat || 0) &&
  !!a.flick === !!b.flick && !!a.skill === !!b.skill && !!a.hidden === !!b.hidden &&
  !!a.charge === !!b.charge &&
  sourceEqual(a.source, b.source);

export function noteEqual(a: ChartNote, b: ChartNote): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'Single': {
      const o = b as SingleNote;
      return a.beat === o.beat && a.lane === o.lane &&
        (a.subBeat || 0) === (o.subBeat || 0) &&
        !!a.flick === !!o.flick && !!a.skill === !!o.skill &&
        !!a.charge === !!o.charge &&
        sourceEqual(a.source, o.source);
    }
    case 'LDirectional':
    case 'RDirectional': {
      const o = b as LDirectionalNote;
      return a.beat === o.beat && a.lane === o.lane &&
        (a.subBeat || 0) === (o.subBeat || 0) && a.length === o.length &&
        !!a.flick === !!o.flick && !!a.skill === !!o.skill &&
        !!a.charge === !!o.charge &&
        sourceEqual(a.source, o.source);
    }
    case 'Slide':
    case 'Long': {
      // type 相等已在上方判定（Slide ≠ Long）；结点顺序是连接语义的一部分，逐下标比较
      const o = b as SlideNote;
      return sourceEqual(a.source, o.source) &&
        a.connections.length === o.connections.length &&
        a.connections.every((c, i) => connEqual(c, o.connections[i]));
    }
    case 'BPM': {
      const o = b as BpmNote;
      return a.beat === o.beat && a.bpm === o.bpm && sourceEqual(a.source, o.source);
    }
    case 'System': {
      const o = b as SystemNote;
      return a.beat === o.beat && a.data === o.data && sourceEqual(a.source, o.source);
    }
    case 'Opaque': {
      const o = b as OpaqueNote;
      return a.beat === o.beat && a.sourceType === o.sourceType && sourceEqual(a.source, o.source);
    }
  }
  return false;
}

/** 两个谱面快照是否语义相等（长度一致且逐音符相等；先引用相等短路） */
export function notesEqual(a: readonly ChartNote[], b: readonly ChartNote[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((n, i) => noteEqual(n, b[i]));
}
