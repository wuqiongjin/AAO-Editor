// ADR-0008 §2 统一交互语义矩阵 + §3 执行键语义 的纯调度层（逐行锁表见
// tests/unit/ToolActionMatrix.test.ts——矩阵任何一行变动必须先改 ADR-0008 再改此表）。
// 画布（FinalVirtualCanvas）负责几何→命中/落点/框内条目的换算，本模块只吃换算好的输入、
// 输出副作用指令（op）序列；一次手势 = 一个 setNotes = 一个可回退快照（§8）。
// 指针行（点选/加选/框选建选区）不在此表——它只操作选区、语义未变，留在画布选择路径。
import type { ChartNote, SelectionItem } from '../types';
import {
  handleNoteReplacement, handleSlideToSlideCombination, keyTargetsFromItems,
  batchApplyKeyType, pasteChartNotes,
} from './NoteReplacementRules';
import { deleteSelection, copySelection, cutSelection, mirrorSelection, remapSelection } from './SelectionEditing';
import { combineSelectionIntoSlide } from './SlideCombination';

/** 持工具态（与 UIProvider.ArmedTool 同构；本模块保持零 UI 依赖） */
export type MatrixTool =
  | 'single' | 'flick' | 'skill' | 'ldirectional' | 'rdirectional'
  | 'bpm' | 'slide'
  | 'copy' | 'cut' | 'delete' | 'paste' | 'mirror';

export interface SlidePoint { beat: number; lane: number; subBeat: number }
export interface SnapPos { beat: number; lane: number }

export type MatrixOp =
  | { t: 'setNotes'; notes: ChartNote[] }          // handleNotesChange（单快照）
  | { t: 'setSelection'; items: SelectionItem[] }  // setSelectedItems
  | { t: 'setClipboard'; notes: ChartNote[] }      // setClipboard
  | { t: 'setSlideBuffer'; point: SlidePoint | null }
  | { t: 'openBpmEditor'; beat: number; value: string }; // §5 就地编辑

const isKeyTool = (tool: MatrixTool): tool is 'single' | 'flick' | 'skill' | 'ldirectional' | 'rdirectional' =>
  tool === 'single' || tool === 'flick' || tool === 'skill' || tool === 'ldirectional' || tool === 'rdirectional';
const isActionTool = (tool: MatrixTool): tool is 'copy' | 'cut' | 'delete' | 'mirror' =>
  tool === 'copy' || tool === 'cut' || tool === 'delete' || tool === 'mirror';

const samePos = (a: SlidePoint, b: SlidePoint) =>
  a.beat === b.beat && (a.subBeat || 0) === (b.subBeat || 0);

/** 同一选择条目判定（同 kind/noteIndex/connIndex） */
export const sameSelectionItem = (a: SelectionItem, b: SelectionItem): boolean =>
  a.kind === b.kind && a.noteIndex === b.noteIndex &&
  (a.kind === 'note' ? true : a.connIndex === (b as Exclude<SelectionItem, { kind: 'note' }>).connIndex);

/**
 * §2 指针行·单击：音符 = 选中该目标（替换选区；Shift 加选/去选；Ctrl 选整条滑条，
 * 加选整条时清同条子部分——ADR-0001 §6.1 互斥）；空白 = 清空选区（非加选）。
 * 起点标记命中/互斥清标记由画布在调用前后处置（标记不入 notes）。
 */
export function pointerClickSelection(
  current: SelectionItem[],
  hit: SelectionItem | null,
  additive: boolean,
  ctrl: boolean,
): SelectionItem[] {
  if (!hit) return additive ? current : [];
  const target: SelectionItem = ctrl ? { kind: 'note', noteIndex: hit.noteIndex } : hit;
  if (!additive) return [target];
  if (current.some(it => sameSelectionItem(it, target))) {
    return current.filter(it => !sameSelectionItem(it, target));
  }
  const base = ctrl ? current.filter(it => it.noteIndex !== target.noteIndex) : current;
  return [...base, target];
}

/** §5：放置 BPM 线（同拍覆盖为 lastBpm；无则追加）→ 打开就地编辑。§3 Ctrl+` 与 BPM 工具点击共用 */
export function bpmPlaceOps(notes: ChartNote[], beat: number, lastBpm: number): MatrixOp[] {
  const ops: MatrixOp[] = [];
  const idx = notes.findIndex(n => n.type === 'BPM' && Math.abs(n.beat - beat) < 1e-9);
  if (idx >= 0) {
    const cur = notes[idx] as Extract<ChartNote, { type: 'BPM' }>;
    if (cur.bpm !== lastBpm) ops.push({ t: 'setNotes', notes: notes.map((n, i) => i === idx ? { ...cur, bpm: lastBpm } : n) });
  } else {
    ops.push({ t: 'setNotes', notes: [...notes, { type: 'BPM', beat, bpm: lastBpm } as ChartNote] });
  }
  ops.push({ t: 'openBpmEditor', beat, value: String(lastBpm) });
  return ops;
}

/** §4 两击直放的"第二次合法点击"→ 成条/接合。Ctrl+E 无选区档与鼠标两击共用 */
export function slideSecondClickOps(notes: ChartNote[], buf: SlidePoint, point: SlidePoint): MatrixOp[] {
  if (samePos(buf, point)) return [{ t: 'setSlideBuffer', point: null }]; // 同位再点 = 取消锚点（bug 32 语义）
  const comb = handleSlideToSlideCombination(notes, [buf, point]);
  if (comb.shouldCombine) return [{ t: 'setNotes', notes: comb.newNotes }, { t: 'setSlideBuffer', point: null }];
  const newNotes = [...comb.newNotes];
  const [start, end] = [buf, point].sort((a, b) => (a.beat - b.beat) || ((a.subBeat || 0) - (b.subBeat || 0)));
  newNotes.push({ type: 'Slide', connections: [start, end] });
  return [{ t: 'setNotes', notes: newNotes }, { t: 'setSlideBuffer', point: null }];
}

/** §4 框选组合 / §3 Ctrl+E 有选区档：吸入键型音符与滑条结点成条（来源 <2 无事发生）；
 *  组合是一次性动作 → 完成后**清空选区**（§2 原则 4 的例外，三轮修订：来源已消耗、
 *  结果滑条不自动进入选中态，避免"组合后多出选中描边"）；
 *  顺带清两击锚点（其位置可能已被本次组合消耗，保留会产生悬空端点） */
export function combineOps(notes: ChartNote[], items: SelectionItem[]): MatrixOp[] {
  const r = combineSelectionIntoSlide(notes, items);
  if (!r.shouldCombine) return [];
  return [
    { t: 'setNotes', notes: r.newNotes },
    { t: 'setSelection', items: [] },
    { t: 'setSlideBuffer', point: null },
  ];
}

export interface ClickInput {
  tool: MatrixTool;
  notes: ChartNote[];
  /** findItemAt 命中（音符上点击）；空白 = null */
  hit: SelectionItem | null;
  /** snapPos 合法栅格落点（轨道内 ∧ beat≥0 ∧ ≤谱面末端）；非法 = null（§1"无事发生"） */
  pos: SnapPos | null;
  slideBuffer: SlidePoint | null;
  lastBpm: number;
  clipboard: ChartNote[];
}

/** §2 单击矩阵（工具族行 × 音符/空白列）；指针行不走此函数 */
export function clickOps(input: ClickInput): MatrixOp[] {
  const { tool, notes, hit, pos, slideBuffer, lastBpm, clipboard } = input;
  if (isKeyTool(tool)) {
    // 键型放置：音符/空白两列同格 = 栅格位放置（ADR-0001 替换规则由 handleNoteReplacement 内部处置）
    if (!pos) return [];
    const r = handleNoteReplacement(notes, pos.beat, pos.lane, 0, tool);
    return r.shouldReplace ? [{ t: 'setNotes', notes: r.newNotes }] : [];
  }
  if (tool === 'bpm') {
    if (!pos) return [];
    return bpmPlaceOps(notes, pos.beat, lastBpm); // 放置 → 进入 §5 就地编辑（音符上/空白同左）
  }
  if (tool === 'slide') {
    // 非法位置点击 = 取消待连接锚点（issue 57 bug2 语义保留）
    if (!pos) return slideBuffer ? [{ t: 'setSlideBuffer', point: null }] : [];
    const point: SlidePoint = { beat: pos.beat, lane: pos.lane, subBeat: 0 };
    if (!slideBuffer) return [{ t: 'setSlideBuffer', point }];
    return slideSecondClickOps(notes, slideBuffer, point);
  }
  if (tool === 'paste') {
    // 粘贴作用于位置：音符/空白两列同左
    if (!pos || clipboard.length === 0) return [];
    const { newNotes, newStartIndex } = pasteChartNotes(notes, clipboard, pos.beat, pos.lane);
    const items = clipboard
      .map((_, i) => newStartIndex + i)
      .filter(i => i < newNotes.length)
      .map(i => ({ kind: 'note' as const, noteIndex: i }));
    return [{ t: 'setNotes', notes: newNotes }, { t: 'setSelection', items }];
  }
  if (isActionTool(tool)) {
    // 音符 = 选中并立即执行（Model A，ADR-0002 §3.2）；空白 = 无效果、不清选区（§2）
    if (!hit) return [];
    return actionOnItemOps(tool, notes, hit);
  }
  return [];
}

/** §2 框选矩阵（工具族 → 松手动作）；指针行不走此函数 */
export function boxSelectOps(tool: MatrixTool, notes: ChartNote[], items: SelectionItem[]): MatrixOp[] {
  if (isKeyTool(tool)) {
    // 框内音符逐个应用 ADR-0001 替换规则；可替换换型、不可替换跳过；原则4：批量后选区保留
    const r = batchApplyKeyType(notes, keyTargetsFromItems(notes, items), tool);
    return r.shouldReplace
      ? [{ t: 'setNotes', notes: r.newNotes }, { t: 'setSelection', items: remapSelection(notes, items, r.newNotes) }]
      : [];
  }
  if (tool === 'bpm' || tool === 'paste') return []; // 无效果
  if (tool === 'slide') return combineOps(notes, items); // §4 组合成滑条
  if (items.length === 0) return [];
  if (tool === 'copy') {
    return [{ t: 'setSelection', items }, { t: 'setClipboard', notes: copySelection(notes, items) }];
  }
  if (tool === 'cut') {
    const { clipboard, newNotes } = cutSelection(notes, items);
    return [{ t: 'setClipboard', notes: clipboard }, { t: 'setNotes', notes: newNotes }, { t: 'setSelection', items: [] }];
  }
  if (tool === 'delete') {
    return [{ t: 'setNotes', notes: deleteSelection(notes, items) }, { t: 'setSelection', items: [] }];
  }
  // mirror：拖拽期间预览（渲染器），松手立即执行（§2"无需二次确认"）
  return [{ t: 'setSelection', items }, { t: 'setNotes', notes: mirrorSelection(notes, items) }];
}

/** 动作族作用于单个条目（= 原 editToolAction 的纯函数化，Model A） */
function actionOnItemOps(tool: 'copy' | 'cut' | 'delete' | 'mirror', notes: ChartNote[], hit: SelectionItem): MatrixOp[] {
  const sel: SelectionItem[] = [hit];
  if (tool === 'copy') return [{ t: 'setSelection', items: sel }, { t: 'setClipboard', notes: copySelection(notes, sel) }];
  if (tool === 'cut') {
    const { clipboard, newNotes } = cutSelection(notes, sel);
    return [{ t: 'setClipboard', notes: clipboard }, { t: 'setNotes', notes: newNotes }, { t: 'setSelection', items: [] }];
  }
  if (tool === 'delete') return [{ t: 'setNotes', notes: deleteSelection(notes, sel) }, { t: 'setSelection', items: [] }];
  return [{ t: 'setSelection', items: sel }, { t: 'setNotes', notes: mirrorSelection(notes, sel) }];
}

export interface ExecInput {
  notes: ChartNote[];
  selectedItems: SelectionItem[];
  /** 谱面光标（ui.mousePosition）；null = 光标不在画布 → 无事发生（§3） */
  cursor: SnapPos | null;
  slideBuffer: SlidePoint | null;
  lastBpm: number;
  chartEndBeat: number;
}

/** §3 Ctrl+E：有选区 → 组合（<2 无事发生，不落两击档）；无选区 → 光标处临时端点（与鼠标两击共用 buffer） */
export function execSlideOps(input: ExecInput): MatrixOp[] {
  const { notes, selectedItems, cursor, slideBuffer, chartEndBeat } = input;
  if (selectedItems.length > 0) return combineOps(notes, selectedItems);
  if (!cursor || cursor.beat > chartEndBeat + 1e-6) return [];
  const point: SlidePoint = { beat: cursor.beat, lane: cursor.lane, subBeat: 0 };
  if (!slideBuffer) return [{ t: 'setSlideBuffer', point }];
  return slideSecondClickOps(notes, slideBuffer, point);
}

/** §3 Ctrl+`：光标处放置 BPM 线 → 就地编辑；光标不在画布 = 无事发生 */
export function execBpmOps(input: ExecInput): MatrixOp[] {
  const { notes, cursor, lastBpm, chartEndBeat } = input;
  if (!cursor || cursor.beat > chartEndBeat + 1e-6) return [];
  return bpmPlaceOps(notes, cursor.beat, lastBpm);
}
