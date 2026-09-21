// 曲线工具深模块（issue 136 / ADR-0009 §3）：配置、草稿、两击/框选/执行键/点段重应用、带组合落子。
// 烘焙仍在 SpanCurve（hidden 采样点是唯一真相）。矩阵只调度持工具态行。
// 单击选区内走 combineOps、框选/执行键选区≥2 走 curveBoxOps——差异冻结，不在本票对齐 issue 88。
import type { ChartNote, ConnectionNote, SelectionItem, SlideNote, LongNote, SpanParam } from '../types';
import { removeOverlappedNotes } from './NoteReplacementRules';
import { combineSelectionIntoSlide, compareAbsorbable, mergeChainWithSlides } from './SlideCombination';
import { slideSpans, regionIdentity } from './SlideSegments';
import {
  applyParamToAllSpans, bakeSpanPoints, connTrueBeat,
  countVisibleNodes, effectiveSpanParams, regenerateSpan,
} from './SpanCurve';
import { CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES, type CurvePrecision, type EasingFamily, type EasingType } from './Easing';
import { shapeTemplateById } from './ShapeTemplates';
import {
  clickOps,
  combineOps,
  sameSelectionItem,
  type ExecInput,
  type MatrixOp,
  type SlidePoint,
  type SnapPos,
} from './ToolActionMatrix';

/** 曲线工具当前配置（issue 114 起持久化于 `settings.curve`，全局一份、跨会话沿用；放置与段重应用共用）。
 *  `templateId` 非空 = 形状模板优先（ADR-0009 §2 三来源之三），缓动三字段被忽略。 */
export interface CurveConfig {
  family: EasingFamily;
  type: EasingType;
  precision: CurvePrecision;
  templateId?: string | null;
}

/**
 * 曲线工具出厂默认（issue 114 定案：默认缓动型由 `inOut` 改为 `in`）。
 * 放本模块——`AppSettings` 需要它做持久化归一化，且不依赖任何 Provider。
 */
export const DEFAULT_CURVE_CONFIG: CurveConfig = {
  family: 'sine',
  type: 'in',
  precision: 16,
  templateId: null,
};

/**
 * 持久化归一化（白名单校验 + 缺字段回落）：老设置文件没有 `curve` 段、或存了已下线的模板 id
 * / 非法枚举时，一律回落到出厂默认的那一项，绝不把脏值带进运行时。
 */
export function normalizeCurveConfig(raw: unknown): CurveConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CURVE_CONFIG;
  const family = (EASING_FAMILIES as readonly string[]).includes(o.family as string)
    ? (o.family as EasingFamily) : d.family;
  const type = (EASING_TYPES as readonly string[]).includes(o.type as string)
    ? (o.type as EasingType) : d.type;
  const precision = (CURVE_PRECISIONS as readonly number[]).includes(o.precision as number)
    ? (o.precision as CurvePrecision) : d.precision;
  const templateId = typeof o.templateId === 'string' && shapeTemplateById(o.templateId)
    ? o.templateId : null;
  return { family, type, precision, templateId };
}

/** 配置 → 段参数（模板优先；S4 起放置/重应用/预览三路共用，保证"所见即所得"） */
export const spanParamFromCurveConfig = (config: CurveConfig): SpanParam =>
  config.templateId
    ? { kind: 'template', templateId: config.templateId }
    : { kind: 'easing', family: config.family, type: config.type, precision: config.precision };

/** 曲线工具链式草稿：可见锚点序列 + 各段参数 + 首段落地后的滑条下标（完整性检查用） */
export interface CurveDraft {
  points: SlidePoint[];
  params: Record<number, SpanParam>;
  /** 首段写入 notes 的下标；null = 尚未落子（第一击前的锚点态） */
  noteIndex: number | null;
}

const samePos = (a: SlidePoint, b: SlidePoint) =>
  a.beat === b.beat && (a.subBeat || 0) === (b.subBeat || 0);

/** 段端点签名（真拍位 + lane）——合并产物中按签名找回被消耗滑条的段参数（序数会平移，签名不会） */
const spanSig = (a: { beat: number; lane: number; subBeat?: number }, b: { beat: number; lane: number; subBeat?: number }, beatDisplay: number) =>
  `${connTrueBeat(a, beatDisplay)},${a.lane}|${connTrueBeat(b, beatDisplay)},${b.lane}`;

const sameGridPos = (a: { beat: number; lane: number; subBeat?: number }, b: { beat: number; lane: number; subBeat?: number }) =>
  a.beat === b.beat && a.lane === b.lane && (a.subBeat || 0) === (b.subBeat || 0);

/**
 * **带组合的滑条落子**（issue 09 三/四轮，两击直放与画笔落子共用）：复用普通滑条的
 * `removeOverlappedNotes`（端点覆盖键型音符）+ `mergeChainWithSlides`（链端与既有滑条头/尾
 * 相接 = 合并，双向级联）；链自身的可见端点为 [start, end]，`hidden` 为调用方预烘焙的段内
 * 采样点（两击 = 缓动/模板烘焙；画笔 = 轨迹采样，可倒序反转后传入）；`param` = 新段参数
 * （画笔自由段传 null）。被消耗滑条的既有段参数按**段端点签名**找回（合并后序数平移不影响
 * 签名匹配），找不到签名的段退化为自由段。端点不相接任何滑条 = 独立新滑条（重叠位置合法）。
 * @returns 落子后的完整音符数组（合并结果写回首条被消耗滑条原下标，与普通两击路径同口径）
 */
export function placeSpanWithCombination(
  notes: ChartNote[],
  start: { beat: number; lane: number; subBeat?: number },
  end: { beat: number; lane: number; subBeat?: number },
  hidden: ConnectionNote[],
  param: SpanParam | null,
  beatDisplay: number,
): ChartNote[] {
  const work = [...notes];
  removeOverlappedNotes(work, start);
  removeOverlappedNotes(work, end);
  const merged = mergeChainWithSlides(work, [
    { beat: start.beat, lane: start.lane, subBeat: start.subBeat || 0 },
    { beat: end.beat, lane: end.lane, subBeat: end.subBeat || 0 },
  ]);

  if (merged.consumed.length === 0) {
    const connections: ConnectionNote[] = [
      { beat: start.beat, lane: start.lane, subBeat: start.subBeat || 0 },
      ...hidden,
      { beat: end.beat, lane: end.lane, subBeat: end.subBeat || 0 },
    ];
    const slide: SlideNote = {
      type: 'Slide',
      connections,
      ...(param ? { spanParams: { visibleCount: 2, bySpan: { 0: param } } } : {}),
    } as SlideNote;
    return [...work, slide];
  }

  const conns = merged.connections;
  let at = -1;
  for (let i = 0; i + 1 < conns.length; i++) {
    if (sameGridPos(conns[i]!, start) && sameGridPos(conns[i + 1]!, end)) { at = i; break; }
  }
  const finalConns = at >= 0
    ? [...conns.slice(0, at + 1), ...hidden, ...conns.slice(at + 1)]
    : conns;
  const consumedSet = new Set(merged.consumed);
  const sigParams = new Map<string, SpanParam>();
  for (const idx of merged.consumed) {
    const s = work[idx];
    if (!s || (s.type !== 'Slide' && s.type !== 'Long')) continue;
    const bySpan = effectiveSpanParams(s as SlideNote | LongNote);
    const cs = (s as SlideNote | LongNote).connections;
    slideSpans(cs).forEach((sp, i) => {
      const p = bySpan[i];
      if (p) sigParams.set(spanSig(cs[sp.start]!, cs[sp.end]!, beatDisplay), p);
    });
  }
  const bySpan: Record<number, SpanParam> = {};
  let last: ConnectionNote | null = null;
  let ordinal = 0;
  let chainOrdinal = -1;
  for (const cn of finalConns) {
    if (cn.hidden) continue;
    if (last !== null) {
      const carried = sigParams.get(spanSig(last, cn, beatDisplay));
      if (carried) bySpan[ordinal] = carried;
      if (sameGridPos(last, start) && sameGridPos(cn, end)) chainOrdinal = ordinal;
      ordinal++;
    }
    last = cn;
  }
  if (param && chainOrdinal >= 0) bySpan[chainOrdinal] = param;
  const hasParams = Object.keys(bySpan).length > 0;
  const slide: SlideNote = {
    type: merged.type,
    connections: finalConns,
    ...(hasParams ? { spanParams: { visibleCount: countVisibleNodes(finalConns), bySpan } } : {}),
  } as SlideNote;
  const result: ChartNote[] = [];
  work.forEach((n, i) => {
    if (consumedSet.has(i)) {
      if (i === Math.min(...merged.consumed)) result.push(slide);
      return;
    }
    result.push(n);
  });
  return result;
}

/**
 * §4 曲线工具两击直放（issue 09 / ADR-0009 §3；2026-09-13 三轮修订）：
 * 第一击 = 挂锚点；第二击 = 落子并清草稿（不残留"可连续放置"UI 态）。
 * 组合规则与落子本体都在 `placeSpanWithCombination`（与画笔落子共用）；此处只负责：
 * 点击次序无关（`compareAbsorbable` 排序）、新段按当前缓动/模板烘焙、同拍位取消（对标滑条两击）。
 */
export function curveChainClickOps(
  notes: ChartNote[],
  draft: CurveDraft,
  point: SlidePoint,
  config: CurveConfig,
  beatDisplay: number,
  clearSel: MatrixOp = { t: 'setSelection', items: [] },
): MatrixOp[] {
  const param = spanParamFromCurveConfig(config);
  if (draft.points.length === 0) {
    return [{ t: 'setCurveBuffer', draft: { points: [point], params: {}, noteIndex: null } }, clearSel];
  }
  const anchor = draft.points[0]!;
  if (samePos(anchor, point)) {
    return [{ t: 'setCurveBuffer', draft: null }, clearSel];
  }
  const [start, end] = compareAbsorbable(anchor, point) <= 0 ? [anchor, point] : [point, anchor];
  const fromBeat = connTrueBeat(start, beatDisplay);
  const toBeat = connTrueBeat(end, beatDisplay);
  const baked = toBeat > fromBeat ? bakeSpanPoints(start, end, fromBeat, toBeat, param) : [];
  return [
    { t: 'setNotes', notes: placeSpanWithCombination(notes, start, end, baked, param, beatDisplay) },
    { t: 'setCurveBuffer', draft: null },
    clearSel,
  ];
}

/**
 * §4 曲线工具框选/执行键选区档（issue 09 验收反馈 #7 拍板）：**组合 + 全部段应用**——
 * 先走滑条组合（`combineSelectionIntoSlide`，与滑条工具框选同源），再对**被框涉及的每条滑条**
 * （组合产物写在被消耗滑条的最小下标，必属其中）的**每个逻辑段**应用当前曲线配置
 * （含覆盖既有缓动段参数的代价——用户知情拍板）。组合不成立时退化为纯批量应用
 * （框内已有滑条仍被施加配置），二者都未发生 = 无事发生。
 */
export function curveBoxOps(
  notes: ChartNote[],
  items: SelectionItem[],
  config: CurveConfig,
  beatDisplay: number,
  clearSel: MatrixOp = { t: 'setSelection', items: [] },
): MatrixOp[] {
  if (items.length === 0) return [];
  const param = spanParamFromCurveConfig(config);
  const comb = combineSelectionIntoSlide(notes, items);
  let newNotes = comb.shouldCombine ? comb.newNotes : notes;
  let changed = comb.shouldCombine;
  const targetIdx = new Set<number>(items
    .map((it) => it.noteIndex)
    .filter((idx) => {
      const n = notes[idx];
      return !!n && (n.type === 'Slide' || n.type === 'Long');
    }));
  if (comb.shouldCombine && comb.slideIndex !== undefined) targetIdx.add(comb.slideIndex);
  for (const idx of targetIdx) {
    const n = newNotes[idx];
    if (!n || (n.type !== 'Slide' && n.type !== 'Long')) continue;
    const next = applyParamToAllSpans(n as SlideNote | LongNote, param, beatDisplay);
    if (next !== n) {
      newNotes = newNotes.map((x, i) => (i === idx ? next : x));
      changed = true;
    }
  }
  if (!changed) return [];
  return [{ t: 'setNotes', notes: newNotes }, clearSel];
}

/** ADR-0008 单击矩阵曲线行本体（含冻结的「选区内 → 只组合」）。 */
export function curveToolClickOps(
  input: {
    notes: ChartNote[];
    hit: SelectionItem | null;
    pos: SnapPos | null;
    selectedItems: SelectionItem[];
    beatDisplay: number;
    curveDraft?: CurveDraft | null;
    curveConfig?: CurveConfig | null;
  },
  clearSel: MatrixOp,
): MatrixOp[] {
  const { notes, hit, pos, selectedItems, beatDisplay } = input;
  const hitInSelection = hit !== null && selectedItems.some(it => sameSelectionItem(it, hit));
  if (hitInSelection) {
    const ops = combineOps(notes, selectedItems);
    if (ops.length > 0) return ops;
  }
  if (hit && hit.kind === 'slideRegion' && input.curveConfig) {
    const target = notes[hit.noteIndex];
    if (target && (target.type === 'Slide' || target.type === 'Long')) {
      const id = regionIdentity((target as SlideNote | LongNote).connections, hit.connIndex);
      if (id) {
        const param = spanParamFromCurveConfig(input.curveConfig);
        const next = regenerateSpan(target as SlideNote | LongNote, id.ordinal, param, beatDisplay);
        return [{ t: 'setNotes', notes: notes.map((n, i) => (i === hit.noteIndex ? next : n)) }, clearSel];
      }
    }
  }
  if (!pos) return input.curveDraft ? [{ t: 'setCurveBuffer', draft: null }, clearSel] : [clearSel];
  const point: SlidePoint = { beat: pos.beat, lane: pos.lane, subBeat: 0 };
  const draft = input.curveDraft ?? null;
  if (!draft) return [{ t: 'setCurveBuffer', draft: { points: [point], params: {}, noteIndex: null } }, clearSel];
  return curveChainClickOps(notes, draft, point, input.curveConfig!, beatDisplay, clearSel);
}

/**
 * §3 执行-曲线（Shift+W，验收反馈 #9）：执行键语义按光标分发（对齐 Ctrl+E 双语义先例）——
 * 选区 ≥2 → 组合 + 全部段应用（与框选同源 `curveBoxOps`）；否则光标不在画布/越末端 → 无事发生；
 * 否则与曲线工具**单击**完全同源（`clickOps` curve 行）。
 */
export function execCurveOps(input: ExecInput & {
  beatDisplay: number;
  curveDraft?: CurveDraft | null;
  curveConfig?: CurveConfig | null;
  hit: SelectionItem | null;
  clipboard: ChartNote[];
}): MatrixOp[] {
  const { notes, selectedItems, cursor, chartEndBeat, beatDisplay, curveDraft, curveConfig, hit } = input;
  if (selectedItems.length >= 2 && curveConfig) {
    return curveBoxOps(notes, selectedItems, curveConfig, beatDisplay);
  }
  if (!cursor || !curveConfig || cursor.beat > chartEndBeat + 1e-6) return [];
  return clickOps({
    tool: 'curve', notes, hit,
    pos: { beat: cursor.beat, lane: cursor.lane },
    slideBuffer: null, lastBpm: input.lastBpm, clipboard: input.clipboard,
    chartEndBeat, beatDisplay, selectedItems, curveDraft, curveConfig,
  });
}
