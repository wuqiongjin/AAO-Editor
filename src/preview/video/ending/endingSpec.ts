// 谱面结束后的**结尾段**（chart-preview 52）：中央章 → 黑幕转场 → 结算。
//
// 版式已定稿（票 52「最终版式 · 原型 v9」，2026-10-26 用户：「最终定稿」）——
// `ENDING_SPEC` 就是用户交回的那份参数 JSON，**键名照抄**；运行时没有参数面板，
// 只有 `settings.export.ending.{enabled, stamp}` 两个开关。
//
// 两条硬口径：
//   - **几何按帧的百分比定义**：`%H` = 帧高、`%W` = 帧宽（1920×1080 下 1%H = 10.8px）。
//   - **三段时长钉死**（首期不可调）：章 3.0 + 黑幕转场 1.55 + 结算停留 2.95 = 7.5s。

/** 中央章形态：AP 彩虹字样 / FC / 普通 Clear（无章） */
export type EndingStamp = 'ap' | 'fc' | 'clear';

/** 中央章候选（导出弹窗「结算形态」三档；顺序即 UI 顺序） */
export const ENDING_STAMPS: readonly EndingStamp[] = ['ap', 'fc', 'clear'];

/** 爆炸配色（`cycle` = 暖 / 冷 / 粉紫 / 混合 按波次轮换） */
export type EndingPalette = 'cycle' | 'warm' | 'cool' | 'pink' | 'mix';

/**
 * 定稿参数表（票 52 · 最终版式 · 原型 v9 的整份 JSON）。
 *
 * 改版式时对着票面改这里，别在绘制里散落魔数：`endingUnits()` 负责 % → px 的换算，
 * 其余（计数 / 字重 / 配色）直接读本表。
 */
export const ENDING_SPEC = {
  // 时序（三段总长 = ENDING_SECONDS）
  stampDur: 3,
  transDur: 1.55,
  resultDur: 2.95,
  // 顶栏
  barX: 8.25,
  barY: 12.9,
  barW: 85,
  barH: 5.2,
  barR: 0.8,
  starSize: 4,
  starDX: 3.3,
  diffX: 6.5,
  diffH: 3.2,
  diffFont: 2.08,
  diffPadX: 1.45,
  titleX: 18.85,
  titleFont: 3.1,
  titleWeight: 400,
  lvRight: 2.35,
  lvNumFont: 2.35,
  lvLabelFont: 2.35,
  // 白卡
  cardRight: 12,
  cardW: 66.7,
  cardTop: 32,
  cardR: 1,
  rowFirst: 5.6,
  rowPitch: 5.9,
  labelH: 4.6,
  labelX: 2.5,
  countRight: 33,
  countFont: 3.6,
  countWeight: 400,
  countDY: 0.7,
  lineInset: 2.25,
  lineLen: 20,
  lineOffset: 2.1,
  padBottom: 3.5,
  comboX: 40,
  comboY: 5,
  comboW: 20,
  comboH: 18.2,
  comboDark: 0.575,
  comboFont: 3,
  comboValueFont: 3.6,
  apH: 5,
  apGap: 4.05,
  apDX: 0.1,
  // 封面
  coverSize: 45,
  coverX: 21.2,
  coverY: 50,
  coverFrame: 0.3,
  coverShadow: 0.45,
  bgBlur: 6,
  bgBright: 65,
  bgScrim: 42,
  bgFadeFrom: 30,
  bgFadeTo: 56,
  // 中央章
  stampW: 62.2,
  stampY: 50.5,
  stampIn: 1,
  stampOut: 0.25,
  partCount: 56,
  partSize: 3.5,
  partSpeed: 1,
  palette: 'cycle' as EndingPalette,
  burst2At: 24,
  burst2X: 34,
  burst2Y: 62,
  burst3At: 42,
  burst3X: 66,
  burst3Y: 36,
  burst4At: 62,
  burst4Points: 4,
  burst5At: 80,
  burst5Points: 5,
  wordGlow: 0,
  // 舞台两层在结尾段里的收场（秒，相对结尾段起点）：
  //   - combo `dur = 0` ⇒ **瞬时消失**（结尾段第一帧就不画），游戏里也是打完就收；
  //   - 轨道 1.0s 慢慢退，结算只剩背景（2026-10-27 原型回填）。
  comboFadeAt: 0,
  comboFadeDur: 0,
  trackFadeAt: 0,
  trackFadeDur: 1,
} as const;

/**
 * 参数表的**可写宽化版**：`ENDING_SPEC` 是 `as const`（键名照抄票面、首期不可变），
 * 调参 / 原型要按同一套键覆盖，故派生一份可变形状。绘制一律收这个类型，
 * 缺省 = `ENDING_SPEC`，行为与以前逐像素一致。
 */
export type EndingSpec = {
  -readonly [K in keyof typeof ENDING_SPEC]: (typeof ENDING_SPEC)[K];
};

/** 参数表里出现的键 */
export type EndingSpecKey = keyof typeof ENDING_SPEC;
/** **数值**参数的键（`palette` 是字符串，不参与 % → px 换算） */
export type EndingUnitKey = {
  [K in EndingSpecKey]: (typeof ENDING_SPEC)[K] extends number ? K : never;
}[EndingSpecKey];

/** ① 中央章（含 5 波粒子） */
export const ENDING_STAMP_SECONDS = ENDING_SPEC.stampDur;
/** ② 黑幕转场（盖黑 → 停一拍 → 抬幕，组件逐个入场藏在幕布后） */
export const ENDING_TRANS_SECONDS = ENDING_SPEC.transDur;
/** ③ 结算停留 */
export const ENDING_RESULT_SECONDS = ENDING_SPEC.resultDur;
/** 结尾段总长；导出总长 =（开场 6.75，若开）+ 谱面 + 它 */
export const ENDING_SECONDS = ENDING_SPEC.stampDur + ENDING_SPEC.transDur + ENDING_SPEC.resultDur;

/**
 * 一帧的单位换算：`hp` = %H → px、`wp` = %W → px。
 *
 * 强调「按**帧**高缩放」而不是按场地：导出画布 1920×1080，场地是 1920×1078（上下各 1px 边），
 * 结尾 UI 画在整帧上，嵌进场地矩形会整体缩 0.2%（票 52 定案）。
 */
export interface EndingUnits {
  /** 画布宽（帧 px） */
  readonly w: number;
  /** 画布高（帧 px） */
  readonly h: number;
  /** %H → px */
  hp(key: EndingUnitKey): number;
  /** %W → px */
  wp(key: EndingUnitKey): number;
  /** 这一帧用的参数表（缺省 = `ENDING_SPEC`；原型 / 调参按同一套键覆盖） */
  readonly spec: EndingSpec;
}

export function endingUnits(w: number, h: number, spec: EndingSpec = ENDING_SPEC): EndingUnits {
  return {
    w,
    h,
    spec,
    hp: (key) => (spec[key] / 100) * h,
    wp: (key) => (spec[key] / 100) * w,
  };
}
