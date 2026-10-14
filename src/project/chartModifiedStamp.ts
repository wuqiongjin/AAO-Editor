// ProjectChart.lastModified 的戳机口径（issue 35 立档，CONTEXT.md「谱面长度与谱面工程」节同文存档）：
//
// lastModified = 谱面**记录最后一次被写入**的时刻（≠ 最后编辑、≠ 每次落盘）。
// 只有当前谱面的 notes 或保真字段（appliedChartCodeText / chartCodePristine）相对已载入记录
// **真变**才重戳 Date.now()；时长 / 音频 / 切 tab flush 这些不改谱面记录内容的落盘沿用记录里的旧值。
//
// 为什么单独一个模块：buildProject() 住在 React hook 里，条件戳的边界（真变才算）必须能单测；
// 比较口径是**记录内容级**（JSON 值语义），不是渲染语义——src/chart/editing/NotesEqual.ts 那个
// notesEqual 刻意忽略 source / spanParams / charge（为历史去重服务），拿来当戳机判据会把
// 「只改保真源数据」的落盘误判成无变化。
import type { ChartNote } from '../chart/types';
import type { ProjectChart } from './ChartProject';

/** 编辑态的保真字段（hook 侧的一个字段）；缺省视同未保真 */
export interface ChartModifiedFidelity {
  text?: string | null;
  pristine?: boolean;
}

/**
 * JSON 值级深比较（键序无关）：
 *   - `undefined` 值视同键缺席（JSON 往返会丢键， editor 里的显式 undefined 不算变化）；
 *   - 数组逐下标；对象按键集合 + 逐个值。
 */
function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => jsonValueEqual(v, bArr[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  for (const k of Object.keys(aObj)) {
    if (aObj[k] === undefined) continue;
    if (!jsonValueEqual(aObj[k], bObj[k])) return false;
  }
  // b 有（非 undefined）而 a 缺席 / 为 undefined 的键 ⇒ 记录内容差了一个字段，算变
  for (const k of Object.keys(bObj)) {
    if (bObj[k] === undefined) continue;
    if (aObj[k] === undefined) return false;
  }
  return true;
}

/** notes 记录内容是否真变（先引用相等短路：未编辑的会话快照与记录同源） */
export function chartNotesModified(next: ChartNote[], prev: ChartNote[]): boolean {
  return next !== prev && !jsonValueEqual(next, prev);
}

/**
 * 条件戳（issue 35）：notes 或保真字段相对记录真变 → 戳 `now`，否则沿用记录里的 `lastModified`。
 * 调用方（useChartProjectPersistence.buildProject）在**每一次**落盘前调用本函数——
 * 时长 / 音频 / 切 tab flush 走的也是同一条路，但它们不改谱面记录内容，故不重戳。
 */
export function stampChartModified(
  chart: ProjectChart,
  input: { notes: ChartNote[]; fidelity?: ChartModifiedFidelity | null; now: number },
): ProjectChart {
  const text = input.fidelity?.text ?? null;
  const pristine = input.fidelity?.pristine === true;
  const modified = chartNotesModified(input.notes, chart.notes)
    || text !== chart.appliedChartCodeText
    || pristine !== chart.chartCodePristine;
  return {
    ...chart,
    notes: input.notes,
    lastModified: modified ? input.now : chart.lastModified,
    appliedChartCodeText: text,
    chartCodePristine: pristine,
  };
}
