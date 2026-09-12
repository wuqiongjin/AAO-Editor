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
import type { ConnectionNote, SlideNote, LongNote, SpanEasingParam, SlideSpanParams } from '../types';
import { slideSpans } from './SlideSegments';
import { easing, type CurvePrecision, type EasingFamily, type EasingType } from './Easing';

/** 连接点真实拍位（beat 十进制 + subBeat/beatDisplay 细分；导入谱 subBeat 缺省 → beat 即真值） */
export function connTrueBeat(conn: { beat: number; subBeat?: number }, beatDisplay: number): number {
  return conn.beat + (conn.subBeat || 0) / beatDisplay;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

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

/** 幽灵/预览用：按当前配置生成"若现在放置"的段连接点（端点 + 烘焙点） */
export function previewEasedConnections(
  from: { beat: number; lane: number },
  to: { beat: number; lane: number },
  family: EasingFamily,
  type: EasingType,
  precision: CurvePrecision,
  beatDisplay: number,
): ConnectionNote[] {
  const fromBeat = connTrueBeat(from, beatDisplay);
  const toBeat = connTrueBeat(to, beatDisplay);
  if (!(toBeat > fromBeat)) return [{ ...from }, { ...to }];
  const param: SpanEasingParam = { kind: 'easing', family, type, precision };
  return [{ ...from }, ...bakeEasingPoints(from, to, fromBeat, toBeat, param), { ...to }];
}

/** 可见结点计数（hidden 不计） */
export function countVisibleNodes(conns: ConnectionNote[]): number {
  return conns.reduce((n, c) => (c.hidden ? n : n + 1), 0);
}

/**
 * 参数自失效护栏（ADR-0009 §1）：可见结点数与创建时不符 → 全部参数视为不存在。
 * 一切"读参数"的路径（重投影/就地编辑/导出判断）都必须经过本函数，不得直读 `slide.spanParams`。
 */
export function effectiveSpanParams(slide: SlideNote | LongNote): Record<number, SpanEasingParam> {
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
  params: Record<number, SpanEasingParam>,
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
          connections.push(...bakeEasingPoints(prev, pt, fromBeat, toBeat, param));
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
 * 对既有滑条的某个段**重新应用**缓动参数（就地编辑/换缓动的唯一写路径，ADR-0009 §2 三来源切换）：
 * 清掉段内既有 hidden 点 → 按 param 重烘焙 → 记录参数（护栏计数取重烘焙后的可见数，不变）。
 */
export function regenerateSpan(
  slide: SlideNote | LongNote,
  spanOrdinal: number,
  param: SpanEasingParam,
  beatDisplay: number,
): SlideNote | LongNote {
  const conns = slide.connections;
  const sp = slideSpans(conns)[spanOrdinal];
  if (!sp) return slide;
  const from = conns[sp.start]!;
  const to = conns[sp.end]!;
  const fromBeat = connTrueBeat(from, beatDisplay);
  const toBeat = connTrueBeat(to, beatDisplay);
  const baked = toBeat > fromBeat ? bakeEasingPoints(from, to, fromBeat, toBeat, param) : [];
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
