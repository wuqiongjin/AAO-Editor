// 工具轴状态（ADR-0008 §1 的持工具态）+ 粘贴持工具态的**负载来源**（issue 186 / ADR-0023 §4）。
//
// 为什么合成一份：工具轴上是同一个「粘贴」，但内容可能来自两处 —— 剪贴板（工具轨 / 快捷键）
// 或某个片段（点卡片）。三条不变量，靠**类型**而不是靠调用方自觉：
// 1. **点卡片不改写剪贴板**：片段来源是独立字段，剪贴板那份原封不动；
// 2. **切任何工具 = 回剪贴板来源**：包括"此态下再点工具轨「粘贴」"（ADR-0023 §4）；
// 3. `pattern !== null` ⇒ `armedTool === 'paste'`：由下面的联合类型直接表达，
//    `{ armedTool: null, pattern }` 这种形状编译就过不去。
import type { Pattern } from '../chart/patterns/types';
import type { ArmedTool } from './providers/UIProvider';

export type ArmedToolState =
  | { armedTool: Exclude<ArmedTool, 'paste'> | null; pattern: null }
  | { armedTool: 'paste'; pattern: Pattern | null };

/** 指针底态（也是唯一一份"没有持工具"的初值，引用稳定） */
export const POINTER_TOOL_STATE: ArmedToolState = { armedTool: null, pattern: null };

/**
 * 切工具（工具轨 / 快捷键 / Esc 退出都走这里）：一律丢弃片段来源。
 * 于是"片段粘贴态下再点工具轨「粘贴」"自然回落到剪贴板，不需要特判。
 */
export function withArmedTool(tool: ArmedTool | null): ArmedToolState {
  return tool === 'paste' ? { armedTool: 'paste', pattern: null } : { armedTool: tool, pattern: null };
}

/** 点片段卡片：进「粘贴」持工具态，负载来源换成该片段（**不碰剪贴板**） */
export function withPatternPaste(pattern: Pattern): ArmedToolState {
  return { armedTool: 'paste', pattern };
}

/**
 * 点卡片 = 进态；点**同一张**卡片 = 退出（回指针）—— 与工具轨"再点一次落回指针"同一手感，
 * 也是"这张卡现在是不是选中的"的唯一判据（抽屉据此高亮 + `aria-pressed`）。
 */
export function withPatternPasteToggled(state: ArmedToolState, pattern: Pattern): ArmedToolState {
  const isCurrent = state.armedTool === 'paste' && state.pattern?.id === pattern.id;
  return isCurrent ? POINTER_TOOL_STATE : withPatternPaste(pattern);
}
