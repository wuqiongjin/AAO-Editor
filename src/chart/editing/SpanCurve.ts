// SP 段曲线生成器（issue 09 S2 / ADR-0009 §1-§2）——纯函数，零 UI 依赖。
//
// 数据模型（ADR-0009 §1）：段参数随行、hidden 采样点是渲染/命中/导出的唯一真相。
// - 烘焙（bake）= 把段参数生成为密集 hidden 结点，写入 connections；
// - 参数自失效护栏（SlideSpanParams.visibleCount）：可见结点数失配 → 参数整体视为不存在，
//   故删结点/拆条/组合/代码回写等任何改动可见序列的路径无需逐个清参数；
// - 自由段 = 参数缺席（画笔/导入/拨弯产物），点集本身就是形态。
//
// 生成语义对标 Bestdori 曲线工具：段两端可见结点之间，按 `f = ceil(拍差 × precision)`
// 细分，p = 1..f-1 逐个生成 `{ beat: 起始拍 + p/precision, lane: clamp(起 lane + lane 差 × ease(p/f)), hidden: true }`。
// beat/lane 用十进制小数（Bestdori 同构：官方 SP 谱大量小数 lane）。
import type { ConnectionNote, SlideNote, LongNote, SpanEasingParam, SpanParam, SlideSpanParams } from '../types';
import { slideSpans, regionIdentity, type ConnSpan } from './SlideSegments';
import { easing, type CurvePrecision } from './Easing';
import { bakeTemplateParam } from './ShapeTemplates';

/** 连接点真实拍位（beat 十进制 + subBeat/beatDisplay 细分；导入谱 subBeat 缺省 → beat 即真值） */
export function connTrueBeat(conn: { beat: number; subBeat?: number }, beatDisplay: number): number {
  return conn.beat + (conn.subBeat || 0) / beatDisplay;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * 段参数 → 段内 hidden 采样点（不含两端可见端点）。三来源的统一烘焙入口：
 * 缓动 = Penner 函数逐细分采样；模板 = 库内点列直接映射；其余（自由段）不走本函数。
 */
export function bakeSpanPoints(
  from: { lane: number },
  to: { lane: number },
  fromBeat: number,
  toBeat: number,
  param: SpanParam,
): ConnectionNote[] {
  if (param.kind === 'template') return bakeTemplateParam(from, to, fromBeat, toBeat, param);
  return bakeEasingPoints(from, to, fromBeat, toBeat, param);
}

/**
 * 生成段内 hidden 采样点（**不含**两端可见端点）。
 * @param fromBeat/toBeat 两端真实拍位（toBeat 必须严格大于 fromBeat，调用方保证）
 */
export function bakeEasingPoints(
  from: { lane: number },
  to: { lane: number },
  fromBeat: number,
  toBeat: number,
  param: SpanEasingParam,
): ConnectionNote[] {
  const diff = toBeat - fromBeat;
  const f = Math.max(1, Math.ceil(diff * param.precision - 1e-9));
  const ease = easing(param.family, param.type);
  const out: ConnectionNote[] = [];
  for (let p = 1; p < f; p++) {
    out.push({
      beat: fromBeat + p / param.precision,
      lane: clamp(from.lane + (to.lane - from.lane) * ease(p / f), 0, 6),
      hidden: true,
    });
  }
  return out;
}

/** 幽灵/预览用：按段参数生成"若现在放置"的段连接点（端点 + 烘焙点）；缓动/模板两形态通吃 */
export function previewSpanConnections(
  from: { beat: number; lane: number },
  to: { beat: number; lane: number },
  param: SpanParam,
  beatDisplay: number,
): ConnectionNote[] {
  const fromBeat = connTrueBeat(from, beatDisplay);
  const toBeat = connTrueBeat(to, beatDisplay);
  if (!(toBeat > fromBeat)) return [{ ...from }, { ...to }];
  return [{ ...from }, ...bakeSpanPoints(from, to, fromBeat, toBeat, param), { ...to }];
}

/** 可见结点计数（hidden 不计） */
export function countVisibleNodes(conns: ConnectionNote[]): number {
  return conns.reduce((n, c) => (c.hidden ? n : n + 1), 0);
}

/**
 * 参数自失效护栏（ADR-0009 §1）：可见结点数与创建时不符 → 全部参数视为不存在。
 * 一切"读参数"的路径（重投影/就地编辑/导出判断）都必须经过本函数，不得直读 `slide.spanParams`。
 */
export function effectiveSpanParams(slide: SlideNote | LongNote): Record<number, SpanParam> {
  const sp: SlideSpanParams | undefined = slide.spanParams;
  if (!sp) return {};
  if (sp.visibleCount !== countVisibleNodes(slide.connections)) return {};
  return sp.bySpan;
}

/**
 * 组一条"链式草稿"滑条：可见锚点 + 各段按 params[序数] 烘焙（缺参数的段 = 直线）。
 * 曲线工具放置链与渲染预览共用（同一确定性重建，避免增量拼接的状态漂移）。
 */
export function buildChainedSlide(
  points: { beat: number; lane: number; subBeat?: number }[],
  params: Record<number, SpanParam>,
  beatDisplay: number,
): SlideNote {
  const connections: ConnectionNote[] = [];
  for (let k = 0; k < points.length; k++) {
    const pt = points[k]!;
    if (k > 0) {
      const prev = points[k - 1]!;
      const param = params[k - 1];
      if (param) {
        const fromBeat = connTrueBeat(prev, beatDisplay);
        const toBeat = connTrueBeat(pt, beatDisplay);
        if (toBeat > fromBeat) {
          connections.push(...bakeSpanPoints(prev, pt, fromBeat, toBeat, param));
        }
      }
    }
    connections.push({ beat: pt.beat, lane: pt.lane, subBeat: pt.subBeat });
  }
  return {
    type: 'Slide',
    connections,
    spanParams: { visibleCount: points.length, bySpan: { ...params } },
  };
}

/** 画笔（自由段）：起终点可见、途中采样点全 hidden；无参数（自由段 = 参数缺席） */
export function buildPenSlide(
  start: { beat: number; lane: number },
  samples: { beat: number; lane: number }[],
  end: { beat: number; lane: number },
): SlideNote {
  return {
    type: 'Slide',
    connections: [
      { beat: start.beat, lane: start.lane },
      ...samples.map((s) => ({ beat: s.beat, lane: s.lane, hidden: true as const })),
      { beat: end.beat, lane: end.lane },
    ],
  };
}

/**
 * 对滑条**每个逻辑段**应用同一参数（issue 09 验收反馈 #7：曲线工具框选 = 组合 + 全部段应用）。
 * 逐段 `regenerateSpan`（段内 hidden 重烘焙、参数覆盖写入）；无段的滑条原样返回。
 */
export function applyParamToAllSpans(
  slide: SlideNote | LongNote,
  param: SpanParam,
  beatDisplay: number,
): SlideNote | LongNote {
  let result: SlideNote | LongNote = slide;
  const ordinalCount = slideSpans(slide.connections).length;
  for (let ordinal = 0; ordinal < ordinalCount; ordinal++) {
    result = regenerateSpan(result, ordinal, param, beatDisplay);
  }
  return result;
}

/**
 * 对既有滑条的某个段**重新应用**缓动参数（就地编辑/换缓动的唯一写路径，ADR-0009 §2 三来源切换）：
 * 清掉段内既有 hidden 点 → 按 param 重烘焙 → 记录参数（护栏计数取重烘焙后的可见数，不变）。
 */
export function regenerateSpan(
  slide: SlideNote | LongNote,
  spanOrdinal: number,
  param: SpanParam,
  beatDisplay: number,
): SlideNote | LongNote {
  const conns = slide.connections;
  const sp = slideSpans(conns)[spanOrdinal];
  if (!sp) return slide;
  const from = conns[sp.start]!;
  const to = conns[sp.end]!;
  const fromBeat = connTrueBeat(from, beatDisplay);
  const toBeat = connTrueBeat(to, beatDisplay);
  const baked = toBeat > fromBeat ? bakeSpanPoints(from, to, fromBeat, toBeat, param) : [];
  const connections = [...conns.slice(0, sp.start + 1), ...baked, ...conns.slice(sp.end)];
  const bySpan = { ...effectiveSpanParams(slide), [spanOrdinal]: param };
  return {
    ...slide,
    connections,
    spanParams: { visibleCount: countVisibleNodes(connections), bySpan },
  };
}

/**
 * 端点移动后的**重投影**（ADR-0009 §4 拖端点 = 移动意图，参数保留）：
 * 段内 hidden 点按参数重新烘焙（端点新位、缓动不变）；无参数的段保持原 hidden 点原样。
 * 调用方（拖拽）已把新端点写进 connections，这里按段重生成 hidden 并保序合并参数。
 */
export function reprojectSpanParams(slide: SlideNote | LongNote, beatDisplay: number): SlideNote | LongNote {
  const bySpan = effectiveSpanParams(slide);
  const ordinals = Object.keys(bySpan);
  if (ordinals.length === 0) return slide;
  let result: SlideNote | LongNote = slide;
  // 逐段重烘焙（regenerateSpan 每次返回新对象；ordinal 不因 hidden 增删而变——按可见结点序数键）
  for (const key of ordinals) {
    const ordinal = Number(key);
    const param = bySpan[ordinal]!;
    result = regenerateSpan(result, ordinal, param, beatDisplay);
  }
  return result;
}

/** 抓取点归一化位置的兜底下限（防止 `t_grab` 落在 0/1 时分段线性除零） */
const GRAB_EPS = 1e-6;

/**
 * **捏形**权重（issue 108 / ADR-0009 §4 修订，**取代**原"拉弓变形"）：
 * 峰值在**抓取点** `grabT`、两端归零、分段线性——左 `w = t/g`、右 `w = (1−t)/(1−g)`。
 * `grabT = 0.5` 时与旧三角权重（`1−|2t−1|`）**逐点相同**：拉弓 = 抓中点的特例。
 */
export const pinchWeight = (t: number, grabT: number): number => {
  const g = clamp(grabT, GRAB_EPS, 1 - GRAB_EPS);
  return t <= g ? Math.max(0, t) / g : Math.max(0, 1 - t) / (1 - g);
};

/**
 * 抓取点的归一化位置：段内**拍位距 `grabBeat` 最近**的采样点（按下即锁定，整个拖拽期间不变）。
 * `grabBeat` 缺省（旧调用路径）或段内无采样点 → `0.5`（= 旧拉弓行为）。
 */
function grabRatioOf(
  middle: readonly ConnectionNote[],
  fromBeat: number,
  toBeat: number,
  grabBeat: number | undefined,
  beatDisplay: number,
): number {
  if (middle.length === 0 || grabBeat === undefined || !(toBeat > fromBeat)) return 0.5;
  let best = Infinity;
  let bestT = 0.5;
  for (const p of middle) {
    const b = connTrueBeat(p, beatDisplay);
    const d = Math.abs(b - grabBeat);
    if (d < best) {
      best = d;
      bestT = (b - fromBeat) / (toBeat - fromBeat);
    }
  }
  return clamp(bestT, GRAB_EPS, 1 - GRAB_EPS);
}

/**
 * 捏形（issue 09 S3 / ADR-0009 §4，**2026-09-16 由"拉弓变形"改为"捏形"**）：
 * 拖该滑条的某段（region）= **lane 方向拨弯**——两端可见结点锚定不动，段内 hidden 点按
 * **以抓取点为峰值的分段线性权重**跟随 `dLane` 位移；beat 不动（时间单向）。
 * `grabBeat` = 按下时锁定的抓取点拍位（缺省 = 段中点 = 旧拉弓）。
 * **拨弯即转化（Q10=B）**：普通段（无 hidden）先按 `precision` 栅格补直线上采样点再弯，
 * 就地成为自由段（SP 段）。
 * **一动就自由化**：被拨段的缓动参数清除（其余段参数保留——visibleCount 不变、护栏不破）。
 * 返回新对象；`dLane = 0` 或段不存在 → 原引用（无变化）。
 */
export function bendSpan(
  slide: SlideNote | LongNote,
  connIndex: number,
  dLane: number,
  beatDisplay: number,
  precision: CurvePrecision = 16,
  /** 按下时锁定的抓取点拍位（未量化）。缺省 = 段中点（旧拉弓行为） */
  grabBeat?: number,
): SlideNote | LongNote {
  if (dLane === 0) return slide;
  const conns = slide.connections;
  const id = regionIdentity(conns, connIndex);
  if (!id) return slide;
  const sp = id.span;
  const from = conns[sp.start]!;
  const to = conns[sp.end]!;
  const fromBeat = connTrueBeat(from, beatDisplay);
  const toBeat = connTrueBeat(to, beatDisplay);
  if (!(toBeat > fromBeat)) return slide;

  // 段内既有 hidden + （普通段时）新补的采样点，一起参与捏形
  const inserted: ConnectionNote[] = sp.end - sp.start === 1
    ? (() => {
        // 普通段（无 hidden）：在**原直线弦**上按 1/precision 栅格补采样点 → 一并拉弯（Q10=B 拨弯即转化；
        // 线性插值，不引入任何缓动形状——弯出来的形 = 位移场本身）
        const f = Math.max(1, Math.ceil((toBeat - fromBeat) * precision - 1e-9));
        const out: ConnectionNote[] = [];
        for (let p = 1; p < f; p++) {
          out.push({
            beat: fromBeat + p / precision,
            lane: clamp(from.lane + (to.lane - from.lane) * (p / f), 0, 6),
            hidden: true,
          });
        }
        return out;
      })()
    : [];
  const sampled = [...conns.slice(sp.start + 1, sp.end), ...inserted];
  // 段内一个采样点都没有（段极短 → 补点也是 0）→ 无从捏形：返回原引用，不制造"无变化的 undo 步"
  if (sampled.length === 0) return slide;
  const grabT = grabRatioOf(sampled, fromBeat, toBeat, grabBeat, beatDisplay);
  const middle = sampled.map((p) => {
    const t = (connTrueBeat(p, beatDisplay) - fromBeat) / (toBeat - fromBeat);
    const w = pinchWeight(t, grabT);
    return { ...p, lane: clamp(p.lane + dLane * w, 0, 6) };
  });
  const connections = [...conns.slice(0, sp.start + 1), ...middle, ...conns.slice(sp.end)];

  // 一动就自由化：清除被拨段的参数（可见数不变，其余段参数保留）
  const spanOrdinal = id.ordinal;
  const bySpan = { ...effectiveSpanParams(slide) };
  if (spanOrdinal >= 0) delete bySpan[spanOrdinal];
  const hasParams = Object.keys(bySpan).length > 0;
  // 注意 spanParams 必须显式覆写（undefined 也在内）：`...slide` 会把旧参数原样带回
  return { ...slide, connections, spanParams: hasParams ? { visibleCount: countVisibleNodes(connections), bySpan } : undefined };
}

/**
 * 自由段端点跟随重映射（ADR-0009 §4 拖端点 = 移动意图：自由段**相对形态保持**、整体拉伸）。
 * `prevConns` = 拖拽前的连接点（提供旧端点用于求投影参数 t），`conns` = 已写新端点的连接点
 * （会被浅拷贝后改写段内 hidden 点）。段端点在两次快照中必须同下标（拖拽不增删结点，成立）。
 * 无 hidden 的段 → 原样返回。
 */
export function remapFreeSpanHidden(
  conns: ConnectionNote[],
  prevConns: ConnectionNote[],
  sp: ConnSpan,
  beatDisplay: number,
): ConnectionNote[] {
  const hasHidden = sp.end - sp.start > 1;
  if (!hasHidden) return conns;
  const oFrom = prevConns[sp.start]!;
  const oTo = prevConns[sp.end]!;
  const nFrom = conns[sp.start]!;
  const nTo = conns[sp.end]!;
  const oFromBeat = connTrueBeat(oFrom, beatDisplay);
  const oToBeat = connTrueBeat(oTo, beatDisplay);
  if (!(oToBeat > oFromBeat)) return conns;
  const nFromBeat = connTrueBeat(nFrom, beatDisplay);
  const nToBeat = connTrueBeat(nTo, beatDisplay);
  const out = [...conns];
  for (let i = sp.start + 1; i < sp.end; i++) {
    const p = prevConns[i]!;
    const t = (connTrueBeat(p, beatDisplay) - oFromBeat) / (oToBeat - oFromBeat);
    const laneChordOld = oFrom.lane + (oTo.lane - oFrom.lane) * t;
    const laneChordNew = nFrom.lane + (nTo.lane - nFrom.lane) * t;
    out[i] = {
      ...p,
      beat: nFromBeat + (nToBeat - nFromBeat) * t,
      lane: clamp(laneChordNew + (p.lane - laneChordOld), 0, 6),
    };
  }
  return out;
}
