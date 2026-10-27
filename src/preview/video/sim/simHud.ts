// 仿真场 HUD 的**判定字 + AP combo 态**（chart-preview 51）。
//
// 对标实机（ガルパ），不对标 Bestdori / Sonolus。两条口径（用户 2026-10-26 逐轮拍板）：
//   - **Auto 永远 PERFECT**：判定只出 PERFECT，combo 全程走 AP 变色；本期不做档位开关。
//   - **判定字位置固定**：场地水平中线 × 判定线上方 0.092H（实机 t012 / t030 复核 —— 字**不跟轨道**
//     左右移动，双轨同时命中也只有一条）。
//
// 这里只给"什么时候、什么颜色"的纯函数；绘制在 `simField`（那一层才有场地度量与画笔）。
import type { SimChart } from './simField';

/**
 * 判定字（实机逐帧量测，2026-10-26 复核）：
 * 字心 `0.497 W`、离判定线 `0.092 H`、高 `0.042 H` ⇒ 宽约 `0.15–0.16 W`（图集本身的 287:79）。
 */
export interface SimJudgeStyle {
  /** 字心 X（场地宽的比例） */
  cx: number;
  /** 字心离判定线的距离（场地高的比例；2026-10-27 原型回填 0.10） */
  dy: number;
  /** 字高（场地高的比例；原型回填 0.08） */
  h: number;
  /** 停留时长（秒） */
  life: number;
  /** 淡入（秒） */
  fadeIn: number;
  /** 淡出（秒） */
  fadeOut: number;
  /** 命中瞬间的弹放时长（秒；0 = 不弹，与 combo 的 `pop` 同一条曲线） */
  pop: number;
}

export const SIM_JUDGE: SimJudgeStyle = {
  /** 字心 X（场地宽的比例） */
  cx: 0.497,
  /** 字心离判定线的距离（场地高的比例；2026-10-27 原型回填 0.10） */
  dy: 0.1,
  /** 字高（场地高的比例；原型回填 0.08） */
  h: 0.08,
  /** 停留时长（秒）：出字即满强度，末段淡出 */
  life: 1,
  /** 淡入（秒）：避免硬切 */
  fadeIn: 0.04,
  /** 淡出（秒） */
  fadeOut: 0.16,
  /** 弹放（秒） */
  pop: 0.2,
};

/**
 * `judgeskin/skin00/judge.png` 里 `judge_perfect` 的切图坐标
 * （`judge.asset` 原样，见 `docs/research/gbp-ui-assets.md` §5）。
 */
export function judgeSprite(): { x: number; y: number; w: number; h: number } {
  return { x: 0, y: 177, w: 287, h: 79 };
}

/**
 * 距离**最近一次命中**多少秒（`null` = 这一刻没有判定字可画）。
 *
 * 命中表升序，从尾部回扫：Auto 下每个可击打物都命中，密集谱面里这个窗口几乎一直亮着 ——
 * 与实机一致（判定字跟着音符节奏闪）。超出 `life` 就返回 null，调用方据此不画。
 */
export function judgeAt(
  chart: SimChart,
  seconds: number,
  life: number = SIM_JUDGE.life,
): number | null {
  const hits = chart.hitTimes;
  for (let i = hits.length - 1; i >= 0; i--) {
    const t = hits[i]!;
    if (t > seconds) continue;
    const age = seconds - t;
    return age <= life ? age : null;
  }
  return null;
}
