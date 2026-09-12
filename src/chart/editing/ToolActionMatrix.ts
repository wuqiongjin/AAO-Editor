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
import { deleteSelection, mirrorSelection, remapSelection } from './SelectionEditing';
import { combineSelectionIntoSlide, compareAbsorbable } from './SlideCombination';
// 对象视图目标（issue 59 §4）在 NoteCodeOps 定义（回写走同一类型），转出供 op 与调用方使用
import { noteCodeTargetForHit, type NoteCodeTarget } from './NoteCodeOps';
export type { NoteCodeTarget } from './NoteCodeOps';

/**
 * 持工具态（与 UIProvider.ArmedTool 同构；本模块保持零 UI 依赖）。
 * ADR-0008 §2.1（六轮）：**复制 / 剪切不占工具轴**——二者必须有选区（作用于对象而非位置），
 * 连续复制无意义、连续剪切有误删风险，只保留 Ctrl+C / Ctrl+X 执行键作用于选区。
 */
export type MatrixTool =
  | 'single' | 'flick' | 'skill' | 'ldirectional' | 'rdirectional'
  | 'bpm' | 'slide'
  | 'delete' | 'paste' | 'mirror'
  | 'noteCode'; // issue 59 §2：持工具态，点音符 = 打开该音符代码弹窗（唯一不改谱面的工具）

export interface SlidePoint { beat: number; lane: number; subBeat: number }
export interface SnapPos { beat: number; lane: number }

export type MatrixOp =
  | { t: 'setNotes'; notes: ChartNote[] }          // handleNotesChange（单快照）
  | { t: 'setSelection'; items: SelectionItem[] }  // setSelectedItems
  | { t: 'setClipboard'; notes: ChartNote[] }      // setClipboard
  | { t: 'setSlideBuffer'; point: SlidePoint | null }
  | { t: 'openBpmEditor'; beat: number; value: string } // §5 就地编辑
  | { t: 'openNoteCode'; target: NoteCodeTarget };      // issue 59 §3：打开该音符/结点的代码弹窗

const isKeyTool = (tool: MatrixTool): tool is 'single' | 'flick' | 'skill' | 'ldirectional' | 'rdirectional' =>
  tool === 'single' || tool === 'flick' || tool === 'skill' || tool === 'ldirectional' || tool === 'rdirectional';
const isActionTool = (tool: MatrixTool): tool is 'delete' | 'mirror' =>
  tool === 'delete' || tool === 'mirror';

/** 命中的是否是一条**已有** BPM 线（issue 56 Q14=A：单击 BPM 线默认无效果，只有删除/音符代码两个例外） */
const hitIsBpm = (notes: ChartNote[], hit: SelectionItem | null): boolean =>
  hit !== null && hit.kind === 'note' && notes[hit.noteIndex]?.type === 'BPM';

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

/**
 * §4 两击直放的"第二次合法点击"→ 成条/接合。Ctrl+E 无选区档与鼠标两击共用。
 * @param clearSel 成条/取消锚点后清选区的 op（原则 6）；由 clickOps 传入以复用同一实例
 */
export function slideSecondClickOps(
  notes: ChartNote[],
  buf: SlidePoint,
  point: SlidePoint,
  clearSel: MatrixOp = { t: 'setSelection', items: [] },
): MatrixOp[] {
  if (samePos(buf, point)) {
    // 同 beat+subBeat 的两点（**不看 lane**）→ 不成条并清空缓冲。
    // 该分支同时承担两条语义：① bug 32「同位再点 = 取消锚点」；② ADR-0001 §2「禁止横向放置（仅两击直放）」
    // ——同拍不同轨即横向段，在此被拦下（框选组合路径不受此限，见 §4）。
    return [{ t: 'setSlideBuffer', point: null }, clearSel];
  }
  const comb = handleSlideToSlideCombination(notes, [buf, point]);
  if (comb.shouldCombine) return [{ t: 'setNotes', notes: comb.newNotes }, { t: 'setSlideBuffer', point: null }, clearSel];
  const newNotes = [...comb.newNotes];
  // 与 §4 排序规则同口径（beat → subBeat → lane），保证两击次序无关。
  // 候选 4 归一：此前此处内联了一份与 `compareAbsorbable` 逐字相同的比较器，而 §4 锁表锁的是
  // 后者 —— 改了排序规则这里不会红（正是 SlideCombination 注释警告的"锁表锁成死代码"）。
  const [start, end] = [buf, point].sort(compareAbsorbable);
  // clone：start/end 来自 slideBuffer / 落点对象，直接塞进谱面会让 UI 态与历史快照共享同一可变对象
  newNotes.push({ type: 'Slide', connections: [{ ...start }, { ...end }] });
  return [{ t: 'setNotes', notes: newNotes }, { t: 'setSlideBuffer', point: null }, clearSel];
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
  /** 谱面末端（ADR-0005 §5）；issue 73：粘贴按**整组**校验末端，与放置同口径 */
  chartEndBeat: number;
  /** 子拍细分（subBeat 的单位分母）；粘贴的末端校验需要它折算真实拍位 */
  beatDisplay: number;
  /** 当前选区（issue 88）：命中项 ∈ 选区 → 动作作用于整片；否则只作用被点那一个 */
  selectedItems: SelectionItem[];
}

/** §2 单击矩阵（工具族行 × 音符/空白列）；指针行不走此函数（指针行在画布侧 selectItemAtPoint） */
export function clickOps(input: ClickInput): MatrixOp[] {
  const { tool, notes, hit, pos, slideBuffer, lastBpm, clipboard, chartEndBeat, beatDisplay, selectedItems } = input;
  // §2 原则 6：**非指针态单击画布 = 新意图 → 清空选区**，与落点是否合法、动作是否生效无关
  // （含"点轨道外/谱面末端外"这种非法落点：动作按 §1 无事发生，但选中态照样取消——
  // 用户点了画布，注意力已经转移；选中态留着只是噪音）。
  // 唯一保留选区的例外见原则 6：镜像/粘贴后 = 本次产物、框选批量后、拖拽后、复制后。
  // **issue 88 追加例外**：命中项 ∈ 选区时，这一击被选区消费 → 作用于整片，且**不清**选区
  // （清不清交给动作自身：删除清 / 镜像→选区=产物 / 键型保留 / 组合清）。
  const clearSel: MatrixOp = { t: 'setSelection', items: [] };
  /** issue 88：命中项 ∈ 选区（`sameSelectionItem` 口径，含滑条结点/区域） */
  const hitInSelection = hit !== null && selectedItems.some(it => sameSelectionItem(it, hit));
  // issue 56 Q14=A：点击**已有** BPM 线 = 无效果（BPM 的通路 = 完整框选 / 右键删除 / 沟槽数字就地编辑）。
  // 例外（issue 59 定案）：**删除** = 删除该线；**音符代码** = 打开该 BPM 的代码（走下方 noteCode 行，同结果）。
  // 作用域只到**非放置类**工具：键型 / Slide / 粘贴是栅格位放置，BPM 线不拦放置
  //（否则 lane 0 上恰好有 BPM 的拍就永远放不下音符）。
  if (hit && hitIsBpm(notes, hit)) {
    if (tool === 'delete') return actionOnTargetsOps('delete', notes, resolveActionTargets(hit, selectedItems));
    if (tool === 'bpm' || tool === 'mirror') return [clearSel];
  }
  if (isKeyTool(tool)) {
    // issue 88：命中 ∈ 选区 → **与「先切键型工具、再框选」完全同源** —— 直接复用框选矩阵的键型行
    //（`batchApplyKeyType` → ADR-0001 替换规则，含滑条结点拆条 / 端点标记覆盖 / 方向键 length+1 到 3 回 1；
    // 选区按结果 remap 保留）。空 op = 无事发生（不清选区），同样与框选口径一致。
    if (hitInSelection) return boxSelectOps(tool, notes, selectedItems);
    // 键型放置：音符/空白两列同格 = 栅格位放置（ADR-0001 替换规则由 handleNoteReplacement 内部处置）
    if (!pos) return [clearSel];
    const r = handleNoteReplacement(notes, pos.beat, pos.lane, 0, tool);
    return r.shouldReplace ? [{ t: 'setNotes', notes: r.newNotes }, clearSel] : [clearSel];
  }
  if (tool === 'bpm') {
    if (!pos) return [clearSel];
    // 放置 → 进入 §5 就地编辑（音符上/空白同左）
    return [...bpmPlaceOps(notes, pos.beat, lastBpm), clearSel];
  }
  if (tool === 'slide') {
    // issue 88（2026-09-11 用户口径修正）：命中 ∈ 选区 → **与「先切 Slide 工具、再框选」完全同源** ——
    // 直接复用框选矩阵 slide 行的同一入口 `combineOps`（§4 组合，**同拍横向合法**，与框选组合一致）。
    // 来源 <2 时 `combineOps` 返回空 → 回落到下面的两击直放（可组合就组合，否则当普通单击）。
    if (hitInSelection) {
      const ops = combineOps(notes, selectedItems);
      if (ops.length > 0) return ops;
    }
    // 非法位置点击 = 取消待连接锚点（issue 57 bug2 语义保留）+ 清选区
    if (!pos) return slideBuffer ? [{ t: 'setSlideBuffer', point: null }, clearSel] : [clearSel];
    const point: SlidePoint = { beat: pos.beat, lane: pos.lane, subBeat: 0 };
    // 第一击（挂锚点）同样清选区：与"点轨道外清"保持一致，不留"改不改谱面"的双轨判定
    if (!slideBuffer) return [{ t: 'setSlideBuffer', point }, clearSel];
    return slideSecondClickOps(notes, slideBuffer, point, clearSel);
  }
  if (tool === 'paste') {
    // §2.1：粘贴作用于位置 —— 剪贴板组的包围盒左上角对齐到该落点（锚点语义归 shiftGroupToAnchor）。
    // 持工具态**驻留**（矩阵只产出 op，不清 armedTool）→ 连续粘贴；粘贴产物成为新选区。
    if (!pos || clipboard.length === 0) return [clearSel]; // 非法落点/空剪贴板：只清选区
    // 选区 = 实际写入/改动的下标（重叠替换与拆条会让下标不连续，不能用 newStartIndex+i）
    const { newNotes, written, rejected } = pasteChartNotes(notes, clipboard, pos.beat, pos.lane,
      { chartEndBeat, beatDisplay });
    // issue 73：整组越出谱面末端 → 拒绝整组（只清选区，不写谱面）
    if (rejected) return [clearSel];
    const items = written.map(i => ({ kind: 'note' as const, noteIndex: i }));
    return [{ t: 'setNotes', notes: newNotes }, { t: 'setSelection', items }];
  }
  if (tool === 'noteCode') {
    // §3「音符代码」：点音符 = 打开该音符/结点的代码（点击优先于选区，粒度沿用 findItemAt）；
    // **并清空选区**（issue 83，2026-09-11 用户重新定案：noteCode 不再是 §2 原则 6 的例外 ——
    // 用户点了画布，注意力就已转移，上一个工具留下的选中态继续亮着是噪音；
    // 尤其"选中 A → 切音符代码 → 点 B"时，A 的选中框还挂在那儿）。
    // 点空白 / 轨道外（无命中）同样清选区（原则 6：与动作是否生效无关）。
    if (!hit) return [clearSel];
    // §4（issue 93）：多段滑条的「段」/中间结点 = 子段视图（target 带 span）——点段默认子段视图、
    // 点中间结点默认结点视图（面包屑多一档"子段代码"可点）。单段滑条（A—B / A—H—B）维持旧口径：
    // region 回退整条、结点走结点视图（单段的"段视图"与整条层内容相同，隐藏子段层）。端点 = 结点视图。
    return [{ t: 'openNoteCode', target: noteCodeTargetForHit(notes, hit) }, clearSel];
  }
  if (isActionTool(tool)) {
    // 音符 = 选中并立即执行（Model A，ADR-0002 §3.2）；
    // issue 88：命中 ∈ 选区 → **与「先切动作工具、再框选」完全同源** —— 复用框选矩阵的删除/镜像行；
    // 命中在选区外 → 只作用被点那一个（现状）。
    // 空白（轨道内）与轨道**外**（落点非法）**一律清选区**（issue 83，2026-09-11 扩订）：
    // 旧口径只有"落点非法才清"，于是"点轨道内空白"成了双轨 —— 按用户口径，点了画布
    // 注意力就已转移，与动作是否生效、落点是否合法都无关。
    if (!hit) return [clearSel];
    if (hitInSelection) return boxSelectOps(tool, notes, selectedItems);
    return actionOnTargetsOps(tool, notes, [hit]);
  }
  return [];
}

/**
 * §2 框选矩阵（工具族 → 松手动作）；指针行不走此函数
 * @param bpmInBox 被框"整条覆盖"的 BPM 线（画布侧 `computeBpmLinesInBox` 单独收集）。
 *   issue 71：BPM **不进选区**，但删除工具的框选是批量执行而非建选区 → 仍按此集合删除。
 */
export function boxSelectOps(
  tool: MatrixTool,
  notes: ChartNote[],
  items: SelectionItem[],
  bpmInBox: readonly SelectionItem[] = [],
): MatrixOp[] {
  if (isKeyTool(tool)) {
    // 框内音符逐个应用 ADR-0001 替换规则；可替换换型、不可替换跳过；原则4：批量后选区保留
    const r = batchApplyKeyType(notes, keyTargetsFromItems(notes, items), tool);
    return r.shouldReplace
      ? [{ t: 'setNotes', notes: r.newNotes }, { t: 'setSelection', items: remapSelection(notes, items, r.newNotes) }]
      : [];
  }
  // §3：「音符代码」= **不可框选**（画布侧按下拖拽根本不启动框选；此处兜底为无效果）
  if (tool === 'noteCode') return [];
  // §2 框选矩阵 BPM 格（issue 71 修订）：BPM 线**不入选**（不是音符，选中无意义），
  // 故 BPM 工具框选 = 无效果。它对框选生效的唯一通路是下面 delete 行的 `bpmInBox`。
  if (tool === 'bpm') return [];
  // issue 72：粘贴态在画布侧**根本不启动框选**（`canStartMarquee`），此处只是兜底无效果
  if (tool === 'paste') return [];
  if (tool === 'slide') return combineOps(notes, items); // §4 组合成滑条
  if (tool === 'delete') {
    // issue 71 例外（用户拍板 A）：删除是"批量执行"不是建选区 → 被整条框住的 BPM 线照删。
    // 它不进选区，故只在删除目标集合里合并一次（去重，防与 items 重复）。
    const targets = [...items];
    for (const b of bpmInBox) {
      if (!targets.some(t => sameSelectionItem(t, b))) targets.push(b);
    }
    if (targets.length === 0) return [];
    return [{ t: 'setNotes', notes: deleteSelection(notes, targets) }, { t: 'setSelection', items: [] }];
  }
  if (items.length === 0) return [];
  if (tool === 'mirror') {
    // mirror：拖拽期间预览（渲染器），松手立即执行（§2"无需二次确认"）
    return [{ t: 'setSelection', items }, { t: 'setNotes', notes: mirrorSelection(notes, items) }];
  }
  return []; // 其余（含 §2.1 已退出工具轴的 copy/cut 旧配置残留）→ 无效果
}

/**
 * 动作族作用于单个条目（= 原 editToolAction 的纯函数化，Model A）。
 * 导出供**右键删除**复用（issue 70）：右键此前绕过本矩阵直连 deleteSelection，
 * 与「删除工具点音符」是同一语义的两份实现。两类调用方的差异只在于画布侧
 * 是否额外清理悬垂 UI 态（Slide 锚点 / BPM 就地编辑框）——那是 UI 态，不进矩阵。
 */
/**
 * issue 88：单击的**目标集合** —— 该工具的"待作用对象"。
 * 命中项 ∈ 当前选区 → 作用于**整片选区**（用户 2026-09-11 拍板）；否则只作用于被点那一个（issue 83 现状）。
 *
 * 这是 §2 原则 6「非指针态单击 = 清选区」的**新例外**：这一击被选区消费 → 不清，
 * 清不清由动作自身决定（删除清 / 镜像→ 选区 = 镜像产物 / 键型保留 / 组合清）。
 */
export function resolveActionTargets(
  hit: SelectionItem | null,
  selectedItems: readonly SelectionItem[],
): SelectionItem[] {
  if (!hit) return [];
  return selectedItems.some(it => sameSelectionItem(it, hit)) ? [...selectedItems] : [hit];
}

/** 动作族作用于一组目标条目（删除 → 清选区；镜像 → 选区 = 镜像产物） */
export function actionOnTargetsOps(tool: 'delete' | 'mirror', notes: ChartNote[], targets: SelectionItem[]): MatrixOp[] {
  if (targets.length === 0) return [];
  if (tool === 'delete') return [{ t: 'setNotes', notes: deleteSelection(notes, targets) }, { t: 'setSelection', items: [] }];
  return [{ t: 'setSelection', items: targets }, { t: 'setNotes', notes: mirrorSelection(notes, targets) }];
}

export function actionOnItemOps(tool: 'delete' | 'mirror', notes: ChartNote[], hit: SelectionItem): MatrixOp[] {
  return actionOnTargetsOps(tool, notes, [hit]);
}

export interface ExecInput {
  notes: ChartNote[];
  selectedItems: SelectionItem[];
  /** 谱面光标；null = 光标不在画布 → 无事发生（§3）。
   *  候选 3：由调用方按当前 viewport **现算**传入，不接受缓存值（缓存会在滚动/缩放后落到旧拍）。 */
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
  // 与 clickOps 同口径：挂锚点也清选区（§2 原则 6）
  if (!slideBuffer) return [{ t: 'setSlideBuffer', point }, { t: 'setSelection', items: [] }];
  return slideSecondClickOps(notes, slideBuffer, point);
}

/** §3 Ctrl+`：光标处放置 BPM 线 → 就地编辑；光标不在画布 = 无事发生 */
export function execBpmOps(input: ExecInput): MatrixOp[] {
  const { notes, cursor, lastBpm, chartEndBeat } = input;
  if (!cursor || cursor.beat > chartEndBeat + 1e-6) return [];
  // §2 原则 6：执行键与单击同语义 → 放置后清选区
  return [...bpmPlaceOps(notes, cursor.beat, lastBpm), { t: 'setSelection', items: [] }];
}
