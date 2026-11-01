// 片段粘贴的载荷构造（issue 186 / ADR-0023 §2）。**只产出"要贴的那一组音符"**，
// 落点语义（锚点 / lane 夹取 / 越末端整组拒绝 / 同拍原位替换）一律交给既有 `pasteChartNotes`，
// 不在这里另写一套 —— 否则"复制粘"与"收藏粘"会漂移成两套体感（ADR-0023 Consequences）。
//
// 三条口径：
// 1. **带 BPM**：写 `startBpm`（与目标落点生效 BPM **相同则不写**，同速粘贴不长出多余 BPM 横线）
//    + 速度语境里的事件按同一 `deltaBeat` 平移；
// 2. **不含 BPM**：一条 BPM 都不发，速度完全跟目标谱面；
// 3. **不缩放数值、不补"恢复 BPM"**：尾部负值靠既有末条警示色暴露（ADR-0023 §2 / issue 142）。
//
// 坐标口径（容易踩）：本函数的产物是"片段自己的坐标系"，随后被 `pasteChartNotes` 整体平移
// `anchorBeat − groupMinBeat(产物)`。BPM 不参与锚点计算（ADR-0008 §2.1），所以 BPM 的
// 载荷拍位必须写成**平移后会正好落到目标位置**的值 —— 即 `groupMinBeat(片段音符)` 为原点，
// 而不是片段的存储最小 beat（两者在带 subBeat 的导入谱里会差半拍）。
import { groupMinBeat } from '../editing/NoteEditing';
import type { ChartNote } from '../types';
import { effectiveBpmAt } from './PasteBpmDecision';
import type { Pattern } from './types';

/** 一次片段粘贴的请求：负载来源 + 当前模式（模式是偏好，存 settings.patternPaste.withBpm） */
export interface PatternPasteRequest {
  pattern: Pattern;
  withBpm: boolean;
}

export interface PatternPastePlacement {
  /** 目标落点（包围盒左上角对齐到的拍） */
  anchorBeat: number;
  /** 目标谱面：判定落点生效 BPM 用 */
  targetNotes: readonly ChartNote[];
  /** 子拍细分：把片段的最小拍位折成真实拍位（与 `pasteChartNotes` 同一分母） */
  beatDisplay: number;
}

/**
 * 构造可交给 `pasteChartNotes` 的粘贴组。
 *
 * @returns 片段音符（原序）+ 需要写入的 BPM 事件（仅带 BPM 时）。
 *          **不含**"片段末端恢复 BPM"这类补线。
 */
export function buildPatternPastePayload(
  request: PatternPasteRequest,
  placement: PatternPastePlacement,
): ChartNote[] {
  const { pattern, withBpm } = request;
  const { anchorBeat, targetNotes, beatDisplay } = placement;
  // 空片段不产出任何东西（含"只有 BPM"的假产物）：下面 `groupMinBeat([])` 会是 -Infinity/Infinity
  if (pattern.notes.length === 0) return [];
  // 片段对象是库里的共享数据：这里只读，不克隆（pasteChartNotes 会给每个落子做结构化拷贝）
  const notes: ChartNote[] = [...pattern.notes];
  if (!withBpm) return notes;

  // 平移后落点会正好压在 anchorBeat 上的那个"载荷拍位"
  const origin = groupMinBeat(pattern.notes, beatDisplay);
  const targetBpm = effectiveBpmAt(targetNotes, anchorBeat);
  const bpmNotes: ChartNote[] = [];

  // 同速不写线：目标这里本来就是这个速度，再画一条只是噪音（ADR-0023 §2）
  if (pattern.bpmContext.startBpm !== targetBpm) {
    bpmNotes.push({ type: 'BPM', beat: origin, bpm: pattern.bpmContext.startBpm });
  }
  // 跨度内事件：同一 deltaBeat 平移写入；同拍已有 BPM 由 pasteChartNotes 原位替换
  for (const event of pattern.bpmContext.events) {
    bpmNotes.push({ type: 'BPM', beat: origin + event.deltaBeat, bpm: event.bpm });
  }
  return [...notes, ...bpmNotes];
}
