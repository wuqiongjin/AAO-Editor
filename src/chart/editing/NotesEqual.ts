// 谱面音符的语义相等比较（issue 57 bug4：历史去重）。
// 背景：同位置重复放置同类音符时，handleNoteReplacement 按覆盖规则返回 shouldReplace=true，
// 产出一个"内容未变但对象重建"的新快照；若照常压栈，Ctrl+Z 要按同样多次才能退掉第一次真实改动。
// 比较口径 = 渲染/编辑语义，而非键存在性：
//   - boolean 标记（flick/skill/hidden）按键缺省 === false（所有消费点均真值判断）；
//   - subBeat 键缺省 === 0；
//   - 其余字段严格 ===。
// 语义不同的快照（如方向键 length+1、flick→skill 切换）不会被误判相等。
import type {
  ChartNote, SingleNote, LDirectionalNote, SlideNote, BpmNote, SystemNote, ConnectionNote,
} from '../types';

const connEqual = (a: ConnectionNote, b: ConnectionNote): boolean =>
  a.beat === b.beat && a.lane === b.lane &&
  (a.subBeat || 0) === (b.subBeat || 0) &&
  !!a.flick === !!b.flick && !!a.skill === !!b.skill && !!a.hidden === !!b.hidden;

export function noteEqual(a: ChartNote, b: ChartNote): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'Single': {
      const o = b as SingleNote;
      return a.beat === o.beat && a.lane === o.lane &&
        (a.subBeat || 0) === (o.subBeat || 0) &&
        !!a.flick === !!o.flick && !!a.skill === !!o.skill;
    }
    case 'LDirectional':
    case 'RDirectional': {
      const o = b as LDirectionalNote;
      return a.beat === o.beat && a.lane === o.lane &&
        (a.subBeat || 0) === (o.subBeat || 0) && a.length === o.length &&
        !!a.flick === !!o.flick && !!a.skill === !!o.skill;
    }
    case 'Slide':
    case 'Long': {
      // type 相等已在上方判定（Slide ≠ Long）；结点顺序是连接语义的一部分，逐下标比较
      const o = b as SlideNote;
      return a.connections.length === o.connections.length &&
        a.connections.every((c, i) => connEqual(c, o.connections[i]));
    }
    case 'BPM': {
      const o = b as BpmNote;
      return a.beat === o.beat && a.bpm === o.bpm;
    }
    case 'System': {
      const o = b as SystemNote;
      return a.beat === o.beat && a.data === o.data;
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
