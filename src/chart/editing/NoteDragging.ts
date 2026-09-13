// ADR-0008 §6：指针态拖拽移动已放置音符（纯模块，可单测）。
// 语义：吸附落点 = beat 栅格 × lane 整格（换算在画布侧完成）；整体位移 = 单一 delta；
// 非法落点（越界/不可裁决的碰撞/不支持）→ ok=false，画布据此隐藏幽灵并回弹。
// 落点碰撞不一律回弹，按 ADR-0001 既有规则裁决（§6 四轮修订）：滑条端点↔滑条端点 = §3 接合；
// 键音符↔键音符 = §1.1 替换；滑条端点→键音符 = 覆盖删除（removeOverlappedNotes 同语义）。
// 无就地变异：受影响音符构造新对象，其余复用原引用（ADR-0001 §4 结构共享）。
import type { ChartNote, SelectionItem, SlideNote, LongNote, ConnectionNote } from '../types';
import { quantizeBeat } from '../geometry/ChartGeometry';
import { mergeChainWithSlides } from './SlideCombination';
import { handleNoteReplacement } from './NoteReplacementRules';
import { slideSpans } from './SlideSegments';
import { bendSpan, effectiveSpanParams, remapFreeSpanHidden, reprojectSpanParams } from './SpanCurve';
import type { CurvePrecision } from './Easing';

/**
 * 拖拽的拍位移（issue 61）：**量化对象 = 被拖对象的落点**，不是光标。
 *
 * 旧实现在画布侧算 `dBeat = snap(cursor_now) − snap(cursor_press)` 再把这个"光标吸附拍位差"
 * 加到音符自己的拍位上。音符落在非当前网格（1/8 吸附放的，之后切到 1/4）时，
 * `snap(按下点) − 音符真实拍位` 这个相位偏移被永久带进落点 → 每次位移确实是 1/4 的整数倍，
 * 但只能在 1/8 的相位线上走，永远踩不到当前网格线。
 *
 * 新算法：先把抓取偏移（按下时光标相对对象中心的偏移，保住"按住哪儿拖哪儿"的手感）从当前
 * 光标拍位里减掉，再量化到当前网格 → 落点恒在网格上；对象已在网格上时结果与旧算法完全一致。
 *
 * @param anchorBeat 被按住那件对象的**真实**拍位（`beat + subBeat/beatDisplay`）
 * @param rawPressBeat 按下时光标的**未量化**拍位
 * @param rawCurBeat 当前光标的**未量化**拍位
 */
export function dragDeltaBeat(input: {
  anchorBeat: number;
  rawPressBeat: number;
  rawCurBeat: number;
  beatDisplay: number;
}): number {
  const grab = input.rawPressBeat - input.anchorBeat;
  const target = quantizeBeat(input.rawCurBeat - grab, input.beatDisplay);
  return target - input.anchorBeat;
}

/**
 * 该对象在虚拟时间轴上的**真实拍位**（含 subBeat 折算，口径与 `ChartGeometry.noteVirtualY` 一致）。
 * 拖拽锚点用它：按住哪件对象，就以哪件对象的拍位为量化基准（issue 61）。
 * BPM/System 不可拖 → null。
 */
export function itemTrueBeat(notes: readonly ChartNote[], item: SelectionItem, beatDisplay: number): number | null {
  const n = notes[item.noteIndex];
  if (!n) return null;
  const bd = beatDisplay > 0 ? beatDisplay : 1;
  if (item.kind === 'slideNode') {
    if (n.type !== 'Slide' && n.type !== 'Long') return null;
    const conn = (n as SlideNote).connections[item.connIndex];
    return conn ? conn.beat + (conn.subBeat && conn.subBeat > 0 ? conn.subBeat / bd : 0) : null;
  }
  if (item.kind === 'slideRegion') {
    // issue 09 S3（ADR-0009 §4）：区域可拖 = 拉弓变形；锚拍取段起点（bend 只吃 dLane，beat 分量忽略）
    if (n.type !== 'Slide' && n.type !== 'Long') return null;
    const conn = (n as SlideNote).connections[item.connIndex];
    return conn ? conn.beat + (conn.subBeat && conn.subBeat > 0 ? conn.subBeat / bd : 0) : null;
  }
  if (n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional') {
    return n.beat + (n.subBeat && n.subBeat > 0 ? n.subBeat / bd : 0);
  }
  if (n.type === 'Slide' || n.type === 'Long') {
    const first = (n as SlideNote).connections[0];
    return first ? first.beat + (first.subBeat && first.subBeat > 0 ? first.subBeat / bd : 0) : null;
  }
  return null; // BPM / System
}

export interface DragDelta {
  /** 拍位移（已是栅格整数倍） */
  dBeat: number;
  /** 轨道位移（整数） */
  dLane: number;
}

export interface DragMoveResult {
  ok: boolean;
  /** ok=true 时的新谱面；ok=false 时为原数组引用 */
  notes: ChartNote[];
  /** ok=true 时拖拽集合在新数组中的等价条目（下标可能因覆盖/接合而变，已重映射） */
  items: SelectionItem[];
  /** 幽灵预览要绘制的音符（下标已随覆盖/接合变动，不能由新旧数组逐位比对得出） */
  ghost?: ChartNote[];
  reason?: 'out-of-bounds' | 'collision' | 'unsupported';
}

const isKey = (n: ChartNote) => n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional';

/**
 * 键音符 → 放置工具的 id（issue 76）：拖拽落点撞滑条结点时，用它把"移动"改判为"放置"。
 * 口径与 `pasteChartNotes` 完全一致（flick 标记 → 滑键、skill 标记 → 技能键，否则单键）。
 */
const keyToolIdOf = (n: ChartNote): string =>
  n.type === 'Single'
    ? (n.flick ? 'flick' : (n.skill ? 'skill' : 'single'))
    : n.type.toLowerCase();
const isSlideish = (n: ChartNote): n is SlideNote | LongNote => n.type === 'Slide' || n.type === 'Long';

const TOTAL_LANES = 7; // 与 NoteEditing.TOTAL_LANES 一致（此处内联避免引动历史模块）
const EPS = 1e-6;

/** 从 from 朝 dir（±1）找最近的**可见**结点（issue 09 S3：hidden 不作被拖结点的移动边界） */
function nearestVisible(conns: ConnectionNote[], from: number, dir: -1 | 1): ConnectionNote | undefined {
  for (let k = from + dir; k >= 0 && k < conns.length; k += dir) {
    if (!conns[k]!.hidden) return conns[k];
  }
  return undefined;
}

/**
 * 重烘焙（拖端点 → `reprojectSpanParams`）只增删段内 **hidden** 点 → 可见结点的**序数**不变、
 * 下标会变。落点裁决与选区回写必须先把旧下标按可见序数映射到新数组（issue 09 验收反馈 #4：
 * 向下拖端点 = 跨度变短 = 数组变短 → 旧下标 `conns[16]` 直接 undefined 崩溃，整个拖拽手势被杀死；
 * 向上拖 = 变长 → 检查错位的 hidden 点；提交后选区 connIndex 同样失效）。
 */
function remapVisibleIndex(conns: ConnectionNote[], origConns: ConnectionNote[], ci: number): number {
  if (conns[ci] && !conns[ci]!.hidden) return ci; // 未被重烘焙挪动（同数组 / 整条平移）
  let ord = 0;
  for (let k = 0; k < ci; k++) if (!origConns[k]!.hidden) ord++;
  let seen = 0;
  for (let k = 0; k < conns.length; k++) {
    if (conns[k]!.hidden) continue;
    if (seen === ord) return k;
    seen++;
  }
  return ci; // 不应发生（可见结点不会因重烘焙消失）；兜底返回原值
}

const posKey = (beat: number, subBeat: number, lane: number) => `${beat}|${subBeat}|${lane}`;
/**
 * 真实拍位：subBeat 的单位是 **1/beatDisplay**（与 ChartGeometry.noteVirtualY、
 * hitTest 索引同口径），不能当作拍的小数部分直接相加。
 */
const sumBeat = (beat: number, subBeat: number, beatDisplay: number) =>
  beat + (subBeat > 0 ? subBeat / beatDisplay : 0);

/** 工作数组元素：note + 其在入参 notes 中的原下标（覆盖/接合会增删元素，靠它重映射选区） */
interface Tagged { note: ChartNote; orig: number }

/**
 * 拖拽落点判定 + 构造（纯函数）。
 * items = 画布侧过滤后的拖拽集合（可能含 kind:'note' 键型/整条滑条 与 kind:'slideNode'）。
 * 同一条滑条既有整条条目又有子结点条目 → 按整条处置（子结点条目忽略）。
 * 同一滑条多个子结点被分别拖动 → 各自位移后用最终邻居位置互校（防退化交叉）。
 * 落点碰撞裁决表（§6 四轮修订，规则全部复用 ADR-0001 既有实现）：
 * | 拖拽件 \ 落点既有 | 键音符            | 滑条端点         | 滑条中间结点 |
 * | 键音符            | §1.1 替换(目标消耗)| 回弹             | 回弹         |
 * | 滑条端点          | 覆盖删除(§6.3)     | §3 接合(异条)    | 回弹         |
 * | 滑条中间结点      | 回弹               | 回弹             | 回弹         |
 * 拖拽件之间互撞（含同一位置被两件认领）→ 回弹（组内不自覆盖、不互接合）。
 */
export function planDragMove(
  notes: ChartNote[],
  items: SelectionItem[],
  delta: DragDelta,
  /** chartEndBeat = 谱面末端；beatDisplay = 子拍细分（subBeat 的单位分母，用于真实拍位换算）；
   *  bendPrecision = 拨弯普通段时的补采样密度（issue 09 S3，缺省 1/16） */
  bounds: { chartEndBeat: number; beatDisplay: number; bendPrecision?: CurvePrecision },
): DragMoveResult {
  const noChange: DragMoveResult = { ok: false, notes, items: [], reason: 'unsupported' };
  const fail = (reason: 'out-of-bounds' | 'collision' | 'unsupported'): DragMoveResult =>
    ({ ok: false, notes, items: [], reason });
  if (delta.dBeat === 0 && delta.dLane === 0) return { ok: true, notes, items };
  const beatDisplay = bounds.beatDisplay > 0 ? bounds.beatDisplay : 1;

  // issue 09 S3（ADR-0009 §4）：**单独拖一个滑条段 = 拉弓变形**——lane 方向拨弯（beat 分量忽略）、
  // 两端可见结点锚定、段内 hidden 按三角权重跟随；普通段拨弯 = 自动补采样点转化（Q10=B）；
  // 被拨段参数清除（一动就自由化）。混合选区不 bend（region 条目按不可拖处理，其余照旧移动）。
  if (items.length === 1 && items[0]!.kind === 'slideRegion') {
    const it = items[0]!;
    const n = notes[it.noteIndex];
    if (!n || !isSlideish(n)) return noChange;
    if (delta.dLane === 0) return { ok: true, notes, items };
    const bent = bendSpan(n as SlideNote | LongNote, it.connIndex, delta.dLane, beatDisplay, bounds.bendPrecision ?? 16);
    if (bent === (n as SlideNote | LongNote)) return noChange;
    const newNotes = notes.map((x, i) => (i === it.noteIndex ? (bent as ChartNote) : x));
    return { ok: true, notes: newNotes, items: [it], ghost: [bent as ChartNote] };
  }

  // 归组：noteIndex → 拖拽方式（whole=整条移动；nodes=指定 conn 下标集合）
  type Plan = { kind: 'whole' } | { kind: 'nodes'; conns: Set<number> };
  const plans = new Map<number, Plan>();
  // 验收反馈 #4：拖端点触发重烘焙 → 可见结点下标平移；noteIndex → (原 conn 下标 → 新下标)
  const connIdxRemap = new Map<number, Map<number, number>>();
  let hasDraggable = false;
  for (const it of items) {
    const n = notes[it.noteIndex];
    if (!n) continue;
    if (it.kind === 'slideRegion') continue; // 区域不可单独拖（画布侧已过滤，防御）
    if (it.kind === 'note') {
      if (!isKey(n) && !isSlideish(n)) continue; // BPM/System 不支持
      plans.set(it.noteIndex, { kind: 'whole' });
      hasDraggable = true;
    } else {
      // slideNode
      if (!isSlideish(n)) continue;
      const existing = plans.get(it.noteIndex);
      if (existing?.kind === 'whole') continue; // 整条优先
      if (!existing) plans.set(it.noteIndex, { kind: 'nodes', conns: new Set([it.connIndex]) });
      else existing.conns.add(it.connIndex);
      hasDraggable = true;
    }
  }
  if (!hasDraggable) return noChange;

  const dragItems = items.filter(it => plans.has(it.noteIndex));

  const inLane = (lane: number) => lane >= 0 && lane < TOTAL_LANES;
  const inBeat = (beat: number, sub: number) => {
    const b = sumBeat(beat, sub, beatDisplay);
    return b >= -EPS && b <= bounds.chartEndBeat + EPS;
  };

  // ① 位移后的音符 + 越界 / 邻居序校验（无就地变异）
  // 顺带累积**落点窗口**（② 占位表的裁剪依据，见下方 ② 的正确性说明）：
  // 只在既有类型分支里加一行标记，不为此再开一遍全谱循环。
  let winLo = Infinity, winHi = -Infinity;
  const markWindow = (beat: number, sub: number) => {
    const b = sumBeat(beat, sub, beatDisplay);
    if (b < winLo) winLo = b;
    if (b > winHi) winHi = b;
  };
  const moved = new Map<number, ChartNote>();
  for (const [i, plan] of plans) {
    const n = notes[i];
    if (isKey(n)) {
      const beat = n.beat + delta.dBeat;
      const lane = n.lane + delta.dLane;
      markWindow(beat, n.subBeat || 0);
      // issue 66 §4b：方向键是整组，但**只有根轨必须留在 0..6 内**——组尾溢出视觉合法
      // （放置链路口径已经允许在 lane 6 放 length=3 的右方向键让组尾溢出右侧）；
      // 拖拽落点保留同一口径：根轨在界内即合法，组尾越界照实落点、不回弹。
      // 单键还是只占一根 = `lanes = [lane]`，越界即非法。
      if (!inLane(lane) || !inBeat(beat, n.subBeat || 0)) return fail('out-of-bounds');
      moved.set(i, { ...n, beat, lane });
    } else if (isSlideish(n)) {
      const conns = n.connections.map((c, ci) =>
        plan.kind === 'whole' || plan.conns.has(ci)
          ? { ...c, beat: c.beat + delta.dBeat, lane: c.lane + delta.dLane }
          : { ...c });
      // 取**全部**结点（比"仅受动结点"宽）→ 窗口仍是落点键的超集，安全
      for (const c of conns) markWindow(c.beat, c.subBeat || 0);
      const touched = plan.kind === 'whole' ? conns.map((_, ci) => ci) : [...plan.conns];
      for (const ci of touched) {
        const c = conns[ci];
        if (!inLane(c.lane) || !inBeat(c.beat, c.subBeat || 0)) return fail('out-of-bounds');
      }
      if (plan.kind !== 'whole') {
        for (const ci of plan.conns) {
          const c = conns[ci];
          // issue 09 S3：邻居序校验只看**可见**邻居——段内 hidden 采样点随后会被重投影/重映射
          // 重建，不能作为被拖可见结点的移动边界（否则缓动段端点只能在一格采样内挪动）
          const prev = nearestVisible(conns, ci, -1);
          const next = nearestVisible(conns, ci, +1);
          // 结点必须严格保持在前后可见邻居之间（防交叉/退化段；端点只有单侧约束）
          if (prev && sumBeat(c.beat, c.subBeat || 0, beatDisplay) <= sumBeat(prev.beat, prev.subBeat || 0, beatDisplay) + EPS) return fail('out-of-bounds');
          if (next && sumBeat(c.beat, c.subBeat || 0, beatDisplay) >= sumBeat(next.beat, next.subBeat || 0, beatDisplay) - EPS) return fail('out-of-bounds');
        }
      }
      moved.set(i, { ...n, connections: conns });
      // issue 09 S3（ADR-0009 §4 拖端点/结点 = 移动意图，非改形）：
      // - 邻接被拖可见结点的**缓动段**：按原参数对新端点重烘焙（参数保留）
      // - 邻接的**自由段**：段内 hidden 相对形态保持、整体拉伸重映射
      // 整条移动（whole） = 平移保形，无需处理。
      if (plan.kind === 'nodes') {
        const prevConns = (n as SlideNote | LongNote).connections;
        const bySpan = effectiveSpanParams(n as SlideNote | LongNote);
        const movedVisible = [...plan.conns].filter(ci => !prevConns[ci]?.hidden);
        if (movedVisible.length > 0) {
          let conns2 = conns;
          const spans = slideSpans(conns2);
          for (let s = 0; s < spans.length; s++) {
            const sp = spans[s]!;
            const adjacent = movedVisible.some(ci => ci === sp.start || ci === sp.end);
            if (!adjacent || bySpan[s]) continue;
            conns2 = remapFreeSpanHidden(conns2, prevConns, sp, beatDisplay);
          }
          let m: SlideNote | LongNote = { ...(moved.get(i) as SlideNote | LongNote), connections: conns2 };
          m = reprojectSpanParams(m, beatDisplay);
          moved.set(i, m as ChartNote);
          // 验收反馈 #4：重烘焙增删 hidden → 被拖可见结点的下标可能整体平移。
          // ② 的占位表按**原下标**让位（不能动 plan.conns），故下标换算单独记账：
          // ③ 落点裁决按新数组取被拖结点，④ 选区回写换成新 connIndex。
          if (m.connections !== conns) {
            const map = new Map<number, number>();
            for (const ci of plan.conns) map.set(ci, remapVisibleIndex(m.connections, conns, ci));
            connIdxRemap.set(i, map);
          }
        }
      }
    }
  }

  // ② 未动对象占位表（被拖走的位置让出；部分拖动的滑条，其未动结点仍占位）
  //
  // issue 70 候选 2（实测）：原实现为**全谱**每个对象建一个 posKey 字符串 + Map.set
  // （5000 音符 ≈ 1.25ms/次），而查询只发生在拖拽件的落点上（≤ 几十次键比较）。
  // 本函数被**每次 mousemove** 调用算拖拽幽灵，故这是「单次交互响应成本」的最大项。
  //
  // 优化：先按**落点窗口**做一次纯数值预筛，只为窗口内的对象建表。
  // 正确性：占位键 = `beat|subBeat|lane` **精确相等**才可能命中，故真实拍位落在窗口外的
  // 对象不可能与任何落点键相等 —— 跳过它们是保守超集裁剪，不漏不误判（EPS 只放宽不收紧）。
  const occ = new Map<string, { orig: number; isKey: boolean; endpoint: boolean }>();
  const inWindow = (beat: number, sub: number) => {
    const b = sumBeat(beat, sub, beatDisplay);
    return b >= winLo - EPS && b <= winHi + EPS;
  };
  notes.forEach((n, i) => {
    const plan = plans.get(i);
    if (isKey(n)) {
      if (plan) return; // 原位置让出
      if (!inWindow(n.beat, n.subBeat || 0)) return;
      occ.set(posKey(n.beat, n.subBeat || 0, n.lane), { orig: i, isKey: true, endpoint: false });
    } else if (isSlideish(n)) {
      const last = n.connections.length - 1;
      // 整条都不在窗口内 → 一个键都不必建（先纯数值扫一遍，避免逐结点建键）
      let anyInWindow = false;
      for (const c of n.connections) {
        if (inWindow(c.beat, c.subBeat || 0)) { anyInWindow = true; break; }
      }
      if (!anyInWindow) return;
      n.connections.forEach((c, ci) => {
        if (plan && (plan.kind === 'whole' || plan.conns.has(ci))) return;
        // issue 77 #8：hidden 结点不占位 —— 它不可见/不可选中/不可 hover（issue 56 A6），
        // 拖任何音符到它所在位置都应被允许（它自己也照旧留在原 connections 里）。
        if (c.hidden) return;
        occ.set(posKey(c.beat, c.subBeat || 0, c.lane), { orig: i, isKey: false, endpoint: ci === 0 || ci === last });
      });
    }
  });

  // ③ 落点裁决：可覆盖/可接合 → 记录；不可裁决 → 回弹
  const claimed = new Set<string>();   // 拖拽件认领的落点（互撞 = 回弹，组内不自覆盖）
  const covered = new Set<number>();   // 被覆盖消耗的音符（notes 原下标）
  const joins: number[] = [];          // 需要走 §3 接合的拖拽滑条（notes 原下标）
  const joinedBy = new Set<number>();  // 已被认领的接合目标（防两件抢同一条）
  // issue 76：键音符拖到滑条结点 → 交回**放置**规则（ADR-0001 §1.2）。
  // 放置规则会把拖拽件本身消耗掉（技能键/滑键加标记、方向键拆条），故与"移动"是两条不同产物路径。
  // key = 被消耗的拖拽件下标；value = 落点 + 工具 id + 目标滑条下标（同一条滑条只许一次，防规则交叠）。
  const placements = new Map<number, { beat: number; lane: number; subBeat: number; toolId: string; targetNote: number }>();
  for (const [i, plan] of plans) {
    const nn = moved.get(i)!;
    if (isKey(nn)) {
      const k = posKey(nn.beat, nn.subBeat || 0, nn.lane);
      if (claimed.has(k)) return fail('collision');
      claimed.add(k);
      const t = occ.get(k);
      if (!t) continue;
      if (t.isKey) { covered.add(t.orig); continue; } // §1.1 替换：目标被拖拽件取代
      // issue 76：键音符 → 滑条结点**不再一律回弹**，改由放置规则裁决（与放置同源）：
      //   skill → 首/尾端点加 skill；flick → 尾端点加 flick；方向键 → 起/中/止结点拆条。
      //   放置规则判定为"忽略"的（单键→任意结点、滑键→非尾端点等）→ 仍回弹。
      //   仅**单件**拖拽走这条路径：组内多件同时落滑条会叠多条规则，保持回弹。
      // 同一条滑条上已有另一件要走放置规则 → 回弹（两条规则会互相改变对方的目标，先不支持）
      for (const p of placements.values()) {
        if (p.targetNote === t.orig) return fail('collision');
      }
      // 先按原谱面判可行性（判定"忽略"的组合，如单键→任意结点、滑键→非尾端点，仍回弹）
      const probe = handleNoteReplacement(notes, nn.beat, nn.lane, nn.subBeat || 0, keyToolIdOf(nn));
      if (!probe.shouldReplace) return fail('collision');
      placements.set(i, {
        beat: nn.beat, lane: nn.lane, subBeat: nn.subBeat || 0,
        toolId: keyToolIdOf(nn), targetNote: t.orig,
      });
      continue;
    }
    const conns = (nn as SlideNote).connections;
    const last = conns.length - 1;
    const remap = connIdxRemap.get(i);
    const touched = plan.kind === 'whole'
      ? conns.map((_, ci) => ci)
      : [...plan.conns].map(ci => remap?.get(ci) ?? ci); // 验收反馈 #4：重烘焙后按新下标取被拖结点
    for (const ci of touched) {
      const c = conns[ci];
      const k = posKey(c.beat, c.subBeat || 0, c.lane);
      if (claimed.has(k)) return fail('collision');
      claimed.add(k);
      const t = occ.get(k);
      if (!t) continue;
      if (t.isKey) {
        if (ci !== 0 && ci !== last) return fail('collision'); // 仅端点覆盖键音符（§6.3 同语义）
        covered.add(t.orig);
        continue;
      }
      if (t.endpoint && (ci === 0 || ci === last) && t.orig !== i && !joinedBy.has(t.orig)) {
        joinedBy.add(t.orig);
        joins.push(i);
        continue;
      }
      return fail('collision');
    }
  }

  // ④ 应用：覆盖消耗 → 端点接合（级联）→ 重映射选区 / 幽灵
  // issue 76：走放置规则的那条路径 —— 被放置规则吃掉的拖拽件**不落子**（从产物里移除），
  // 其余成员照常移动；幽灵仍画全部拖拽件的落点形态（覆盖/扣入也要有幽灵）。
  if (placements.size > 0) {
    // 放置规则与 §3 端点接合叠加的产物未定义 → 直接回弹（两者同时发生极罕见）
    if (joins.length > 0) return fail('collision');
    let arr: ChartNote[] = [];
    notes.forEach((n, i) => {
      if (placements.has(i)) return; // 被放置规则消耗
      if (covered.has(i)) return;    // 被覆盖消耗（§1.1）
      arr.push(moved.get(i) || n);
    });
    for (const p of placements.values()) {
      const r = handleNoteReplacement(arr, p.beat, p.lane, p.subBeat, p.toolId);
      if (!r.shouldReplace) return fail('collision'); // 保险（③已判过）
      arr = r.newNotes;
    }
    const ghost = [...plans.keys()].map(i => moved.get(i)).filter((n): n is ChartNote => !!n);
    return { ok: true, notes: arr, items: [], ghost };
  }
  let work: Tagged[] = notes.map((n, i) => ({ note: moved.get(i) || n, orig: i }));
  if (covered.size > 0) work = work.filter(w => !covered.has(w.orig));
  for (const orig of joins) {
    const pos = work.findIndex(w => w.orig === orig);
    if (pos < 0) continue;
    const dragType = work[pos].note.type;
    const chain = (work[pos].note as SlideNote).connections.map(c => ({ ...c }));
    // 排除自身：链端点与自身端点天然相等，不排除会自合并
    const merged = mergeChainWithSlides(work.map(w => w.note), chain, [pos]);
    if (merged.consumed.length === 0) continue;
    const type: 'Slide' | 'Long' = merged.type === 'Long' || dragType === 'Long' ? 'Long' : 'Slide';
    const consumedSet = new Set(merged.consumed);
    const out: Tagged[] = [];
    work.forEach((w, k) => {
      // 合并结果写回被拖滑条所在位置；其余被消耗滑条移除
      if (k === pos) {
        out.push({ note: { type, connections: merged.connections } as ChartNote, orig });
        return;
      }
      if (consumedSet.has(k)) return;
      out.push(w);
    });
    work = out;
  }

  const newNotes = work.map(w => w.note);
  const idxOf = new Map<number, number>();
  work.forEach((w, k) => idxOf.set(w.orig, k));
  const newItems = dragItems.map(it => {
    const re = connIdxRemap.get(it.noteIndex);
    return {
      ...it,
      noteIndex: idxOf.get(it.noteIndex) ?? it.noteIndex,
      ...(re && 'connIndex' in it && re.has(it.connIndex) ? { connIndex: re.get(it.connIndex)! } : {}),
    } as SelectionItem;
  });
  const ghost = [...new Set(newItems.map(it => it.noteIndex))].map(k => newNotes[k]);
  return { ok: true, notes: newNotes, items: newItems, ghost };
}

/**
 * 拖拽集合是否可作为拖拽起点（画布按下时判定，避免无意义拖拽）：
 * 过滤后存在可拖条目 = true。
 */
export function draggableFromItems(notes: readonly ChartNote[], items: readonly SelectionItem[]): SelectionItem[] {
  return items.filter(it => {
    const n = notes[it.noteIndex];
    if (!n) return false;
    if (it.kind === 'note') return isKey(n) || isSlideish(n);
    if (it.kind === 'slideNode') return isSlideish(n);
    // issue 09 S3（ADR-0009 §4）：slideRegion 可拖 = 拉弓变形（planDragMove 的 bend 分支处置）
    if (it.kind === 'slideRegion') return isSlideish(n);
    return false;
  });
}
