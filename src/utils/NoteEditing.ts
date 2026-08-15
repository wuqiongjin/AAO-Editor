import type { ChartNote } from "../notes/Charts";

// 轨道总数（与 FinalVirtualCanvas 的 LANES 保持一致）
export const TOTAL_LANES = 7;

/**
 * 谱面音符数统计（issue 36）：与按键音事件（AudioTiming.buildKeyEvents）同一口径——
 * 滑条/长条按**非 hidden 结点数**计（两端点 + 非 hidden 中间结点，每个可击打结点各计 1），
 * 其余音符（单键/方向键/BPM/System）各计 1。
 */
export const countChartNotes = (notes: readonly ChartNote[]): number => {
  let count = 0;
  for (const n of notes) {
    if (n.type === "Slide" || n.type === "Long") {
      for (const c of n.connections) if (!c.hidden) count++;
    } else {
      count++;
    }
  }
  return count;
};

// 轨道镜像（唯一实现，三处调用点收敛于此——NoteEditing/SelectionEditing/NoteInfoPanel）
export const mirrorLane = (lane: number) => TOTAL_LANES - 1 - lane;

// 对单个音符做左右镜像：lane 翻转 + 方向键 L↔R 翻转 + 滑条端点 lane 同步；BPM/System 不参与
export const mirrorNote = (n: ChartNote): ChartNote => {
  switch (n.type) {
    case "Single":
      return { ...n, lane: mirrorLane(n.lane) };
    case "LDirectional":
      return { ...n, lane: mirrorLane(n.lane), type: "RDirectional" };
    case "RDirectional":
      return { ...n, lane: mirrorLane(n.lane), type: "LDirectional" };
    case "Slide":
    case "Long":
      return { ...n, connections: n.connections.map(c => ({ ...c, lane: mirrorLane(c.lane) })) };
    case "BPM":
    case "System":
      return n;
  }
};

// 对选中的下标音符做镜像，未选中的保持不变
export const mirrorNotes = (notes: ChartNote[], selected: number[]): ChartNote[] =>
  notes.map((n, i) => (selected.includes(i) ? mirrorNote(n) : n));

// 剪贴板组的"左上角"(最小 beat/lane)，作为粘贴锚点
const groupMinBeat = (clip: ChartNote[]) =>
  Math.min(...clip.map(n =>
    (n.type === "Slide" || n.type === "Long")
      ? Math.min(...n.connections.map(c => c.beat))
      : n.beat
  ));

const groupMinLane = (clip: ChartNote[]) =>
  Math.min(...clip.map(n => {
    if (n.type === "Slide" || n.type === "Long") {
      return Math.min(...n.connections.map(c => c.lane));
    }
    return "lane" in n ? n.lane : 0;
  }));

const groupMaxLane = (clip: ChartNote[]) =>
  Math.max(...clip.map(n => {
    if (n.type === "Slide" || n.type === "Long") {
      return Math.max(...n.connections.map(c => c.lane));
    }
    return "lane" in n ? n.lane : 0;
  }));

const shiftNote = (n: ChartNote, dBeat: number, dLane: number): ChartNote => {
  if (n.type === "BPM" || n.type === "System") {
    return { ...n, beat: n.beat + dBeat };
  }
  if (n.type === "Slide" || n.type === "Long") {
    return {
      ...n,
      connections: n.connections.map(c => ({
        ...c,
        beat: c.beat + dBeat,
        lane: c.lane + dLane
      }))
    };
  }
  return { ...n, beat: n.beat + dBeat, lane: n.lane + dLane };
};

// 把剪贴板组粘贴到 (anchorBeat, anchorLane) 处，保持组内相对位移与整体宽度
export const shiftGroupToAnchor = (clip: ChartNote[], anchorBeat: number, anchorLane: number): ChartNote[] => {
  if (clip.length === 0) return [];
  const deltaBeat = anchorBeat - groupMinBeat(clip);
  // 以组"左上角"为锚点；若把组左缘对齐到光标 lane 会超出轨道，则整体平移至恰好能放下的位置，保持组宽度不变
  const minLane = groupMinLane(clip);
  const maxLane = groupMaxLane(clip);
  const rawDeltaLane = anchorLane - minLane;
  const deltaLane = Math.max(-minLane, Math.min(TOTAL_LANES - 1 - maxLane, rawDeltaLane));
  return clip.map(n => shiftNote(n, deltaBeat, deltaLane));
};
