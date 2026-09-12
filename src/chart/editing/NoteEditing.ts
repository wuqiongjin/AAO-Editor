import type { ChartNote } from '../types';
import { flipEasingType } from './Easing';

// 轨道总数（与 FinalVirtualCanvas 的 LANES 保持一致）
export const TOTAL_LANES = 7;

/**
 * 谱面音符数统计（issue 36）：与按键音事件（AudioTiming.buildKeyEvents）同一口径——
 * 滑条/长条按**非 hidden 结点数**计（两端点 + 非 hidden 中间结点，每个可击打结点各计 1）：
 * `A→B` = 2、`A→B→C` = 3、`A→H→C` = 2（H = hidden，不可击打）。
 * 其余**可击打**音符（单键 / 方向键）各计 1；
 * **BPM / System 不计入**（issue 84：它们不是音符，只是谱面标线/元信息）——
 * 与下方 `countNotesUpToBeat` 同口径。
 */
/** 滑条/长条的**可击打结点**（hidden 结点不可击打，不计数）——两处计数共用同一判据（issue 84） */
const hittableConnections = (n: ChartNote): { beat: number }[] => {
  if (n.type !== "Slide" && n.type !== "Long") return [];
  return n.connections.filter(c => !c.hidden);
};

/** 是否计入音符数（BPM/System 不是音符：只是谱面标线/元信息，issue 84） */
const isCountableNote = (n: ChartNote): boolean =>
  n.type !== "BPM" && n.type !== "System";

export const countChartNotes = (notes: readonly ChartNote[]): number => {
  let count = 0;
  for (const n of notes) {
    if (n.type === "Slide" || n.type === "Long") {
      count += hittableConnections(n).length;
    } else if (isCountableNote(n)) {
      count++;
    }
  }
  return count;
};

// 音符的"起始拍"（判定线处判读：音符起手节拍是否已到达/越过判定线）。
// 只服务单键/方向键 —— 滑条/长条在 issue 84 后改按**逐结点**判过线（不再用首结点代表整条）。
const noteStartBeat = (n: ChartNote): number => (n as { beat: number }).beat;

/**
 * 已到达/越过判定线的可打击音符数（issue 22 画布右下角实时统计 / 实时显示线右沟槽读数）。
 * 口径（issue 84 修订）：**滑条/长条按"已过线的非 hidden 结点数"逐结点计** ——
 * 与 `countChartNotes`（总数按结点计）同口径，`A→B` 全过线时算 2 而非 1；
 * 单键/方向键按自身起始拍；BPM/System 无击打语义不计入；hidden 结点不可击打不计入。
 * 起始拍 ≤ playheadBeat（含边界）视为"已过判定线"。
 */
export const countNotesUpToBeat = (
  notes: readonly ChartNote[],
  playheadBeat: number,
): number => {
  let count = 0;
  for (const n of notes) {
    switch (n.type) {
      case "Single":
      case "LDirectional":
      case "RDirectional":
        if (noteStartBeat(n) <= playheadBeat) count++;
        break;
      case "Slide":
      case "Long":
        // issue 84：每个结点各自是一击，各自按自己的拍位判"是否已过线"
        for (const c of hittableConnections(n)) if (c.beat <= playheadBeat) count++;
        break;
      case "BPM":
      case "System":
        break;
    }
  }
  return count;
};

// 轨道镜像（唯一实现，三处调用点收敛于此——NoteEditing/SelectionEditing/NoteInfoPanel）
export const mirrorLane = (lane: number) => TOTAL_LANES - 1 - lane;

// 对单个音符做左右镜像：lane 翻转 + 方向键 L↔R 翻转 + 滑条端点 lane 同步；BPM/System 不参与。
// issue 09 S3（ADR-0009 §4）：SP 解析段同步做缓动**型翻转**（In↔Out / In-Out↔Out-In，族不变）——
// 点集镜像后只有翻转的型才能重烘焙出同一形状（否则拖端点重投影会把形状"弹回"未镜像态）；
// 模板段点列左右对称翻转天然成立、自由段无参数，均不动。
export const mirrorNote = (n: ChartNote): ChartNote => {
  switch (n.type) {
    case "Single":
      return { ...n, lane: mirrorLane(n.lane) };
    case "LDirectional":
      return { ...n, lane: mirrorLane(n.lane), type: "RDirectional" };
    case "RDirectional":
      return { ...n, lane: mirrorLane(n.lane), type: "LDirectional" };
    case "Slide":
    case "Long": {
      const sp = n.spanParams;
      const bySpan = sp
        ? Object.fromEntries(Object.entries(sp.bySpan).map(([k, p]) => [
            k, p.kind === 'easing' ? { ...p, type: flipEasingType(p.type) } : p,
          ]))
        : undefined;
      return {
        ...n,
        connections: n.connections.map(c => ({ ...c, lane: mirrorLane(c.lane) })),
        ...(bySpan ? { spanParams: { ...sp!, bySpan } } : {}),
      };
    }
    case "BPM":
    case "System":
      return n;
  }
};

// 对选中的下标音符做镜像，未选中的保持不变
export const mirrorNotes = (notes: ChartNote[], selected: number[]): ChartNote[] =>
  notes.map((n, i) => (selected.includes(i) ? mirrorNote(n) : n));

/**
 * 剪贴板组的"左上角"(最小 beat/lane)，作为粘贴锚点（ADR-0008 §2.1）。
 * **BPM / System 不参与锚点计算**：它们没有 lane，参与 min 会污染组的左上角（把整组推远/推偏）；
 * 它们只随最终的 beat 位移平移（见 shiftNote）。
 */
const isLaned = (n: ChartNote) => n.type !== "BPM" && n.type !== "System";
/** 真实拍位：subBeat 单位是 1/beatDisplay（与 ChartGeometry.noteVirtualY 同口径） */
const trueBeat = (beat: number, subBeat: number | undefined, beatDisplay: number) =>
  beat + ((subBeat || 0) > 0 ? (subBeat as number) / beatDisplay : 0);
const noteMinBeat = (n: ChartNote, beatDisplay: number) =>
  (n.type === "Slide" || n.type === "Long")
    ? Math.min(...n.connections.map(c => trueBeat(c.beat, c.subBeat, beatDisplay)))
    : trueBeat(n.beat, (n as { subBeat?: number }).subBeat, beatDisplay);
const noteMinLane = (n: ChartNote) =>
  (n.type === "Slide" || n.type === "Long")
    ? Math.min(...n.connections.map(c => c.lane))
    : (n as { lane: number }).lane; // 已由 isLaned 过滤掉 BPM/System
const noteMaxLane = (n: ChartNote) =>
  (n.type === "Slide" || n.type === "Long")
    ? Math.max(...n.connections.map(c => c.lane))
    : (n as { lane: number }).lane;

const groupMinBeat = (clip: ChartNote[], beatDisplay: number) => {
  const laned = clip.filter(isLaned);
  return Math.min(...(laned.length > 0 ? laned : clip).map(n => noteMinBeat(n, beatDisplay)));
};

const groupMinLane = (clip: ChartNote[]) => {
  const laned = clip.filter(isLaned);
  return Math.min(...(laned.length > 0 ? laned : clip).map(noteMinLane));
};

const groupMaxLane = (clip: ChartNote[]) => {
  const laned = clip.filter(isLaned);
  return Math.max(...(laned.length > 0 ? laned : clip).map(noteMaxLane));
};

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

/**
 * 把剪贴板组粘贴到 (anchorBeat, anchorLane) 处，保持组内相对位移与整体宽度。
 * @param beatDisplay 子拍细分（subBeat 的单位分母）；用于把组的 min 拍位换算成真实拍位，
 *                    否则带 subBeat 的结点会让锚点被低估（内容溢出到光标左/上侧）。
 */
export const shiftGroupToAnchor = (
  clip: ChartNote[],
  anchorBeat: number,
  anchorLane: number,
  beatDisplay = 4,
): ChartNote[] => {
  if (clip.length === 0) return [];
  const deltaBeat = anchorBeat - groupMinBeat(clip, beatDisplay);
  // 以组"左上角"为锚点；若把组左缘对齐到光标 lane 会超出轨道，则整体平移至恰好能放下的位置，保持组宽度不变
  const minLane = groupMinLane(clip);
  const maxLane = groupMaxLane(clip);
  const rawDeltaLane = anchorLane - minLane;
  const deltaLane = Math.max(-minLane, Math.min(TOTAL_LANES - 1 - maxLane, rawDeltaLane));
  return clip.map(n => shiftNote(n, deltaBeat, deltaLane));
};
